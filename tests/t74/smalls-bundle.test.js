/**
 * T74 — the SMALLS BUNDLE (the release after the supplement
 * reader; four owner-ruled small fixes + the credit-memo
 * print button, all ruled Nov 25, 2026):
 *
 *  1. THE CLOCK CARD'S TIMEZONE EYES. ClockAttentionCard read
 *     stored timestamps with a raw `new Date(...)`, which
 *     reads a zone-less UTC value as LOCAL time — the date
 *     survived but the hour moved, and near midnight the day
 *     moved with it. The card (and every sibling the sweep
 *     found: Payroll's missed-clock-out line, the two staff
 *     documents dialogs, the time-entry fix dialog, the two
 *     clock-gate messages) now reads through lib/dates
 *     (toLocalDate under every formatter). Proven below BY
 *     EXECUTION on the trap case, in America/Denver: a
 *     clock-in stored as 06:55 UTC is 11:55 PM the PREVIOUS
 *     day in Denver; the raw parse says Nov 25, 6:55 AM —
 *     wrong day AND wrong hour — and the house machinery
 *     says Nov 24, 11:55 PM.
 *  2. RECEIVING + RETURNS NAME THE STORE. The PO dialog, the
 *     receive dialog and the return form now offer the Ships
 *     From wall's operating sites (shipFromLocations — a
 *     legacy stored shelf rides along once, nothing is
 *     rewritten), and the printed return document names the
 *     store + its address.
 *  3. THE UPGRADE DOOR, ROAD B. The server's synthesized
 *     entitlement read is marked `inherited_from`; inside a
 *     riding business /upgrade renders only the note naming
 *     the plan's holder, the Settings summary swaps its door
 *     for the same note, and the switcher's limit-note door
 *     does the same. Holding businesses are untouched.
 *  4. THE DATE-FORMAT PICKER, WIRED UP (Road B). An empty
 *     date_format is Automatic; a stored pattern governs the
 *     business's printed documents and labels through
 *     formatBusinessDate — the pick wins over the locale's
 *     ordering while the month names stay the language's own
 *     (proven in es-MX below). App chrome stays automatic.
 *  5. CREDIT MEMOS PRINT. A Studio CreditMemoDoc + a print
 *     button on every memo row (a read, not gated by the
 *     build tick); the sheet names itself as this business's
 *     own record, never the supplier's document; the
 *     training step says so too, in all 52 locales.
 *
 * Keyset: 5908 + 5 = 5913 ×52, uniform; the five Englishes
 * carry the new keys and the amended step byte-identically.
 */
// The trap case is zone-specific: pin the process to the
// owner's own timezone before any date machinery loads.
process.env.TZ = 'America/Denver';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { register } from 'node:module';

// The `@/` alias (Vite-only) must resolve before lib modules
// that import the API client can execute under plain node.
register(new URL('./alias-loader.mjs', import.meta.url));

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

const { LOCALES, setLocale } = await import('../../src/lib/i18n.js');
const dates = await import('../../src/lib/dates.js');
const { shipFromLocations, firstShipFromLocation } = await import('../../src/lib/locations.js');
const { resolveEntitlement } = await import('../../src/lib/entitlements.js');

const NEW_KEYS = [
  'plans.inheritedNote',
  'settings.details.dateFormatAutomatic',
  'settings.details.dateFormatHint',
  'print.creditMemoTitle',
  'print.creditMemoRecordNote',
];

// ---------------------------------------------------------------- keyset

test('the keyset stands at 5913 in all 52 locales, the five new keys in each', () => {
  const codes = Object.keys(LOCALES);
  assert.equal(codes.length, 52);
  const enKeys = Object.keys(LOCALES.en).sort();
  assert.equal(enKeys.length, 5913);
  for (const code of codes) {
    assert.deepEqual(Object.keys(LOCALES[code]).sort(), enKeys, `${code} keyset`);
    for (const key of NEW_KEYS) assert.ok(LOCALES[code][key], `${code} missing ${key}`);
  }
});

test('the five Englishes carry the new keys and the amended step byte-identically', () => {
  for (const code of ['en-GB', 'en-CA', 'en-AU', 'en-IN']) {
    for (const key of NEW_KEYS) assert.equal(LOCALES[code][key], LOCALES.en[key], `${code} ${key}`);
    assert.equal(
      LOCALES[code]['training.lessons.mgr-restaurant-invoices.step5'],
      LOCALES.en['training.lessons.mgr-restaurant-invoices.step5'],
      `${code} step5`,
    );
  }
});

