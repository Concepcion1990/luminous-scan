/**
 * Business-only flows — T5 (plan §2.11, §7 Phase T5).
 *
 * Purchase orders and BOMs live as entities (server/entities.js), but
 * the moves that change stock are flows, not edits, and they run here
 * in one transaction each:
 *
 *  - PO order / cancel: guarded status moves (draft -> ordered,
 *    anything open -> cancelled only before anything arrived).
 *  - PO receive: every line checked before the first movement, then
 *    stock lands through the atomic movements path
 *    (server/movements.js recordMovementTx) — never a direct level
 *    write — and the product's cost becomes what was actually paid.
 *  - BOM build: components are checked up front, then consumed and
 *    the finished product produced in the same transaction, so a
 *    build either has everything it needs or writes nothing at all.
 *  - BOM disassemble: the finished units leave the shelf and every
 *    component comes back in the same proportions.
 *
 * All of it is Business-only and permission-checked server-side.
 * Essentials never reaches these routes (403 plan_gated).
 */
import crypto from 'node:crypto';
import { resolveAccess } from './authz.js';
import { featureAllowed } from './plans.js';
import { entityDef, publicRow } from './entities.js';
import { recordMovementTx, getLevel, withTx } from './movements.js';
import { assertNotInGrace } from './billing.js';

function err(status, code, message) {
  return Object.assign(new Error(message), { status, code });
}

function buildReference(prefix) {
  const now = new Date();
  const day = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
  return `${prefix}-${day}-${String(Math.floor(Math.random() * 900) + 100)}`;
}

/** Merge repeated component rows so availability is checked on the full need. */
export function usableBomLines(bom) {
  const merged = new Map();
  (bom?.lines || []).forEach((line) => {
    const quantity = Number(line.quantity) || 0;
    if (!line.component_id || quantity <= 0) return;
    const existing = merged.get(line.component_id);
    if (existing) merged.set(line.component_id, { ...existing, quantity: existing.quantity + quantity });
    else merged.set(line.component_id, { ...line, quantity });
  });
  return [...merged.values()];
}

async function businessAccessOr403(pool, user, businessId, permission) {
  const access = await resolveAccess(pool, user, businessId);
  if (!access) throw err(403, 'forbidden', 'You do not have access to this workspace.');
  if (!featureAllowed(access.planKey, 'purchasing') && !featureAllowed(access.planKey, 'builds')) {
    throw err(403, 'plan_gated', 'This feature is part of the Business plan.');
  }
  if (permission && !access.can(permission)) {
    throw err(403, 'forbidden', 'You do not have permission to do that here.');
  }
  await assertNotInGrace(pool, businessId);
  return access;
}

async function loadPo(pool, businessId, id) {
  const { rows } = await pool.query(
    'SELECT * FROM purchase_orders WHERE id = $1 AND business_id = $2 LIMIT 1',
    [id, businessId],
  );
  if (!rows[0]) throw err(404, 'not_found', 'Purchase order not found.');
  return publicRow(entityDef('PurchaseOrder'), rows[0]);
}

async function loadBom(pool, businessId, id) {
  const { rows } = await pool.query('SELECT * FROM boms WHERE id = $1 AND business_id = $2 LIMIT 1', [
    id,
    businessId,
  ]);
  if (!rows[0]) throw err(404, 'not_found', 'Build list not found.');
  return publicRow(entityDef('Bom'), rows[0]);
}

async function savePo(pool, order) {
  const { rows } = await pool.query(
    `UPDATE purchase_orders
        SET status = $1, lines = $2, received_date = $3, received_by = $4,
            location_id = $5, location_name = $6, updated_at = NOW()
      WHERE id = $7 RETURNING *`,
    [
      order.status,
      JSON.stringify(order.lines || []),
      order.received_date || null,
      order.received_by || '',
      order.location_id || '',
      order.location_name || '',
      order.id,
    ],
  );
  return publicRow(entityDef('PurchaseOrder'), rows[0]);
}

async function loadLocation(pool, businessId, locationId) {
  const { rows } = await pool.query(
    'SELECT * FROM locations WHERE id = $1 AND business_id = $2 LIMIT 1',
    [locationId, businessId],
  );
  return rows[0] ?? null;
}

export async function orderPurchaseOrder(pool, user, businessId, poId) {
  await businessAccessOr403(pool, user, businessId, 'purchasing.manage');
  const order = await loadPo(pool, businessId, poId);
  if (order.status !== 'draft') {
    throw err(400, 'invalid_po_status', `Only a draft order can be placed — this one is ${order.status}.`);
  }
  const { rows } = await pool.query(
    "UPDATE purchase_orders SET status = 'ordered', updated_at = NOW() WHERE id = $1 RETURNING *",
    [poId],
  );
  return publicRow(entityDef('PurchaseOrder'), rows[0]);
}

