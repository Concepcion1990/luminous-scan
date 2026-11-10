import { base44 } from '@/api/client';
import { scoped, withBusiness } from '@/lib/scoped';
import { loadEntitlement, resolveEntitlement } from '@/lib/entitlements';
import { BUNDLE_MOVEMENT_TYPES, featureAllowed } from '@/lib/plans';
import { t } from './i18n.js';

export const MOVEMENT_TYPES = {
  receive: {
    get label() { return t('inventoryLib.movementReceived'); },
    tone: 'in',
    direction: 'in',
    get hint() { return t('inventoryLib.movementReceivedHint'); },
  },
  sale: {
    get label() { return t('inventoryLib.movementSold'); },
    tone: 'out',
    direction: 'out',
    get hint() { return t('inventoryLib.movementSoldHint'); },
  },
  count: {
    get label() { return t('inventoryLib.movementCount'); },
    tone: 'count',
    direction: 'set',
    get hint() { return t('inventoryLib.movementCountHint'); },
  },
  transfer: {
    get label() { return t('inventoryLib.movementTransfer'); },
    tone: 'move',
    direction: 'out',
    get hint() { return t('inventoryLib.movementTransferHint'); },
  },
  transfer_in: {
    get label() { return t('inventoryLib.movementTransferIn'); },
    tone: 'move',
    direction: 'in',
    get hint() { return t('inventoryLib.movementTransferInHint'); },
  },
  returned: {
    get label() { return t('inventoryLib.movementReturned'); },
    tone: 'in',
    direction: 'in',
    get hint() { return t('inventoryLib.movementReturnedHint'); },
  },
  damaged: {
    get label() { return t('inventoryLib.movementDamaged'); },
    tone: 'warn',
    direction: 'out',
    get hint() { return t('inventoryLib.movementDamagedHint'); },
  },
  lost: {
    get label() { return t('inventoryLib.movementLost'); },
    tone: 'warn',
    direction: 'out',
    get hint() { return t('inventoryLib.movementLostHint'); },
  },
  found: {
    get label() { return t('inventoryLib.movementFound'); },
    tone: 'in',
    direction: 'in',
    get hint() { return t('inventoryLib.movementFoundHint'); },
  },
  write_off: {
    get label() { return t('inventoryLib.movementWrittenOff'); },
    tone: 'warn',
    direction: 'out',
    get hint() { return t('inventoryLib.movementWrittenOffHint'); },
  },
  correction: {
    get label() { return t('inventoryLib.movementCorrection'); },
    tone: 'count',
    direction: 'set',
    get hint() { return t('inventoryLib.movementCorrectionHint'); },
  },
  reserved: {
    get label() { return t('inventoryLib.movementHeld'); },
    tone: 'hold',
    direction: 'hold',
    get hint() { return t('inventoryLib.movementHeldHint'); },
  },
  released: {
    get label() { return t('inventoryLib.movementReleased'); },
    tone: 'hold',
    direction: 'hold',
    get hint() { return t('inventoryLib.movementReleasedHint'); },
  },
  consume: {
    get label() { return t('inventoryLib.movementConsumed'); },
    tone: 'out',
    direction: 'out',
    get hint() { return t('inventoryLib.movementConsumedHint'); },
  },
  produce: {
    get label() { return t('inventoryLib.movementBuilt'); },
    tone: 'in',
    direction: 'in',
    get hint() { return t('inventoryLib.movementBuiltHint'); },
  },
  disassemble: {
    get label() { return t('inventoryLib.movementTakenApart'); },
    tone: 'out',
    direction: 'out',
    get hint() { return t('inventoryLib.movementTakenApartHint'); },
  },
  recovered: {
    get label() { return t('inventoryLib.movementPartRecovered'); },
    tone: 'in',
    direction: 'in',
    get hint() { return t('inventoryLib.movementPartRecoveredHint'); },
  },
};

