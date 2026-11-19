/**
 * T3 — No dangling doors: product creation (owner ruling, Nov 19, 2026).
 *
 * Before this build, the "+ New product" buttons (Overview,
 * Products, the scanner's not-found panel) rendered for everyone,
 * but the server refused anyone without products.edit — a door
 * hanging on the wall of a person who could not walk through it,
 * proven by the owner's own hand ("You do not have permission to
 * do that here.").
 *
 * The ruling: creating products is the owner's per-member
 * enrollment option. The products.create tick (stored in the
 * member's permissions array, carried by NO role, off by default)
 * makes the buttons appear for that member AND makes creation
 * work; unticked, no buttons at all. The create door therefore
 * takes products.edit OR the tick. Editing an existing product
 * still takes products.edit alone — the tick is a creation door,
 * not an editing one.
 */
import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  pool,
  req,
  close,
  resetRateLimits,
  registerVerifiedUser,
  ownerWithBusiness,
} from './helpers.js';
import { PRESET_ROLES } from '../../server/authz.js';

after(close);
beforeEach(() => resetRateLimits());

const REFUSAL = 'You do not have permission to do that here.';

/** Invite a member with a preset role, activate their account, and
 * give them a full-week schedule so the shift window lets their
 * session work (the window brackets sign-in once the active
 * business is set — owner ruling, Nov 19, 2026). */
async function actor(owner, { email, roleId, roleName }) {
  const invite = await req('/api/entities/StaffMember', {
    method: 'POST',
    cookie: owner.cookie,
    body: {
      business_id: owner.business.id,
      full_name: roleName,
      email,
      role_id: roleId,
      role_name: roleName,
    },
  });
  assert.equal(invite.status, 201, invite.text);
  const account = await registerVerifiedUser(email);
  await pool.query('UPDATE users SET active_business_id = $1 WHERE id = $2', [
    owner.business.id,
    account.user.id,
  ]);
  const row = (
    await pool.query('SELECT id FROM staff_members WHERE business_id = $1 AND email = $2', [
      owner.business.id,
      email,
    ])
  ).rows[0];
  for (let weekday = 0; weekday < 7; weekday += 1) {
    await pool.query(
      `INSERT INTO work_schedules (id, business_id, staff_member_id, weekday, start_time, end_time)
       VALUES ($1, $2, $3, $4, '00:00', '23:59')`,
      [crypto.randomUUID(), owner.business.id, row.id, weekday],
    );
  }
  return { ...account, memberId: row.id };
}

/** Give or take the products.create tick on a member's stored
 * permissions — the same array the enrollment dialog edits. A
 * member invited without an explicit array stores an EMPTY one
 * and the server falls back to their role; the dialog instead
 * always saves the full set, so materialize the role's
 * permissions first, exactly as a dialog save would leave them. */
async function setGrant(businessId, memberId, granted) {
  const row = (
    await pool.query('SELECT permissions, role_id FROM staff_members WHERE id = $1', [memberId])
  ).rows[0];
  let permissions = [];
  try {
    permissions = JSON.parse(row.permissions || '[]');
  } catch {
    permissions = [];
  }
  if (!permissions.length) {
    const preset = PRESET_ROLES.find((role) => role.id === row.role_id);
    permissions = preset ? [...preset.permissions] : [];
  }
  const next = granted
    ? [...new Set([...permissions, 'products.create'])]
    : permissions.filter((key) => key !== 'products.create');
  await pool.query('UPDATE staff_members SET permissions = $1 WHERE business_id = $2 AND id = $3', [
    JSON.stringify(next),
    businessId,
    memberId,
  ]);
}

let seq = 0;
async function createViaEntity(cookie, businessId) {
  seq += 1;
  return req('/api/entities/Product', {
    method: 'POST',
    cookie,
    body: { business_id: businessId, name: `Gate Widget ${seq}`, sku: `GW-${seq}` },
  });
}

async function createViaRoute(cookie, businessId) {
  seq += 1;
  return req(`/api/businesses/${businessId}/products`, {
    method: 'POST',
    cookie,
    body: { products: [{ name: `Gate Widget ${seq}`, sku: `GW-${seq}` }] },
  });
}

