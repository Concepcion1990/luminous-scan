/**
 * Stock movements, server-side — T3 (plan §2.11, §5.2).
 *
 * The ported pages still record movements through the generic entity
 * layer (src/lib/inventory.js is untouched — the ported audit tests
 * assert on its source), but the canonical, atomic path lives here:
 * one transaction adjusts the level and writes the ledger, so a
 * transfer can never write one side without the other. The server
 * import endpoint and the cross-business move both use this module.
 * The rules mirror src/lib/inventory.js exactly: stock never goes
 * below zero, bundle types are Business-only, transfers write both
 * sides, reversals write a mirror entry and never edit the original.
 */
import crypto from 'node:crypto';
import { featureAllowed, BUNDLE_MOVEMENT_TYPES } from './plans.js';
import { depleteForSaleTx, restoreDepletionsTx } from './recipes.js';

export const MOVEMENT_TYPES = {
  receive: { label: 'Received', direction: 'in' },
  sale: { label: 'Sold', direction: 'out' },
  count: { label: 'Count', direction: 'set' },
  transfer: { label: 'Transfer', direction: 'out' },
  transfer_in: { label: 'Transfer in', direction: 'in' },
  returned: { label: 'Returned', direction: 'in' },
  damaged: { label: 'Damaged', direction: 'out' },
  lost: { label: 'Lost', direction: 'out' },
  found: { label: 'Found', direction: 'in' },
  write_off: { label: 'Written off', direction: 'out' },
  correction: { label: 'Correction', direction: 'set' },
  reserved: { label: 'Held', direction: 'hold' },
  released: { label: 'Released', direction: 'hold' },
  consume: { label: 'Consumed', direction: 'out' },
  produce: { label: 'Built', direction: 'in' },
  // Restaurant operations (release 361): a staff meal takes
  // the dish off the shelf as its own usage category. Like
  // consume/produce it is NOT in REVERSIBLE_TYPES — the meal
  // was eaten; the row stands and stock is adjusted directly.
  staff_meal: { label: 'Staff meal', direction: 'out' },
  disassemble: { label: 'Taken apart', direction: 'out' },
  recovered: { label: 'Part recovered', direction: 'in' },
};

const REVERSIBLE_TYPES = [
  'receive', 'sale', 'returned', 'damaged', 'lost', 'found',
  'write_off', 'correction', 'count', 'reserved', 'released',
];

function err(status, code, message) {
  return Object.assign(new Error(message), { status, code });
}

/**
 * Archived products are FROZEN (owner ruling, Nov 14, 2026): while a
 * product is archived, no stock movement of any kind may touch it —
 * not from the app, a till, a sync replay, or an import. Restoring
 * it to active unfreezes it instantly. The check lives in the
 * movement funnel itself so no caller can route around it; callers
 * that hand in a partial product row get the status read here.
 */
export async function assertProductNotArchived(client, businessId, product) {
  let status = product?.status;
  if (status === undefined && product?.id) {
    const { rows } = await client.query(
      'SELECT status FROM products WHERE id = $1 AND business_id = $2',
      [product.id, businessId],
    );
    status = rows[0]?.status;
  }
  if (status === 'archived') {
    throw err(
      400,
      'product_archived',
      `${product?.name || 'This product'} is archived, so its stock is frozen. Restore it to active to move its stock again.`,
    );
  }
}

export async function getLevel(client, businessId, productId, locationId) {
  const { rows } = await client.query(
    'SELECT * FROM stock_levels WHERE business_id = $1 AND product_id = $2 AND location_id = $3 LIMIT 1',
    [businessId, productId, locationId],
  );
  return rows[0] ?? null;
}

