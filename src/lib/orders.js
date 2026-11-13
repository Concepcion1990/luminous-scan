import { base44 } from '@/api/client';
import { recordMovement, setReserved } from '@/lib/inventory';
import { todayIso } from '@/lib/purchasing';
import { scoped } from '@/lib/scoped';
import { t } from './i18n.js';

export const ORDER_STATUS = {
  new: { get label() { return t('ordersLib.statusNew'); }, tone: 'muted' },
  pending: { get label() { return t('ordersLib.statusPending'); }, tone: 'warn' },
  reserved: { get label() { return t('ordersLib.statusStockHeld'); }, tone: 'hold' },
  packed: { get label() { return t('ordersLib.statusPacked'); }, tone: 'info' },
  shipped: { get label() { return t('ordersLib.statusShipped'); }, tone: 'info' },
  delivered: { get label() { return t('ordersLib.statusDelivered'); }, tone: 'ok' },
  cancelled: { get label() { return t('ordersLib.statusCancelled'); }, tone: 'muted' },
  returned: { get label() { return t('ordersLib.statusReturned'); }, tone: 'warn' },
};

export const CHANNELS = [
  { value: 'manual', get label() { return t('ordersLib.channelManual'); } },
  { value: 'shopify', get label() { return t('ordersLib.channelShopify'); } },
  { value: 'ebay', get label() { return t('ordersLib.channelEbay'); } },
  { value: 'amazon', get label() { return t('ordersLib.channelAmazon'); } },
  { value: 'walmart', get label() { return t('ordersLib.channelWalmart'); } },
  { value: 'tiktok_shop', get label() { return t('ordersLib.channelTiktokShop'); } },
  { value: 'other', get label() { return t('ordersLib.channelOther'); } },
];

export const STATUS_FILTERS = [
  { key: 'open', get label() { return t('ordersLib.filterOpen'); } },
  { key: 'reserved', get label() { return t('ordersLib.filterStockHeld'); } },
  { key: 'packed', get label() { return t('ordersLib.filterPacked'); } },
  { key: 'shipped', get label() { return t('ordersLib.filterShipped'); } },
  { key: 'delivered', get label() { return t('ordersLib.filterDelivered'); } },
  { key: 'cancelled', get label() { return t('ordersLib.filterCancelled'); } },
  { key: 'all', get label() { return t('ordersLib.filterAll'); } },
];

const STATUS_QUERY = {
  open: { $in: ['new', 'pending', 'reserved', 'packed'] },
  reserved: 'reserved',
  packed: 'packed',
  shipped: 'shipped',
  delivered: 'delivered',
  cancelled: 'cancelled',
  all: 'all',
};

export function statusQuery(filter) {
  return STATUS_QUERY[filter] ?? 'all';
}

export function channelLabel(value) {
  return CHANNELS.find((c) => c.value === value)?.label || t('ordersLib.channelManual');
}

export function orderNumber() {
  const stamp = todayIso().replace(/-/g, '').slice(2);
  return `ORD-${stamp}-${String(Date.now()).slice(-3)}`;
}

export function lineTotal(line) {
  return (Number(line.quantity) || 0) * (Number(line.unit_price) || 0);
}

export function orderTotals({ lines = [], discount = 0, shipping = 0, tax = 0 }) {
  const subtotal = lines.reduce((sum, line) => sum + lineTotal(line), 0);
  const total =
    subtotal - (Number(discount) || 0) + (Number(shipping) || 0) + (Number(tax) || 0);
  return { subtotal, total };
}

export function heldUnits(order) {
  return (order.lines || []).reduce((sum, l) => sum + (Number(l.reserved) || 0), 0);
}

export function shippedUnits(order) {
  return (order.lines || []).reduce((sum, l) => sum + (Number(l.shipped) || 0), 0);
}

export function blankLine() {
  return { product_id: '', product_name: '', sku: '', quantity: 1, unit_price: '', reserved: 0, shipped: 0 };
}

function productIndex(products) {
  return new Map(products.map((p) => [p.id, p]));
}

function orderLocation(order) {
  if (!order.location_id) throw new Error(t('ordersLib.chooseShipFrom'));
  return { id: order.location_id, name: order.location_name || t('ordersLib.locationFallback') };
}

