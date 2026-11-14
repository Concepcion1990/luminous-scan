import { Image } from '@/components/ui/image';
import { formatMoney } from '@/lib/inventory';
import { effectivePrice } from '@/lib/pricing';
import { toLabel } from '@/lib/labelPayload';
import { t } from '@/lib/i18n';
import BarcodeSvg from './BarcodeSvg';
import QrSvg from './QrSvg';

export const TEMPLATES = [
  { key: 'price', label: 'Price tag', labelKey: 'print.templatePrice', hint: 'Large price with name and SKU', hintKey: 'print.templatePriceHint', width: 'w-[52mm]' },
  { key: 'shelf', label: 'Shelf label', labelKey: 'print.templateShelf', hint: 'Name, price and barcode', hintKey: 'print.templateShelfHint', width: 'w-[70mm]' },
  { key: 'barcode', label: 'Barcode / SKU', labelKey: 'print.templateBarcode', hint: 'Scannable Code 128', hintKey: 'print.templateBarcodeHint', width: 'w-[62mm]' },
  { key: 'qr', label: 'QR label', labelKey: 'print.templateQr', hint: 'Scans straight into the app', hintKey: 'print.templateQrHint', width: 'w-[44mm]' },
  { key: 'bin', label: 'Storage bin', labelKey: 'print.templateBin', hint: 'Big code with QR', hintKey: 'print.templateBinHint', width: 'w-[80mm]' },
  { key: 'sheet', label: 'Product sheet', labelKey: 'print.templateSheet', hint: 'Full details, one per page', hintKey: 'print.templateSheetHint', width: 'w-[180mm]' },
  {
    key: 'count',
    label: 'Stock count sheet',
    labelKey: 'print.countSheetTitle',
    hint: 'Counted column for each item',
    hintKey: 'print.templateCountHint',
    kind: 'document',
  },
  {
    key: 'pick',
    label: 'Pick list',
    labelKey: 'print.pickListTitle',
    hint: 'Tick-off list with quantities',
    hintKey: 'print.templatePickHint',
    kind: 'document',
  },
  {
    key: 'po',
    label: 'Purchase order',
    labelKey: 'print.purchaseOrderTitle',
    hint: 'Costed order to send the supplier',
    hintKey: 'print.templatePoHint',
    kind: 'order',
    mode: 'po',
  },
  {
    key: 'packing',
    label: 'Supplier packing slip',
    labelKey: 'print.templatePacking',
    hint: 'Quantities only, no prices',
    hintKey: 'print.templatePackingHint',
    kind: 'order',
    mode: 'packing',
  },
  {
    key: 'invoice',
    label: 'Customer invoice',
    labelKey: 'print.templateInvoice',
    hint: 'Priced order with totals',
    hintKey: 'print.templateInvoiceHint',
    kind: 'customer',
    mode: 'invoice',
  },
  {
    key: 'receipt',
    label: 'Sales receipt',
    labelKey: 'print.salesReceiptTitle',
    hint: 'Compact proof of payment',
    hintKey: 'print.templateReceiptHint',
    kind: 'customer',
    mode: 'receipt',
  },
  {
    key: 'custpacking',
    label: 'Customer packing slip',
    labelKey: 'print.templateCustPacking',
    hint: 'Quantities only, no prices',
    hintKey: 'print.templateCustPackingHint',
    kind: 'customer',
    mode: 'packing',
  },
  {
    key: 'shipping',
    label: 'Shipping label',
    labelKey: 'print.templateShipping',
    hint: '4×6 label with the buyer name and address',
    hintKey: 'print.templateShippingHint',
    width: 'w-[102mm]',
    kind: 'customer',
    mode: 'shipping',
  },
  {
    key: 'returndoc',
    label: 'Return document',
    labelKey: 'print.templateReturnDoc',
    hint: 'What came back and its condition',
    hintKey: 'print.templateReturnDocHint',
    kind: 'return',
  },
];

export function labelCodes(product) {
  return {
    barcode: (product.barcode || product.upc || product.sku || '').trim(),
    qr: (product.qr_code || product.sku || product.upc || '').trim(),
  };
}

const shell =
  'print-label flex flex-col overflow-hidden border border-dashed border-foreground/25 bg-white text-black';

function Name({ product, className = '' }) {
  return <p className={`truncate font-semibold leading-tight ${className}`}>{product.name}</p>;
}

/**
 * One label in the browser-print preview.
 *
 * Takes a `product` — or a generic `label` payload ({ title, lines,
 * code, codeType }, src/lib/labelPayload.js) for an aisle tag or a
 * stock-room bin label. A generic label is viewed through the same
 * templates: title as the name, the code as the big identifier and
 * the barcode / QR, the detail lines as the small print. The 'bin'
 * template is the natural fit for a location label. The label
 * generators (ESC/POS, Bluetooth / USB, client + server PDF) speak
 * the same payload, so a location label and a product label share
 * one path end to end.
 */