export async function listProducts({
  search = '',
  category = '',
  tag = '',
  status = '',
  condition = '',
  locationId = '',
  locationIds = [],
  limit = 200,
  businessId = '',
} = {}) {
  const q = search.trim();
  const clauses = [];
  if (q) {
    clauses.push({
      $or: [
        { name: { $regex: q, $options: 'i' } },
        { sku: { $regex: q, $options: 'i' } },
        { upc: { $regex: q, $options: 'i' } },
        { barcode: { $regex: q, $options: 'i' } },
        { isbn: { $regex: q, $options: 'i' } },
        { author: { $regex: q, $options: 'i' } },
        { brand: { $regex: q, $options: 'i' } },
        { publisher: { $regex: q, $options: 'i' } },
        { manufacturer: { $regex: q, $options: 'i' } },
        { category: { $regex: q, $options: 'i' } },
        { subcategory: { $regex: q, $options: 'i' } },
        { tags: { $regex: q, $options: 'i' } },
      ],
    });
  }
  if (category) {
    clauses.push({ category: { $regex: `^${escapeRegex(category)}$`, $options: 'i' } });
  }
  if (tag) clauses.push({ tags: tag });
  // Products saved before statuses existed have no status field; they are live stock.
  if (status === 'active') {
    clauses.push({ $or: [{ status: 'active' }, { status: { $exists: false } }] });
  } else if (status) {
    clauses.push({ status });
  }
  if (condition) clauses.push({ condition });

  // Stock lives in per-location records, so a location filter resolves to the
  // products actually stocked there before the catalog is queried.
  // A parent location reports the stock held inside it too, so callers can pass
  // the parent plus its shelves and bins.
  const placeIds = locationIds?.length ? locationIds : locationId ? [locationId] : [];
  if (placeIds.length) {
    const levelPage = await base44.entities.StockLevel.filter(
      scoped({ location_id: { $in: placeIds } }, businessId),
      { limit: 2000 }
    );
    const ids = [...new Set((levelPage.items ?? []).map((level) => level.product_id))];
    if (!ids.length) return [];
    clauses.push({ id: { $in: ids } });
  }

  const query = clauses.length ? { $and: clauses } : {};
  const page = await base44.entities.Product.filter(scoped(query, businessId), {
    sort: 'name',
    limit,
  });
  return page.items ?? [];
}

export function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Builds a pattern that ignores the spacing style of a code, so a barcode
 * reading "TEST-PJ-001" still finds a SKU stored as "TEST - PJ - 001".
 */
function looseCodePattern(code) {
  if (code.length > 40 || !/^[A-Za-z0-9\s\-_/]+$/.test(code)) return null;
  const parts = code.split(/[\s\-_/]+/).filter(Boolean).map(escapeRegex);
  if (parts.length < 2) return null;
  return `^${parts.join('[\\s\\-_/]*')}$`;
}

/**
 * Every product whose SKU, UPC, barcode or QR value matches the scanned code.
 * An ISBN often belongs to several physical copies, so callers must offer a
 * choice when more than one product comes back instead of picking one.
 */
export async function findProductsByCode(raw, businessId = '') {
  const code = String(raw || '').trim();
  if (!code) return [];
  const variants = [
    ...new Set([
      code,
      code.toUpperCase(),
      code.replace(/\s+/g, ''),
      code.replace(/[-\s]/g, ''),
    ]),
  ].filter(Boolean);

  const page = await base44.entities.Product.filter(
    scoped(
      {
        $or: [
          { sku: { $in: variants } },
          { upc: { $in: variants } },
          { barcode: { $in: variants } },
          { qr_code: { $in: variants } },
          { isbn: { $in: variants } },
        ],
      },
      businessId
    ),
    { limit: 10 }
  );
  if (page.items?.length) return page.items;

  // Second pass: a typed or scanned code whose separators differ from the
  // stored one ("TEST-PJ-001" against "TEST - PJ - 001").
  const pattern = looseCodePattern(code);
  if (!pattern) return [];
  const loose = await base44.entities.Product.filter(
    scoped(
      {
        $or: [
          { sku: { $regex: pattern, $options: 'i' } },
          { upc: { $regex: pattern, $options: 'i' } },
          { barcode: { $regex: pattern, $options: 'i' } },
          { qr_code: { $regex: pattern, $options: 'i' } },
          { isbn: { $regex: pattern, $options: 'i' } },
        ],
      },
      businessId
    ),
    { limit: 10 }
  );
  return loose.items ?? [];
}

export async function findProductByCode(raw, businessId = '') {
  const matches = await findProductsByCode(raw, businessId);
  return matches[0] ?? null;
}

