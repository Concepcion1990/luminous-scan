import { base44 } from '@/api/client';
import { recordMovement } from '@/lib/inventory';
import { todayIso } from '@/lib/purchasing';
import { descendantIds, orderedLocations } from './locations.js';
import { t } from './i18n.js';

export const COUNT_STATUS = {
  open: { get label() { return t('countsLib.statusCounting'); }, tone: 'warn' },
  review: { get label() { return t('countsLib.statusInReview'); }, tone: 'info' },
  applied: { get label() { return t('countsLib.statusApplied'); }, tone: 'ok' },
  cancelled: { get label() { return t('countsLib.statusCancelled'); }, tone: 'muted' },
};

export const COUNT_FILTERS = [
  { key: 'open', get label() { return t('countsLib.filterOpen'); } },
  { key: 'review', get label() { return t('countsLib.filterInReview'); } },
  { key: 'applied', get label() { return t('countsLib.filterApplied'); } },
  { key: 'cancelled', get label() { return t('countsLib.filterCancelled'); } },
  { key: 'all', get label() { return t('countsLib.filterAll'); } },
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
 * The areas a count walks, in walk order (release 378, Nov
 * 25, 2026 — count sheets in shelf order): the counted place
 * first, then everything nested inside it (shelf, bin, cold
 * room), in the location tree's own order — the order the
 * counter physically walks the space. A place with nothing
 * nested in it walks as itself alone, exactly as counts
 * have always worked.
 */
export function countWalkAreas(locations = [], locationId) {
  if (!locationId) return [];
  const inside = new Set([locationId, ...descendantIds(locations, locationId)]);
  return orderedLocations(locations)
    .filter(({ location }) => inside.has(location.id))
    .map(({ location }) => location);
}

/**
 * Builds the count sheet as a snapshot, laid out in shelf
 * order (release 378): the walk's areas in walk order, each
 * area's stocked products together under it (name order
 * inside an area, as before), every line stamped with the
 * area it belongs to — so a count of the walk-in counts its
 * shelves too, in the order you walk them, instead of only
 * the stock booked to the room itself. With a category
 * chosen, the whole category counts (the rule the sheet has
 * always kept): a category product stocked in one of the
 * walk's areas joins THAT area's section at its own number;
 * one stocked nowhere in the walk joins the counted place's
 * section at zero. Without a category, only what is on hand
 * somewhere in the walk joins. Nothing is written to stock
 * here. Callers that pass no locations get the single-area
 * sheet counts have always built.
 */
export function buildSheet({ products, levels, locations = [], locationId, category }) {
  const areas = countWalkAreas(locations, locationId);
  const walk = areas.length ? areas : [{ id: locationId, name: '' }];
  const candidates = (products || [])
    .filter((p) => (p.status || 'active') !== 'archived')
    .filter((p) => !category || p.category === category)
    .sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  const stocked = new Set();
  const perArea = walk.map((area) => {
    const lines = [];
    for (const p of candidates) {
      const onHand = expectedAt(levels, area.id, p.id);
      if (onHand > 0) {
        stocked.add(p.id);
        lines.push({
          product_id: p.id,
          product_name: p.name,
          sku: p.sku || '',
          expected: onHand,
          counted: null,
          location_id: area.id,
          location_name: area.name || '',
        });
      }
    }
    return lines;
  });
  if (category && perArea.length) {
    for (const p of candidates) {
      if (stocked.has(p.id)) continue;
      perArea[0].push({
        product_id: p.id,
        product_name: p.name,
        sku: p.sku || '',
        expected: 0,
        counted: null,
        location_id: walk[0].id,
        location_name: walk[0].name || '',
      });
    }
    perArea[0].sort((a, b) => a.product_name.localeCompare(b.product_name));
  }
  return perArea.flat();
}

/**
 * "That count looks wrong" (release 378): a counted line
 * whose number is wildly off from what is on record — at
 * least ten units away AND at least double, or at most
 * half, the expected number (stock appearing from nowhere
 * counts too: ten or more counted where none is on record).
 * The warning ASKS before saving; it never blocks — a
 * genuine find (a case in the back nobody booked) saves
 * exactly like any other count once the counter says so.
 * Small honest differences — the ordinary variance a count
 * exists to find — never trip it.
 */
export function countLooksWrong(line) {
  if (!isCounted(line)) return false;
  const counted = Number(line.counted);
  const expected = Number(line.expected) || 0;
  const diff = Math.abs(counted - expected);
  if (diff < 10) return false;
  if (expected <= 0) return true;
  return counted >= expected * 2 || counted * 2 <= expected;
}

/** Every line on the sheet the sanity warning names. */
export function wildCountLines(lines = []) {
  return lines.filter(countLooksWrong);
}

/**
 * The printed count sheet's shelf order (release 378): the
 * picked products grouped by the storage area that holds
 * most of their stock, areas in the location tree's walk
 * order, name order inside an area. A product stocked
 * nowhere picked yet (or a business whose areas could not
 * be read) lands in one last ungrouped section — the sheet
 * the Print Center has always printed.
 */
export function shelfOrderProducts(products = [], levels = [], locations = []) {
  const walk = orderedLocations(locations).map(({ location }) => location);
  const areaIndex = new Map(walk.map((location, index) => [location.id, index]));
  const primary = new Map();
  for (const level of levels || []) {
    if (!areaIndex.has(level.location_id)) continue;
    const qty = Number(level.quantity) || 0;
    if (qty <= 0) continue;
    const current = primary.get(level.product_id);
    if (!current || qty > current.qty) primary.set(level.product_id, { areaId: level.location_id, qty });
  }
  const groups = new Map();
  for (const product of products || []) {
    const key = primary.get(product.id)?.areaId || '';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(product);
  }
  return [...groups.entries()]
    .sort(
      ([a], [b]) =>
        (areaIndex.get(a) ?? Number.MAX_SAFE_INTEGER) - (areaIndex.get(b) ?? Number.MAX_SAFE_INTEGER),
    )
    .map(([areaId, items]) => ({
      area: walk.find((location) => location.id === areaId) || null,
      products: items.sort((a, b) => (a.name || '').localeCompare(b.name || '')),
    }));
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

/**
 * One scanned unit on a count sheet — scan-to-tally (owner ruling,
 * Nov 16, 2026). The product's line gains +1 from its current
 * counted value (0 when untouched); a product NOT on the sheet
 * joins it at 1, wearing the expected quantity for the sheet's
 * location — the exact line the typed-code Add has always
 * appended. This supersedes the Nov 14 camera rule (one capture,
 * off-sheet products refused): she asked for both ways of counting
 * side by side — type the total, or scan item after item and let
 * the tally climb on its own. A scan inside a count touches ONLY
 * the sheet: no stock moves until the sheet is saved, sent for
 * review and applied through the usual lifecycle.
 */
export function tallyCountedLine(lines = [], product, expected = 0, area = null) {
  // Shelf order (release 378): a product stocked in more
  // than one of the walk's areas has a line per area; a scan
  // tallies the FIRST of them in walk order — the counter is
  // walking the areas in order, and any line can still be
  // typed into directly. A product new to the sheet joins at
  // the counted place (the area the caller names, else the
  // sheet's own first area), exactly as it always has.
  const index = lines.findIndex((l) => l.product_id === product.id);
  if (index >= 0) {
    return lines.map((l, i) => (i === index ? { ...l, counted: (Number(l.counted) || 0) + 1 } : l));
  }
  return [
    ...lines,
    {
      product_id: product.id,
      product_name: product.name,
      sku: product.sku || '',
      expected,
      counted: 1,
      ...(area ? { location_id: area.id || '', location_name: area.name || '' } : {}),
    },
  ];
}

export async function saveCounts(sessionId, lines) {
  await base44.entities.CountSession.update(sessionId, { lines });
}

export async function submitCounts(sessionId, lines) {
  const summary = countSummary(lines);
  if (!summary.counted) throw new Error(t('countsLib.countAtLeastOne'));
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
  if (session.status === 'applied') throw new Error(t('countsLib.alreadyApplied'));
  if (session.status !== 'review') throw new Error(t('countsLib.sendForReviewFirst'));

  const location = { id: session.location_id, name: session.location_name || t('countsLib.locationFallback') };
  if (!location.id) throw new Error(t('countsLib.noLocation'));
  const byProduct = new Map(products.map((p) => [p.id, p]));
  const differing = discrepancies(lines);

  // Resolve every product before the first movement: a line whose product is
  // missing from the loaded catalog must fail before any stock is corrected.
  const resolved = [];
  for (const line of differing) {
    // A half-typed or negative number must never reach the shelf as a count.
    const counted = Number(line.counted);
    if (!Number.isFinite(counted) || counted < 0) {
      throw new Error(
        t('countsLib.enterQuantityZeroOrMore', { name: line.product_name || t('countsLib.lineFallback') })
      );
    }
    let product = byProduct.get(line.product_id);
    if (!product) {
      product = await base44.entities.Product.get(line.product_id).catch(() => null);
    }
    if (!product) {
      throw new Error(
        t('countsLib.noLongerInCatalog', { name: line.product_name || t('countsLib.lineFallback') })
      );
    }
    resolved.push({ line, product, counted });
  }

  for (const { line, product, counted } of resolved) {
    // Shelf order (release 378): a line corrects the area it
    // counted — its own stamped location — so a count of a
    // place and its shelves sets each shelf's number, never
    // the parent place's. Lines from before the stamp (and
    // lines added by scan at the counted place) fall back to
    // the session's location, as counts have always applied.
    const lineLocation = line.location_id
      ? { id: line.location_id, name: line.location_name || location.name }
      : location;
    await recordMovement({
      product,
      location: lineLocation,
      type: 'count',
      quantity: counted,
      note: t('countsLib.countNote', {
        number: session.number,
        expected: line.expected,
      }),
      reference: session.number,
      scannedCode: product.sku,
      user,
      businessId: session.business_id || '',
    });
  }

  await base44.entities.CountSession.update(session.id, {
    lines: lines.map((l) => (isCounted(l) ? { ...l, expected: Number(l.counted) } : l)),
    status: 'applied',
    // The applied stamp is the server's to write (release 357):
    // it stamps the transition into 'applied' from its own clock
    // and session — a name, never an email, as ever.
  });

  return differing.length;
}

export async function cancelCount(session) {
  if (session.status === 'applied') throw new Error(t('countsLib.appliedIsAuditTrail'));
  await base44.entities.CountSession.update(session.id, { status: 'cancelled' });
}

export async function deleteCount(session) {
  if (session.status === 'applied') {
    throw new Error(t('countsLib.appliedCannotDelete'));
  }
  await base44.entities.CountSession.delete(session.id);
}