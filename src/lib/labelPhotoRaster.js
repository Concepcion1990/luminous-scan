/**
 * A product photo as ESC/POS raster bytes (print family,
 * Nov 24, 2026 — the barcode/QR labels print the product's
 * picture in EVERY path, including the direct-to-printer
 * Bluetooth / USB sends).
 *
 * The photo is fetched and rasterised HERE, by the async
 * callers (bluetoothPrint / usbPrint), and rides the label
 * payload as `photoRaster` — src/lib/escPos.js itself stays
 * pure and synchronous, exactly as its contract requires: no
 * DOM work at byte-build time beyond what the caller prepared.
 *
 * The raster is a GS v 0 bit image: the photo scaled to
 * LABEL_PHOTO_DOTS wide (proportional height, capped), each
 * pixel thresholded to black or white — the one picture format
 * every ESC/POS thermal printer speaks. ANY failure along the
 * way (offline, photo gone, no canvas in this browser) returns
 * null, and the label prints exactly as it did before photos
 * joined labels — never a broken print job over a picture.
 */
import { toLabel } from './labelPayload.js';

export const LABEL_PHOTO_DOTS = 160;
const MAX_PHOTO_HEIGHT_DOTS = 240;
const BLACK_BELOW = 160; // luminance threshold: darker prints black

export async function photoToEscPosRaster(url, { widthDots = LABEL_PHOTO_DOTS } = {}) {
  try {
    if (!url || typeof fetch !== 'function') return null;
    const response = await fetch(url);
    if (!response.ok) return null;
    const blob = await response.blob();
    const bitmap = await createImageBitmap(blob);
    const width = widthDots;
    const height = Math.max(
      8,
      Math.min(MAX_PHOTO_HEIGHT_DOTS, Math.round((bitmap.height / bitmap.width) * widthDots)),
    );
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(bitmap, 0, 0, width, height);
    if (typeof bitmap.close === 'function') bitmap.close();
    const { data } = ctx.getImageData(0, 0, width, height);
    const bytesPerRow = Math.ceil(width / 8);
    const raster = new Uint8Array(bytesPerRow * height);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const i = (y * width + x) * 4;
        const luminance = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
        if (data[i + 3] > 0 && luminance < BLACK_BELOW) {
          raster[y * bytesPerRow + (x >> 3)] |= 0x80 >> (x & 7);
        }
      }
    }
    // GS v 0, mode 0 (normal density), then width-in-bytes and
    // height-in-dots as little-endian 16-bit counts.
    const header = [
      0x1d, 0x76, 0x30, 0x00,
      bytesPerRow & 0xff, (bytesPerRow >> 8) & 0xff,
      height & 0xff, (height >> 8) & 0xff,
    ];
    const out = new Uint8Array(header.length + raster.length);
    out.set(header, 0);
    out.set(raster, header.length);
    return out;
  } catch {
    return null;
  }
}

/**
 * Prepare label payloads with photo rasters attached, for the
 * direct-printer callers. Products without a photo — and every
 * location label — pass through with no raster, unchanged.
 */
export async function withLabelRasters(items) {
  return Promise.all(
    (items || []).map(async (item) => {
      const label = toLabel(item);
      if (!label.photo) return label;
      const photoRaster = await photoToEscPosRaster(label.photo);
      return photoRaster ? { ...label, photoRaster } : label;
    }),
  );
}