/**
 * Holds the order's stock without taking it off the shelf. Availability is
 * checked for every line before anything is written, so a short line never
 * leaves half the order held.
 */
export async function reserveOrder({ order, products, levels = [], user }) {
  if (!['new', 'pending'].includes(order.status || 'new')) {
    throw new Error(t('ordersLib.alreadyHoldingOrPast'));
  }
  const location = orderLocation(order);
  const lines = order.lines || [];
  const byProduct = productIndex(products);

  const needed = new Map();
  lines.forEach((line) => {
    const qty = Number(line.quantity) || 0;
    if (qty > 0 && !(Number(line.reserved) > 0)) {
      needed.set(line.product_id, (needed.get(line.product_id) || 0) + qty);
    }
  });
  if (!needed.size) throw new Error(t('ordersLib.everyLineAlreadyHeld'));

  needed.forEach((qty, productId) => {
    const level = levels.find((l) => l.product_id === productId && l.location_id === location.id);
    const available = (Number(level?.quantity) || 0) - (Number(level?.reserved) || 0);
    if (qty > available) {
      const name = byProduct.get(productId)?.name || t('ordersLib.lineFallback');
      throw new Error(
        t('ordersLib.onlyAvailableFor', {
          available: Math.max(available, 0),
          location: location.name,
          name,
        })
      );
    }
  });

  const updated = [];
  for (const line of lines) {
    const qty = Number(line.quantity) || 0;
    if (!qty || Number(line.reserved) > 0) {
      updated.push(line);
      continue;
    }
    const product =
      byProduct.get(line.product_id) || {
        id: line.product_id,
        name: line.product_name,
        sku: line.sku,
      };
    await setReserved({
      product,
      location,
      type: 'reserved',
      quantity: qty,
      note: t('ordersLib.orderNote', { number: order.number }),
      reference: order.number,
      user,
      businessId: order.business_id || '',
    });
    updated.push({ ...line, reserved: qty });
  }

  await base44.entities.Order.update(order.id, {
    lines: updated,
    status: 'reserved',
    reserved_at: order.reserved_at || new Date().toISOString(),
    reserved_by: order.reserved_by || user?.full_name || user?.email || '',
  });
}

/** Frees every hold on the order, leaving on-hand stock untouched. */
export async function releaseHolds({ order, products, user }) {
  const lines = order.lines || [];
  const held = lines.filter((l) => Number(l.reserved) > 0);
  if (!held.length) throw new Error(t('ordersLib.notHoldingStock'));
  const location = orderLocation(order);
  const byProduct = productIndex(products);

  for (const line of held) {
    const product =
      byProduct.get(line.product_id) || {
        id: line.product_id,
        name: line.product_name,
        sku: line.sku,
      };
    await setReserved({
      product,
      location,
      type: 'released',
      quantity: Number(line.reserved) || 0,
      note: t('ordersLib.orderReleasedNote', { number: order.number }),
      reference: order.number,
      user,
      businessId: order.business_id || '',
    });
  }

  const relaxed = lines.map((l) => ({ ...l, reserved: 0 }));
  await base44.entities.Order.update(order.id, {
    lines: relaxed,
    status: ['packed', 'reserved'].includes(order.status) ? 'pending' : order.status,
  });
}

/**
 * Ships the order: the hold is released and the sale is written once, so the
 * shelf drops exactly once however many times the button is pressed.
 *
 * The whole order is checked against the shelf before a single movement is
 * written. Without that check a short line halfway down the order would leave the
 * earlier lines sold and the order still open, and pressing Ship again would sell
 * them a second time.
 */
