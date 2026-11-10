/**
 * Server-side PDF documents — T5 (plan §2.12).
 *
 * jsPDF 4.2.1, already a dependency, runs in Node (verified: it
 * produces a real %PDF-1.3 document with no browser). No print-vendor
 * SDK, no paid service, no pdf-lib — jsPDF proved usable server-side.
 *
 * What is printed here, and for whom:
 *  - Labels: BOTH plans (product codes + scannable code text + SKU).
 *    Barcodes are rendered as code text, not as drawn bars — the
 *    server has no barcode font, and a fake barcode would be worse
 *    than honest text. Real barcode bars come from the Bluetooth /
 *    WebUSB ESC/POS path (client-side GS k commands) and from the
 *    browser-print label templates, which draw Code 128 in SVG.
 *  - Packing slips, purchase orders, supplier docs, reports:
 *    Business-only (enforced on the routes, not here).
 *
 * Every builder returns a Buffer. Tests assert a valid %PDF header,
 * a non-trivial size, and the expected content strings.
 */
import { jsPDF } from 'jspdf';

const money = (value, currency = 'USD') => {
  const amount = Number(value) || 0;
  try {
    return new Intl.NumberFormat('en-US', {
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
  if (businessName) doc.text(String(businessName), 40, 36);
  doc.setFontSize(9);
  return doc;
}

function footer(doc, label) {
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i += 1) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setTextColor(140, 140, 140);
    doc.text(`${label} · Page ${i} of ${pages}`, 40, 756);
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
function toLabel(item) {
  if (!item) return { title: 'Untitled', lines: [], code: '', codeType: 'CODE128' };
  if (typeof item.title === 'string') {
    return {
      title: item.title.slice(0, 42),
      lines: Array.isArray(item.lines) ? item.lines.map(String) : [],
      code: String(item.code || '').trim(),
      codeType: item.codeType || 'CODE128',
    };
  }
  const lines = [];
  if (item.price !== null && item.price !== undefined && item.price !== '') {
    lines.push(money(item.price));
  }
  if (item.sku) lines.push(`SKU ${item.sku}`);
  return { title: String(item.name || 'Untitled').slice(0, 42), lines, code: codeOf(item), codeType: 'CODE128' };
}

/** Labels, both plans. One label per item per copy — product or location. */
export function buildLabelsPdf(items, { copies = 1, businessName = '' } = {}) {
  const doc = newDoc(businessName);
  const perCopy = Math.min(Math.max(Number(copies) || 1, 1), 20);
  const labels = (items || [])
    .map((item) => toLabel(item))
    .flatMap((label) => Array.from({ length: perCopy }, () => label));
  if (!labels.length) throw new Error('Choose at least one label to print.');
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
    doc.text(doc.splitTextToSize(String(label.title || 'Untitled'), labelW - 20), x + 10, y + 20);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    label.lines.slice(0, 3).forEach((line, i) => {
      doc.text(String(line), x + 10, y + 52 + i * 16);
    });
    const codeY = Math.max(84, 52 + Math.min(label.lines.length, 3) * 16);
    const code = label.code || '';
    doc.setFontSize(13);
    doc.setFont('helvetica', 'bold');
    doc.text(code || 'NO CODE', x + 10, y + codeY, { maxWidth: labelW - 20 });
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(90, 90, 90);
    doc.text(`Code: ${code || '—'}`, x + 10, y + codeY + 36);
    col += 1;
    if (col >= cols) {
      col = 0;
      x = 40;
      y += labelH + gap;
    } else {
      x += labelW + gap;
    }
  });
  footer(doc, 'Labels');
  return toBuffer(doc);
}

/** Customer packing slip (quantities only, no prices) — Business. */
export function buildPackingSlipPdf(order, business) {
  const doc = newDoc(business?.name);
  doc.setTextColor(30, 30, 30);
  doc.setFontSize(16);
  doc.setFont('helvetica', 'bold');
  doc.text('Packing slip', 40, 64);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.text(`Order ${order.number || ''}`, 40, 84);
  doc.text(`Customer ${order.customer_name || ''}`, 40, 100);
  if (order.order_date) doc.text(`Ordered ${order.order_date}`, 40, 116);
  let y = 148;
  doc.setFont('helvetica', 'bold');
  doc.text('Product', 40, y);
  doc.text('Qty', 420, y);
  doc.setFont('helvetica', 'normal');
  y += 18;
  (order.lines || []).forEach((line) => {
    const qty = line.qty ?? line.quantity ?? line.qty_ordered ?? 0;
    doc.text(String(line.product_name || line.sku || 'Item'), 40, y);
    doc.text(String(qty), 420, y);
    y += 16;
    if (y > 720) {
      doc.addPage();
      y = 56;
    }
  });
  footer(doc, `Packing slip ${order.number || ''}`);
  return toBuffer(doc);
}

/**
 * Purchase order (mode 'po': with costs) or supplier packing slip
 * (mode 'packing': quantities only, no prices) — Business.
 */
export function buildPoPdf(order, business, { mode = 'po' } = {}) {
  const doc = newDoc(business?.name);
  doc.setTextColor(30, 30, 30);
  doc.setFontSize(16);
  doc.setFont('helvetica', 'bold');
  doc.text(mode === 'packing' ? 'Supplier packing slip' : 'Purchase order', 40, 64);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.text(`PO ${order.number || ''}`, 40, 84);
  doc.text(`Supplier ${order.supplier_name || ''}`, 40, 100);
  if (order.order_date) doc.text(`Ordered ${order.order_date}`, 40, 116);
  if (order.expected_date) doc.text(`Expected ${order.expected_date}`, 40, 132);
  doc.text(`Status ${order.status || ''}`, 40, 148);
  let y = 180;
  doc.setFont('helvetica', 'bold');
  doc.text('Product', 40, y);
  doc.text('Qty', 340, y);
  if (mode === 'po') {
    doc.text('Unit cost', 400, y);
    doc.text('Line total', 490, y);
  }
  doc.setFont('helvetica', 'normal');
  y += 18;
  (order.lines || []).forEach((line) => {
    const qty = Number(line.qty_ordered) || 0;
    const cost = Number(line.unit_cost) || 0;
    doc.text(String(line.product_name || line.sku || 'Item'), 40, y);
    doc.text(String(qty), 340, y);
    if (mode === 'po') {
      doc.text(money(cost, business?.currency), 400, y);
      doc.text(money(qty * cost, business?.currency), 490, y);
    }
    y += 16;
    if (y > 720) {
      doc.addPage();
      y = 56;
    }
  });
  if (mode === 'po') {
    y += 8;
    doc.setFont('helvetica', 'bold');
    doc.text(`Subtotal ${money(order.subtotal, business?.currency)}`, 400, y);
    y += 16;
    doc.text(`Total ${money(order.total, business?.currency)}`, 400, y);
    doc.setFont('helvetica', 'normal');
  }
  if (order.note) {
    y += 24;
    doc.setFontSize(9);
    doc.setTextColor(90, 90, 90);
    doc.text(doc.splitTextToSize(`Note: ${order.note}`, 480), 40, y);
  }
  footer(doc, `Purchase order ${order.number || ''}`);
  return toBuffer(doc);
}

/** Supplier profile sheet with its open orders — Business. */
export function buildSupplierDocPdf(supplier, business, openOrders = []) {
  const doc = newDoc(business?.name);
  doc.setTextColor(30, 30, 30);
  doc.setFontSize(16);
  doc.setFont('helvetica', 'bold');
  doc.text(`Supplier: ${supplier.name || ''}`, 40, 64);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  let y = 88;
  const fields = [
    ['Contact', supplier.contact_name || ''],
    ['Email', supplier.email || ''],
    ['Phone', supplier.phone || ''],
    ['Account', supplier.account_number || ''],
    ['Lead time', supplier.lead_time_days ? `${supplier.lead_time_days} days` : ''],
    ['Website', supplier.website || ''],
    ['Address', supplier.address || ''],
  ];
  fields.forEach(([label, value]) => {
    if (!value) return;
    doc.text(`${label}: ${value}`, 40, y);
    y += 16;
  });
  if (supplier.notes) {
    y += 8;
    doc.setFontSize(9);
    doc.setTextColor(90, 90, 90);
    doc.text(doc.splitTextToSize(supplier.notes, 480), 40, y);
    y += 32;
  }
  y += 16;
  doc.setTextColor(30, 30, 30);
  doc.setFontSize(12);
  doc.setFont('helvetica', 'bold');
  doc.text('Open purchase orders', 40, y);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  y += 20;
  if (!openOrders.length) {
    doc.text('No open orders with this supplier.', 40, y);
  }
  openOrders.forEach((po) => {
    const received = (po.lines || []).reduce((s, l) => s + (Number(l.qty_received) || 0), 0);
    const ordered = (po.lines || []).reduce((s, l) => s + (Number(l.qty_ordered) || 0), 0);
    doc.text(`${po.number || ''} · ${po.status || ''} · ${received}/${ordered} received`, 40, y);
    y += 16;
    if (y > 720) {
      doc.addPage();
      y = 56;
    }
  });
  footer(doc, `Supplier ${supplier.name || ''}`);
  return toBuffer(doc);
}

/** One report as a PDF — Business. Same rows the server report endpoint returns. */
export function buildReportPdf(report, business, { from = '', to = '' } = {}) {
  const doc = newDoc(business?.name);
  doc.setTextColor(30, 30, 30);
  doc.setFontSize(16);
  doc.setFont('helvetica', 'bold');
  doc.text(String(report?.report?.label || 'Report'), 40, 64);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.text(`Grouped by ${(report?.groupLabel || '').toLowerCase()}`, 40, 84);
  if (from || to) doc.text(`Period ${from || 'earliest'} to ${to || 'today'}`, 40, 100);
  let y = 132;
  doc.setFont('helvetica', 'bold');
  doc.text('Group', 40, y);
  doc.text('Records', 300, y);
  doc.text('Units', 380, y);
  doc.text(String(report?.valueLabel || 'Value'), 450, y);
  doc.setFont('helvetica', 'normal');
  y += 18;
  (report?.rows || []).forEach((row) => {
    doc.text(doc.splitTextToSize(String(row.label || ''), 240)[0], 40, y);
    doc.text(String(row.count ?? 0), 300, y);
    doc.text(String(row.units ?? 0), 380, y);
    doc.text(money(row.value, business?.currency), 450, y);
    y += 16;
    if (y > 720) {
      doc.addPage();
      y = 56;
    }
  });
  y += 8;
  doc.setFont('helvetica', 'bold');
  doc.text(
    `Total ${report?.totals?.count ?? 0} records · ${report?.totals?.units ?? 0} units · ${money(report?.totals?.value, business?.currency)}`,
    40,
    y,
  );
  doc.setFont('helvetica', 'normal');
  if (report?.missing?.units) {
    y += 20;
    doc.setFontSize(9);
    doc.setTextColor(90, 90, 90);
    doc.text(
      doc.splitTextToSize(
        `${report.missing.units} units in this view have no ${report.missing.label} recorded. Missing money is never treated as zero — they are left out of the figures.`,
        480,
      ),
      40,
      y,
    );
  }
  footer(doc, String(report?.report?.label || 'Report'));
  return toBuffer(doc);
}
