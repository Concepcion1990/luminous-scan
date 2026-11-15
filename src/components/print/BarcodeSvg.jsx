import { barcodeRects } from '@/lib/barcodeSym';
import { code128Rects } from '@/lib/code128';
import { t } from '@/lib/i18n';

// Barcodes print at their NATURAL proportions (owner ruling,
// Nov 14, 2026): a fixed module width like real product packaging,
// never stretched to fill the label. 0.25mm per module puts a
// 12-digit code at roughly 44mm wide — compact, centered, with
// clear space at both edges of the label.
const MODULE_MM = 0.25;
// Code 128 quiet zones: 10 modules of white on each side.
const QUIET_MODULES = 10;

/**
 * A barcode drawn as SVG, ready for print — in the code's native
 * symbology (UPC-A / EAN-13 / Code 128, see barcodeSym.js), at
 * natural proportions, never stretched to the label's width.
 */
export default function BarcodeSvg({ value, className = 'h-10', variant = 'natural' }) {
  // The storage bin label is EXEMPT by the owner's word (Nov 14,
  // 2026): she loves it exactly as-is — the SKU's Code 128 drawn
  // long along the bottom. variant="legacy" renders that original
  // form byte-for-byte; every product-identity label uses natural.
  if (variant === 'legacy') {
    const legacy = code128Rects(value);
    if (!legacy) return null;
    return (
      <svg
        viewBox={`0 0 ${legacy.width} 100`}
        preserveAspectRatio="none"
        className={className}
        shapeRendering="crispEdges"
        role="img"
        aria-label={t('print.barcodeLabel', { value })}
      >
        <rect x="0" y="0" width={legacy.width} height="100" fill="#ffffff" />
        {legacy.rects.map((rect) => (
          <rect key={rect.x} x={rect.x} y="6" width={rect.w} height="88" fill="#000000" />
        ))}
      </svg>
    );
  }
  const code = barcodeRects(value);
  if (!code) return null;

  const totalModules = code.width + QUIET_MODULES * 2;
  const widthMm = (totalModules * MODULE_MM).toFixed(1);

  return (
    <svg
      viewBox={`0 0 ${totalModules} 100`}
      preserveAspectRatio="none"
      className={className}
      style={{ width: `${widthMm}mm`, maxWidth: '100%' }}
      shapeRendering="crispEdges"
      role="img"
      aria-label={t('print.barcodeLabel', { value })}
    >
      <rect x="0" y="0" width={totalModules} height="100" fill="#ffffff" />
      {code.rects.map((rect) => (
        <rect
          key={rect.x}
          x={rect.x + QUIET_MODULES}
          y={rect.tall ? 2 : 6}
          width={rect.w}
          height={rect.tall ? 96 : 88}
          fill="#000000"
        />
      ))}
    </svg>
  );
}