export async function shipOrder({ order, products, user }) {
  if (['shipped', 'delivered', 'cancelled', 'returned'].includes(order.status)) {
    throw new Error(t('ordersLib.alreadyLeftShelf'));
  }
  const location = orderLocation(order);
  const byProduct = productIndex(products);
  const businessId = order.business_id || '';

  const levelPage = await base44.entities.StockLevel.filter(
    scoped({ location_id: location.id }, businessId),
    { limit: 2000 }
  );
  const onHand = new Map();
  (levelPage.items || []).forEach((level) => {
    onHand.set(level.product_id, Number(level.quantity) || 0);
  });

  const needed = new Map();
  (order.lines || []).forEach((line) => {
    const remaining = (Number(line.quantity) || 0) - (Number(line.shipped) || 0);
    if (remaining <= 0) return;
    if (!byProduct.get(line.product_id)) {
      throw new Error(
        t('ordersLib.noLongerInCatalog', { name: line.product_name || t('ordersLib.lineFallback') })
      );
    }
    needed.set(line.product_id, (needed.get(line.product_id) || 0) + remaining);
  });
  if (!needed.size) throw new Error(t('ordersLib.nothingLeftToShip'));

  needed.forEach((qty, productId) => {
    const available = onHand.get(productId) || 0;
    if (qty > available) {
      throw new Error(
        t('ordersLib.onlyOnHandFor', {
          available,
          location: location.name,
          name: byProduct.get(productId)?.name || t('ordersLib.lineFallback'),
        })
      );
    }
  });

  const updated = [];
  let shippedNow = 0;

  for (const line of order.lines || []) {
    const qty = Number(line.quantity) || 0;
    const done = Number(line.shipped) || 0;
    const remaining = qty - done;
    if (remaining <= 0) {
      updated.push(line);
      continue;
    }
    const product = byProduct.get(line.product_id);
    if (!product) {
      throw new Error(
        t('ordersLib.noLongerInCatalog', { name: line.product_name || t('ordersLib.lineFallback') })
      );
    }

    const held = Number(line.reserved) || 0;
    if (held > 0) {
      await setReserved({
        product,
        location,
        type: 'released',
        quantity: held,
        note: t('ordersLib.orderShippingNote', { number: order.number }),
        reference: order.number,
        user,
        businessId: order.business_id || '',
      });
    }
    await recordMovement({
      product,
      location,
      type: 'sale',
      quantity: remaining,
      note: t('ordersLib.orderNote', { number: order.number }),
      reference: order.number,
      // No code was scanned here, so none is recorded — the not-scanned alert
      // must only count stock that really went past a scanner.
      user,
      businessId: order.business_id || product.business_id || '',
    });
    updated.push({ ...line, reserved: 0, shipped: qty });
    shippedNow += remaining;
  }

  if (!shippedNow) throw new Error(t('ordersLib.nothingLeftToShip'));

  const complete = updated.every((l) => (Number(l.shipped) || 0) >= (Number(l.quantity) || 0));
  await base44.entities.Order.update(order.id, {
    lines: updated,
    status: complete ? 'shipped' : order.status === 'new' ? 'pending' : order.status,
    shipped_at: complete ? new Date().toISOString() : order.shipped_at || '',
    shipped_by: user?.full_name || user?.email || order.shipped_by || '',
  });
  return { shippedNow, complete };
}

export async function cancelOrder({ order, products, user }) {
  if (['shipped', 'delivered', 'returned'].includes(order.status)) {
    throw new Error(t('ordersLib.stockLeftRecordReturn'));
  }
  if (heldUnits(order) > 0) await releaseHolds({ order, products, user });
  await base44.entities.Order.update(order.id, {
    status: 'cancelled',
    cancelled_at: new Date().toISOString(),
  });
}

export async function markPacked(order) {
  if (!['new', 'pending', 'reserved'].includes(order.status)) {
    throw new Error(t('ordersLib.onlyOpenCanPack'));
  }
  await base44.entities.Order.update(order.id, { status: 'packed' });
}

export async function markDelivered(order) {
  if (order.status !== 'shipped') throw new Error(t('ordersLib.shipBeforeDelivered'));
  await base44.entities.Order.update(order.id, { status: 'delivered' });
}

export async function deleteOrder(order) {
  if (['shipped', 'delivered', 'returned'].includes(order.status)) {
    throw new Error(t('ordersLib.stockHistoryCancelInstead'));
  }
  if (heldUnits(order) > 0) throw new Error(t('ordersLib.releaseHeldBeforeDelete'));
  await base44.entities.Order.delete(order.id);
}