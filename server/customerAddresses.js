/**
 * The rolling 90-day customer address book (Nov 14, 2026).
 *
 * IDENTITY RULE (the owner's ruling): a name alone NEVER
 * identifies a customer — too many people share names. A customer
 * entry is keyed by NAME + ADDRESS together:
 *  - same name + same address on a new order → the same entry,
 *    and the order refreshes its 90 days;
 *  - same name + a DIFFERENT address → a NEW entry with its own
 *    address and its own 90-day clock — never merged, never
 *    refreshing the other entry;
 *  - the new-order form may OFFER the saved addresses held under
 *    a typed name; choosing one binds the order to that entry
 *    (its save refreshes it); typing a different address creates
 *    the new entry.
 *
 * Normalization (comparison only): every field is lowercased,
 * trimmed, and internal whitespace runs collapse to one space.
 * The stored fields keep the order's own trimmed spelling.
 *
 * Retention: after 90 days with no order for an entry, the saved
 * REUSABLE address is purged by runCustomerAddressSweep (it rides
 * the daily wipe-sweep job). The purge never touches the orders
 * themselves: an individual order keeps the address that was on
 * it as part of its own record. Orders with no customer name or
 * no address create no entry.
 */
import crypto from 'node:crypto';

export const CUSTOMER_ADDRESS_RETENTION_DAYS = 90;

const norm = (value) => String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');

export function normalizeCustomerName(name) {
  return norm(name);
}

const ADDRESS_FIELDS = ['ship_street', 'ship_city', 'ship_region', 'ship_postal', 'ship_country'];

export function orderHasAddress(order) {
  return ADDRESS_FIELDS.some((field) => String(order?.[field] || '').trim());
}

/** The identity key: a hash of the normalized name + normalized address. */
export function customerKeyFor(order) {
  const name = norm(order?.customer_name);
  if (!name || !orderHasAddress(order)) return null;
  const parts = [name, ...ADDRESS_FIELDS.map((field) => norm(order?.[field]))];
  return `cust:${crypto.createHash('sha256').update(parts.join('|')).digest('hex')}`;
}

function expiryFrom(now) {
  return new Date(now.getTime() + CUSTOMER_ADDRESS_RETENTION_DAYS * 24 * 60 * 60 * 1000);
}

/**
 * Remember (or refresh) the customer's entry from an order that
 * was just saved. Same name + same address refreshes the one
 * entry; a different address lands as its own entry. Never throws
 * into the order path.
 */
export async function rememberOrderAddress(pool, order, now = new Date()) {
  if (!pool || !order?.business_id) return;
  const key = customerKeyFor(order);
  if (!key) return;
  const expiresAt = expiryFrom(now);
  await pool.query(
    `INSERT INTO customer_addresses
       (id, business_id, customer_key, customer_name, name_norm, ship_street, ship_city,
        ship_region, ship_postal, ship_country, last_order_at, expires_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $11)
     ON CONFLICT (business_id, customer_key) DO UPDATE SET
       customer_name = EXCLUDED.customer_name,
       name_norm = EXCLUDED.name_norm,
       ship_street = EXCLUDED.ship_street,
       ship_city = EXCLUDED.ship_city,
       ship_region = EXCLUDED.ship_region,
       ship_postal = EXCLUDED.ship_postal,
       ship_country = EXCLUDED.ship_country,
       last_order_at = EXCLUDED.last_order_at,
       expires_at = EXCLUDED.expires_at,
       updated_at = EXCLUDED.updated_at`,
    [
      crypto.randomUUID(),
      order.business_id,
      key,
      String(order.customer_name || '').trim(),
      norm(order.customer_name),
      String(order.ship_street || '').trim(),
      String(order.ship_city || '').trim(),
      String(order.ship_region || '').trim(),
      String(order.ship_postal || '').trim(),
      String(order.ship_country || '').trim(),
      now.toISOString(),
      expiresAt.toISOString(),
    ],
  );
}

/** All live entries held under a customer name (the form's offer list). */
export async function findCustomerAddressesByName(pool, businessId, name, now = new Date()) {
  if (!pool || !businessId) return [];
  const nameNorm = norm(name);
  if (!nameNorm) return [];
  const { rows } = await pool.query(
    `SELECT customer_key, customer_name, ship_street, ship_city, ship_region,
            ship_postal, ship_country, expires_at
     FROM customer_addresses
     WHERE business_id = $1 AND name_norm = $2 AND expires_at > $3
     ORDER BY last_order_at DESC`,
    [businessId, nameNorm, now.toISOString()],
  );
  return rows;
}

/** Purge every lapsed reusable address. Orders are never touched. */
export async function runCustomerAddressSweep(pool, now = new Date()) {
  const result = await pool.query(
    'DELETE FROM customer_addresses WHERE expires_at <= $1',
    [now.toISOString()],
  );
  return { purged: result.rowCount ?? 0 };
}
