/**
 * Server-side PDF documents — T5 (plan §2.12).
 *
 * jsPDF 4.2.1, already a dependency, runs in Node (verified: it
 * produces a real %PDF-1.3 document with no browser). No print-vendor
 * SDK, no paid service, no pdf-lib — jsPDF proved usable server-side.
 *
 * What is printed here, and for whom:
 *  - Labels: BOTH plans (product codes + scannable code text + SKU).
 *    The barcode is drawn as REAL bars (owner catch, Nov 18, 2026):
 *    labels used to render the code as text only — "the server has
 *    no barcode font" — but jsPDF draws the bars as plain rectangles
 *    from the encoders in server/barcodeSym.js (the mirror of
 *    src/lib/barcodeSym.js), in the code's native symbology with
 *    the digits beneath, exactly as the client labels PDF
 *    (src/lib/labelsPdf.js) and the browser-print templates do. A
 *    code that cannot be encoded keeps the honest text rendering.
 *  - Packing slips, purchase orders, supplier docs, reports:
 *    Business-only (enforced on the routes, not here).
 *
 * Every builder returns a Buffer. Tests assert a valid %PDF header,
 * a non-trivial size, and the expected content strings.
 *
 * Document labels render in the business's language
 * (server/printLabels.js, Nov 15, 2026) with a per-string English
 * fallback for anything the standard PDF fonts cannot encode.
 */
import { jsPDF } from 'jspdf';
import { printLabelsFor, fillLabel } from './printLabels.js';
import { drawPrintText, splitPrintText } from './printFonts.js';
import { barcodeRects } from './barcodeSym.js';
import { drawPdfPhoto } from './printPhotos.js';

// Barcode geometry, shared with src/lib/labelsPdf.js so the two
// PDFs agree bar for bar: 0.25mm per module like the SVG label
// templates, 10 modules of quiet zone each side, shrunk only when
// a long code would overflow the label.
const BAR_MODULE_PT = (0.25 * 72) / 25.4;
const BAR_QUIET_MODULES = 10;
const BAR_MAX_WIDTH_PT = 200;
const BAR_HEIGHT_PT = 24;

/**
 * Draw the code's barcode bars centred at centerX, tops at topY.
 * Returns false when the code has no encodable barcode (empty or
 * outside Code 128 set B) — the caller then falls back to text.
 */
function drawLabelBarcode(doc, code, centerX, topY) {
  const sym = barcodeRects(code);
  if (!sym) return false;
  const totalModules = sym.width + BAR_QUIET_MODULES * 2;
  const modulePt = Math.min(BAR_MODULE_PT, BAR_MAX_WIDTH_PT / totalModules);
  const x0 = centerX - (totalModules * modulePt) / 2 + BAR_QUIET_MODULES * modulePt;
  doc.setFillColor(0, 0, 0);
  for (const rect of sym.rects) {
    // Guard bars (tall) run 2pt above and 2pt below the rest, as
    // on real packaging.
    const tall = rect.tall === true;
    doc.rect(
      x0 + rect.x * modulePt,
      tall ? topY - 2 : topY,
      rect.w * modulePt,
      tall ? BAR_HEIGHT_PT + 4 : BAR_HEIGHT_PT,
      'F',
    );
  }
  return true;
}

// Every string these builders draw goes through the print-fonts
// helper: WinAnsi-safe text draws exactly as before in the standard
// fonts; a string in a script the standard fonts cannot encode
// draws in the embedded font for its script (server/printFonts.js).
const text = (doc, value, x, y, options) => drawPrintText(doc, value, x, y, options);
const split = (doc, value, width) => splitPrintText(doc, value, width);

const money = (value, currency = 'USD', locale) => {
  const amount = Number(value) || 0;
  try {
    // Grouping follows the business's locale (leftovers sweep, Nov
    // 15, 2026); the amount itself is untouched — Intl currency
    // formatting keeps exactly two fraction digits, cents and all.
    return new Intl.NumberFormat(locale && locale !== 'en' ? locale : 'en-US', {
      style: 'currency',
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `$${amount.toFixed(2)}`;
  }
};

function newDoc(businessName) {
  const doc = new jsPDF({ unit: 'pt', format: 'letter' });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(90, 90, 90);
  // White-label rule (T6 customization): the paper carries the STORE's
  // own business name — never the app name or logo. When no store name
  // is set, nothing is printed here at all.
  if (businessName) text(doc, String(businessName), 40, 36);
  doc.setFontSize(9);
  return doc;
}

function footer(doc, label, labels) {
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i += 1) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setTextColor(140, 140, 140);
    text(doc, `${label} · ${fillLabel(labels.pageOf, { page: i, pages })}`, 40, 756);
  }
}