export async function getLevelsForProduct(productId, businessId = '') {
  const page = await base44.entities.StockLevel.filter(
    scoped({ product_id: productId }, businessId),
    { limit: 200 }
  );
  return page.items ?? [];
}

async function setLevel(productId, locationId, quantity, businessId = '') {
  const page = await base44.entities.StockLevel.filter(
    scoped({ product_id: productId, location_id: locationId }, businessId),
    { limit: 1 }
  );
  const existing = page.items?.[0];
  if (existing) {
    await base44.entities.StockLevel.update(existing.id, { quantity });
  } else {
    await base44.entities.StockLevel.create(
      withBusiness({ product_id: productId, location_id: locationId, quantity, reserved: 0 }, businessId)
    );
  }
}

/**
 * Applies a scanned movement: writes the new on-hand level for the location
 * and records it in the ledger (a transfer writes both sides).
 */
export async function recordMovement({
  product,
  location,
  type,
  quantity,
  note,
  scannedCode,
  toLocation,
  user,
  reference,
  supplierName,
  unitCost,
  businessId = '',
}) {
  // Bundle movements are a Business feature, and this is the one funnel
  // every movement write passes through — Scan, counts, orders, purchasing,
  // returns, stock adjustments and builds/teardowns — so the check lives
  // here and no caller can record a bundle type on Essentials. The stored
  // entitlement row decides (the same record the screens read); a missing
  // or unverified record refuses, fail closed. Non-bundle movements skip
  // the read entirely. There is no backend movement endpoint — the
  // entitlement row is the server-side record this checks — and import only
  // ever writes 'receive', so it cannot smuggle a bundle type in either.
  // The guard runs before any level is touched, so a refused build writes
  // nothing at all.
  if (BUNDLE_MOVEMENT_TYPES.includes(type)) {
    const business = businessId || product.business_id || '';
    const record = await loadEntitlement(business);
    if (!featureAllowed(resolveEntitlement(record, user).planKey, 'builds')) {
      throw new Error(t('inventoryLib.bundleBusinessOnly'));
    }
  }

  const qty = Math.abs(Number(quantity) || 0);
  const levels = await getLevelsForProduct(product.id, businessId);
  const current = levels.find((l) => l.location_id === location.id)?.quantity ?? 0;

  const direction = MOVEMENT_TYPES[type]?.direction;
  const next =
    direction === 'set' ? qty
    : direction === 'in' ? current + qty
    : current - qty;

  // Stock can never go below zero: a bad count or a double tap must fail loudly.
  if (next < 0) {
    throw new Error(t('inventoryLib.onlyOnHandAt', { current, location: location.name }));
  }

  await setLevel(product.id, location.id, next, businessId);

  const base = {
    business_id: businessId || product.business_id || '',
    product_id: product.id,
    product_name: product.name,
    sku: product.sku || '',
    location_id: location.id,
    location_name: location.name,
    quantity: qty,
    previous_qty: current,
    new_qty: next,
    scanned_code: scannedCode || '',
    note: note || '',
    reference: reference || '',
    supplier_name: supplierName || '',
    unit_cost: Number(unitCost) || 0,
    user_name: user?.full_name || user?.email || '',
  };

  await base44.entities.StockMovement.create({ ...base, type });

  if (type === 'transfer' && toLocation) {
    const destCurrent = levels.find((l) => l.location_id === toLocation.id)?.quantity ?? 0;
    await setLevel(product.id, toLocation.id, destCurrent + qty, businessId);
    await base44.entities.StockMovement.create({
      ...base,
      type: 'transfer_in',
      location_id: toLocation.id,
      location_name: toLocation.name,
      previous_qty: destCurrent,
      new_qty: destCurrent + qty,
      to_location_id: '',
      to_location_name: location.name,
    });
  }

  return { previous: current, next };
}

/**
 * Holds stock for an order without taking it off the shelf: the reserved
 * number moves, the on-hand quantity does not. Releasing frees it again.
 */