export async function cancelPurchaseOrder(pool, user, businessId, poId) {
  await businessAccessOr403(pool, user, businessId, 'purchasing.manage');
  const order = await loadPo(pool, businessId, poId);
  if (!['draft', 'ordered', 'partial'].includes(order.status)) {
    throw err(400, 'invalid_po_status', `A ${order.status} order cannot be cancelled.`);
  }
  const received = (order.lines || []).reduce((sum, l) => sum + (Number(l.qty_received) || 0), 0);
  if (received > 0) {
    throw err(400, 'invalid_po_status', 'Stock already arrived on this order, so it cannot be cancelled.');
  }
  const { rows } = await pool.query(
    "UPDATE purchase_orders SET status = 'cancelled', updated_at = NOW() WHERE id = $1 RETURNING *",
    [poId],
  );
  return publicRow(entityDef('PurchaseOrder'), rows[0]);
}

/**
 * Receive stock against an open order. `receipts` is an array aligned
 * with the order's lines (one quantity per line). Every line is
 * checked before the first movement is written.
 */
export async function receivePurchaseOrder(pool, user, businessId, poId, body = {}) {
  const access = await businessAccessOr403(pool, user, businessId, 'purchasing.manage');
  const order = await loadPo(pool, businessId, poId);
  if (!['ordered', 'partial'].includes(order.status)) {
    throw err(400, 'invalid_po_status', 'This order is no longer open for receiving.');
  }
  const location = await loadLocation(pool, businessId, body.location_id || order.location_id);
  if (!location) throw err(400, 'invalid_reference', 'Choose a receiving location in this business.');
  const receipts = Array.isArray(body.receipts) ? body.receipts : [];
  const lines = order.lines || [];
  const planned = [];
  let receivedNow = 0;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const outstanding = Math.max(0, (Number(line.qty_ordered) || 0) - (Number(line.qty_received) || 0));
    const add = Math.max(0, Number(receipts[i]) || 0);
    if (add > outstanding) {
      throw err(
        400,
        'invalid_quantity',
        `Only ${outstanding} still due on ${line.product_name || line.sku || 'a line'} — adjust the quantity.`,
      );
    }
    if (!add) continue;
    const productRows = await pool.query('SELECT * FROM products WHERE id = $1 AND business_id = $2 LIMIT 1', [
      line.product_id,
      businessId,
    ]);
    const product = productRows.rows[0];
    if (!product) throw err(400, 'invalid_reference', `${line.product_name || 'A line'} is no longer in the catalog.`);
    planned.push({ line, product, add });
    receivedNow += add;
  }
  if (!receivedNow) throw err(400, 'invalid_value', 'Enter how many arrived on at least one line.');

  const note = String(body.note || '').trim();
  const result = await withTx(pool, async (client) => {
    for (const { line, product, add } of planned) {
      await recordMovementTx(client, {
        businessId,
        product,
        location,
        type: 'receive',
        quantity: add,
        note: [order.number, order.supplier_name, note].filter(Boolean).join(' · '),
        reference: order.number,
        supplierName: order.supplier_name,
        unitCost: line.unit_cost,
        planKey: access.planKey,
        caller: user,
      });
      // The cost on the shelf becomes what was actually paid.
      if (Number(line.unit_cost) > 0) {
        await client.query('UPDATE products SET cost = $1, updated_at = NOW() WHERE id = $2', [
          Number(line.unit_cost),
          product.id,
        ]);
      }
    }
    const updated = lines.map((line) => {
      const add = planned.find((p) => p.line === line)?.add || 0;
      return add ? { ...line, qty_received: (Number(line.qty_received) || 0) + add } : line;
    });
    const complete = updated.every(
      (l) => (Number(l.qty_received) || 0) >= (Number(l.qty_ordered) || 0),
    );
    const saved = await savePo(
      // savePo uses the pool; run the same UPDATE on the tx client so
      // the order and the stock land together or not at all.
      { query: (sql, params) => client.query(sql, params) },
      {
        ...order,
        lines: updated,
        status: complete ? 'received' : 'partial',
        received_date: complete
          ? new Date().toISOString().slice(0, 10)
          : order.received_date || '',
        received_by: user?.email || order.received_by || '',
        location_id: location.id,
        location_name: location.name,
      },
    );
    return { saved, complete };
  });
  return { order: result.saved, status: result.saved.status, receivedNow };
}