function toBuffer(doc) {
  return Buffer.from(doc.output('arraybuffer'));
}

function codeOf(product) {
  return String(product.barcode || product.upc || product.sku || product.qr_code || '').trim();
}

/**
 * One label's payload — the server mirror of src/lib/labelPayload.js
 * (the server imports nothing from src/, so the mapping is kept
 * here in miniature; the shape is the same: { title, lines, code,
 * codeType }). A product row maps to it; a location / bin label will
 * map to it the same way when the aisle feature lands.
 */
function toLabel(item, labelsText, locale) {
  if (!item) return { title: labelsText.untitled, lines: [], code: '', codeType: 'CODE128' };
  if (typeof item.title === 'string') {
    return {
      title: item.title.slice(0, 42),
      lines: Array.isArray(item.lines) ? item.lines.map(String) : [],
      code: String(item.code || '').trim(),
      codeType: item.codeType || 'CODE128',
      photoData: item.photoData || '',
    };
  }
  const lines = [];
  if (item.price !== null && item.price !== undefined && item.price !== '') {
    lines.push(money(item.price, 'USD', locale));
  }
  if (item.sku) lines.push(fillLabel(labelsText.skuLine, { sku: item.sku }));
  return {
    title: String(item.name || labelsText.untitled).slice(0, 42),
    lines,
    code: codeOf(item),
    codeType: 'CODE128',
    // The product's photo, resolved by the route from the stored
    // photo bytes (print family, Nov 24, 2026); empty when the
    // product has none.
    photoData: item.photoData || '',
  };
}

/** Labels, both plans. One label per item per copy — product or location. */
export function buildLabelsPdf(items, { copies = 1, businessName = '', language = 'en' } = {}) {
  const labelsText = printLabelsFor(language);
  const doc = newDoc(businessName);
  const perCopy = Math.min(Math.max(Number(copies) || 1, 1), 20);
  const labels = (items || [])
    .map((item) => toLabel(item, labelsText, language))
    .flatMap((label) => Array.from({ length: perCopy }, () => label));
  if (!labels.length) throw new Error(labelsText.chooseLabel);
  const labelW = 252;
  const labelH = 144;
  const gap = 12;
  const cols = 2;
  let x = 40;
  let y = 56;
  let col = 0;
  labels.forEach((label, index) => {
    if (index > 0 && col === 0 && y + labelH > 740) {
      doc.addPage();
      y = 56;
    }
    doc.setDrawColor(180, 180, 180);
    doc.rect(x, y, labelW, labelH);
    doc.setTextColor(30, 30, 30);
    doc.setFontSize(11);
    doc.setFont('helvetica', 'bold');
    // The product's photo at the label's top-right corner — the
    // server twin of the client labels PDF (print family,
    // Nov 24, 2026); the title narrows only when a photo rides.
    const hasPhoto = drawPdfPhoto(doc, label.photoData, x + labelW - 54, y + 8, 44, 44);
    text(
      doc,
      split(doc, String(label.title || labelsText.untitled), hasPhoto ? labelW - 74 : labelW - 20),
      x + 10,
      y + 20,
    );
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    label.lines.slice(0, 3).forEach((line, i) => {
      text(doc, String(line), x + 10, y + 52 + i * 16);
    });
    const codeY = Math.max(84, 52 + Math.min(label.lines.length, 3) * 16);
    const code = label.code || '';
    if (drawLabelBarcode(doc, code, x + labelW / 2, y + codeY - 12)) {
      // The digits under the bars — the number stays human-readable
      // exactly as on the browser-print price tag.
      doc.setFontSize(10);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(30, 30, 30);
      text(doc, code, x + labelW / 2, y + codeY + 23, { align: 'center' });
    } else {
      doc.setFontSize(13);
      doc.setFont('helvetica', 'bold');
      text(doc, code || labelsText.noCode, x + 10, y + codeY, { maxWidth: labelW - 20 });
    }
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(90, 90, 90);
    text(doc, fillLabel(labelsText.codeLine, { code: code || '—' }), x + 10, y + codeY + 36);
    col += 1;
    if (col >= cols) {
      col = 0;
      x = 40;
      y += labelH + gap;
    } else {
      x += labelW + gap;
    }
  });
  footer(doc, labelsText.labels, labelsText);
  return toBuffer(doc);
}

