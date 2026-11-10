import { base44 } from '@/api/client';
import { recordMovement } from '@/lib/inventory';
import { todayIso } from '@/lib/purchasing';
import { scoped } from '@/lib/scoped';

export const RETURN_STATUS = {
  new: { label: 'New', tone: 'warn' },
  approved: { label: 'Approved', tone: 'info' },
  completed: { label: 'Completed', tone: 'ok' },
  rejected: { label: 'Rejected', tone: 'muted' },
};

export const RETURN_KINDS = [
  { value: 'return', label: 'Return' },
  { value: 'exchange', label: 'Exchange' },
];

export const RETURN_REASONS = [
  { value: 'wrong_item', label: 'Wrong item' },
  { value: 'damaged', label: 'Damaged in transit' },
  { value: 'not_as_described', label: 'Not as described' },
  { value: 'changed_mind', label: 'Changed mind' },
  { value: 'size_fit', label: 'Size or fit' },
  { value: 'late', label: 'Arrived late' },
  { value: 'other', label: 'Other' },
];

export const CONDITIONS = [
  { value: 'sellable', label: 'Sellable as new' },
  { value: 'inspected', label: 'Good, needs inspection' },
  { value: 'used', label: 'Used but sellable' },
  { value: 'damaged', label: 'Damaged' },
  { value: 'unsellable', label: 'Unsellable' },
];

export const RETURN_FILTERS = [
  { key: 'open', label: 'Open' },
  { key: 'approved', label: 'Approved' },
  { key: 'completed', label: 'Completed' },
  { key: 'rejected', label: 'Rejected' },
  { key: 'all', label: 'All' },
];

const STATUS_QUERY = {
  open: { $in: ['new', 'approved'] },
  approved: 'approved',
  completed: 'completed',
  rejected: 'rejected',
  all: 'all',
};

export function statusQuery(filter) {
  return STATUS_QUERY[filter] ?? 'all';
}

export function reasonLabel(value) {
  return RETURN_REASONS.find((r) => r.value === value)?.label || 'Other';
}

export function conditionLabel(value) {
  return CONDITIONS.find((c) => c.value === value)?.label || 'Sellable as new';
}

export function returnNumber() {
  const stamp = todayIso().replace(/-/g, '').slice(2);
  return `RET-${stamp}-${String(Date.now()).slice(-3)}`;
}

export function blankReturnLine() {
  return {
    product_id: '',
    product_name: '',
    sku: '',
    quantity: 1,
    condition: 'sellable',
    restock: true,
    unit_price: '',
  };
}

export function blankExchangeLine() {
  return { product_id: '', product_name: '', sku: '', quantity: 1, unit_price: '' };
}

export function lineValue(line) {
  return (Number(line.quantity) || 0) * (Number(line.unit_price) || 0);
}

export function returnTotals({ lines = [], exchange_lines = [], refund_amount = 0 }) {
  const returnedValue = lines.reduce((sum, l) => sum + lineValue(l), 0);
  const exchangeValue = exchange_lines.reduce((sum, l) => sum + lineValue(l), 0);
  return { returnedValue, exchangeValue, refund: Number(refund_amount) || 0 };
}

export function restockUnits(ret) {
  return (ret.lines || [])
    .filter((l) => l.restock)
    .reduce((sum, l) => sum + (Number(l.quantity) || 0), 0);
}

export async function approveReturn(ret, user) {
  if (!['new', 'approved'].includes(ret.status)) {
    throw new Error('Only a new return can be approved.');
  }
  await base44.entities.Return.update(ret.id, {
    status: 'approved',
    approved_at: ret.approved_at || new Date().toISOString(),
    approved_by: ret.approved_by || user?.full_name || user?.email || '',
  });
}

export async function rejectReturn(ret) {
  if (['completed'].includes(ret.status)) {
    throw new Error('A completed return cannot be rejected — reverse the stock entries instead.');
  }
  await base44.entities.Return.update(ret.id, { status: 'rejected' });
}

/**
 * Applies the approved return: sellable lines go back on the shelf, replacement
 * lines come off it. Written once, guarded by the status, so a second press can
 * never restock or deduct twice.
 */