export async function buildBom(pool, user, businessId, bomId, body = {}) {
  const access = await businessAccessOr403(pool, user, businessId, 'builds.manage');
  const bom = await loadBom(pool, businessId, bomId);
  const qty = Math.max(1, Math.floor(Number(body.quantity) || 0));
  const location = await loadLocation(pool, businessId, body.location_id);
  if (!location) throw err(400, 'invalid_reference', 'Choose where you are building.');
  const lines = usableBomLines(bom);
  if (!lines.length) throw err(400, 'invalid_value', 'This build list has no components yet.');
  const finishedRows = await pool.query(
    'SELECT * FROM products WHERE id = $1 AND business_id = $2 LIMIT 1',
    [bom.product_id, businessId],
  );
  const finished = finishedRows.rows[0];
  if (!finished) {
    throw err(400, 'invalid_reference', 'The finished product is no longer in the catalog — add it back before building.');
  }
  const reference = buildReference('BUILD');
  const result = await withTx(pool, async (client) => {
    // Check every component up front: a build either has everything
    // it needs or writes nothing at all.
    for (const line of lines) {
      const level = await getLevel(client, businessId, line.component_id, location.id);
      const have = Number(level?.quantity ?? 0);
      const need = (Number(line.quantity) || 0) * qty;
      if (need > have) {
        throw err(
          400,
          'insufficient_stock',
          `${line.component_name}: only ${have} at ${location.name}, ${need} needed for ${qty}.`,
        );
      }
    }
    for (const line of lines) {
      const componentRows = await client.query(
        'SELECT * FROM products WHERE id = $1 AND business_id = $2 LIMIT 1',
        [line.component_id, businessId],
      );
      const component = componentRows.rows[0];
      await recordMovementTx(client, {
        businessId,
        product: component,
        location,
        type: 'consume',
        quantity: (Number(line.quantity) || 0) * qty,
        note: `Build ${qty} × ${finished.name}`,
        reference,
        planKey: access.planKey,
        caller: user,
      });
    }
    const produced = await recordMovementTx(client, {
      businessId,
      product: finished,
      location,
      type: 'produce',
      quantity: qty,
      note: `Built from ${lines.length} part${lines.length === 1 ? '' : 's'}`,
      reference,
      planKey: access.planKey,
      caller: user,
    });
    return { next: produced.next };
  });
  return { reference, quantity: qty, next: result.next };
}

export async function disassembleBom(pool, user, businessId, bomId, body = {}) {
  const access = await businessAccessOr403(pool, user, businessId, 'builds.manage');
  const bom = await loadBom(pool, businessId, bomId);
  const qty = Math.max(1, Math.floor(Number(body.quantity) || 0));
  const location = await loadLocation(pool, businessId, body.location_id);
  if (!location) throw err(400, 'invalid_reference', 'Choose where you are taking it apart.');
  const lines = usableBomLines(bom);
  if (!lines.length) throw err(400, 'invalid_value', 'This build list has no components yet.');
  const finishedRows = await pool.query(
    'SELECT * FROM products WHERE id = $1 AND business_id = $2 LIMIT 1',
    [bom.product_id, businessId],
  );
  const finished = finishedRows.rows[0];
  if (!finished) throw err(400, 'invalid_reference', 'The finished product is no longer in the catalog.');
  const reference = buildReference('TEARDOWN');
  const result = await withTx(pool, async (client) => {
    const level = await getLevel(client, businessId, bom.product_id, location.id);
    const onHand = Number(level?.quantity ?? 0);
    if (qty > onHand) {
      throw err(400, 'insufficient_stock', `Only ${onHand} × ${finished.name} at ${location.name}.`);
    }
    await recordMovementTx(client, {
      businessId,
      product: finished,
      location,
      type: 'disassemble',
      quantity: qty,
      note: 'Taken apart for parts',
      reference,
      planKey: access.planKey,
      caller: user,
    });
    for (const line of lines) {
      const componentRows = await client.query(
        'SELECT * FROM products WHERE id = $1 AND business_id = $2 LIMIT 1',
        [line.component_id, businessId],
      );
      const component = componentRows.rows[0];
      await recordMovementTx(client, {
        businessId,
        product: component,
        location,
        type: 'recovered',
        quantity: (Number(line.quantity) || 0) * qty,
        note: `From ${qty} × ${finished.name}`,
        reference,
        planKey: access.planKey,
        caller: user,
      });
    }
    return { remaining: onHand - qty };
  });
  return { reference, quantity: qty, remaining: result.remaining };
}
