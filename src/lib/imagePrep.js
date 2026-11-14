/**
 * Image preparation for uploads (Nov 14, 2026) — the app sizes
 * pictures FOR the customer. The owner's rule: nobody is ever told
 * to shrink a photo themselves; many customers are not tech-savvy
 * and don't know how. A picked image is decoded with its EXIF
 * orientation honored, downscaled to a sane long edge, and
 * re-encoded before upload, so an ordinary phone photo uploads
 * as-is with no customer action. The server's cap then judges the
 * PREPARED image and effectively never trips on a real photo.
 *
 * Any failure in here returns the original file untouched — the
 * upload still proceeds and the server answers plainly. Nothing in
 * this module ever blocks an upload by itself.
 */

const MAX_EDGE = 1600;
const JPEG_QUALITY = 0.85;
const SKIP_UNDER_BYTES = 1.5 * 1024 * 1024;

async function decodeImage(file) {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
      return { source: bitmap, width: bitmap.width, height: bitmap.height, close: () => bitmap.close?.() };
    } catch {
      // Fall through to the <img> path (older engines).
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = reject;
      img.src = url;
    });
    return { source: img, width: img.naturalWidth, height: img.naturalHeight, close: () => {} };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * prepareImageForUpload(file, { preserveFormat }) → Blob | File
 * Photos (default): re-encode as JPEG at 0.85 over a white ground
 * (JPEG has no transparency). Logos (preserveFormat): PNG/WebP
 * keep their format and transparency.
 */
export async function prepareImageForUpload(file, { preserveFormat = false } = {}) {
  try {
    if (!file || !String(file.type || '').startsWith('image/')) return file;
    const { source, width, height, close } = await decodeImage(file);
    try {
      if (!width || !height) return file;
      const scale = Math.min(1, MAX_EDGE / Math.max(width, height));
      if (scale === 1 && file.size <= SKIP_UNDER_BYTES) return file;
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(width * scale));
      canvas.height = Math.max(1, Math.round(height * scale));
      const ctx = canvas.getContext('2d');
      if (!ctx) return file;
      const outType = preserveFormat && ['image/png', 'image/webp'].includes(file.type)
        ? file.type
        : 'image/jpeg';
      if (outType === 'image/jpeg') {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }
      ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, outType, JPEG_QUALITY));
      return blob && blob.size < file.size ? blob : file;
    } finally {
      close();
    }
  } catch {
    return file;
  }
}
