import { apiRequest } from '@/api/client';

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
 * Receives an order through the server endpoint (T5): every line is
 * checked before the first movement, then stock lands through the
 * atomic movements path and the product's cost becomes what was
 * actually paid — all in one transaction, so an order is never left
 * half-received. `receipts` is an array aligned with the order's
 * lines (one quantity per line).
 */
export async function receiveOrder({ order, receipts, products, location, user, note }) {
  if (!['ordered', 'partial'].includes(order.status)) {
    throw new Error('This order is no longer open for receiving.');
  }
  if (!location) throw new Error('Choose a receiving location.');
  const lines = order.lines || [];
  let receivedNow = 0;

  // Check every line before anything is sent: a short quantity must
  // fail before stock is added, or the order would be left
  // half-received. The server checks again — this is the fast,
  // plain-language answer in the dialog.
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const outstanding = openQty(line);
    const add = Math.max(0, Number(receipts[i]) || 0);
    if (add > outstanding) {
      throw new Error(
        `Only ${outstanding} still due on ${line.product_name || line.sku || 'a line'} — adjust the quantity.`
      );
    }
    if (!add) continue;
    receivedNow += add;
  }

  if (!receivedNow) throw new Error('Enter how many arrived on at least one line.');

  const businessId = order.business_id || products?.[0]?.business_id || '';
  const result = await apiRequest(
    `/api/businesses/${businessId}/purchase-orders/${order.id}/receive`,
    {
      method: 'POST',
      body: {
        location_id: location.id,
        receipts: lines.map((line, i) => Number(receipts[i]) || 0),
        note: note || '',
      },
    },
  );
  return { status: result.status, receivedNow: result.receivedNow };
}