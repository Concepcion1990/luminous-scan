import { base44 } from '@/api/client';
import { recordMovement } from '@/lib/inventory';
import { todayIso } from '@/lib/purchasing';

export const COUNT_STATUS = {
  open: { label: 'Counting', tone: 'warn' },
  review: { label: 'In review', tone: 'info' },
  applied: { label: 'Applied', tone: 'ok' },
  cancelled: { label: 'Cancelled', tone: 'muted' },
};

export const COUNT_FILTERS = [
  { key: 'open', label: 'Open' },
  { key: 'review', label: 'In review' },
  { key: 'applied', label: 'Applied' },
  { key: 'cancelled', label: 'Cancelled' },
  { key: 'all', label: 'All' },
];

const STATUS_QUERY = {
  open: 'open',
  review: 'review',
  applied: 'applied',
  cancelled: 'cancelled',
  all: 'all',
};

export function statusQuery(filter) {
  return STATUS_QUERY[filter] ?? 'all';
}

export function countNumber() {
  const stamp = todayIso().replace(/-/g, '').slice(2);
  return `CNT-${stamp}-${String(Date.now()).slice(-3)}`;
}

export function expectedAt(levels, locationId, productId) {
  const level = levels.find((l) => l.product_id === productId && l.location_id === locationId);
  return Number(level?.quantity) || 0;
}

/**
 * Builds the count sheet as a snapshot: everything on hand at the location,
 * plus the rest of the chosen category. Nothing is written to stock here.
 */
export function buildSheet({ products, levels, locationId, category }) {
  return products
    .filter((p) => (p.status || 'active') !== 'archived')
    .filter((p) => !category || p.category === category)
    .filter((p) => {
      const onHand = expectedAt(levels, locationId, p.id);
      return onHand > 0 || Boolean(category);
    })
    .map((p) => ({
      product_id: p.id,
      product_name: p.name,
      sku: p.sku || '',
      expected: expectedAt(levels, locationId, p.id),
      counted: null,
    }))
    .sort((a, b) => a.product_name.localeCompare(b.product_name));
}

/** A line holds a real count only when the number is finite and not blank. */
function isCounted(line) {
  return (
    line.counted !== null &&
    line.counted !== '' &&
    line.counted !== undefined &&
    Number.isFinite(Number(line.counted))
  );
}

export function discrepancies(lines = []) {
  return lines.filter((line) => isCounted(line) && Number(line.counted) !== Number(line.expected));
}

export function countedLines(lines = []) {
  return lines.filter(isCounted);
}

export function countSummary(lines = []) {
  const counted = countedLines(lines);
  const differing = discrepancies(lines);
  const net = differing.reduce((sum, l) => sum + (Number(l.counted) || 0) - (Number(l.expected) || 0), 0);
  return { total: lines.length, counted: counted.length, differing: differing.length, net };
}

export async function saveCounts(sessionId, lines) {
  await base44.entities.CountSession.update(sessionId, { lines });
}

export async function submitCounts(sessionId, lines) {
  const summary = countSummary(lines);
  if (!summary.counted) throw new Error('Count at least one product before sending the session for review.');
  await base44.entities.CountSession.update(sessionId, { lines, status: 'review' });
}

/** Reopens a counted session so more items can be added before approval. */
export async function reopenCounts(sessionId, lines) {
  await base44.entities.CountSession.update(sessionId, { lines, status: 'open' });
}

/**
 * Applies the reviewed sheet: one "count" ledger entry per differing line,
 * which sets the shelf to the counted number. Guarded by the status, so a
 * second press can never write the differences twice. A sheet that matches
 * the system closes with no movements instead of being stuck in review.
 */
export async function applyCounts({ session, lines, products, user }) {
  if (session.status === 'applied') throw new Error('This session has already been applied.');
  if (session.status !== 'review') throw new Error('Send the session for review before applying it.');

  const location = { id: session.location_id, name: session.location_name || 'the location' };
  if (!location.id) throw new Error('This session has no location.');
  const byProduct = new Map(products.map((p) => [p.id, p]));
  const differing = discrepancies(lines);

  // Resolve every product before the first movement: a line whose product is
  // missing from the loaded catalog must fail before any stock is corrected.
  const resolved = [];
  for (const line of differing) {
    // A half-typed or negative number must never reach the shelf as a count.
    const counted = Number(line.counted);
    if (!Number.isFinite(counted) || counted < 0) {
      throw new Error(`${line.product_name || 'A line'}: enter a quantity of 0 or more.`);
    }
    let product = byProduct.get(line.product_id);
    if (!product) {
      product = await base44.entities.Product.get(line.product_id).catch(() => null);
    }
    if (!product) throw new Error(`${line.product_name || 'A line'} is no longer in the catalog.`);
    resolved.push({ line, product, counted });
  }

  for (const { line, product, counted } of resolved) {
    await recordMovement({
      product,
      location,
      type: 'count',
      quantity: counted,
      note: `Count ${session.number} · system said ${line.expected}`,
      reference: session.number,
      scannedCode: product.sku,
      user,
      businessId: session.business_id || '',
    });
  }

  await base44.entities.CountSession.update(session.id, {
    lines: lines.map((l) => (isCounted(l) ? { ...l, expected: Number(l.counted) } : l)),
    status: 'applied',
    applied_at: new Date().toISOString(),
    applied_by: user?.full_name || user?.email || '',
  });

  return differing.length;
}

export async function cancelCount(session) {
  if (session.status === 'applied') throw new Error('An applied session is part of the audit trail.');
  await base44.entities.CountSession.update(session.id, { status: 'cancelled' });
}

export async function deleteCount(session) {
  if (session.status === 'applied') {
    throw new Error('Applied sessions are kept as audit history — they cannot be deleted.');
  }
  await base44.entities.CountSession.delete(session.id);
}