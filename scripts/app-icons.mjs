/**
 * App-icon emission (Nov 24, 2026) — the installed app must wear
 * the globe, not Chrome's generated letter tile.
 *
 * THE DEFECT (diagnosis ~/workspace/diagnosis-app-icon/report.md):
 * the manifest offered the icon ONLY as SVG files, and there was
 * no raster icon anywhere — no PNG, no favicon.ico, no
 * apple-touch-icon. Windows shortcut/taskbar icons are raster
 * surfaces and Chromium's Windows install pipeline does not build
 * them from SVG manifest icons, so installs fell back to a
 * generated letter tile ("L", white on dark). No "L" asset ever
 * existed in the repo; Chrome manufactured it at install time.
 *
 * THE FIX: emit the raster family at build time from the PNG
 * masters that already live inside public/icon-192.svg and
 * public/icon-512.svg (the GitHub snapshot push is UTF-8/text
 * only, so the masters travel as base64 inside SVG wrappers —
 * the PNGs are born during the build, from text already in the
 * repo). The artwork is never redrawn or substituted:
 *  - icon-192.png / icon-512.png are the masters' own bytes,
 *    byte-for-byte.
 *  - apple-touch-icon.png (180×180) is a resize of the 192 master.
 *  - icon-maskable-512.png is the 512 master scaled into the
 *    maskable safe zone (central 80%) on the master's own cream.
 *  - favicon.ico wraps 16/32/48 PNG resizes of the 192 master.
 *
 * Pure Node (node:zlib only) — the production build is
 * node:20-slim with no image tooling, so nothing here may lean
 * on sharp/PIL/ImageMagick. The functions are exported so the
 * test group (tests/t66) can prove the emitted files by reading
 * their real headers and pixels, not by trusting a build log.
 */
import { inflateSync, deflateSync } from 'node:zlib';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/* ---------------- PNG primitives ---------------- */

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

// Table CRC-32 (PNG's polynomial) — implemented locally so the
// build never depends on a Node version new enough to carry
// zlib.crc32.
const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

