/**
 * ISBN extraction and check-digit validation (owner ruling,
 * Nov 19, 2026). The product form's ISBN button reads the printed
 * digits with OCR; whatever the camera thinks it saw is only a
 * CANDIDATE until the ISBN's own check digit agrees — a misread
 * digit breaks the checksum, so a bad read is refused instead of
 * filled in. The same gate judges barcode reads offered to the
 * ISBN field: only a genuinely valid ISBN-10 or ISBN-13 lands.
 */

export function isbn13CheckDigit(first12) {
  let sum = 0;
  for (let i = 0; i < 12; i += 1) sum += Number(first12[i]) * (i % 2 === 0 ? 1 : 3);
  return String((10 - (sum % 10)) % 10);
}

export function isValidIsbn13(value) {
  const s = String(value || '').replace(/[^0-9]/g, '');
  return s.length === 13 && isbn13CheckDigit(s.slice(0, 12)) === s[12];
}

export function isValidIsbn10(value) {
  const s = String(value || '').toUpperCase().replace(/[^0-9X]/g, '');
  if (s.length !== 10 || !/^[0-9]{9}[0-9X]$/.test(s)) return false;
  let sum = 0;
  for (let i = 0; i < 10; i += 1) {
    const d = s[i] === 'X' ? 10 : Number(s[i]);
    sum += (10 - i) * d;
  }
  return sum % 11 === 0;
}

export function isValidIsbn(value) {
  return isValidIsbn13(value) || isValidIsbn10(value);
}

/**
 * Pull an ISBN out of free text (OCR output or a barcode
 * payload). Returns { isbn, valid }: isbn is the bare digits
 * (an ISBN-10 keeps its X); when nothing validates, isbn is the
 * most plausible candidate found (or '') and valid is false, so
 * the caller can refuse without guessing.
 */
export function extractIsbn(text) {
  const upper = String(text || '').toUpperCase();
  // Candidate runs: digits/X with single separators between them
  // (the printed "978-3-16-148410-0" shape, spaces included).
  const runs = upper.match(/[0-9][0-9X\- ]*[0-9X]|[0-9]/g) || [];
  const candidates = [];
  for (const run of runs) {
    const bare = run.replace(/[^0-9X]/g, '');
    if (bare.length === 13 || bare.length === 10) {
      candidates.push(bare);
    } else if (bare.length > 13) {
      // A longer digit run (a price or a phone number fused to
      // the ISBN): only 978/979 windows can be ISBN-13s.
      for (let i = 0; i + 13 <= bare.length; i += 1) {
        const w = bare.slice(i, i + 13);
        if (/^97[89]/.test(w)) candidates.push(w);
      }
    }
  }
  for (const c of candidates) {
    if (isValidIsbn13(c)) return { isbn: c, valid: true };
  }
  for (const c of candidates) {
    if (isValidIsbn10(c)) return { isbn: c, valid: true };
  }
  return { isbn: candidates[0] || '', valid: false };
}
