/**
 * The write side of the spreadsheet imports. Both operations here are additive
 * in what they touch: an update writes product fields only, a receipt writes the
 * location's stock level plus one ledger entry per line.
 */

import { base44 } from '@/api/client';
import { scoped } from '@/lib/scoped';

function chunk(list, size = 200) {
  const parts = [];
  for (let index = 0; index < list.length; index += size) parts.push(list.slice(index, index + size));
  return parts;
}

/** Writes the reviewed field changes. Quantities are not part of this payload. */
export async function applyProductUpdates({ changes = [], businessId }) {
  if (!businessId) throw new Error('Choose a business first.');
  let updated = 0;
  for (const part of chunk(changes)) {
    await base44.entities.Product.bulkUpdate(part);
    updated += part.length;
  }
  return updated;
}

/**
 * Adds received quantities to one location and records each line in the ledger.
 * `batchRef` marks the batch, so a second click (or a re-upload of the same
 * sheet) is refused instead of receiving the goods twice.
 */
export async function applyReceipts({
  rows = [],
  levels = [],
  locationId,
  locationName = '',
  businessId,
  user,
  batchRef,
  reference = '',
  note = '',
}) {
  if (!businessId) throw new Error('Choose a business first.');
  if (!locationId) throw new Error('Choose the location the stock arrived at.');
  if (!rows.length) return { received: 0, units: 0 };

  const already = await base44.entities.StockMovement.filter(
    scoped({ note: { $regex: `Import ${batchRef}` } }, businessId),
    { limit: 1 }
  );
  if (already.items?.length) {
    throw new Error(`Import ${batchRef} was already recorded. Nothing was received twice.`);
  }

  const levelByProduct = new Map(
    levels.filter((level) => level.location_id === locationId).map((level) => [level.product_id, level])
  );
  const updates = [];
  const creates = [];
  const movements = [];
  const userName = user?.full_name || user?.email || '';

  rows.forEach((row) => {
    const level = levelByProduct.get(row.product.id);
    const previous = level?.quantity ?? 0;
    const next = previous + row.incoming;

    if (level) updates.push({ id: level.id, quantity: next });
    else {
      creates.push({
        business_id: businessId,
        product_id: row.product.id,
        location_id: locationId,
        quantity: next,
        reserved: 0,
      });
    }

    movements.push({
      business_id: businessId,
      product_id: row.product.id,
      product_name: row.product.name,
      sku: row.product.sku || '',
      location_id: locationId,
      location_name: locationName,
      type: 'receive',
      quantity: row.incoming,
      previous_qty: previous,
      new_qty: next,
      reference: row.reference || reference || '',
      supplier_name: row.supplier || '',
      unit_cost: row.unitCost ?? 0,
      note: [row.note || note, `Import ${batchRef}`].filter(Boolean).join(' · '),
      user_name: userName,
    });
  });

  for (const part of chunk(updates)) await base44.entities.StockLevel.bulkUpdate(part);
  for (const part of chunk(creates)) await base44.entities.StockLevel.bulkCreate(part);
  for (const part of chunk(movements)) await base44.entities.StockMovement.bulkCreate(part);

  return {
    received: rows.length,
    units: rows.reduce((sum, row) => sum + row.incoming, 0),
  };
}