// A distinctive opening fragment of each locale's appended
// print sentence — the step carries it, in its own language.
const STEP5_FRAGMENTS = {
  en: 'Print the memo fro', de: 'Drucken Sie die Gu', it: 'Stampa la nota dal',
  'pt-BR': 'Imprima a nota a p', 'pt-PT': 'Imprima a nota a p', ru: 'Распечатайте ноту',
  uk: 'Роздрукуйте ноту з', ar: 'اطبع الإشعار من صف', fa: 'وقتی یادداشت را رو',
  prs: 'وقتی یادداشت را رو', ur: 'جب آپ کو میمو کاغذ', hi: 'जब आपको मेमो कागज़',
  bn: 'যখন মেমোটি কাগজে দ', bho: 'जब रउरा मेमो कागज़', gu: 'જ્યારે તમને મેમો ક',
  mr: 'जेव्हा तुम्हाला मे', 'pa-Guru': 'ਜਦੋਂ ਤੁਹਾਨੂੰ ਮੈਮੋ', 'pa-Arab': 'جدوں توانوں میمو ک',
  ta: 'குறிப்பு காகிதத்தி', te: 'మెమో కాగితంపై అవసర', kn: 'ಮೆಮೊ ಕಾಗದದ ಮೇಲೆ ಬೇ',
  ja: 'メモが紙で必要なときは、その行から印', ko: '메모가 종이로 필요할 때는 해당',
  'zh-Hans': '需要纸质版时，可从该行打印此凭证——', 'zh-Hant': '需要紙質版時，可從該行列印此憑證——',
  yue: '需要紙質版嗰陣，可以由嗰行打印呢張憑', wuu: '需要纸质版个辰光，可以从箇行打印箇张',
  th: 'เมื่อต้องการใบลดหน', vi: 'Khi cần giấy báo c', id: 'Cetak memo dari ba',
  ms: 'Cetak memo daripad', jv: 'Cetak memo saka ba', tl: 'I-print ang memo m',
  sw: 'Chapisha memo kuto', ha: 'Buga takardar daga', yo: 'Tẹ ìwé náà jáde lá',
  am: 'ማስታወሻው በወረቀት ላይ ሲያ', tg: 'Вақте ки ёддоштро', pcm: 'Print di memo from',
  tr: 'Notu kâğıt üzerind', 'en-GB': 'Print the memo fro', 'en-CA': 'Print the memo fro',
  'en-AU': 'Print the memo fro', 'en-IN': 'Print the memo fro', 'es-ES': 'Imprime la nota de',
  'es-MX': 'Imprime la nota de', 'es-US': 'Imprime la nota de', 'es-CU': 'Imprime la nota de',
  'es-PR': 'Imprime la nota de', 'es-VE': 'Imprime la nota de', 'fr-FR': 'Imprimez la note d',
  'fr-CA': 'Imprimez la note d',
};

test('the credit-memo training step now teaches the print button, in every locale', () => {
  const en = LOCALES.en['training.lessons.mgr-restaurant-invoices.step5'];
  assert.ok(en.startsWith('When a supplier gives money back against an invoice'));
  assert.ok(en.endsWith("not the supplier's document."));
  for (const code of Object.keys(LOCALES)) {
    const step = LOCALES[code]['training.lessons.mgr-restaurant-invoices.step5'];
    assert.ok(step.includes(STEP5_FRAGMENTS[code]), `${code} step5 carries no print sentence`);
  }
});

// ------------------------------------------------------- fix 1: the trap

test('fix 1: the trap case — a 06:55 UTC clock-in is Nov 24, 11:55 PM in Denver', () => {
  const stored = '2026-11-25T06:55:00'; // zone-less UTC, the stored shape
  // What the OLD card did: raw parse + Intl — wrong day, wrong hour.
  const raw = new Intl.DateTimeFormat('en-US', {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  }).format(new Date(stored));
  assert.equal(raw, 'Nov 25, 6:55 AM');
  // The house machinery: the right day AND the right hour.
  assert.equal(dates.formatDayTime(stored, 'en'), 'Nov 24, 11:55 PM');
  assert.equal(dates.formatTimeOnly(stored, 'en'), '11:55 PM');
  // A zone-carrying instant reads the same through both doors.
  assert.equal(dates.formatDayTime('2026-11-25T06:55:00Z', 'en'), 'Nov 24, 11:55 PM');
});