async function productCount(cookie, businessId) {
  const res = await req('/api/entities/Product/query', {
    method: 'POST',
    cookie,
    body: { filter: { business_id: businessId } },
  });
  assert.equal(res.status, 200, res.text);
  return res.json.items.length;
}

test('a Sales clerk without the tick: product creation refuses on both create doors and nothing is created', async () => {
  const owner = await ownerWithBusiness('doors-sales-owner@example.com');
  const sales = await actor(owner, {
    email: 'doors-sales@example.com',
    roleId: 'preset-sales',
    roleName: 'Sales clerk',
  });

  const viaEntity = await createViaEntity(sales.cookie, owner.business.id);
  assert.equal(viaEntity.status, 403, viaEntity.text);
  assert.equal(viaEntity.json.error, 'forbidden');
  assert.equal(viaEntity.json.message, REFUSAL);

  const viaRoute = await createViaRoute(sales.cookie, owner.business.id);
  assert.equal(viaRoute.status, 403, viaRoute.text);
  assert.equal(viaRoute.json.error, 'forbidden');

  assert.equal(await productCount(owner.cookie, owner.business.id), 0, 'no product slipped in');
});

test('the tick makes creation work on both doors; removing it refuses again', async () => {
  const owner = await ownerWithBusiness('doors-tick-owner@example.com');
  const sales = await actor(owner, {
    email: 'doors-tick@example.com',
    roleId: 'preset-sales',
    roleName: 'Sales clerk',
  });

  await setGrant(owner.business.id, sales.memberId, true);
  const viaEntity = await createViaEntity(sales.cookie, owner.business.id);
  assert.equal(viaEntity.status, 201, viaEntity.text);
  const viaRoute = await createViaRoute(sales.cookie, owner.business.id);
  assert.equal(viaRoute.status, 201, viaRoute.text);
  assert.equal(viaRoute.json.created.length, 1);
  assert.equal(await productCount(owner.cookie, owner.business.id), 2);

  await setGrant(owner.business.id, sales.memberId, false);
  const refused = await createViaEntity(sales.cookie, owner.business.id);
  assert.equal(refused.status, 403, refused.text);
  assert.equal(refused.json.message, REFUSAL);
  assert.equal(await productCount(owner.cookie, owner.business.id), 2, 'the count never moved');
});

test('products.edit holders create with no tick anywhere (the Stock clerk case is unchanged)', async () => {
  const owner = await ownerWithBusiness('doors-stock-owner@example.com');
  const stock = await actor(owner, {
    email: 'doors-stock@example.com',
    roleId: 'preset-stock',
    roleName: 'Stock clerk',
  });
  const viaEntity = await createViaEntity(stock.cookie, owner.business.id);
  assert.equal(viaEntity.status, 201, viaEntity.text);
  const viaRoute = await createViaRoute(stock.cookie, owner.business.id);
  assert.equal(viaRoute.status, 201, viaRoute.text);
});

test('the tick is a creation door only: a ticked clerk still cannot EDIT an existing product', async () => {
  const owner = await ownerWithBusiness('doors-edit-owner@example.com');
  const sales = await actor(owner, {
    email: 'doors-edit@example.com',
    roleId: 'preset-sales',
    roleName: 'Sales clerk',
  });
  await setGrant(owner.business.id, sales.memberId, true);
  const created = await createViaEntity(sales.cookie, owner.business.id);
  assert.equal(created.status, 201, created.text);

  const edited = await req(`/api/entities/Product/${created.json.id}`, {
    method: 'PATCH',
    cookie: sales.cookie,
    body: { name: 'Renamed by the clerk' },
  });
  assert.equal(edited.status, 403, edited.text);
  assert.equal(edited.json.message, REFUSAL);
});

test('the owner creates with no tick anywhere', async () => {
  const owner = await ownerWithBusiness('doors-owner@example.com');
  const created = await createViaEntity(owner.cookie, owner.business.id);
  assert.equal(created.status, 201, created.text);
});

