/**
 * Client-side label PDF — T5 printing (plan §2.12 + owner refinement).
 *
 * The primary print path must work from data the app already has,
 * with no fetch at print time — so a label PDF is generated here,
 * in the browser, from the items already loaded on the page.
 * jsPDF is already a client dependency. The server labels endpoint
 * (/api/businesses/:bid/print/labels) still exists for online use;
 * this is the path that keeps working when the internet drops.
 *
 * Generic, not product-only (owner design note Nov 9): the PDF is
 * built from generic label payloads — { title, lines, code,
 * codeType } (src/lib/labelPayload.js) — so a location / bin label
 * flows through exactly the same path as a product label. Layout
 * mirrors server/printPdf.js buildLabelsPdf (same grid, same
 * fields) so the two PDFs agree. Barcodes are rendered as code text
 * + code, as on the server — real barcode bars come from the
 * Bluetooth / USB ESC/POS path and from the browser-print label
 * templates, which draw Code 128 in SVG.
 */
import { jsPDF } from 'jspdf';
import { toLabel } from './labelPayload.js';

/** Label PDF bytes from already-loaded items — no fetch, no server. */
export function buildLabelsPdfBytes(items, { copies = 1, businessName = '' } = {}) {
  const doc = new jsPDF({ unit: 'pt', format: 'letter' });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(90, 90, 90);
  // White-label rule (T6 customization): the paper carries the STORE's
  // own business name — never the app name or logo. When no store name
  // is set, nothing is printed here at all.
  if (businessName) doc.text(String(businessName), 40, 36);
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
    // The detail lines, one per row; the code sits below them.
    const lineY = (i) => y + 52 + i * 16;
    label.lines.slice(0, 3).forEach((line, i) => {
      doc.text(String(line), x + 10, lineY(i));
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
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i += 1) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setTextColor(140, 140, 140);
    doc.text(`Labels · Page ${i} of ${pages}`, 40, 756);
  }
  return new Uint8Array(doc.output('arraybuffer'));
}

/** Build the labels PDF from cached data and trigger the download. */
export function downloadLabelsPdf(items, options = {}) {
  const bytes = buildLabelsPdfBytes(items, options);
  const blob = new Blob([bytes], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = options.filename || 'labels.pdf';
  anchor.click();
  URL.revokeObjectURL(url);
  return { bytes: bytes.length, filename: anchor.download };
}