test('fix 1: the card and its swept siblings read through lib/dates — pins', () => {
  const card = read('src/components/staff/ClockAttentionCard.jsx');
  assert.ok(!card.includes('new Date(iso)'), 'card still raw-parses');
  assert.ok(card.includes("from '@/lib/dates'") && card.includes('formatDayTime') && card.includes('formatTimeOnly'));

  const payroll = read('src/pages/Payroll.jsx');
  assert.ok(!payroll.includes('new Date(missed.'), 'payroll still raw-parses the missed line');
  assert.ok(payroll.includes('formatTimeOnly(missed.shift_start)'));

  for (const rel of ['src/components/staff/StaffDocumentsDialog.jsx', 'src/components/staff/MyDocumentsDialog.jsx']) {
    const src = read(rel);
    assert.ok(!src.includes('new Date(iso)'), `${rel} still raw-parses`);
    assert.ok(src.includes('formatDateTime(iso)'), `${rel} not on the house machinery`);
  }

  const fix = read('src/components/staff/TimeEntryFixDialog.jsx');
  assert.ok(fix.includes('toLocalDate(iso)'), 'fix dialog not on toLocalDate');
  assert.ok(!fix.includes('const date = new Date(iso)'), 'fix dialog still raw-parses');

  const workforce = read('src/pages/Workforce.jsx');
  assert.ok(workforce.includes('toLocalDate(data.next_shift_start)'), 'clock gate not on toLocalDate');
  const authMfa = read('src/lib/authMfa.js');
  assert.ok(authMfa.includes('toLocalDate(data.next_shift_start)'), 'sign-in gate not on toLocalDate');
});

// ------------------------------------------------- fix 2: stores, not shelves

const SITES = [
  { id: 'store-1', name: 'Main Store', kind: 'store', parent_id: null },
  { id: 'shelf-1', name: 'Shelf A', kind: 'shelf', parent_id: 'store-1' },
  { id: 'wh-1', name: 'Back Warehouse', kind: 'warehouse', parent_id: null },
  { id: 'bin-1', name: 'Bin 3', kind: 'bin', parent_id: 'shelf-1' },
];

test('fix 2: the receiving/returns options are the operating sites only', () => {
  assert.deepEqual(shipFromLocations(SITES).map((l) => l.id), ['store-1', 'wh-1']);
  assert.equal(firstShipFromLocation(SITES).id, 'store-1');
  // A legacy stored shelf rides along exactly once — shown,
  // never silently rewritten.
  assert.deepEqual(shipFromLocations(SITES, 'shelf-1').map((l) => l.id), ['store-1', 'wh-1', 'shelf-1']);
  assert.deepEqual(shipFromLocations(SITES, 'store-1').map((l) => l.id), ['store-1', 'wh-1']);
});

test('fix 2: the three pickers and the return paper are wired — pins', () => {
  for (const rel of [
    'src/components/purchasing/PurchaseOrderDialog.jsx',
    'src/components/purchasing/ReceiveDialog.jsx',
    'src/components/returns/ReturnFormDialog.jsx',
  ]) {
    assert.ok(read(rel).includes('shipFromLocations('), `${rel} not on the sites wall`);
  }
  const doc = read('src/components/print/ReturnDoc.jsx');
  assert.ok(doc.includes('locationAddress'), 'return doc carries no store address');
  const center = read('src/pages/PrintCenter.jsx');
  assert.ok(center.includes('locationAddress={returnLocationAddress}'), 'print center passes no address');
});

// ------------------------------------------------------ fix 3: the door

test('fix 3: resolveEntitlement surfaces the inheritance marker', () => {
  const riding = resolveEntitlement({ plan: 'business', status: 'active', business_id: 'biz-2', inherited_from: 'biz-1' });
  assert.equal(riding.inheritedFrom, 'biz-1');
  assert.equal(riding.planKey, 'business');
  const holding = resolveEntitlement({ plan: 'business', status: 'active', business_id: 'biz-1' });
  assert.equal(holding.inheritedFrom, null);
  const none = resolveEntitlement(null);
  assert.equal(none.inheritedFrom, null);
});

test('fix 3: the marker and the three note surfaces are wired — pins', () => {
  const entities = read('server/entities.js');
  assert.ok(entities.includes('shaped.inherited_from = inheritedFrom'), 'server marks no synthesized row');
  const upgrade = read('src/pages/Upgrade.jsx');
  assert.ok(upgrade.includes('if (inheritedFrom)'), 'upgrade page has no riding branch');
  assert.ok(upgrade.includes("t('plans.inheritedNote'"), 'upgrade page shows no holder note');
  const summary = read('src/components/plans/PlanSummaryCard.jsx');
  assert.ok(summary.includes('inheritedFrom') && summary.includes("t('plans.inheritedNote'"), 'settings summary not wired');
  const switcher = read('src/components/business/BusinessSwitcher.jsx');
  assert.ok(switcher.includes('inherited_from') && switcher.includes("t('plans.inheritedNote'"), 'switcher not wired');
});

