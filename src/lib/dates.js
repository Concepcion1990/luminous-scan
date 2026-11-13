/**
 * Record timestamps come back without a timezone marker (for example
 * "2026-11-04T03:54:01.598000"), which browsers read as local time and can
 * push an evening movement onto the next calendar day. Stored values are UTC,
 * so mark them as UTC before formatting them for display.
 */
export function toLocalDate(value) {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const text = String(value).trim();
  if (!text) return null;
  const hasZone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(text);
  const date = new Date(hasZone ? text : `${text.replace(' ', 'T')}Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function localTimeZoneName() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || '';
  } catch {
    return '';
  }
}