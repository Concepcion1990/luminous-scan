import { base44 } from '@/api/client';
import { recordMovement } from '@/lib/inventory';
import { todayIso } from '@/lib/purchasing';
import { scoped } from '@/lib/scoped';
import { t } from './i18n.js';

export const RETURN_STATUS = {
  new: { get label() { return t('returnsLib.statusNew'); }, tone: 'warn' },
  approved: { get label() { return t('returnsLib.statusApproved'); }, tone: 'info' },
  completed: { get label() { return t('returnsLib.statusCompleted'); }, tone: 'ok' },
  rejected: { get label() { return t('returnsLib.statusRejected'); }, tone: 'muted' },
};

export const RETURN_KINDS = [
  { value: 'return', get label() { return t('returnsLib.kindReturn'); } },
  { value: 'exchange', get label() { return t('returnsLib.kindExchange'); } },
];

export const RETURN_REASONS = [
  { value: 'wrong_item', get label() { return t('returnsLib.reasonWrongItem'); } },
  { value: 'damaged', get label() { return t('returnsLib.reasonDamaged'); } },
  { value: 'not_as_described', get label() { return t('returnsLib.reasonNotAsDescribed'); } },
  { value: 'changed_mind', get label() { return t('returnsLib.reasonChangedMind'); } },
  { value: 'size_fit', get label() { return t('returnsLib.reasonSizeFit'); } },
  { value: 'late', get label() { return t('returnsLib.reasonLate'); } },
  { value: 'other', get label() { return t('returnsLib.reasonOther'); } },
];

export const CONDITIONS = [
  { value: 'sellable', get label() { return t('returnsLib.conditionSellable'); } },
  { value: 'inspected', get label() { return t('returnsLib.conditionInspected'); } },
  { value: 'used', get label() { return t('returnsLib.conditionUsed'); } },
  { value: 'damaged', get label() { return t('returnsLib.conditionDamaged'); } },
  { value: 'unsellable', get label() { return t('returnsLib.conditionUnsellable'); } },
];

export const RETURN_FILTERS = [
  { key: 'open', get label() { return t('returnsLib.filterOpen'); } },
  { key: 'approved', get label() { return t('returnsLib.filterApproved'); } },
  { key: 'completed', get label() { return t('returnsLib.filterCompleted'); } },
  { key: 'rejected', get label() { return t('returnsLib.filterRejected'); } },
  { key: 'all', get label() { return t('returnsLib.filterAll'); } },
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
  return RETURN_REASONS.find((r) => r.value === value)?.label || t('returnsLib.reasonOther');
}

export function conditionLabel(value) {
  return CONDITIONS.find((c) => c.value === value)?.label || t('returnsLib.conditionSellable');
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
    throw new Error(t('returnsLib.onlyNewCanApprove'));
  }
  await base44.entities.Return.update(ret.id, {
    status: 'approved',
    approved_at: ret.approved_at || new Date().toISOString(),
    approved_by: ret.approved_by || user?.full_name || user?.email || '',
  });
}

export async function rejectReturn(ret) {
  if (['completed'].includes(ret.status)) {
    throw new Error(t('returnsLib.completedCannotReject'));
  }
  await base44.entities.Return.update(ret.id, { status: 'rejected' });
}

/**
 * Applies the approved return: sellable lines go back on the shelf, replacement
 * lines come off it. Written once, guarded by the status, so a second press can
 * never restock or deduct twice.
 */
export async function completeReturn({ ret, products, user, linkedOrder }) {
  if (ret.status === 'completed') throw new Error(t('returnsLib.alreadyCompleted'));
  if (ret.status !== 'approved') throw new Error(t('returnsLib.approveBeforeComplete'));
  if (!ret.location_id) throw new Error(t('returnsLib.chooseReturnLocation'));

  const location = { id: ret.location_id, name: ret.location_name || t('returnsLib.locationFallback') };
  const byProduct = new Map(products.map((p) => [p.id, p]));
  const businessId = ret.business_id || '';

  const restockLines = (ret.lines || []).filter((l) => Number(l.quantity) > 0 && l.restock);
  const exchangeLines = (ret.exchange_lines || []).filter((l) => Number(l.quantity) > 0);

  // Everything is checked before anything is written. Applied line by line, a
  // failure halfway would leave the return approved with some stock already
  // moved, and completing it again would restock those lines twice.
  if (!restockLines.length && !exchangeLines.length) {
    throw new Error(t('returnsLib.setLineOrReplacement'));
  }
  [...restockLines, ...exchangeLines].forEach((line) => {
    if (!byProduct.get(line.product_id)) {
      throw new Error(
        t('returnsLib.noLongerInCatalog', { name: line.product_name || t('returnsLib.lineFallback') })
      );
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
          t('returnsLib.onlyOnHandFor', {
            available,
            location: location.name,
            name: byProduct.get(productId)?.name || t('returnsLib.replacementFallback'),
          })
        );
      }
    });
  }

  let restocked = 0;
  for (const line of ret.lines || []) {
    const qty = Number(line.quantity) || 0;
    if (!qty || !line.restock) continue;
    const product = byProduct.get(line.product_id);
    if (!product) {
      throw new Error(
        t('returnsLib.noLongerInCatalog', { name: line.product_name || t('returnsLib.lineFallback') })
      );
    }
    await recordMovement({
      product,
      location,
      type: 'returned',
      quantity: qty,
      note: t('returnsLib.returnNote', { number: ret.number, condition: conditionLabel(line.condition) }),
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
    if (!product) {
      throw new Error(
        t('returnsLib.noLongerInCatalog', {
          name: line.product_name || t('returnsLib.replacementFallback'),
        })
      );
    }
    await recordMovement({
      product,
      location,
      type: 'sale',
      quantity: qty,
      note: t('returnsLib.exchangeNote', { number: ret.number }),
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
    throw new Error(t('returnsLib.stockEntriesReverseInstead'));
  }
  await base44.entities.Return.delete(ret.id);
}