export async function setLevel(client, businessId, productId, locationId, quantity, reserved, caller) {
  const existing = await getLevel(client, businessId, productId, locationId);
  if (existing) {
    const { rows } = await client.query(
      'UPDATE stock_levels SET quantity = $1, reserved = $2, updated_at = NOW() WHERE id = $3 RETURNING *',
      [quantity, reserved ?? Number(existing.reserved ?? 0), existing.id],
    );
    return rows[0];
  }
  const { rows } = await client.query(
    `INSERT INTO stock_levels (id, business_id, product_id, location_id, quantity, reserved, created_by_id, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [crypto.randomUUID(), businessId, productId, locationId, quantity, reserved ?? 0, caller?.id ?? null, caller?.email ?? null],
  );
  return rows[0];
}

export async function insertMovement(client, values, caller) {
  const id = crypto.randomUUID();
  const { rows } = await client.query(
    `INSERT INTO stock_movements
       (id, business_id, product_id, product_name, sku, location_id, location_name, type,
        quantity, previous_qty, new_qty, to_location_id, to_location_name, scanned_code,
        reference, supplier_name, unit_cost, note, user_name, reversal_of_id, reversal_of_label,
        created_by_id, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)
     RETURNING *`,
    [
      id,
      values.business_id,
      values.product_id || '',
      values.product_name || '',
      values.sku || '',
      values.location_id || '',
      values.location_name || '',
      values.type,
      values.quantity ?? 0,
      values.previous_qty ?? 0,
      values.new_qty ?? 0,
      values.to_location_id || '',
      values.to_location_name || '',
      values.scanned_code || '',
      values.reference || '',
      values.supplier_name || '',
      values.unit_cost ?? 0,
      values.note || '',
      values.user_name || '',
      values.reversal_of_id || null,
      values.reversal_of_label || '',
      caller?.id ?? null,
      caller?.email ?? null,
    ],
  );
  return rows[0];
}

/**
 * Apply one movement inside the caller's transaction (client must
 * already be in BEGIN). Returns { previous, next, movement }.
 * `product` and `location` are the loaded rows; `planKey` gates
 * bundle types; `userName` is stamped on the ledger row.
 */
export async function recordMovementTx(client, {
  businessId,
  product,
  location,
  type,
  quantity,
  note,
  scannedCode,
  toLocation,
  userName,
  reference,
  supplierName,
  unitCost,
  planKey,
  caller,
}) {
  if (!MOVEMENT_TYPES[type]) throw err(400, 'invalid_type', `Unknown movement type ${type}.`);
  await assertProductNotArchived(client, businessId, product);
  if (BUNDLE_MOVEMENT_TYPES.includes(type) && !featureAllowed(planKey, 'builds')) {
    throw err(403, 'bundle_business_only', 'Bundle movements are a Business feature — building bundles and taking them apart need the Business plan.');
  }
  const qty = Math.abs(Number(quantity) || 0);
  if (type !== 'count' && type !== 'correction' && qty <= 0) {
    throw err(400, 'invalid_quantity', 'Enter a quantity greater than zero.');
  }
  const level = await getLevel(client, businessId, product.id, location.id);
  const current = Number(level?.quantity ?? 0);
  const direction = MOVEMENT_TYPES[type].direction;
  const next = direction === 'set' ? qty : direction === 'in' ? current + qty : current - qty;
  if (next < 0) throw err(400, 'insufficient_stock', `Only ${current} on hand at ${location.name}.`);
  await setLevel(client, businessId, product.id, location.id, next, undefined, caller);
  const base = {
    business_id: businessId,
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
    user_name: userName || '',
  };
  // A transfer's OUT row names its destination (release 361:
  // the transfer document reads the out row — before this,
  // only the in row carried a place name, its source, and
  // the document's TO line came out blank).
  if (type === 'transfer' && toLocation) {
    base.to_location_id = toLocation.id;
    base.to_location_name = toLocation.name;
  }
  const movement = await insertMovement(client, { ...base, type }, caller);
  if (type === 'transfer' && toLocation) {
    const destLevel = await getLevel(client, businessId, product.id, toLocation.id);
    const destCurrent = Number(destLevel?.quantity ?? 0);
    await setLevel(client, businessId, product.id, toLocation.id, destCurrent + qty, undefined, caller);
    await insertMovement(client, {
      ...base,
      type: 'transfer_in',
      location_id: toLocation.id,
      location_name: toLocation.name,
      previous_qty: destCurrent,
      new_qty: destCurrent + qty,
      to_location_id: '',
      to_location_name: location.name,
    }, caller);
  }
  // Restaurant depletion (release 359, Nov 23, 2026): a SALE
  // of a dish takes its recipe's ingredients off the same
  // shelf, in the same transaction — so every door that sells
  // through this funnel (tills, sync replay, the scan and
  // adjustment doors) depletes alike, and a sale that rolls
  // back takes its depletion with it. Drafts never deplete
  // and a shortage never blocks the sale (server/recipes.js).
  if (type === 'sale' && featureAllowed(planKey, 'restaurant')) {
    await depleteForSaleTx(client, {
      businessId,
      saleMovement: movement,
      product,
      location,
      quantity: qty,
      userName,
      caller,
    });
  }
  return { previous: current, next, movement };
}

/** Hold / release reserved stock without touching the on-hand quantity. */
export async function setReservedTx(client, {
  businessId, product, location, type, quantity, note, reference, userName, reversalOf, caller,
}) {
  if (!['reserved', 'released'].includes(type)) throw err(400, 'invalid_type', 'Expected reserved or released.');
  await assertProductNotArchived(client, businessId, product);
  const qty = Math.abs(Number(quantity) || 0);
  if (!qty) throw err(400, 'invalid_quantity', 'Enter how many to hold.');
  const level = await getLevel(client, businessId, product.id, location.id);
  const onHand = Number(level?.quantity ?? 0);
  const held = Number(level?.reserved ?? 0);
  const next = type === 'reserved' ? held + qty : held - qty;
  if (next < 0) throw err(400, 'insufficient_stock', `Only ${held} held at ${location.name}.`);
  if (type === 'reserved' && qty > onHand - held) {
    throw err(400, 'insufficient_stock', `Only ${Math.max(onHand - held, 0)} available to hold at ${location.name}.`);
  }
  await setLevel(client, businessId, product.id, location.id, onHand, next, caller);
  const movement = await insertMovement(client, {
    business_id: businessId,
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
    user_name: userName || '',
    reversal_of_id: reversalOf?.id || null,
    reversal_of_label: reversalOf?.label || '',
  }, caller);
  return { previous: held, next, movement };
}

export function reversalBlocker(movement) {
  if (!movement) return 'Nothing to reverse.';
  if (movement.reversal_of_id) return 'This entry is already a reversal.';
  if (['consume', 'produce', 'disassemble', 'recovered'].includes(movement.type)) {
    return 'This entry came from a build or teardown, which moved several items at once. Adjust the stock directly instead.';
  }
  if (!REVERSIBLE_TYPES.includes(movement.type)) {
    return 'A transfer touches two places — move the stock back with a new transfer instead.';
  }
  if (movement.type === 'receive' && /^PO-/i.test(movement.reference || '')) {
    return 'This receipt came from a purchase order. Receive the shortfall or cancel the order in Purchasing instead.';
  }
  return '';
}

/** Undo one ledger entry by writing its mirror image (original stays). */
export async function reverseMovementTx(client, { businessId, movement, userName, caller }) {
  // Archived products are frozen (Nov 14, 2026): a reversal is a
  // stock movement too, so it waits for the product to come back.
  // The message carries the door, per the owner's no-dead-ends rule.
  if (movement?.product_id) {
    const { rows } = await client.query(
      'SELECT status, name FROM products WHERE id = $1 AND business_id = $2',
      [movement.product_id, businessId],
    );
    if (rows[0]?.status === 'archived') {
      throw err(
        400,
        'product_archived',
        `${rows[0].name || 'This product'} is archived, so its stock is frozen. Restore it to active first, then reverse this entry.`,
      );
    }
  }
  const blocker = reversalBlocker(movement);
  if (blocker) throw err(400, 'not_reversible', blocker);
  const product = { id: movement.product_id, name: movement.product_name, sku: movement.sku };
  const location = { id: movement.location_id, name: movement.location_name };
  const label = [MOVEMENT_TYPES[movement.type]?.label || movement.type, movement.created_at ? new Date(movement.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : ''].filter(Boolean).join(' · ');
  const link = { id: movement.id, label };
  if (movement.type === 'reserved' || movement.type === 'released') {
    return setReservedTx(client, {
      businessId,
      product,
      location,
      type: movement.type === 'reserved' ? 'released' : 'reserved',
      quantity: movement.quantity,
      note: `Reverses ${link.label}`,
      reference: movement.reference,
      userName,
      reversalOf: link,
      caller,
    });
  }
  const level = await getLevel(client, businessId, movement.product_id, movement.location_id);
  const current = Number(level?.quantity ?? 0);
  const direction = MOVEMENT_TYPES[movement.type]?.direction;
  const delta = Number(movement.new_qty ?? 0) - Number(movement.previous_qty ?? 0);
  const target = direction === 'set' ? Number(movement.previous_qty ?? 0) : current - delta;
  if (target < 0) {
    throw err(400, 'insufficient_stock', `Stock at ${location.name} has moved since — only ${current} on hand, so this entry cannot be undone.`);
  }
  await setLevel(client, businessId, movement.product_id, movement.location_id, target, undefined, caller);
  const mirror = await insertMovement(client, {
    business_id: businessId,
    product_id: movement.product_id,
    product_name: movement.product_name,
    sku: movement.sku || '',
    location_id: movement.location_id,
    location_name: movement.location_name,
    type: 'correction',
    quantity: Math.abs(target - current),
    previous_qty: current,
    new_qty: target,
    note: `Reverses ${link.label}`,
    reference: movement.reference || '',
    user_name: userName || '',
    reversal_of_id: movement.id,
    reversal_of_label: link.label,
  }, caller);
  // Restaurant depletion (release 359): reversing a SALE puts
  // its ingredients back — each consume row the sale caused is
  // restored once, as its own correction naming it. A returned
  // dish never does this (the food was made); only a reversed
  // sale restores.
  if (movement.type === 'sale') {
    await restoreDepletionsTx(client, { businessId, saleMovement: movement, userName, caller });
  }
  return { previous: current, next: target, movement: mirror };
}

/** Run fn(client) inside one transaction; rolls back on any throw. */
export async function withTx(pool, fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
