/**
 * A product's stored photo on a printed document (print family,
 * Nov 24, 2026 — the owner's ruling: wherever a document lists a
 * product, its photo prints beside the item). Renders nothing
 * when the product has no photo, so a photo-less product's paper
 * is exactly the paper it always was. The source is the same one
 * the Product sheet has always used: the product's first stored
 * photo (photo_urls[0], served from /api/photos/<id>).
 */
export default function DocPhoto({ url, className = 'h-[9mm] w-[9mm]' }) {
  if (!url) return null;
  return (
    <img
      src={url}
      alt=""
      className={`doc-photo shrink-0 rounded-[1mm] object-cover ${className}`}
    />
  );
}

/** The first stored photo URL of a product row, or ''. */
export function firstPhotoUrl(product) {
  return Array.isArray(product?.photo_urls) ? product.photo_urls[0] || '' : '';
}
