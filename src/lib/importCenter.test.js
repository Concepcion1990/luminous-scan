import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Import Center wording and the failed-rows download: Business-only.
 *
 * LIVE FINDING (2026-11-07, on the fresh Essentials account): the "What
 * each operation does" section ended "Rows that cannot be imported are
 * listed with a reason and can be downloaded as a file." Essentials is
 * import-only — there is no way to download anything — so the copy must not
 * promise a download, and the "Download these problems" button must not be
 * offered there either.
 *
 * The download is a client-side CSV build (downloadCsv in the browser); no
 * backend function serves it. The gate lives in ProblemReport itself, which
 * all three workbenches (create / update / receive) render.
 */

test('the Import Center never promises a download on Essentials', () => {
  const page = readFileSync('src/pages/ImportCenter.jsx', 'utf8');
  assert.match(page, /const \{ isEssentials, isLoading: entitlementLoading \} = useEntitlements\(\);/);
  assert.match(page, /const allowDownload = !isEssentials && !entitlementLoading;/);
  // Essentials wording: listed with a reason, so you can fix them — no
  // download mentioned. Business keeps the download wording.
  assert.match(page, /', so you can fix them and try again\.'\}/);
  assert.match(page, /' and can be downloaded as a file\.'/);
  // The old unconditional sentence must be gone.
  assert.doesNotMatch(page, /listed with a reason and can be downloaded as a file\./);
});

test('the failed-rows download is Business-only, in all three workbenches', () => {
  const report = readFileSync('src/components/import/ProblemReport.jsx', 'utf8');
  assert.match(report, /const \{ isEssentials, isLoading: entitlementLoading \} = useEntitlements\(\);/);
  assert.match(report, /const allowDownload = !isEssentials && !entitlementLoading;/);
  assert.match(report, /\{allowDownload && \(\s*<Button variant="outline" size="sm" className="mt-2" onClick=\{download\}>/);
  assert.match(report, /Download these problems/);
  // The gate covers every import mode: all three workbenches render this
  // one component.
  for (const workbench of ['ImportWorkbench', 'UpdateWorkbench', 'ReceiveWorkbench']) {
    const content = readFileSync(`src/components/import/${workbench}.jsx`, 'utf8');
    assert.match(content, /<ProblemReport rows=\{report\.problems\}/);
  }
  // Essentials sees the first 25 problem rows inline, with an "and N
  // more" count; Business keeps the five-row cap plus the download.
  assert.match(report, /const shown = allowDownload \? rows\.slice\(0, 5\) : rows\.slice\(0, 25\);/);
});

test('Essentials sees the first 25 problem rows, an "and N more" count, and the Business download line', () => {
  const report = readFileSync('src/components/import/ProblemReport.jsx', 'utf8');
  assert.match(report, /const shown = allowDownload \? rows\.slice\(0, 5\) : rows\.slice\(0, 25\);/);
  assert.match(report, /\{!allowDownload && rows\.length > 25 && <li>and \{rows\.length - 25\} more<\/li>\}/);
  // The line only shows where the download button does not.
  assert.match(report, /\{!allowDownload && \(\s*<p className="mt-2 text-muted-foreground">/);
  assert.match(report, /Business can download this list as a file — see/);
  assert.match(report, /<Link to="\/upgrade"/);
  assert.match(report, /Plan &amp; limits/);
});

test('the failed-rows download is client-side, not a backend endpoint', () => {
  const report = readFileSync('src/components/import/ProblemReport.jsx', 'utf8');
  assert.match(report, /downloadCsv\(fileName, toCsv\(columns, rows\)\);/);
  assert.doesNotMatch(report, /base44\.functions/);
});

test('no other copy anywhere promises a failed-rows download', () => {
  // The sentence lived in exactly one place — the shared "What each
  // operation does" explainer at the bottom of the Import Center, which is
  // visible no matter which mode card is selected, so it reads as if it
  // belongs to Update and to Receive as well. Sweep the whole app so a
  // second copy can never creep back unnoticed: no source file may carry
  // the unconditional sentence. (Test files quote it, and dist/ is built
  // output, so both are skipped. Reports has a different sentence about
  // its own table, on a Business-only page, and stays.)
  const offenders = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry);
      if (entry === 'node_modules' || entry === 'dist') continue;
      if (statSync(path).isDirectory()) {
        walk(path);
      } else if (/\.jsx?$/.test(entry) && !/\.test\.jsx?$/.test(entry)) {
        const content = readFileSync(path, 'utf8');
        if (/listed with a reason and can be downloaded as a file\./.test(content)) {
          offenders.push(path);
        }
      }
    }
  };
  walk('src');
  walk('base44');
  assert.deepEqual(offenders, []);
});
