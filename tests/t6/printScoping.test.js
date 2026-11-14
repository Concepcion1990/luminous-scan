/**
 * T6 — print scoping (owner's ruling, Nov 14, 2026).
 *
 * LIVE FINDING (owner, same day): she printed her backup codes from
 * Settings and got ALL SEVEN PAGES of the Settings page. Her ruling:
 * when someone clicks print for a certain document, it should print
 * ONLY that document — never the whole page around it.
 *
 * The audit behind these pins:
 *   - Settings backup codes — WAS a bare window.print() of the whole
 *     Settings page. FIXED: the codes print as their own dedicated
 *     document (src/lib/backupCodesPrint.js), the reward slip's
 *     established pattern; only the title, the codes and the
 *     shown-once note can reach the paper.
 *   - Print Center (every document style: labels, the 4x6 shipping
 *     label, receipts, invoices, packing slips, purchase orders,
 *     supplier documents, pay stubs, count sheets, pick lists,
 *     return documents) — already scoped: controls carry no-print,
 *     the one selected document renders alone in the .print-area.
 *   - Direct-deposit form — already scoped the same way.
 *   - Reward slip — already scoped: it prints a dedicated window
 *     containing only the slip.
 *   - Scan "Print shelf tag" / Payroll "Print form" — doors INTO the
 *     two scoped pages above, not print actions of their own.
 *   - The app-wide leak shared by every in-page print: the Layout
 *     legal footer (a <footer> in <main>, not covered by the print
 *     stylesheet's aside/header rule) trailed onto paper behind the
 *     document. FIXED: LegalFooter carries no-print.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { backupCodesPrintDocument, printBackupCodes } from '../../src/lib/backupCodesPrint.js';

const CODES = ['ABCD-EFGH', 'IJKL-MNOP', 'QRST-UVWX'];

test('the backup-codes print document contains the codes and the note — and nothing else', () => {
  const html = backupCodesPrintDocument({
    title: 'Your new backup codes',
    note: 'These codes are shown once. Keep them somewhere safe.',
    codes: CODES,
  });
  for (const code of CODES) assert.ok(html.includes(code), `printout is missing ${code}`);
  assert.ok(html.includes('Your new backup codes'));
  assert.ok(html.includes('shown once'));
  // Nothing from the surrounding Settings page can leak in: the
  // document is built only from its three inputs.
  for (const foreign of ['Settings', 'Backup email', 'Change email', 'Delete', 'Subscription'])
    assert.ok(!html.includes(foreign), `printout leaked "${foreign}" from the page`);
});

test('the backup-codes print document escapes its inputs', () => {
  const html = backupCodesPrintDocument({ title: '<b>bold</b>', note: 'a & b', codes: ['<x>'] });
  assert.ok(!html.includes('<b>bold</b>'));
  assert.ok(html.includes('&lt;b&gt;bold&lt;/b&gt;'));
  assert.ok(html.includes('a &amp; b'));
  assert.ok(html.includes('&lt;x&gt;'));
});

test('printBackupCodes prints the dedicated window, never the page', () => {
  const written = [];
  let pagePrinted = false;
  const fakePopup = {
    document: { write: (html) => written.push(html), close: () => {} },
    focus: () => {},
    print: () => { fakePopup.printed = true; },
  };
  const fakeWindow = {
    open: () => fakePopup,
    print: () => { pagePrinted = true; },
  };
  const result = printBackupCodes(
    { title: 'Your new backup codes', note: 'Shown once.', codes: CODES },
    fakeWindow,
  );
  assert.equal(result, 'window');
  assert.equal(fakePopup.printed, true);
  assert.equal(pagePrinted, false, 'the Settings page itself must not print');
  assert.equal(written.length, 1);
  for (const code of CODES) assert.ok(written[0].includes(code));
});

test('printBackupCodes falls back to the page print only when the popup is blocked', () => {
  let pagePrinted = false;
  const fakeWindow = { open: () => null, print: () => { pagePrinted = true; } };
  assert.equal(printBackupCodes({ title: 't', note: 'n', codes: CODES }, fakeWindow), 'fallback');
  assert.equal(pagePrinted, true);
  // Nothing to print: no window games at all.
  assert.equal(printBackupCodes({ title: 't', note: 'n', codes: [] }, fakeWindow), 'none');
});

test('SecurityCard no longer prints the whole Settings page for the codes', () => {
  const source = readFileSync(new URL('../../src/components/business/SecurityCard.jsx', import.meta.url), 'utf8');
  assert.ok(!source.includes('onClick={() => window.print()}'), 'bare page print is still wired to a button');
  assert.ok(source.includes('printBackupCodes'), 'the codes button must use the scoped print');
});

test('the legal footer can never trail onto printed paper', () => {
  const source = readFileSync(new URL('../../src/components/LegalFooter.jsx', import.meta.url), 'utf8');
  assert.ok(source.includes('no-print'), 'LegalFooter must carry no-print');
  const css = readFileSync(new URL('../../src/index.css', import.meta.url), 'utf8');
  assert.match(css, /@media print \{[^}]*\.no-print/s, 'the print stylesheet must hide .no-print');
});

test('the already-scoped print pages keep their isolation', () => {
  const printCenter = readFileSync(new URL('../../src/pages/PrintCenter.jsx', import.meta.url), 'utf8');
  assert.ok(printCenter.includes('print-area'), 'Print Center document must render in the print area');
  assert.ok(printCenter.includes('no-print'), 'Print Center controls must be no-print');
  const ddForm = readFileSync(new URL('../../src/pages/DirectDepositForm.jsx', import.meta.url), 'utf8');
  assert.ok(ddForm.includes('print-area'), 'direct-deposit form must render in the print area');
  assert.ok(ddForm.includes('no-print'), 'direct-deposit controls must be no-print');
  const workforce = readFileSync(new URL('../../src/pages/Workforce.jsx', import.meta.url), 'utf8');
  assert.ok(workforce.includes("window.open('', '_blank')"), 'the reward slip must keep its dedicated print window');
});