export function crc32(buffer) {
  let c = 0xffffffff;
  for (let i = 0; i < buffer.length; i += 1) {
    c = CRC_TABLE[(c ^ buffer[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

/** Read just the IHDR facts of a PNG buffer. */
export function pngInfo(buffer) {
  if (buffer.length < 33 || !buffer.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new Error('not a PNG (bad signature)');
  }
  if (buffer.toString('ascii', 12, 16) !== 'IHDR') throw new Error('not a PNG (no IHDR)');
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
    bitDepth: buffer[24],
    colorType: buffer[25],
    interlace: buffer[28],
  };
}

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

/**
 * Decode a PNG to raw pixels. Supports exactly what the masters
 * are: bit depth 8, color type 2 (RGB) or 6 (RGBA),
 * non-interlaced. Anything else is a loud error, never a guess.
 * Returns { width, height, channels, pixels }.
 */
export function decodePng(buffer) {
  const info = pngInfo(buffer);
  if (info.bitDepth !== 8) throw new Error(`unsupported PNG bit depth ${info.bitDepth}`);
  if (info.colorType !== 2 && info.colorType !== 6) {
    throw new Error(`unsupported PNG color type ${info.colorType}`);
  }
  if (info.interlace !== 0) throw new Error('interlaced PNGs are not supported');
  const channels = info.colorType === 2 ? 3 : 4;
  const idat = [];
  let offset = 8;
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    if (type === 'IDAT') idat.push(buffer.subarray(offset + 8, offset + 8 + length));
    offset += 12 + length;
    if (type === 'IEND') break;
  }
  if (idat.length === 0) throw new Error('PNG carries no IDAT');
  const raw = inflateSync(Buffer.concat(idat));
  const stride = info.width * channels;
  const pixels = Buffer.alloc(info.height * stride);
  let pos = 0;
  for (let y = 0; y < info.height; y += 1) {
    const filter = raw[pos];
    pos += 1;
    const rowStart = y * stride;
    const upStart = rowStart - stride;
    for (let x = 0; x < stride; x += 1) {
      const value = raw[pos];
      pos += 1;
      const left = x >= channels ? pixels[rowStart + x - channels] : 0;
      const up = y > 0 ? pixels[upStart + x] : 0;
      const upLeft = y > 0 && x >= channels ? pixels[upStart + x - channels] : 0;
      let recon;
      switch (filter) {
        case 0: recon = value; break;
        case 1: recon = value + left; break;
        case 2: recon = value + up; break;
        case 3: recon = value + ((left + up) >> 1); break;
        case 4: recon = value + paeth(left, up, upLeft); break;
        default: throw new Error(`unknown PNG filter ${filter}`);
      }
      pixels[rowStart + x] = recon & 0xff;
    }
  }
  return { width: info.width, height: info.height, channels, pixels };
}

/** Encode RGB pixels (3 bytes/px) as a PNG, Paeth-filtered. */
export function encodePngRgb({ width, height, pixels }) {
  const stride = width * 3;
  if (pixels.length !== height * stride) throw new Error('pixel buffer size mismatch');
  const raw = Buffer.alloc(height * (stride + 1));
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * (stride + 1);
    raw[rowStart] = 4; // Paeth
    const srcStart = y * stride;
    const upStart = srcStart - stride;
    for (let x = 0; x < stride; x += 1) {
      const left = x >= 3 ? pixels[srcStart + x - 3] : 0;
      const up = y > 0 ? pixels[upStart + x] : 0;
      const upLeft = y > 0 && x >= 3 ? pixels[upStart + x - 3] : 0;
      raw[rowStart + 1 + x] = (pixels[srcStart + x] - paeth(left, up, upLeft)) & 0xff;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type RGB
  return Buffer.concat([
    PNG_SIGNATURE,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

/**
 * Area-average resize of an RGB image. Every destination pixel
 * averages the source rectangle it maps to (fractional edges
 * weighted), which is the honest way to shrink artwork: no
 * dropped rows, no invented detail.
 */
export function resizeRgb({ width, height, pixels }, targetWidth, targetHeight) {
  const out = Buffer.alloc(targetWidth * targetHeight * 3);
  const scaleX = width / targetWidth;
  const scaleY = height / targetHeight;
  for (let dy = 0; dy < targetHeight; dy += 1) {
    const sy0 = dy * scaleY;
    const sy1 = sy0 + scaleY;
    for (let dx = 0; dx < targetWidth; dx += 1) {
      const sx0 = dx * scaleX;
      const sx1 = sx0 + scaleX;
      let r = 0;
      let g = 0;
      let b = 0;
      let weightTotal = 0;
      for (let sy = Math.floor(sy0); sy < Math.ceil(sy1); sy += 1) {
        const wy = Math.min(sy1, sy + 1) - Math.max(sy0, sy);
        if (wy <= 0) continue;
        for (let sx = Math.floor(sx0); sx < Math.ceil(sx1); sx += 1) {
          const wx = Math.min(sx1, sx + 1) - Math.max(sx0, sx);
          if (wx <= 0) continue;
          const w = wx * wy;
          const idx = (sy * width + sx) * 3;
          r += pixels[idx] * w;
          g += pixels[idx + 1] * w;
          b += pixels[idx + 2] * w;
          weightTotal += w;
        }
      }
      const outIdx = (dy * targetWidth + dx) * 3;
      out[outIdx] = Math.round(r / weightTotal);
      out[outIdx + 1] = Math.round(g / weightTotal);
      out[outIdx + 2] = Math.round(b / weightTotal);
    }
  }
  return { width: targetWidth, height: targetHeight, pixels: out };
}

/* ---------------- ICO ---------------- */

/**
 * Assemble a classic .ico from PNG payloads (PNG-compressed
 * entries, the form every Windows since Vista reads).
 * entries: [{ size, png }] — square sizes only.
 */
export function buildIco(entries) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(entries.length, 4);
  const directory = Buffer.alloc(16 * entries.length);
  let offset = 6 + directory.length;
  entries.forEach((entry, i) => {
    const at = i * 16;
    directory[at] = entry.size >= 256 ? 0 : entry.size; // width (0 means 256)
    directory[at + 1] = entry.size >= 256 ? 0 : entry.size; // height
    directory[at + 2] = 0; // palette colors
    directory[at + 3] = 0; // reserved
    directory.writeUInt16LE(1, at + 4); // planes
    directory.writeUInt16LE(32, at + 6); // bits per pixel
    directory.writeUInt32LE(entry.png.length, at + 8);
    directory.writeUInt32LE(offset, at + 12);
    offset += entry.png.length;
  });
  return Buffer.concat([header, directory, ...entries.map((e) => e.png)]);
}

/** Read back an .ico's directory: [{ width, height, bytesInRes, offset }]. */
export function icoInfo(buffer) {
  if (buffer.length < 6 || buffer.readUInt16LE(0) !== 0 || buffer.readUInt16LE(2) !== 1) {
    throw new Error('not an ICO');
  }
  const count = buffer.readUInt16LE(4);
  const entries = [];
  for (let i = 0; i < count; i += 1) {
    const at = 6 + i * 16;
    entries.push({
      width: buffer[at] === 0 ? 256 : buffer[at],
      height: buffer[at + 1] === 0 ? 256 : buffer[at + 1],
      bytesInRes: buffer.readUInt32LE(at + 8),
      offset: buffer.readUInt32LE(at + 12),
    });
  }
  return entries;
}

/* ---------------- The family ---------------- */

/** Pull the base64 PNG master out of an SVG wrapper file. */
export function extractMasterPng(svgText) {
  const match = svgText.match(/data:image\/png;base64,([A-Za-z0-9+/=]+)/);
  if (!match) throw new Error('SVG wrapper carries no PNG master');
  return Buffer.from(match[1], 'base64');
}

/**
 * The maskable render: the 512 master scaled so the whole frame
 * sits inside the central 80% (the maskable safe zone is the
 * central circle of 80% diameter — the scaled frame's corners
 * are plain cream, identical to the canvas fill, so nothing of
 * the globe can ever be cropped by an OS shape mask), centered
 * on a 512×512 canvas filled with the master's own corner color.
 */
export function buildMaskable(master512) {
  const size = 512;
  const inner = Math.round(size * 0.8); // 410
  const offset = Math.floor((size - inner) / 2); // 51
  const bg = [master512.pixels[0], master512.pixels[1], master512.pixels[2]];
  const canvas = Buffer.alloc(size * size * 3);
  for (let i = 0; i < size * size; i += 1) {
    canvas[i * 3] = bg[0];
    canvas[i * 3 + 1] = bg[1];
    canvas[i * 3 + 2] = bg[2];
  }
  const scaled = resizeRgb(master512, inner, inner);
  for (let y = 0; y < inner; y += 1) {
    const srcStart = y * inner * 3;
    const dstStart = ((y + offset) * size + offset) * 3;
    scaled.pixels.copy(canvas, dstStart, srcStart, srcStart + inner * 3);
  }
  return { width: size, height: size, pixels: canvas };
}

/**
 * Emit the full raster icon family into outDir, from the SVG
 * wrappers in publicDir. Returns the list of file names written.
 */
export function generateAppIcons({ publicDir, outDir }) {
  const master192 = extractMasterPng(readFileSync(path.join(publicDir, 'icon-192.svg'), 'utf8'));
  const master512 = extractMasterPng(readFileSync(path.join(publicDir, 'icon-512.svg'), 'utf8'));
  const decoded192 = decodePng(master192);
  const decoded512 = decodePng(master512);
  if (decoded192.width !== 192 || decoded192.height !== 192) {
    throw new Error(`icon-192 master is ${decoded192.width}x${decoded192.height}, expected 192x192`);
  }
  if (decoded512.width !== 512 || decoded512.height !== 512) {
    throw new Error(`icon-512 master is ${decoded512.width}x${decoded512.height}, expected 512x512`);
  }
  if (decoded192.channels !== 3 || decoded512.channels !== 3) {
    throw new Error('icon masters must be RGB (color type 2)');
  }

  const files = {
    // The masters' own bytes — the artwork, byte-for-byte.
    'icon-192.png': master192,
    'icon-512.png': master512,
    // iPhone/iPad home screen: 180×180 from the 192 master.
    'apple-touch-icon.png': encodePngRgb(resizeRgb(decoded192, 180, 180)),
    // Android adaptive / shape-cropping surfaces.
    'icon-maskable-512.png': encodePngRgb(buildMaskable(decoded512)),
    // The legacy surface: a real .ico (16/32/48 PNG entries).
    'favicon.ico': buildIco(
      [16, 32, 48].map((size) => ({
        size,
        png: encodePngRgb(resizeRgb(decoded192, size, size)),
      })),
    ),
  };

  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
  for (const [name, bytes] of Object.entries(files)) {
    writeFileSync(path.join(outDir, name), bytes);
  }
  return Object.keys(files);
}