/** Customer packing slip (quantities only, no prices) — Business. */
export function buildPackingSlipPdf(order, business, { photoDataById = {} } = {}) {
  const labels = printLabelsFor(business?.language);
  const doc = newDoc(business?.name);
  doc.setTextColor(30, 30, 30);
  doc.setFontSize(16);
  doc.setFont('helvetica', 'bold');
  text(doc, labels.packingSlip, 40, 64);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  text(doc, fillLabel(labels.orderLine, { number: order.number || '' }), 40, 84);
  text(doc, fillLabel(labels.customerLine, { name: order.customer_name || '' }), 40, 100);
  if (order.order_date) text(doc, fillLabel(labels.orderedLine, { date: order.order_date }), 40, 116);
  let y = 148;
  doc.setFont('helvetica', 'bold');
  text(doc, labels.product, 40, y);
  text(doc, labels.qty, 420, y);
  doc.setFont('helvetica', 'normal');
  y += 18;
  (order.lines || []).forEach((line) => {
    const qty = line.qty ?? line.quantity ?? line.qty_ordered ?? 0;
    // The product's photo beside its name (print family, Nov 24,
    // 2026) when the route resolved one; the name shifts right
    // only on rows that actually carry a picture.
    const hasPhoto = drawPdfPhoto(doc, photoDataById[line.product_id], 40, y - 9, 12, 12);
    text(doc, String(line.product_name || line.sku || labels.item), hasPhoto ? 58 : 40, y);
    text(doc, String(qty), 420, y);
    y += hasPhoto ? 18 : 16;
    if (y > 720) {
      doc.addPage();
      y = 56;
    }
  });
  footer(doc, `${labels.packingSlip} ${order.number || ''}`, labels);
  return toBuffer(doc);
}

/**
 * Purchase order (mode 'po': with costs) or supplier packing slip
 * (mode 'packing': quantities only, no prices) — Business.
 */
export function buildPoPdf(order, business, { mode = 'po', photoDataById = {} } = {}) {
  const labels = printLabelsFor(business?.language);
  const doc = newDoc(business?.name);
  doc.setTextColor(30, 30, 30);
  doc.setFontSize(16);
  doc.setFont('helvetica', 'bold');
  text(doc, mode === 'packing' ? labels.supplierPackingSlip : labels.purchaseOrder, 40, 64);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  text(doc, fillLabel(labels.poLine, { number: order.number || '' }), 40, 84);
  text(doc, fillLabel(labels.supplierLine, { name: order.supplier_name || '' }), 40, 100);
  if (order.order_date) text(doc, fillLabel(labels.orderedLine, { date: order.order_date }), 40, 116);
  if (order.expected_date) text(doc, fillLabel(labels.expectedLine, { date: order.expected_date }), 40, 132);
  text(doc, fillLabel(labels.statusLine, { status: order.status || '' }), 40, 148);
  let y = 180;
  doc.setFont('helvetica', 'bold');
  text(doc, labels.product, 40, y);
  text(doc, labels.qty, 340, y);
  if (mode === 'po') {
    text(doc, labels.unitCost, 400, y);
    text(doc, labels.lineTotal, 490, y);
  }
  doc.setFont('helvetica', 'normal');
  y += 18;
  (order.lines || []).forEach((line) => {
    const qty = Number(line.qty_ordered) || 0;
    const cost = Number(line.unit_cost) || 0;
    // The product's photo beside its name (print family, Nov 24,
    // 2026) — on the purchase order and its packing slip alike.
    const hasPhoto = drawPdfPhoto(doc, photoDataById[line.product_id], 40, y - 9, 12, 12);
    text(doc, String(line.product_name || line.sku || labels.item), hasPhoto ? 58 : 40, y);
    text(doc, String(qty), 340, y);
    if (mode === 'po') {
      text(doc, money(cost, business?.currency, business?.language), 400, y);
      text(doc, money(qty * cost, business?.currency, business?.language), 490, y);
    }
    y += hasPhoto ? 18 : 16;
    if (y > 720) {
      doc.addPage();
      y = 56;
    }
  });
  if (mode === 'po') {
    y += 8;
    doc.setFont('helvetica', 'bold');
    text(doc, fillLabel(labels.subtotalLine, { amount: money(order.subtotal, business?.currency, business?.language) }), 400, y);
    y += 16;
    text(doc, fillLabel(labels.totalLine, { amount: money(order.total, business?.currency, business?.language) }), 400, y);
    doc.setFont('helvetica', 'normal');
  }
  if (order.note) {
    y += 24;
    doc.setFontSize(9);
    doc.setTextColor(90, 90, 90);
    text(doc, split(doc, fillLabel(labels.noteLine, { note: order.note }), 480), 40, y);
  }
  footer(doc, `${labels.purchaseOrder} ${order.number || ''}`, labels);
  return toBuffer(doc);
}

