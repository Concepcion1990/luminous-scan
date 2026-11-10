import { base44 } from '@/api/client';
import { recordMovement } from '@/lib/inventory';

export const PO_STATUS = {
  draft: { label: 'Draft', tone: 'muted' },
  ordered: { label: 'On order', tone: 'info' },
  partial: { label: 'Partly received', tone: 'warn' },
  received: { label: 'Received', tone: 'ok' },
  cancelled: { label: 'Cancelled', tone: 'muted' },
};

const STATUS_QUERY = {
  open: { $in: ['ordered', 'partial'] },
  draft: 'draft',
  ordered: 'ordered',
  partial: 'partial',
  received: 'received',
  cancelled: 'cancelled',
};

export function todayIso() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(
    now.getDate()
  ).padStart(2, '0')}`;
}

export function poNumber() {
  const stamp = todayIso().replace(/-/g, '').slice(2);
  return `PO-${stamp}-${String(Date.now()).slice(-3)}`;
}

export function money(value, currency = 'USD') {
  const amount = Number(value) || 0;
  const options = { style: 'currency', currency, minimumFractionDigits: 2, maximumFractionDigits: 2 };
  try {
    return new Intl.NumberFormat('en-US', options).format(amount);
  } catch {
    return new Intl.NumberFormat('en-US', { ...options, currency: 'USD' }).format(amount);
  }
}

export function lineTotal(line) {
  return (Number(line.qty_ordered) || 0) * (Number(line.unit_cost) || 0);
}

export function poTotals({ lines = [], shipping = 0, tax = 0 }) {
  const subtotal = lines.reduce((sum, line) => sum + lineTotal(line), 0);
  return { subtotal, total: subtotal + (Number(shipping) || 0) + (Number(tax) || 0) };
}

export function openQty(line) {
  return Math.max(0, (Number(line.qty_ordered) || 0) - (Number(line.qty_received) || 0));
}

export function poProgress(order) {
  const lines = order.lines || [];
  return {
    ordered: lines.reduce((sum, l) => sum + (Number(l.qty_ordered) || 0), 0),
    received: lines.reduce((sum, l) => sum + (Number(l.qty_received) || 0), 0),
    lines: lines.length,
  };
}

export function statusQuery(status) {
  return STATUS_QUERY[status] ?? 'all';
}

export function blankLine() {
  return { product_id: '', product_name: '', sku: '', qty_ordered: 1, qty_received: 0, unit_cost: '' };
}

/**
 * Receives an order: stock in at the chosen location, a ledger entry per line
 * carrying the PO number, supplier and unit cost, and the product's cost
 * replaced with what was actually paid.
 */
export async function receiveOrder({ order, receipts, products, location, user, note }) {
  if (!['ordered', 'partial'].includes(order.status)) {
    throw new Error('This order is no longer open for receiving.');
  }

  const productById = new Map(products.map((p) => [p.id, p]));
  const lines = order.lines || [];
  const planned = [];
  let receivedNow = 0;

  // Check every line before the first movement: a short or unknown line must
  // fail before stock is added, or the order would be left half-received.
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const outstanding = openQty(line);
    const add = Math.max(0, Number(receipts[i]) || 0);
    // Never receive more than is still due: a typed or double-submitted
    // quantity must fail loudly instead of inflating stock.
    if (add > outstanding) {
      throw new Error(
        `Only ${outstanding} still due on ${line.product_name || line.sku || 'a line'} — adjust the quantity.`
      );
    }
    if (!add) continue;
    let product = productById.get(line.product_id);
    if (!product) {
      product = await base44.entities.Product.get(line.product_id).catch(() => null);
    }
    if (!product) throw new Error(`${line.product_name || 'A line'} is no longer in the catalog.`);
    planned.push({ line, product, add });
    receivedNow += add;
  }

  if (!receivedNow) throw new Error('Enter how many arrived on at least one line.');

  const addByLine = new Map(planned.map((p) => [p.line, p.add]));

  for (const { line, product, add } of planned) {
    await recordMovement({
      product,
      location,
      type: 'receive',
      quantity: add,
      note: [order.number, order.supplier_name, note].filter(Boolean).join(' · '),
      reference: order.number,
      supplierName: order.supplier_name,
      unitCost: line.unit_cost,
      user,
      businessId: order.business_id || product.business_id || '',
    });

    if (Number(line.unit_cost) > 0) {
      await base44.entities.Product.update(product.id, { cost: Number(line.unit_cost) });
    }
  }

  const updated = lines.map((line) => {
    const add = addByLine.get(line) || 0;
    return add ? { ...line, qty_received: (Number(line.qty_received) || 0) + add } : line;
  });

  const complete = updated.every(
    (l) => (Number(l.qty_received) || 0) >= (Number(l.qty_ordered) || 0)
  );
  const status = complete ? 'received' : 'partial';

  await base44.entities.PurchaseOrder.update(order.id, {
    lines: updated,
    status,
    received_date: complete ? todayIso() : order.received_date || '',
    received_by: user?.full_name || user?.email || order.received_by || '',
    location_id: location.id,
    location_name: location.name,
  });

  return { status, receivedNow };
}