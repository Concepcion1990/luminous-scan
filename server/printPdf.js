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
 *
 * Document labels render in the business's language
 * (server/printLabels.js, Nov 15, 2026) with a per-string English
 * fallback for anything the standard PDF fonts cannot encode.
 */
import { jsPDF } from 'jspdf';
import { printLabelsFor, fillLabel } from './printLabels.js';

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

function footer(doc, label, labels) {
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i += 1) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setTextColor(140, 140, 140);
    doc.text(`${label} · ${fillLabel(labels.pageOf, { page: i, pages })}`, 40, 756);
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
function toLabel(item, labelsText) {
  if (!item) return { title: labelsText.untitled, lines: [], code: '', codeType: 'CODE128' };
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
  if (item.sku) lines.push(fillLabel(labelsText.skuLine, { sku: item.sku }));
  return { title: String(item.name || labelsText.untitled).slice(0, 42), lines, code: codeOf(item), codeType: 'CODE128' };
}

/** Labels, both plans. One label per item per copy — product or location. */
export function buildLabelsPdf(items, { copies = 1, businessName = '', language = 'en' } = {}) {
  const labelsText = printLabelsFor(language);
  const doc = newDoc(businessName);
  const perCopy = Math.min(Math.max(Number(copies) || 1, 1), 20);
  const labels = (items || [])
    .map((item) => toLabel(item, labelsText))
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
    doc.text(doc.splitTextToSize(String(label.title || labelsText.untitled), labelW - 20), x + 10, y + 20);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    label.lines.slice(0, 3).forEach((line, i) => {
      doc.text(String(line), x + 10, y + 52 + i * 16);
    });
    const codeY = Math.max(84, 52 + Math.min(label.lines.length, 3) * 16);
    const code = label.code || '';
    doc.setFontSize(13);
    doc.setFont('helvetica', 'bold');
    doc.text(code || labelsText.noCode, x + 10, y + codeY, { maxWidth: labelW - 20 });
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(90, 90, 90);
    doc.text(fillLabel(labelsText.codeLine, { code: code || '—' }), x + 10, y + codeY + 36);
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
export function buildPackingSlipPdf(order, business) {
  const labels = printLabelsFor(business?.language);
  const doc = newDoc(business?.name);
  doc.setTextColor(30, 30, 30);
  doc.setFontSize(16);
  doc.setFont('helvetica', 'bold');
  doc.text(labels.packingSlip, 40, 64);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.text(fillLabel(labels.orderLine, { number: order.number || '' }), 40, 84);
  doc.text(fillLabel(labels.customerLine, { name: order.customer_name || '' }), 40, 100);
  if (order.order_date) doc.text(fillLabel(labels.orderedLine, { date: order.order_date }), 40, 116);
  let y = 148;
  doc.setFont('helvetica', 'bold');
  doc.text(labels.product, 40, y);
  doc.text(labels.qty, 420, y);
  doc.setFont('helvetica', 'normal');
  y += 18;
  (order.lines || []).forEach((line) => {
    const qty = line.qty ?? line.quantity ?? line.qty_ordered ?? 0;
    doc.text(String(line.product_name || line.sku || labels.item), 40, y);
    doc.text(String(qty), 420, y);
    y += 16;
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
export function buildPoPdf(order, business, { mode = 'po' } = {}) {
  const labels = printLabelsFor(business?.language);
  const doc = newDoc(business?.name);
  doc.setTextColor(30, 30, 30);
  doc.setFontSize(16);
  doc.setFont('helvetica', 'bold');
  doc.text(mode === 'packing' ? labels.supplierPackingSlip : labels.purchaseOrder, 40, 64);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.text(fillLabel(labels.poLine, { number: order.number || '' }), 40, 84);
  doc.text(fillLabel(labels.supplierLine, { name: order.supplier_name || '' }), 40, 100);
  if (order.order_date) doc.text(fillLabel(labels.orderedLine, { date: order.order_date }), 40, 116);
  if (order.expected_date) doc.text(fillLabel(labels.expectedLine, { date: order.expected_date }), 40, 132);
  doc.text(fillLabel(labels.statusLine, { status: order.status || '' }), 40, 148);
  let y = 180;
  doc.setFont('helvetica', 'bold');
  doc.text(labels.product, 40, y);
  doc.text(labels.qty, 340, y);
  if (mode === 'po') {
    doc.text(labels.unitCost, 400, y);
    doc.text(labels.lineTotal, 490, y);
  }
  doc.setFont('helvetica', 'normal');
  y += 18;
  (order.lines || []).forEach((line) => {
    const qty = Number(line.qty_ordered) || 0;
    const cost = Number(line.unit_cost) || 0;
    doc.text(String(line.product_name || line.sku || labels.item), 40, y);
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
    doc.text(fillLabel(labels.subtotalLine, { amount: money(order.subtotal, business?.currency) }), 400, y);
    y += 16;
    doc.text(fillLabel(labels.totalLine, { amount: money(order.total, business?.currency) }), 400, y);
    doc.setFont('helvetica', 'normal');
  }
  if (order.note) {
    y += 24;
    doc.setFontSize(9);
    doc.setTextColor(90, 90, 90);
    doc.text(doc.splitTextToSize(fillLabel(labels.noteLine, { note: order.note }), 480), 40, y);
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
  doc.text(fillLabel(labels.supplierTitle, { name: supplier.name || '' }), 40, 64);
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
  doc.text(labels.openPurchaseOrders, 40, y);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  y += 20;
  if (!openOrders.length) {
    doc.text(labels.noOpenOrders, 40, y);
  }
  openOrders.forEach((po) => {
    const received = (po.lines || []).reduce((s, l) => s + (Number(l.qty_received) || 0), 0);
    const ordered = (po.lines || []).reduce((s, l) => s + (Number(l.qty_ordered) || 0), 0);
    doc.text(fillLabel(labels.receivedLine, { number: po.number || '', status: po.status || '', received, ordered }), 40, y);
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
export function buildReportPdf(report, business, { from = '', to = '' } = {}) {
  const labels = printLabelsFor(business?.language);
  const doc = newDoc(business?.name);
  doc.setTextColor(30, 30, 30);
  doc.setFontSize(16);
  doc.setFont('helvetica', 'bold');
  doc.text(String(report?.report?.label || labels.reportFallback), 40, 64);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.text(fillLabel(labels.groupedBy, { group: (report?.groupLabel || '').toLowerCase() }), 40, 84);
  if (from || to) doc.text(fillLabel(labels.periodLine, { from: from || labels.earliest, to: to || labels.today }), 40, 100);
  let y = 132;
  doc.setFont('helvetica', 'bold');
  doc.text(labels.group, 40, y);
  doc.text(labels.records, 300, y);
  doc.text(labels.units, 380, y);
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
    fillLabel(labels.totalRecordsLine, {
      count: report?.totals?.count ?? 0,
      units: report?.totals?.units ?? 0,
      value: money(report?.totals?.value, business?.currency),
    }),
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