/** Supplier profile sheet with its open orders — Business. */
export function buildSupplierDocPdf(supplier, business, openOrders = []) {
  const labels = printLabelsFor(business?.language);
  const doc = newDoc(business?.name);
  doc.setTextColor(30, 30, 30);
  doc.setFontSize(16);
  doc.setFont('helvetica', 'bold');
  text(doc, fillLabel(labels.supplierTitle, { name: supplier.name || '' }), 40, 64);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  let y = 88;
  const fields = [
    [labels.contact, supplier.contact_name || ''],
    [labels.email, supplier.email || ''],
    [labels.phone, supplier.phone || ''],
    [labels.account, supplier.account_number || ''],
    [labels.leadTime, supplier.lead_time_days ? fillLabel(labels.leadTimeDays, { days: supplier.lead_time_days }) : ''],
    [labels.website, supplier.website || ''],
    [labels.address, supplier.address || ''],
  ];
  fields.forEach(([label, value]) => {
    if (!value) return;
    text(doc, `${label}: ${value}`, 40, y);
    y += 16;
  });
  if (supplier.notes) {
    y += 8;
    doc.setFontSize(9);
    doc.setTextColor(90, 90, 90);
    text(doc, split(doc, supplier.notes, 480), 40, y);
    y += 32;
  }
  y += 16;
  doc.setTextColor(30, 30, 30);
  doc.setFontSize(12);
  doc.setFont('helvetica', 'bold');
  text(doc, labels.openPurchaseOrders, 40, y);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  y += 20;
  if (!openOrders.length) {
    text(doc, labels.noOpenOrders, 40, y);
  }
  openOrders.forEach((po) => {
    const received = (po.lines || []).reduce((s, l) => s + (Number(l.qty_received) || 0), 0);
    const ordered = (po.lines || []).reduce((s, l) => s + (Number(l.qty_ordered) || 0), 0);
    text(doc, fillLabel(labels.receivedLine, { number: po.number || '', status: po.status || '', received, ordered }), 40, y);
    y += 16;
    if (y > 720) {
      doc.addPage();
      y = 56;
    }
  });
  footer(doc, fillLabel(labels.supplierLine, { name: supplier.name || '' }), labels);
  return toBuffer(doc);
}

/** One report as a PDF — Business. Same rows the server report endpoint returns. */
export function buildReportPdf(report, business, { from = '', to = '', photoDataById = {} } = {}) {
  const labels = printLabelsFor(business?.language);
  const doc = newDoc(business?.name);
  doc.setTextColor(30, 30, 30);
  doc.setFontSize(16);
  doc.setFont('helvetica', 'bold');
  text(doc, String(report?.report?.label || labels.reportFallback), 40, 64);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  text(doc, fillLabel(labels.groupedBy, { group: (report?.groupLabel || '').toLowerCase() }), 40, 84);
  if (from || to) text(doc, fillLabel(labels.periodLine, { from: from || labels.earliest, to: to || labels.today }), 40, 100);
  let y = 132;
  doc.setFont('helvetica', 'bold');
  text(doc, labels.group, 40, y);
  text(doc, labels.records, 300, y);
  text(doc, labels.units, 380, y);
  text(doc, String(report?.valueLabel || 'Value'), 450, y);
  doc.setFont('helvetica', 'normal');
  y += 18;
  (report?.rows || []).forEach((row) => {
    // A report grouped by product prints each product's photo
    // beside its name (print family, Nov 24, 2026); rows carry
    // the product id as their key only in that grouping.
    const hasPhoto = drawPdfPhoto(doc, photoDataById[row.key], 40, y - 9, 12, 12);
    text(doc, split(doc, String(row.label || ''), 240)[0], hasPhoto ? 58 : 40, y);
    text(doc, String(row.count ?? 0), 300, y);
    text(doc, String(row.units ?? 0), 380, y);
    text(doc, money(row.value, business?.currency, business?.language), 450, y);
    y += hasPhoto ? 18 : 16;
    if (y > 720) {
      doc.addPage();
      y = 56;
    }
  });
  y += 8;
  doc.setFont('helvetica', 'bold');
  text(doc, 
    fillLabel(labels.totalRecordsLine, {
      count: report?.totals?.count ?? 0,
      units: report?.totals?.units ?? 0,
      value: money(report?.totals?.value, business?.currency, business?.language),
    }),
    40,
    y,
  );
  doc.setFont('helvetica', 'normal');
  if (report?.missing?.units) {
    y += 20;
    doc.setFontSize(9);
    doc.setTextColor(90, 90, 90);
    text(doc, 
      split(doc, 
        fillLabel(labels.missingUnits, { units: report.missing.units, label: report.missing.label }),
        480,
      ),
      40,
      y,
    );
  }
  footer(doc, String(report?.report?.label || labels.reportFallback), labels);
  return toBuffer(doc);
}
