// ISBN check-digit validation + extraction (Nov 19, 2026): the
// gate that decides whether a camera read may fill the product
// form's ISBN field. A read that fails the checksum is refused —
// these tests pin the math the refusal stands on.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  extractIsbn, isValidIsbn, isValidIsbn10, isValidIsbn13,
} from './isbn.js';

describe('ISBN-13 check digit', () => {
  it('accepts a valid ISBN-13, bare or hyphenated', () => {
    assert.equal(isValidIsbn13('9783161484100'), true);
    assert.equal(isValidIsbn13('978-3-16-148410-0'), true);
    assert.equal(isValidIsbn13('9780306406157'), true);
  });

  it('rejects a single wrong digit anywhere', () => {
    assert.equal(isValidIsbn13('9783161484105'), false); // check digit off
    assert.equal(isValidIsbn13('9783161484200'), false); // body digit off
    assert.equal(isValidIsbn13('8783161484100'), false); // first digit off
  });

  it('rejects junk and wrong lengths', () => {
    assert.equal(isValidIsbn13(''), false);
    assert.equal(isValidIsbn13('978316148410'), false);
    assert.equal(isValidIsbn13('97831614841000'), false);
    assert.equal(isValidIsbn13('abcdefghijklm'), false);
    assert.equal(isValidIsbn13(null), false);
  });
});

describe('ISBN-10 check digit', () => {
  it('accepts valid ISBN-10s, including an X check digit', () => {
    assert.equal(isValidIsbn10('0306406152'), true);
    assert.equal(isValidIsbn10('0-306-40615-2'), true);
    assert.equal(isValidIsbn10('080442957X'), true);
    assert.equal(isValidIsbn10('0-8044-2957-X'), true);
    assert.equal(isValidIsbn10('080442957x'), true);
  });

  it('rejects a wrong check digit', () => {
    assert.equal(isValidIsbn10('0306406153'), false);
    assert.equal(isValidIsbn10('0804429570'), false); // X replaced by 0
  });

  it('rejects junk and wrong lengths', () => {
    assert.equal(isValidIsbn10(''), false);
    assert.equal(isValidIsbn10('030640615'), false);
    assert.equal(isValidIsbn10('03064061522'), false);
    assert.equal(isValidIsbn10('X306406152'), false); // X only ever last
  });
});

describe('isValidIsbn', () => {
  it('accepts either family and refuses everything else', () => {
    assert.equal(isValidIsbn('9783161484100'), true);
    assert.equal(isValidIsbn('080442957X'), true);
    assert.equal(isValidIsbn('1234567890'), false);
    assert.equal(isValidIsbn('hello'), false);
  });
});

describe('extractIsbn', () => {
  it('pulls a hyphenated ISBN-13 out of printed text', () => {
    assert.deepEqual(extractIsbn('ISBN 978-3-16-148410-0'),
      { isbn: '9783161484100', valid: true });
  });

  it('pulls a bare ISBN-13 out of OCR text with noise around it', () => {
    assert.deepEqual(extractIsbn('  9783161484100 \n'),
      { isbn: '9783161484100', valid: true });
  });

  it('pulls an ISBN-10 with an X check digit', () => {
    assert.deepEqual(extractIsbn('ISBN 0-8044-2957-X'),
      { isbn: '080442957X', valid: true });
  });

  it('reports a faithfully-read but invalid number as invalid', () => {
    const found = extractIsbn('ISBN 978-3-16-148410-5');
    assert.equal(found.valid, false);
    assert.equal(found.isbn, '9783161484105');
  });

  it('finds a 978 window inside a longer fused digit run', () => {
    assert.deepEqual(extractIsbn('12999783161484100'),
      { isbn: '9783161484100', valid: true });
  });

  it('returns empty + invalid when there is no ISBN at all', () => {
    assert.deepEqual(extractIsbn(''), { isbn: '', valid: false });
    assert.deepEqual(extractIsbn('no digits here'), { isbn: '', valid: false });
    assert.deepEqual(extractIsbn(null), { isbn: '', valid: false });
  });
});
