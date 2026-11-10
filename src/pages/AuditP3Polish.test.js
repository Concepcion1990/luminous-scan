import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Audit findings 30 + 36 (P3 polish, 2026-11-07): dead MFA pages, in-page
 * entitlement guards, Alerts error handling + Excel parity, Print Center
 * subtitle + locked supplier styles, ProblemReport cap + Business line,
 * and the Import nav permission comment.
 *
 * Page tests in this repo read source (see the former
 * UpgradeWixButtons.test.js, deleted in the Wix removal) —
 * these do the same, so no renderer is needed.
 */

// Finding 30: the MFA page tree is dead — no route, no other import.
const DELETED_MFA_FILES = [
  'src/pages/Mfa.jsx',
  'src/components/MfaFlow.jsx',
  'src/components/MfaManage.jsx',
  'src/components/MfaMethodSetup.jsx',
  'src/components/MfaParts.jsx',
  'src/lib/authMfaFlow.js',
];

test('the dead MFA page tree is deleted (finding 30)', () => {
  for (const file of DELETED_MFA_FILES) assert.equal(existsSync(file), false, `${file} still exists`);
});

test('nothing in the app still references the deleted MFA tree (finding 30)', () => {
  const offenders = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry);
      if (entry === 'node_modules' || entry === 'dist') continue;
      if (statSync(path).isDirectory()) {
        walk(path);
      } else if (/\.jsx?$/.test(entry) && !/\.test\.jsx?$/.test(entry)) {
        const content = readFileSync(path, 'utf8');
        if (/authMfaFlow|MfaFlow|MfaManage|MfaParts|MfaMethodSetup/.test(content)) {
          offenders.push(path);
        }
      }
    }
  };
  walk('src');
  walk('base44');
  assert.deepEqual(offenders, []);
});

test('the live MFA sign-in helper stays: Login and Register still use authMfa (finding 30)', () => {
  // authMfa.js is NOT part of the dead tree — Login/Register hand the
  // platform /auth/mfa flow through it. Only authMfaFlow.js (the in-app
  // /mfa page's helper) was deleted.
  assert.equal(existsSync('src/lib/authMfa.js'), true);
  assert.match(readFileSync('src/pages/Login.jsx', 'utf8'), /from "@\/lib\/authMfa";/);
  assert.match(readFileSync('src/pages/Register.jsx', 'utf8'), /from "@\/lib\/authMfa";/);
});

test('OAuthConsent is kept as-is with no route — the route decision is OPEN (finding 30)', () => {
  assert.equal(existsSync('src/pages/OAuthConsent.jsx'), true);
  const app = readFileSync('src/App.jsx', 'utf8');
  assert.doesNotMatch(app, /oauth-consent/);
  assert.doesNotMatch(app, /OAuthConsent/);
  // The consent_path value lives in base44/mcp/config.json, which is not
  // in the repo — no route can be added until it is confirmed platform-side.
  assert.doesNotMatch(readFileSync('src/pages/OAuthConsent.jsx', 'utf8'), /Route path=/);
});

// Finding 36: one-line in-page entitlement guards — each page is safe on
// its own, not only via the route-level PlanGate in App.jsx.
const GUARDED_PAGES = [
  { file: 'src/pages/Materials.jsx', feature: 'builds' },
  { file: 'src/pages/Purchasing.jsx', feature: 'purchasing' },
  { file: 'src/pages/Suppliers.jsx', feature: 'suppliers' },
  { file: 'src/pages/Alerts.jsx', feature: 'alerts' },
  { file: 'src/pages/LowStock.jsx', feature: 'alerts' },
];

for (const { file, feature } of GUARDED_PAGES) {
  test(`${file} has an in-page entitlement guard for ${feature} (finding 36)`, () => {
    const page = readFileSync(file, 'utf8');
    assert.match(page, /import PlanGate from '@\/components\/plan\/PlanGate';/);
    assert.match(page, /import useEntitlements from '@\/hooks\/useEntitlements';/);
    assert.match(page, /const \{ can, isLoading: entitlementLoading \} = useEntitlements\(\);/);
    // While the entitlement is still loading the plan is unknown, so the
    // guard waits — the same fail-open-while-loading shape PlanGate uses.
    assert.match(
      page,
      new RegExp(
        `if \\(!entitlementLoading && !can\\('${feature}'\\)\\) return <PlanGate feature="${feature}" \\/>;`
      )
    );
  });
}

// Finding 36: Import keeps the exports.use permission key, with a comment
// saying why it must not be renamed to import.use.
test('the Import nav entry keeps exports.use, with the shared-permission comment (finding 36)', () => {
  const nav = readFileSync('src/components/layout/navGroups.js', 'utf8');
  assert.match(
    nav,
    /\{ to: '\/import', label: 'Import', icon: FileUp, perm: 'exports\.use' \}/
  );
  assert.match(nav, /do NOT\s*\n\s*\/\/ rename it to import\.use/);
  assert.match(nav, /stored roles and members already/);
  assert.match(nav, /exportPermissionLabel in src\/lib\/staff\.js/);
});

// Finding 36: Alerts create / toggle / delete fail loudly, like Orders and
// Returns do — a destructive toast, not a silent rejection.
test('Alerts save/addPreset/toggle/remove all fail with a destructive toast (finding 36)', () => {
  const page = readFileSync('src/pages/Alerts.jsx', 'utf8');
  assert.match(page, /const save = async \(values\) => \{\s*try \{/);
  assert.match(page, /const addPreset = async \(preset\) => \{\s*try \{/);
  assert.match(page, /const toggle = async \(rule\) => \{\s*try \{/);
  // remove confirms first, then tries the delete.
  assert.match(page, /const remove = async \(rule\) => \{\s*if \(!window\.confirm/);
  assert.match(page, /try \{\s*await base44\.entities\.AlertRule\.delete\(rule\.id\);/);
  for (const title of [
    'Could not save the alert',
    'Could not add the alert',
    'Could not change the alert',
    'Could not delete the alert',
  ]) {
    assert.match(page, new RegExp(`title: '${title}'`));
  }
  // Four handlers plus the Excel download's own failure toast.
  assert.equal(page.match(/variant: 'destructive'/g).length, 5);
});

// Finding 36: Alerts gets the same CSV + Excel download choice as Reports.
test('Alerts offers Download Excel alongside Download CSV (finding 36)', () => {
  const page = readFileSync('src/pages/Alerts.jsx', 'utf8');
  assert.match(page, /const downloadExcel = async \(\) => \{/);
  assert.match(page, /const \{ downloadSheets \} = await import\('@\/lib\/xlsx'\);/);
  assert.match(
    page,
    /downloadSheets\(\s*\[\{ name: 'Alerts', columns: ALERT_EXPORT_COLUMNS, rows: lines \}\],/
  );
  assert.match(page, /Download Excel/);
  assert.match(page, /Download CSV/);
  // Both formats carry the same rows.
  assert.match(page, /const ALERT_EXPORT_COLUMNS = \[/);
  assert.match(page, /const csv = toCsv\(ALERT_EXPORT_COLUMNS, lines\);/);
});