export async function setReserved({
  product,
  location,
  type,
  quantity,
  note,
  reference,
  user,
  businessId = '',
  reversalOf = null,
}) {
  const qty = Math.abs(Number(quantity) || 0);
  if (!qty) throw new Error(t('inventoryLib.enterHowManyToHold'));
  const levels = await getLevelsForProduct(product.id, businessId);
  const level = levels.find((l) => l.location_id === location.id);
  const onHand = level?.quantity ?? 0;
  const held = level?.reserved ?? 0;
  const next = type === 'reserved' ? held + qty : held - qty;
  if (next < 0) throw new Error(t('inventoryLib.onlyHeldAt', { held, location: location.name }));
  if (type === 'reserved' && qty > onHand - held) {
    throw new Error(
      t('inventoryLib.onlyAvailableToHoldAt', {
        available: Math.max(onHand - held, 0),
        location: location.name,
      })
    );
  }

  if (level) await base44.entities.StockLevel.update(level.id, { reserved: next });
  else {
    await base44.entities.StockLevel.create(
      withBusiness({ product_id: product.id, location_id: location.id, quantity: 0, reserved: next }, businessId)
    );
  }

  await base44.entities.StockMovement.create({
    business_id: businessId || product.business_id || '',
    product_id: product.id,
    product_name: product.name,
    sku: product.sku || '',
    location_id: location.id,
    location_name: location.name,
    type,
    quantity: qty,
    previous_qty: held,
    new_qty: next,
    reference: reference || '',
    note: note || '',
    user_name: user?.full_name || user?.email || '',
    ...(reversalOf ? { reversal_of_id: reversalOf.id, reversal_of_label: reversalOf.label } : {}),
  });

  return { previous: held, next };
}

const REVERSIBLE_TYPES = [
  'receive',
  'sale',
  'returned',
  'damaged',
  'lost',
  'found',
  'write_off',
  'correction',
  'count',
  'reserved',
  'released',
];

/** Why a ledger entry cannot be reversed, or '' when it can. */
export function reversalBlocker(movement) {
  if (!movement) return t('inventoryLib.reversalNothing');
  if (movement.reversal_of_id) return t('inventoryLib.reversalAlreadyReversal');
  // Bundle entries are checked before the reversible list: they are not in
  // it, and without this order they would get the transfer message below.
  if (
    ['consume', 'produce', 'disassemble', 'recovered'].includes(movement.type)
  ) {
    return t('inventoryLib.reversalBuildTeardown');
  }
  if (!REVERSIBLE_TYPES.includes(movement.type)) {
    return t('inventoryLib.reversalTransfer');
  }
  if (movement.type === 'receive' && /^PO-/i.test(movement.reference || '')) {
    return t('inventoryLib.reversalPurchaseOrder');
  }
  return '';
}

function movementLabel(movement) {
  const meta = MOVEMENT_TYPES[movement.type];
  const stamp = movement.created_date ? new Date(movement.created_date) : null;
  const when =
    stamp && !Number.isNaN(stamp.getTime())
      ? stamp.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
      : '';
  return [meta?.label || movement.type, when].filter(Boolean).join(' · ');
}

/**
 * Undoes one ledger entry by writing its mirror image, so nothing is ever
 * edited or deleted: the original stays and the correction explains itself.
 */
export async function reverseMovement(movement, user, businessId = '') {
  const blocker = reversalBlocker(movement);
  if (blocker) throw new Error(blocker);

  const product = {
    id: movement.product_id,
    name: movement.product_name,
    sku: movement.sku,
    business_id: movement.business_id,
  };
  const location = { id: movement.location_id, name: movement.location_name };
  const link = { id: movement.id, label: movementLabel(movement) };

  if (movement.type === 'reserved' || movement.type === 'released') {
    return setReserved({
      product,
      location,
      type: movement.type === 'reserved' ? 'released' : 'reserved',
      quantity: movement.quantity,
      note: t('inventoryLib.reversesLabel', { label: link.label }),
      reference: movement.reference,
      user,
      businessId,
      reversalOf: link,
    });
  }

  const levels = await getLevelsForProduct(movement.product_id, businessId);
  const current = levels.find((l) => l.location_id === movement.location_id)?.quantity ?? 0;
  const direction = MOVEMENT_TYPES[movement.type]?.direction;
  const delta = (movement.new_qty ?? 0) - (movement.previous_qty ?? 0);
  const target = direction === 'set' ? Number(movement.previous_qty ?? 0) : current - delta;

  if (target < 0) {
    throw new Error(
      t('inventoryLib.cannotUndoMovedSince', { location: location.name, current })
    );
  }

  await setLevel(movement.product_id, movement.location_id, target, businessId);
  await base44.entities.StockMovement.create({
    business_id: businessId || movement.business_id || '',
    product_id: movement.product_id,
    product_name: movement.product_name,
    sku: movement.sku || '',
    location_id: movement.location_id,
    location_name: movement.location_name,
    type: 'correction',
    quantity: Math.abs(target - current),
    previous_qty: current,
    new_qty: target,
    note: t('inventoryLib.reversesLabel', { label: link.label }),
    reference: movement.reference || '',
    user_name: user?.full_name || user?.email || '',
    reversal_of_id: movement.id,
    reversal_of_label: link.label,
  });

  return { previous: current, next: target };
}

