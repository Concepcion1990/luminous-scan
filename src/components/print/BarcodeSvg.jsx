import { code128Rects } from '@/lib/code128';

/** A Code 128 barcode drawn as SVG, ready for print. */
export default function BarcodeSvg({ value, className = 'h-10 w-full' }) {
  const code = code128Rects(value);
  if (!code) return null;

  return (
    <svg
      viewBox={`0 0 ${code.width} 100`}
      preserveAspectRatio="none"
      className={className}
      shapeRendering="crispEdges"
      role="img"
      aria-label={`Barcode ${value}`}
    >
      <rect x="0" y="0" width={code.width} height="100" fill="#ffffff" />
      {code.rects.map((rect) => (
        <rect key={rect.x} x={rect.x} y="6" width={rect.w} height="88" fill="#000000" />
      ))}
    </svg>
  );
}