// ------------------------------------------------- fix 4: the wired picker

test('fix 4: the pick resolves — empty is automatic, a pattern is a pick', () => {
  assert.equal(dates.pickedDatePattern(null), null);
  assert.equal(dates.pickedDatePattern({}), null);
  assert.equal(dates.pickedDatePattern({ date_format: '' }), null);
  assert.equal(dates.pickedDatePattern({ date_format: 'yyyy-MM-dd' }), 'yyyy-MM-dd');
  assert.equal(dates.pickedDatePattern({ date_format: 'dd/mm/yy' }), null);
});

test('fix 4: the four patterns assemble exactly, in the language of the reader', () => {
  assert.equal(dates.formatPickedDate('2026-11-18', 'MMM d, yyyy', 'en'), 'Nov 18, 2026');
  assert.equal(dates.formatPickedDate('2026-11-18', 'd MMM yyyy', 'en'), '18 Nov 2026');
  assert.equal(dates.formatPickedDate('2026-11-18', 'M/d/yyyy', 'en'), '11/18/2026');
  assert.equal(dates.formatPickedDate('2026-11-18', 'yyyy-MM-dd', 'en'), '2026-11-18');
  assert.equal(dates.formatPickedDate('2026-01-05', 'yyyy-MM-dd', 'en'), '2026-01-05');
  assert.equal(dates.formatPickedDate('2026-01-05', 'M/d/yyyy', 'en'), '1/5/2026');
});

test('fix 4: the pick WINS over the locale order; the month name stays the language’s own', () => {
  setLocale('es-MX');
  // Automatic in es-MX: day first, the locale's own way.
  assert.equal(dates.formatBusinessDate('2026-11-18', { date_format: '' }, 'es-MX'), '18 nov 2026');
  assert.equal(dates.formatBusinessDate('2026-11-18', null, 'es-MX'), '18 nov 2026');
  // The pick: month first — but the month is still Spanish.
  assert.equal(dates.formatBusinessDate('2026-11-18', { date_format: 'MMM d, yyyy' }, 'es-MX'), 'nov 18, 2026');
  assert.equal(dates.formatBusinessDate('2026-11-18', { date_format: 'yyyy-MM-dd' }, 'es-MX'), '2026-11-18');
  setLocale('en');
});

test('fix 4: the picker, the papers and the server are wired — pins', () => {
  const details = read('src/components/business/DetailsCard.jsx');
  assert.ok(details.includes("t('settings.details.dateFormatAutomatic')"), 'no Automatic option');
  assert.ok(details.includes("value === 'auto' ? '' : value"), 'the sentinel does not clear to automatic');
  assert.ok(details.includes("t('settings.details.dateFormatHint')"), 'no hint under the picker');
  for (const rel of [
    'src/components/print/DocHeader.jsx',
    'src/components/print/CustomerDoc.jsx',
    'src/components/print/ReturnDoc.jsx',
    'src/components/print/TransferDoc.jsx',
    'src/components/print/DateLabelDoc.jsx',
  ]) {
    assert.ok(read(rel).includes('formatBusinessDate'), `${rel} not on the business date`);
  }
  const auth = read('server/authRoutes.js');
  assert.ok(auth.includes("date_format: row.date_format || '',"), 'server shaping still forces a pattern');
  assert.ok(auth.includes("text !== '' && !SUPPORTED_DATE_FORMATS.includes(text)"), 'server refuses the empty Automatic value');
  const business = read('src/lib/business.js');
  assert.ok(business.includes("date_format: '',"), 'client default is not Automatic');
});

// ------------------------------------------------------ fix 5: memo paper

test('fix 5: the credit memo Studio sheet and its print button are wired — pins', () => {
  const doc = read('src/components/print/CreditMemoDoc.jsx');
  assert.ok(doc.includes("t('print.creditMemoTitle')"), 'doc has no title');
  assert.ok(doc.includes("t('print.creditMemoRecordNote')"), 'doc does not name itself as our record');
  assert.ok(doc.includes('DocFrame') && doc.includes('PrintedAt'), 'doc is not in the Studio frame');
  assert.ok(doc.includes('formatBusinessDate'), 'doc date ignores the business pick');
  const page = read('src/pages/RestaurantInvoices.jsx');
  assert.ok(page.includes('CreditMemoDoc'), 'invoices page renders no memo doc');
  assert.ok(page.includes('printMemo'), 'invoices page has no print door');
  assert.ok(page.includes("t('print.printButton')"), 'memo rows carry no print button');
});