export async function completeReturn({ ret, products, user, linkedOrder }) {
  if (ret.status === 'completed') throw new Error('This return is already completed.');
  if (ret.status !== 'approved') throw new Error('Approve the return before completing it.');
  if (!ret.location_id) throw new Error('Choose where the goods came back to.');

  const location = { id: ret.location_id, name: ret.location_name || 'the location' };
  const byProduct = new Map(products.map((p) => [p.id, p]));
  const businessId = ret.business_id || '';

  const restockLines = (ret.lines || []).filter((l) => Number(l.quantity) > 0 && l.restock);
  const exchangeLines = (ret.exchange_lines || []).filter((l) => Number(l.quantity) > 0);

  // Everything is checked before anything is written. Applied line by line, a
  // failure halfway would leave the return approved with some stock already
  // moved, and completing it again would restock those lines twice.
  if (!restockLines.length && !exchangeLines.length) {
    throw new Error('Set at least one line to restock, or add a replacement, before completing.');
  }
  [...restockLines, ...exchangeLines].forEach((line) => {
    if (!byProduct.get(line.product_id)) {
      throw new Error(`${line.product_name || 'A line'} is no longer in the catalog.`);
    }
  });

  if (exchangeLines.length) {
    const levelPage = await base44.entities.StockLevel.filter(
      scoped({ location_id: location.id }, businessId),
      { limit: 2000 }
    );
    const onHand = new Map();
    (levelPage.items || []).forEach((level) => {
      onHand.set(level.product_id, Number(level.quantity) || 0);
    });
    const needed = new Map();
    exchangeLines.forEach((line) => {
      needed.set(line.product_id, (needed.get(line.product_id) || 0) + (Number(line.quantity) || 0));
    });
    needed.forEach((qty, productId) => {
      const available = onHand.get(productId) || 0;
      if (qty > available) {
        throw new Error(
          `Only ${available} on hand at ${location.name} for ${
            byProduct.get(productId)?.name || 'a replacement'
          }.`
        );
      }
    });
  }

  let restocked = 0;
  for (const line of ret.lines || []) {
    const qty = Number(line.quantity) || 0;
    if (!qty || !line.restock) continue;
    const product = byProduct.get(line.product_id);
    if (!product) throw new Error(`${line.product_name || 'A line'} is no longer in the catalog.`);
    await recordMovement({
      product,
      location,
      type: 'returned',
      quantity: qty,
      note: `Return ${ret.number} · ${conditionLabel(line.condition)}`,
      reference: ret.number,
      // Completed from a form, not scanned — so no scan is recorded.
      user,
      businessId,
    });
    restocked += qty;
  }

  let replaced = 0;
  for (const line of ret.exchange_lines || []) {
    const qty = Number(line.quantity) || 0;
    if (!qty) continue;
    const product = byProduct.get(line.product_id);
    if (!product) throw new Error(`${line.product_name || 'A replacement'} is no longer in the catalog.`);
    await recordMovement({
      product,
      location,
      type: 'sale',
      quantity: qty,
      note: `Exchange ${ret.number}`,
      reference: ret.number,
      user,
      businessId: businessId || product.business_id || '',
    });
    replaced += qty;
  }

  await base44.entities.Return.update(ret.id, {
    status: 'completed',
    completed_at: new Date().toISOString(),
    completed_by: user?.full_name || user?.email || '',
  });

  if (linkedOrder && restocked) {
    const shipped = (linkedOrder.lines || []).reduce((s, l) => s + (Number(l.shipped) || 0), 0);
    const returnedSoFar =
      (linkedOrder.lines || []).length > 0
        ? (ret.lines || []).reduce((s, l) => s + (Number(l.quantity) || 0), 0)
        : 0;
    if (shipped > 0 && returnedSoFar >= shipped) {
      await base44.entities.Order.update(linkedOrder.id, { status: 'returned' });
    }
  }

  return { restocked, replaced };
}

export async function deleteReturn(ret) {
  if (ret.status === 'completed') {
    throw new Error('This return has stock entries — reverse them in the ledger instead of deleting.');
  }
  await base44.entities.Return.delete(ret.id);
}