test('the gate holds on the Business plan too', async () => {
  const owner = await ownerWithBusiness('doors-business-owner@example.com', 'Test Shop', { plan: 'business' });
  const sales = await actor(owner, {
    email: 'doors-business@example.com',
    roleId: 'preset-sales',
    roleName: 'Sales clerk',
  });
  const refused = await createViaEntity(sales.cookie, owner.business.id);
  assert.equal(refused.status, 403, refused.text);
  await setGrant(owner.business.id, sales.memberId, true);
  const created = await createViaEntity(sales.cookie, owner.business.id);
  assert.equal(created.status, 201, created.text);
});

// ---- Source pins: the tick, the doors, the sweep alignments ----

const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');

test('the tick lives in the member dialog as its own grant state, beside the returns grants', () => {
  const dialog = read('../../src/components/staff/StaffMemberDialog.jsx');
  assert.match(dialog, /PRODUCTS_GRANTS\.map/, 'the dialog renders the products grants');
  assert.match(dialog, /products_grants/, 'the dialog keeps the products grants as their own form state');
  assert.match(dialog, /isProductsGrant/, 'the dialog splits the products grants out of the stored array');
  const staff = read('../../src/lib/staff.js');
  assert.match(staff, /key: 'products\.create'/, 'the grant key is products.create');
  assert.match(staff, /isSettingsGrant\(key\) \|\| isReturnsGrant\(key\) \|\| isProductsGrant\(key\)/, 'isMemberGrant covers the products grant, so the picker can never wipe it');
});

test('the server create door takes products.edit OR the tick; the update door is untouched', () => {
  const entities = read('../../server/entities.js');
  assert.match(
    entities,
    /name === 'Product' && access\.can\('products\.create'\)/,
    'guardCreate aligns the Product create door to the tick',
  );
});

test('the New product doors render only for a person who can create', () => {
  const dashboard = read('../../src/pages/Dashboard.jsx');
  assert.match(dashboard, /canStaff\('products\.edit'\) \|\| canStaff\('products\.create'\)/, 'Overview reads the effective creation right');
  assert.match(dashboard, /\{canCreateProducts && \(/, 'the Overview New product link is conditional');
  const products = read('../../src/pages/Products.jsx');
  assert.match(products, /can\('products\.edit'\) \|\| can\('products\.create'\)/, 'Products reads the effective creation right');
  assert.match(products, /\{canCreateProducts && \(/, 'the Products New product button is conditional');
  assert.match(products, /onDuplicate={canCreateProducts \? duplicate : undefined}/, 'Duplicate follows the creation right');
  const menu = read('../../src/components/products/ProductRowMenu.jsx');
  assert.match(menu, /\{onDuplicate && \(/, 'the row menu renders Duplicate only when it is offered');
  const scan = read('../../src/pages/Scan.jsx');
  assert.match(scan, /can\('products\.edit'\) \|\| can\('products\.create'\)/, 'the scanner reads the effective creation right');
  assert.match(scan, /\{canCreateProducts && \(/, 'the not-found Create product button is conditional');
});

test('the sibling doors from the sweep render only for the person the server would let through', () => {
  const form = read('../../src/components/products/ProductFormDialog.jsx');
  assert.match(form, /onAddNewRequest={canManageCategories \?/, 'minting a category from the product form follows categories.manage');
  const inline = read('../../src/components/locations/AddLocationInline.jsx');
  assert.match(inline, /if \(!can\('locations\.manage'\)\) return null;/, 'the inline location form self-gates on locations.manage');
  const movements = read('../../src/pages/Movements.jsx');
  assert.match(movements, /onAskReverse={canReverse \?/, 'the Reverse door follows movements.reverse');
  const row = read('../../src/components/movements/MovementRow.jsx');
  assert.match(row, /!movement\.reversal_of_id && onAskReverse && \(/, 'a movement row shows no Reverse button without the door');
  const center = read('../../src/pages/ImportCenter.jsx');
  assert.match(center, /modes={canEditProducts \? undefined : \['receive'\]}/, 'the import modes offered follow products.edit');
});

test('the products lesson no longer teaches every reader to add a product', () => {
  const en = read('../../src/lib/locales/en.js');
  assert.match(
    en,
    /"training\.lessons\.products-find-edit\.step4": "Brand-new product\? If you see the New product button, you can add it/,
    'step 4 speaks in the conditional voice',
  );
});
