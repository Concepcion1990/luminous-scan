/**
 * Product photos for the server-side print PDFs (print family,
 * Nov 24, 2026 — the owner's ruling: wherever a printed document
 * lists a product, its stored photo prints beside the item, on the
 * server PDF twins exactly as on the screen documents).
 *
 * A product's first stored photo lives in the product_photos table
 * (uploaded bytes, base64) and is named by products.photo_urls[0]
 * as /api/photos/<id> — the same source the browser documents use.
 * This helper resolves a set of products to { productId: dataUrl }
 * so the jsPDF builders can embed the image. A product with no
 * photo, a dangling reference, or an undecodable row simply has no
 * entry — the document prints exactly as it did before, with no
 * placeholder and no failure.
 */
const PHOTO_REF = /\/api\/photos\/([^/?#]+)/;

export function photoIdOf(product) {
  // Raw pool rows can carry photo_urls as a JSON string; the
  // entity layer's rows carry the parsed array. Both are read.
  let urls = product?.photo_urls;
  if (typeof urls === 'string') {
    try {
      urls = JSON.parse(urls);
    } catch {
      urls = [];
    }
  }
  if (!Array.isArray(urls)) return null;
  for (const url of urls) {
    const match = PHOTO_REF.exec(String(url || ''));
    if (match) return match[1];
  }
  return null;
}

export async function photoDataByProductId(pool, products) {
  const wanted = new Map();
  for (const product of products || []) {
    const photoId = photoIdOf(product);
    if (photoId && product?.id) wanted.set(photoId, product.id);
  }
  const out = {};
  if (!wanted.size) return out;
  const ids = [...wanted.keys()];
  const placeholders = ids.map((_, i) => `$${i + 1}`).join(', ');
  const { rows } = await pool.query(
    `SELECT id, content_type, data_base64 FROM product_photos WHERE id IN (${placeholders})`,
    ids,
  );
  for (const row of rows || []) {
    const productId = wanted.get(row.id);
    if (!productId || !row.data_base64) continue;
    const type = String(row.content_type || 'image/jpeg').toLowerCase();
    if (!type.startsWith('image/')) continue;
    out[productId] = `data:${type};base64,${row.data_base64}`;
  }
  return out;
}

/** jsPDF image format for a data URL produced above. */
export function pdfImageFormat(dataUrl) {
  if (typeof dataUrl !== 'string') return null;
  if (dataUrl.startsWith('data:image/png')) return 'PNG';
  if (dataUrl.startsWith('data:image/jpeg') || dataUrl.startsWith('data:image/jpg')) return 'JPEG';
  if (dataUrl.startsWith('data:image/webp')) return 'WEBP';
  return null;
}

/**
 * Draw a product photo into a jsPDF document at (x, y) sized w×h.
 * Returns false (drawing nothing) when there is no usable image —
 * callers lay out exactly as before in that case.
 */
export function drawPdfPhoto(doc, dataUrl, x, y, w, h) {
  const format = pdfImageFormat(dataUrl);
  if (!format) return false;
  try {
    doc.addImage(dataUrl, format, x, y, w, h);
    return true;
  } catch {
    return false;
  }
}
