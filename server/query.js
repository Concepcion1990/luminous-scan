/**
 * Base44 filter translator — T3.
 *
 * The ported frontend queries entities with Base44's filter language
 * ($or / $and / $in / $ne / $regex / $exists / comparisons, sort,
 * limit, cursor). The server evaluates that language over the rows
 * of one business in plain JS, so the semantics match Base44 exactly
 * (including the loose-separator code search) on both pg-mem and real
 * Postgres. Rows per business are bounded (FETCH_CAP); the export
 * path does its own SQL and is not subject to this cap.
 */
export const FETCH_CAP = 5000;

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** A $regex pattern from the ported code, evaluated case-sensitively or not. */
function regexTest(pattern, options, value) {
  if (value === null || value === undefined) return false;
  const text = String(value);
  try {
    const re = new RegExp(pattern, options && options.includes('i') ? 'i' : '');
    return re.test(text);
  } catch {
    return false;
  }
}

function compareValues(actual, expected, operator) {
  if (operator === '$gt') return actual > expected;
  if (operator === '$gte') return actual >= expected;
  if (operator === '$lt') return actual < expected;
  if (operator === '$lte') return actual <= expected;
  return false;
}

/** One field condition: a literal, or an operator object. */
function fieldMatches(actual, condition) {
  if (isPlainObject(condition)) {
    const keys = Object.keys(condition);
    if (keys.some((key) => key.startsWith('$'))) {
      return keys.every((key) => {
        const expected = condition[key];
        if (key === '$in') {
          const list = Array.isArray(expected) ? expected : [expected];
          if (Array.isArray(actual)) return actual.some((item) => list.includes(item));
          return list.some((item) => String(item) === String(actual ?? ''));
        }
        if (key === '$nin') {
          const list = Array.isArray(expected) ? expected : [expected];
          if (Array.isArray(actual)) return !actual.some((item) => list.includes(item));
          return !list.some((item) => String(item) === String(actual ?? ''));
        }
        if (key === '$ne') {
          if (expected === null || expected === undefined) return actual !== null && actual !== undefined && actual !== '';
          return String(actual ?? '') !== String(expected);
        }
        if (key === '$regex') return regexTest(expected, condition.$options, actual);
        if (key === '$options') return true; // handled with $regex
        if (key === '$exists') {
          const exists = actual !== null && actual !== undefined;
          return expected ? exists : !exists;
        }
        if (['$gt', '$gte', '$lt', '$lte'].includes(key)) {
          const a = Number(actual);
          const b = Number(expected);
          if (Number.isNaN(a) || Number.isNaN(b)) return false;
          return compareValues(a, b, key);
        }
        return false;
      });
    }
  }
  // Literal equality. An array field (tags) matches when it contains the value.
  if (Array.isArray(actual)) return actual.some((item) => String(item) === String(condition));
  if (actual === null || actual === undefined) return condition === null || condition === undefined || condition === '';
  if (typeof actual === 'number' || typeof condition === 'number') return Number(actual) === Number(condition);
  return String(actual) === String(condition);
}

export function matchesFilter(row, filter) {
  if (!filter || !Object.keys(filter).length) return true;
  return Object.entries(filter).every(([key, condition]) => {
    if (key === '$and') {
      const parts = Array.isArray(condition) ? condition : [condition];
      return parts.every((part) => matchesFilter(row, part));
    }
    if (key === '$or') {
      const parts = Array.isArray(condition) ? condition : [condition];
      return parts.some((part) => matchesFilter(row, part));
    }
    if (key === '$nor') {
      const parts = Array.isArray(condition) ? condition : [condition];
      return !parts.some((part) => matchesFilter(row, part));
    }
    return fieldMatches(row[key], condition);
  });
}

function sortValue(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') return value;
  const asDate = Date.parse(String(value));
  if (!Number.isNaN(asDate) && /^\d{4}-\d{2}-\d{2}/.test(String(value))) return asDate;
  return String(value).toLowerCase();
}

export function sortRows(rows, sort) {
  if (!sort) return rows;
  const descending = sort.startsWith('-');
  const field = descending ? sort.slice(1) : sort;
  const copy = [...rows];
  copy.sort((a, b) => {
    const av = sortValue(a[field]);
    const bv = sortValue(b[field]);
    if (av === null && bv === null) return 0;
    if (av === null) return 1;
    if (bv === null) return -1;
    if (av < bv) return descending ? 1 : -1;
    if (av > bv) return descending ? -1 : 1;
    return 0;
  });
  return copy;
}

export function encodeCursor(offset) {
  return Buffer.from(JSON.stringify({ o: offset }), 'utf8').toString('base64url');
}

export function decodeCursor(cursor) {
  if (!cursor || typeof cursor !== 'string') return 0;
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    const offset = Number(parsed.o);
    return Number.isFinite(offset) && offset >= 0 ? Math.floor(offset) : 0;
  } catch {
    return 0;
  }
}

/** Sort + paginate already-filtered rows, Base44 shape: { items, next_cursor }. */
export function pageRows(rows, { sort, limit = 200, cursor } = {}) {
  const sorted = sortRows(rows, sort);
  const safeLimit = Math.min(Math.max(Number(limit) || 200, 1), 2000);
  const offset = decodeCursor(cursor);
  const items = sorted.slice(offset, offset + safeLimit);
  const nextOffset = offset + items.length;
  return {
    items,
    next_cursor: nextOffset < sorted.length ? encodeCursor(nextOffset) : null,
    total: sorted.length,
  };
}