export default function LabelCard({ template, product: productProp, label, business }) {
  const generic = label ? toLabel(label) : null;
  const product = generic
    ? {
        name: generic.title,
        sku: generic.code,
        barcode: generic.code,
        upc: generic.code,
        qr_code: generic.code,
        price: null,
        condition: generic.lines.join(' · '),
        isbn: '',
        author: '',
        category: '',
        unit: '',
        notes: '',
        photo_urls: [],
      }
    : productProp;
  const { barcode, qr } = labelCodes(product);
  // Printed labels carry the EFFECTIVE price — the clearance price,
  // or the rollback price while its window runs (migration 018) —
  // because the label must match what the customer pays today.
  const effective = effectivePrice(product);
  const price =
    (product.price === null || product.price === undefined || product.price === '') && effective === 0
      ? ''
      : formatMoney(effective, business.currency);
  const condition = product.condition || '';

  if (template === 'price') {
    return (
      <div className={`${shell} w-[52mm] gap-1 p-2`}>
        <Name product={product} className="text-[8pt]" />
        <p className="text-[20pt] font-bold leading-none">{price}</p>
        <p className="truncate font-mono text-[6pt] uppercase tracking-wide">{product.sku}</p>
      </div>
    );
  }

  if (template === 'shelf') {
    return (
      <div className={`${shell} w-[70mm] gap-1 p-2`}>
        <Name product={product} className="text-[9pt]" />
        <div className="flex items-end justify-between gap-2">
          <p className="text-[14pt] font-bold leading-none">{price}</p>
          <p className="truncate font-mono text-[6pt]">{product.sku}</p>
        </div>
        <BarcodeSvg value={barcode} className="h-8 w-full" />
      </div>
    );
  }

  if (template === 'barcode') {
    return (
      <div className={`${shell} w-[62mm] gap-1 p-2`}>
        <Name product={product} className="text-[8pt]" />
        <BarcodeSvg value={barcode} className="h-10 w-full" />
        <p className="text-center font-mono text-[7pt] tracking-wide">{barcode}</p>
      </div>
    );
  }

  if (template === 'qr') {
    return (
      <div className={`${shell} w-[44mm] items-center gap-1 p-2`}>
        <QrSvg value={qr} className="h-[26mm] w-[26mm]" />
        <Name product={product} className="max-w-full text-center text-[7pt]" />
        <p className="truncate font-mono text-[6pt]">{product.sku}</p>
      </div>
    );
  }

  if (template === 'bin') {
    return (
      <div className={`${shell} w-[80mm] gap-1 p-2`}>
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate text-[14pt] font-bold leading-none">{product.sku}</p>
            <Name product={product} className="mt-1 text-[7pt]" />
            {condition && <p className="truncate text-[6pt] uppercase tracking-wide">{condition}</p>}
          </div>
          <QrSvg value={qr} className="h-[18mm] w-[18mm] shrink-0" />
        </div>
        <BarcodeSvg value={barcode} className="h-7 w-full" />
      </div>
    );
  }

  // Product sheet
  const facts = [
    ['SKU', product.sku],
    ['UPC / EAN', product.upc],
    ['ISBN', product.isbn],
    [t('print.factAuthor'), product.author],
    [t('print.factCondition'), condition],
    [t('print.factCategory'), product.category],
    [t('print.factPrice'), product.price ? price : ''],
    [t('print.factUnit'), product.unit],
  ].filter(([, value]) => value);

  return (
    <div className={`${shell} print-page-break w-[180mm] gap-3 p-4`}>
      <div className="flex items-start justify-between gap-4 border-b border-black/20 pb-2">
        <div>
          <p className="font-mono text-[6pt] uppercase tracking-[0.18em]">{business.name}</p>
          <p className="text-[16pt] font-semibold leading-tight">{product.name}</p>
          {product.author && <p className="text-[9pt]">{t('print.byAuthor', { author: product.author })}</p>}
        </div>
        {product.photo_urls?.[0] && (
          <Image
            src={product.photo_urls[0]}
            alt={product.name}
            fittingType="fill"
            className="h-[26mm] w-[26mm] shrink-0 rounded border border-black/15 object-cover"
          />
        )}
      </div>

      <div className="flex flex-wrap gap-x-6 gap-y-1">
        {facts.map(([key, value]) => (
          <p key={key} className="text-[8pt]">
            <span className="font-mono text-[6pt] uppercase tracking-wide text-black/60">{key} </span>
            {value}
          </p>
        ))}
      </div>

      {product.notes && (
        <p className="whitespace-pre-line text-[8pt] leading-snug">{product.notes}</p>
      )}

      <div className="mt-auto flex items-end gap-4 pt-2">
        <div className="min-w-0 flex-1">
          <BarcodeSvg value={barcode} className="h-10 w-full" />
          <p className="text-center font-mono text-[7pt]">{barcode}</p>
        </div>
        <QrSvg value={qr} className="h-[22mm] w-[22mm] shrink-0" />
      </div>
    </div>
  );
}