export const INVENTORY_PRODUCT_LIMIT = 500;

/**
 * "Showing 500 of 600 — refine your search" when a 500-row page cut the
 * catalog short, '' when everything shown fits. A truncated catalog must
 * never look complete: the first 500 products alphabetically are not the
 * whole business.
 */
export function productTruncationNotice(shown, total) {
  if (!total || shown >= total) return '';
  return t('inventoryLib.showingOfTotal', { shown, total });
}

export async function loadInventory(businessId = '') {
  const [products, levels, locations, movements, productTotal] = await Promise.all([
    base44.entities.Product.filter(scoped({}, businessId), { sort: 'name', limit: INVENTORY_PRODUCT_LIMIT }),
    base44.entities.StockLevel.filter(scoped({}, businessId), { limit: 2000 }),
    base44.entities.Location.filter(scoped({}, businessId), { sort: 'name', limit: 100 }),
    base44.entities.StockMovement.filter(scoped({}, businessId), {
      sort: '-created_date',
      limit: 8,
    }),
    base44.entities.Product.count(scoped({}, businessId)),
  ]);

  const shown = products.items ?? [];
  return {
    products: shown,
    levels: levels.items ?? [],
    locations: locations.items ?? [],
    movements: movements.items ?? [],
    // The catalog page is capped at 500: say how many exist so a Business
    // store with 600 products never mistakes the first 500 for all of them.
    productTotal,
    productsTruncated: productTotal > shown.length,
  };
}

export function summarize({ products, levels, locations }) {
  const qtyByProduct = new Map();
  levels.forEach((l) => {
    qtyByProduct.set(l.product_id, (qtyByProduct.get(l.product_id) || 0) + (l.quantity || 0));
  });

  const productById = new Map(products.map((p) => [p.id, p]));
  const locationById = new Map(locations.map((l) => [l.id, l]));

  const low = levels
    .map((level) => {
      const product = productById.get(level.product_id);
      if (!product || !product.reorder_point) return null;
      if ((level.quantity || 0) > product.reorder_point) return null;
      return {
        product,
        level,
        location: locationById.get(level.location_id),
        quantity: level.quantity || 0,
        reorder: product.reorder_point,
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.quantity - b.quantity);

  const perLocation = locations.map((location) => {
    const own = levels.filter((l) => l.location_id === location.id);
    return {
      location,
      units: own.reduce((sum, l) => sum + (l.quantity || 0), 0),
      skus: own.filter((l) => (l.quantity || 0) > 0).length,
      low: low.filter((l) => l.level.location_id === location.id).length,
    };
  });

  const stockValue = levels.reduce((sum, level) => {
    const product = productById.get(level.product_id);
    return sum + (level.quantity || 0) * (product?.cost || 0);
  }, 0);

  const retailValue = levels.reduce((sum, level) => {
    const product = productById.get(level.product_id);
    return sum + (level.quantity || 0) * (product?.price || 0);
  }, 0);

  return {
    totalUnits: levels.reduce((sum, l) => sum + (l.quantity || 0), 0),
    reservedUnits: levels.reduce((sum, l) => sum + (l.reserved || 0), 0),
    activeSkus: products.length,
    stockValue,
    retailValue,
    margin: retailValue - stockValue,
    low,
    perLocation,
    qtyByProduct,
  };
}

export function formatMoney(value, currency = 'USD', maximumFractionDigits = 0) {
  const options = { style: 'currency', currency, maximumFractionDigits };
  try {
    return new Intl.NumberFormat('en-US', options).format(value || 0);
  } catch {
    return new Intl.NumberFormat('en-US', { ...options, currency: 'USD' }).format(value || 0);
  }
}