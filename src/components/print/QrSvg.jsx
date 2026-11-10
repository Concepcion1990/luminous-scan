import { qrMatrix } from '@/lib/qr';
import { t } from '@/lib/i18n';

/** A QR code drawn as SVG, ready for print. */
export default function QrSvg({ value, className = 'h-16 w-16' }) {
  const matrix = qrMatrix(value);
  if (!matrix) {
    return (
      <p className="text-[6pt] leading-tight text-black/60">{t('print.qrTooLong')}</p>
    );
  }

  const quiet = 2;
  const size = matrix.size + quiet * 2;
  const path = matrix.modules
    .map((row, r) =>
      row
        .map((dark, c) => (dark ? `M${quiet + c} ${quiet + r}h1v1h-1z` : ''))
        .join('')
    )
    .join('');

  return (
    <svg
      viewBox={`0 0 ${size} ${size}`}
      className={className}
      shapeRendering="crispEdges"
      role="img"
      aria-label={t('print.qrLabel', { value })}
    >
      <rect width={size} height={size} fill="#ffffff" />
      <path d={path} fill="#000000" />
    </svg>
  );
}