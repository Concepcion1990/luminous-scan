/**
 * T5 — PR #44/#45 plan-limits gating (audit-2026-11-07-pages.md).
 *
 * Server-testable items: custom roles, role edit/delete, suppliers,
 * alerts, POs, BOMs, exports, reports, valuation, document PDFs and
 * bundle movements all refuse on Essentials. Static assertions check
 * the ported frontend gates in the twin's src/ pages and libs.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  ALL_PERMISSIONS,
  BUSINESS_ONLY_PERMISSIONS,
  allPermissionsForPlan,
  exportPermissionLabel,
} from '../../src/lib/staff.js';
import {
  close,
  req,
  reqRaw,
  ownerWithBusiness,
  setPlan,
  createLocation,
  createProducts,
} from './helpers.js';

after(close);

function src(path) {
  return readFileSync(path, 'utf8');
}

test('custom roles are Business-only: create, edit and delete refuse on Essentials', async () => {
  const ess = await ownerWithBusiness('roles-ess@example.com');
  const create = await req('/api/entities/StaffRole', {
    method: 'POST',
    body: { business_id: ess.business.id, name: 'Manager', permissions: ['products'] },
    cookie: ess.cookie,
  });
  assert.equal(create.status, 403);
  assert.equal(create.json.error, 'custom_roles_business_only');
  // A Business role exists in another workspace; editing/deleting it
  // from an Essentials workspace refuses as well.
  const biz = await ownerWithBusiness('roles-biz@example.com');
  await setPlan(biz.business.id, 'business', biz.user.id);
  const role = await req('/api/entities/StaffRole', {
    method: 'POST',
    body: { business_id: biz.business.id, name: 'Manager', permissions: ['products'] },
    cookie: biz.cookie,
  });
  assert.equal(role.status, 201);
  const essEdit = await req(`/api/entities/StaffRole/${role.json.id}`, {
    method: 'PATCH',
    body: { name: 'Renamed' },
    cookie: ess.cookie,
  });
  assert.notEqual(essEdit.status, 200);
  const bizEdit = await req(`/api/entities/StaffRole/${role.json.id}`, {
    method: 'PATCH',
    body: { name: 'Renamed' },
    cookie: biz.cookie,
  });
  assert.equal(bizEdit.status, 200);
  assert.equal(bizEdit.json.name, 'Renamed');
});

test('every server-testable PR #44/#45 item refuses on Essentials', async () => {
  const ess = await ownerWithBusiness('limits-ess@example.com');
  const bid = ess.business.id;
  const location = await createLocation(ess.cookie, bid);
  const [product] = await createProducts(ess.cookie, bid, [
    { name: 'Cat Bookmark', sku: 'BM-001', cost: 4, price: 10 },
  ]);
  const cases = [
    ['role create', '/api/entities/StaffRole', 'POST', { business_id: bid, name: 'X', permissions: [] }],
    ['supplier create', '/api/entities/Supplier', 'POST', { business_id: bid, name: 'X' }],
    ['alert rule create', '/api/entities/AlertRule', 'POST', { business_id: bid, name: 'Low', kind: 'low_stock', threshold: 1 }],
    ['PO create', '/api/entities/PurchaseOrder', 'POST', { business_id: bid, number: 'PO-1', supplier_id: 's', lines: [{ product_id: product.id, qty_ordered: 1, unit_cost: 1 }] }],
    ['BOM create', '/api/entities/Bom', 'POST', { business_id: bid, product_id: product.id, kind: 'bundle', lines: [{ component_id: product.id, quantity: 1 }] }],
    ['bundle movement', '/api/entities/StockMovement', 'POST', { business_id: bid, product_id: product.id, type: 'consume', quantity: 1, location_id: location.id }],
  ];
  for (const [label, path, method, body] of cases) {
    const res = await req(path, { method, body, cookie: ess.cookie });
    assert.equal(res.status, 403, `${label} must refuse on Essentials`);
  }
  const getCases = [
    `/api/businesses/${bid}/export/products`,
    `/api/businesses/${bid}/export/valuation?format=csv`,
    `/api/businesses/${bid}/reports?type=stock`,
    `/api/businesses/${bid}/valuation`,
    `/api/businesses/${bid}/print/packing-slip?order_id=x`,
    `/api/businesses/${bid}/print/po?po_id=x`,
    `/api/businesses/${bid}/print/supplier-doc?supplier_id=x`,
    `/api/businesses/${bid}/print/report?type=stock`,
  ];
  for (const path of getCases) {
    const res = await reqRaw(path, { cookie: ess.cookie });
    assert.equal(res.status, 403, `${path} must refuse on Essentials`);
  }
  // Labels stay open on Essentials — the connection is plan-free.
  const labels = await reqRaw(
    `/api/businesses/${bid}/print/labels?product_ids=${product.id}`,
    { cookie: ess.cookie },
  );
  assert.equal(labels.status, 200);
});

test('frontend gates: Staff hides + New role on Essentials; role edit/delete guarded', () => {
  const staff = src('src/pages/Staff.jsx');
  assert.match(staff, /canCreateRoles/);
  assert.match(staff, /const canCreateRoles = !entitlementLoading && !isEssentials;/);
  assert.match(staff, /{canCreateRoles && \(/);
  assert.match(staff, /New role/);
});

test('frontend gates: no Products Export button on Essentials', () => {
  const products = src('src/pages/Products.jsx');
  assert.match(products, /<ExportCsvButton businessName=\{profile\.name\} businessId=\{activeId\} \/>/);
  // The gating lives in the button itself: it renders nothing on Essentials.
  const button = src('src/components/products/ExportCsvButton.jsx');
  assert.match(button, /if \(entitlementLoading \|\| isEssentials\) return null;/);
});

test('frontend gates: Movements filter ends at Released; bundle types Business-only', () => {
  const movements = src('src/pages/Movements.jsx');
  assert.match(movements, /const showBundleTypes = !isEssentials && !entitlementLoading;/);
  // Released is the last always-offered type; the bundle types follow it,
  // spread only when showBundleTypes is true.
  assert.ok(movements.indexOf("'released'") < movements.indexOf('showBundleTypes\n'));
  assert.match(movements, /\.\.\.\(showBundleTypes/);
  assert.match(movements, /value: 'consume'/);
  assert.match(movements, /value: 'produce'/);
  assert.match(movements, /value: 'disassemble'/);
  assert.match(movements, /value: 'recovered'/);
});

test('frontend gates: no Incoming stock / Reorder suggestions cards on Essentials', () => {
  const dashboard = src('src/pages/Dashboard.jsx');
  assert.match(dashboard, /showPurchasing/);
  assert.match(dashboard, /showPurchasing = !entitlementLoading && can\('purchasing'\)/);
  assert.match(dashboard, /{showPurchasing && \(/);
  assert.match(dashboard, /<IncomingStock/);
  assert.match(dashboard, /<ReorderPanel/);
});

test('frontend gates: Import Center promises no download and shows problem rows inline', () => {
  const importCenter = src('src/pages/ImportCenter.jsx');
  assert.match(importCenter, /const allowDownload = !isEssentials && !entitlementLoading;/);
  const problemReport = src('src/components/import/ProblemReport.jsx');
  // Essentials sees the first 25 problem rows inline, with an "and N more"
  // count; the Download button only renders when allowDownload is true.
  assert.match(problemReport, /const allowDownload = !isEssentials && !entitlementLoading;/);
  assert.match(problemReport, /rows\.slice\(0, 25\)/);
  assert.match(problemReport, /Business can download this list as a file/);
  assert.match(problemReport, /{allowDownload && \(/);
  assert.match(problemReport, /Download these problems/);
});

test('frontend gates: no PO / supplier packing-slip print styles on Essentials', () => {
  const printCenter = src('src/pages/PrintCenter.jsx');
  assert.match(printCenter, /const showSupplierDocs = !isEssentials && !entitlementLoading;/);
  assert.match(printCenter, /const visibleTemplates = TEMPLATES\.filter\(/);
  assert.match(printCenter, /!isSupplierPrintTemplate\(entry\.key\)/);
  // On Essentials the supplier styles show as visibly locked entries
  // linking to /upgrade, never as usable templates.
  assert.match(printCenter, /const lockedSupplierTemplates =/);
  assert.match(printCenter, /isEssentials && !entitlementLoading/);
});

test('frontend gates: Essentials shows 15 permissions with Import data, not exports', () => {
  assert.equal(ALL_PERMISSIONS.length, 18);
  assert.deepEqual([...BUSINESS_ONLY_PERMISSIONS].sort(), [
    'builds.manage',
    'purchasing.manage',
    'suppliers.manage',
  ]);
  assert.equal(allPermissionsForPlan('essentials').length, 15);
  assert.equal(allPermissionsForPlan('business').length, 18);
  assert.ok(!allPermissionsForPlan('essentials').includes('builds.manage'));
  assert.ok(!allPermissionsForPlan('essentials').includes('purchasing.manage'));
  assert.ok(!allPermissionsForPlan('essentials').includes('suppliers.manage'));
  // The exports key stays, but on Essentials it is offered — and named —
  // as import only.
  assert.ok(allPermissionsForPlan('essentials').includes('exports.use'));
  assert.equal(exportPermissionLabel('essentials'), 'Import data');
  assert.equal(exportPermissionLabel('business'), 'Export and import data');
});

test('frontend gates: ReorderPanel creates draft POs and blocks missing-cost lines', () => {
  const reorder = src('src/components/dashboard/ReorderPanel.jsx');
  assert.match(reorder, /status: 'draft'/);
  assert.match(reorder, /a missing cost is not \$0/);
  assert.match(reorder, /Create draft PO/);
  assert.match(reorder, /Nothing is\n\s+ordered until you review and place the draft in Purchasing/);
  assert.doesNotMatch(reorder, /status: 'ordered'/);
});

test('PrintCenter offers label printing on Essentials without a plan check', () => {
  const printCenter = src('src/pages/PrintCenter.jsx');
  assert.match(printCenter, /printLabelsViaBluetooth\(selected, \{ copies \}\)/);
  assert.match(printCenter, /printLabelsViaUsb\(selected, \{ copies \}\)/);
  assert.match(printCenter, /downloadLabelsPdf\(selected, \{/);
});
