/**
 * Backup-codes print document — the Settings → Security "Print these
 * codes" button.
 *
 * LIVE FINDING (owner, Nov 14, 2026): the button used to call a bare
 * window.print() on the Settings page, so the printer dumped ALL
 * SEVEN PAGES of Settings. Her ruling: when someone clicks print for
 * a certain document, it should print ONLY that document. So the
 * codes print in their own dedicated document — the same pattern the
 * reward slip uses (Workforce printSlip) — containing nothing but
 * the codes card's own content: the title, the codes, and the
 * shown-once warning. Nothing else from Settings can reach the paper.
 *
 * This builder is pure (strings in, HTML out) so the scoping is
 * testable: what is not in the input cannot be in the document.
 */

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * The full HTML document for the backup-codes printout.
 * `title` and `note` are the already-localized strings the codes card
 * itself shows (settings.security.newCodesTitle / codesOnceWarning);
 * `codes` is the fresh, shown-once code list.
 */
export function backupCodesPrintDocument({ title, note, codes }) {
  const safeCodes = (Array.isArray(codes) ? codes : [])
    .map((code) => `      <span>${escapeHtml(code)}</span>`)
    .join('\n');
  return [
    '<!doctype html>',
    '<html>',
    '<head>',
    '<meta charset="utf-8">',
    `<title>${escapeHtml(title)}</title>`,
    '<style>',
    '  body { font-family: system-ui, -apple-system, sans-serif; margin: 40px; color: #1c1917; }',
    '  h1 { font-size: 18px; margin: 0 0 16px; }',
    '  .codes { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; max-width: 420px; }',
    '  .codes span { font-family: ui-monospace, monospace; font-size: 15px; letter-spacing: 0.12em;',
    '    text-align: center; border: 1px solid #d6d3d1; border-radius: 6px; padding: 8px 4px; }',
    '  p { margin-top: 16px; font-size: 12px; color: #57534e; max-width: 420px; line-height: 1.5; }',
    '</style>',
    '</head>',
    '<body>',
    `  <h1>${escapeHtml(title)}</h1>`,
    '  <div class="codes">',
    safeCodes,
    '  </div>',
    `  <p>${escapeHtml(note)}</p>`,
    '</body>',
    '</html>',
  ].join('\n');
}

/**
 * Print ONLY the backup codes: open a dedicated print window holding
 * just the codes document (the reward slip's established pattern) and
 * print that. Returns 'window' when the dedicated window was used,
 * 'fallback' when a popup blocker refused it and the page's own
 * print was the only remaining way to get the codes on paper, and
 * 'none' when there is nothing to print.
 */
export function printBackupCodes({ title, note, codes }, win = typeof window !== 'undefined' ? window : null) {
  if (!win || !Array.isArray(codes) || codes.length === 0) return 'none';
  const popup = win.open('', '_blank');
  if (!popup) {
    win.print();
    return 'fallback';
  }
  popup.document.write(backupCodesPrintDocument({ title, note, codes }));
  popup.document.close();
  popup.focus();
  popup.print();
  return 'window';
}
