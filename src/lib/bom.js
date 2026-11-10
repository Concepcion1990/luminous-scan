import { base44 } from '@/api/client';
import { scoped } from '@/lib/scoped';
import { recordMovement } from '@/lib/inventory';

/** A bundle is a kit of existing items; a recipe is what a made item consumes. */
export const BUILD_KINDS = {
  bundle: {
    label: 'Bundle',
    short: 'Kit',
    blurb: 'Existing products packed together and sold as one unit',
    tip: 'Building a bundle takes each part off the shelf and puts one bundle on it.',
  },
  recipe: {
    label: 'Recipe',
    short: 'Materials',
    blurb: 'Materials and parts consumed to make the finished item',
    tip: 'Building takes the materials off the shelf and puts the finished item on it.',
  },
};

export function buildNumber(prefix = 'BUILD') {
  const stamp = new Date();
  const day = `${stamp.getFullYear()}${String(stamp.getMonth() + 1).padStart(2, '0')}${String(
    stamp.getDate()
  ).padStart(2, '0')}`;
  const tail = String(Math.floor(Math.random() * 900) + 100);
  return `${prefix}-${day}-${tail}`;
}

export function usableLines(bom) {
  // One row per component: a repeated part is summed, so availability and the
  // consume step can never check half the need and then fail on the other half.
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

/** How many units of the built product the stock at one location can make now. */
export function availabilityAt(bom, levels, locationId) {
  const onHand = new Map();
  (levels || []).forEach((level) => {
    if (level.location_id === locationId) onHand.set(level.product_id, level.quantity || 0);
  });
  const lines = usableLines(bom);
  if (!lines.length) return 0;
  return lines.reduce((most, line) => {
    const canMake = Math.floor((onHand.get(line.component_id) || 0) / (Number(line.quantity) || 1));
    return Math.min(most, canMake);
  }, Number.POSITIVE_INFINITY);
}

/** Every component with what it needs and what is on hand, for the assemble sheet. */
export function componentRows(bom, levels, locationId, qty = 1) {
  const onHand = new Map();
  (levels || []).forEach((level) => {
    if (level.location_id === locationId) onHand.set(level.product_id, level.quantity || 0);
  });
  return usableLines(bom).map((line) => {
    const per = Number(line.quantity) || 0;
    const need = per * Math.max(1, Number(qty) || 1);
    const have = onHand.get(line.component_id) || 0;
    return {
      ...line,
      per,
      need,
      have,
      short: Math.max(need - have, 0),
    };
  });
}

export async function listBoms(businessId = '') {
  const page = await base44.entities.Bom.filter(scoped({}, businessId), {
    sort: 'product_name',
    limit: 300,
  });
  return page.items ?? [];
}

export async function listBuildableProducts(businessId = '') {
  const page = await base44.entities.Product.filter(scoped({}, businessId), {
    sort: 'name',
    limit: 500,
  });
  return page.items ?? [];
}

/**
 * Consumes every component at the location, then puts the finished product on
 * the same shelf. Component stock is checked up front so a build either has
 * everything it needs or writes nothing at all.
 */
export async function assembleBom({ bom, product, location, quantity, user, businessId = '' }) {
  const qty = Math.max(1, Math.floor(Number(quantity) || 0));
  if (!location) throw new Error('Choose where you are building.');
  const lines = usableLines(bom);
  if (!lines.length) throw new Error('This build list has no components yet.');

  // The finished product must still exist, or the build would put stock on the
  // shelf for something that is no longer in the catalog.
  const finished = await base44.entities.Product.get(bom.product_id).catch(() => null);
  if (!finished) {
    throw new Error(
      `${product?.name || 'The finished product'} is no longer in the catalog — add it back before building.`
    );
  }

  const page = await base44.entities.StockLevel.filter(
    scoped({ location_id: location.id }, businessId),
    { limit: 2000 }
  );
  const onHand = new Map((page.items ?? []).map((level) => [level.product_id, level.quantity || 0]));

  lines.forEach((line) => {
    const need = (Number(line.quantity) || 0) * qty;
    const have = onHand.get(line.component_id) || 0;
    if (need > have) {
      throw new Error(
        `${line.component_name}: only ${have} at ${location.name}, ${need} needed for ${qty}.`
      );
    }
  });

  const reference = buildNumber();

  for (const line of lines) {
    await recordMovement({
      product: {
        id: line.component_id,
        name: line.component_name,
        sku: line.sku || '',
        business_id: businessId,
      },
      location,
      type: 'consume',
      quantity: (Number(line.quantity) || 0) * qty,
      note: `Build ${qty} × ${finished.name}`,
      reference,
      user,
      businessId,
    });
  }

  const { next } = await recordMovement({
    product: finished,
    location,
    type: 'produce',
    quantity: qty,
    note: `Built from ${lines.length} part${lines.length === 1 ? '' : 's'}`,
    reference,
    user,
    businessId,
  });

  return { reference, next };
}

/** How many finished units of this build list sit on one shelf right now. */
export function bundleOnHand(bom, levels, locationId) {
  if (!bom) return 0;
  return (
    (levels || []).find(
      (level) => level.location_id === locationId && level.product_id === bom.product_id
    )?.quantity ?? 0
  );
}

/**
 * Takes finished units apart: the bundle leaves the shelf and every component
 * comes back to it in the same proportions it was built with.
 */
export async function disassembleBom({ bom, product, location, quantity, user, businessId = '' }) {
  const qty = Math.max(1, Math.floor(Number(quantity) || 0));
  if (!location) throw new Error('Choose where you are taking it apart.');
  const lines = usableLines(bom);
  if (!lines.length) throw new Error('This build list has no components yet.');

  const page = await base44.entities.StockLevel.filter(
    scoped({ location_id: location.id }, businessId),
    { limit: 2000 }
  );
  const onHand =
    (page.items ?? []).find((level) => level.product_id === bom.product_id)?.quantity ?? 0;
  if (qty > onHand) {
    throw new Error(`Only ${onHand} × ${product.name} at ${location.name}.`);
  }

  const reference = buildNumber('TEARDOWN');

  await recordMovement({
    product,
    location,
    type: 'disassemble',
    quantity: qty,
    note: 'Taken apart for parts',
    reference,
    user,
    businessId,
  });

  for (const line of lines) {
    await recordMovement({
      product: {
        id: line.component_id,
        name: line.component_name,
        sku: line.sku || '',
        business_id: businessId,
      },
      location,
      type: 'recovered',
      quantity: (Number(line.quantity) || 0) * qty,
      note: `From ${qty} × ${product.name}`,
      reference,
      user,
      businessId,
    });
  }

  return { reference, remaining: onHand - qty };
}