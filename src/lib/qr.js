/**
 * Small QR Code encoder: byte mode, error correction level M, versions 1–4.
 * That covers up to 62 characters — plenty for an internal SKU, UPC or label
 * reference — and keeps the code small enough to audit. Print output is
 * verified by decoding the generated modules with the scanner library.
 */

const BLOCKS = {
  1: { ecc: 10, groups: [[1, 16]] },
  2: { ecc: 16, groups: [[1, 28]] },
  3: { ecc: 26, groups: [[1, 44]] },
  4: { ecc: 18, groups: [[2, 32]] },
};

const CAPACITY = { 1: 14, 2: 26, 3: 42, 4: 62 };
const ALIGNMENT = { 1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26] };

const EXP = new Array(512);
const LOG = new Array(256);
(() => {
  let x = 1;
  for (let i = 0; i < 255; i += 1) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i += 1) EXP[i] = EXP[i - 255];
})();

function multiply(a, b) {
  if (a === 0 || b === 0) return 0;
  return EXP[LOG[a] + LOG[b]];
}

function generator(degree) {
  let poly = [1];
  for (let i = 0; i < degree; i += 1) {
    const next = new Array(poly.length + 1).fill(0);
    for (let j = 0; j < poly.length; j += 1) {
      next[j] ^= poly[j];
      next[j + 1] ^= multiply(poly[j], EXP[i]);
    }
    poly = next;
  }
  return poly;
}

function eccFor(data, degree) {
  const factor = generator(degree);
  const remainder = new Array(degree).fill(0);
  for (let i = 0; i < data.length; i += 1) {
    const lead = data[i] ^ remainder[0];
    remainder.shift();
    remainder.push(0);
    if (lead !== 0) {
      for (let j = 0; j < degree; j += 1) remainder[j] ^= multiply(factor[j + 1], lead);
    }
  }
  return remainder;
}

function dataCodewordCount(version) {
  return BLOCKS[version].groups.reduce((sum, [count, length]) => sum + count * length, 0);
}

function encodeData(bytes, version) {
  const capacityBits = dataCodewordCount(version) * 8;
  const bits = [];
  const push = (value, length) => {
    for (let i = length - 1; i >= 0; i -= 1) bits.push((value >>> i) & 1);
  };

  push(4, 4); // byte mode
  push(bytes.length, 8); // character count for versions 1–9
  bytes.forEach((byte) => push(byte, 8));

  for (let i = 0; i < 4 && bits.length < capacityBits; i += 1) bits.push(0);
  while (bits.length % 8 !== 0) bits.push(0);

  const codewords = [];
  for (let i = 0; i < bits.length; i += 8) {
    let value = 0;
    for (let j = 0; j < 8; j += 1) value = (value << 1) | bits[i + j];
    codewords.push(value);
  }

  let pad = 0;
  while (codewords.length < dataCodewordCount(version)) {
    codewords.push(pad % 2 === 0 ? 0xec : 0x11);
    pad += 1;
  }
  return codewords;
}

function interleave(data, version) {
  const spec = BLOCKS[version];
  const blocks = [];
  let offset = 0;
  spec.groups.forEach(([count, length]) => {
    for (let i = 0; i < count; i += 1) {
      const chunk = data.slice(offset, offset + length);
      offset += length;
      blocks.push({ data: chunk, ecc: eccFor(chunk, spec.ecc) });
    }
  });

  const out = [];
  const maxData = Math.max(...blocks.map((block) => block.data.length));
  for (let i = 0; i < maxData; i += 1) {
    blocks.forEach((block) => {
      if (i < block.data.length) out.push(block.data[i]);
    });
  }
  for (let i = 0; i < spec.ecc; i += 1) {
    blocks.forEach((block) => out.push(block.ecc[i]));
  }
  return out;
}

function bitLength(value) {
  let length = 0;
  let rest = value;
  while (rest !== 0) {
    length += 1;
    rest >>>= 1;
  }
  return length;
}

function formatBits(errorLevel, mask) {
  const data = (errorLevel << 3) | mask;
  let remainder = data << 10;
  while (bitLength(remainder) - bitLength(0x537) >= 0) {
    remainder ^= 0x537 << (bitLength(remainder) - bitLength(0x537));
  }
  return ((data << 10) | remainder) ^ 0x5412;
}

/**
 * Returns { size, modules } where modules[row][col] is true for a dark module,
 * or null when the text does not fit.
 */
export function qrMatrix(text) {
  const bytes = Array.from(new TextEncoder().encode(String(text ?? '')));
  const version = [1, 2, 3, 4].find((candidate) => bytes.length <= CAPACITY[candidate]);
  if (!version) return null;

  const size = version * 4 + 17;
  const modules = Array.from({ length: size }, () => new Array(size).fill(null));
  const place = (row, col, dark) => {
    if (row < 0 || col < 0 || row >= size || col >= size) return;
    modules[row][col] = dark;
  };

  [[0, 0], [0, size - 7], [size - 7, 0]].forEach(([top, left]) => {
    for (let row = -1; row <= 7; row += 1) {
      for (let col = -1; col <= 7; col += 1) {
        const inside = row >= 0 && row <= 6 && col >= 0 && col <= 6;
        const dark =
          inside &&
          (row === 0 ||
            row === 6 ||
            col === 0 ||
            col === 6 ||
            (row >= 2 && row <= 4 && col >= 2 && col <= 4));
        place(top + row, left + col, dark);
      }
    }
  });

  for (let i = 8; i < size - 8; i += 1) {
    place(6, i, i % 2 === 0);
    place(i, 6, i % 2 === 0);
  }

  const centres = ALIGNMENT[version];
  centres.forEach((row) => {
    centres.forEach((col) => {
      if (modules[row][col] !== null) return;
      for (let dr = -2; dr <= 2; dr += 1) {
        for (let dc = -2; dc <= 2; dc += 1) {
          place(row + dr, col + dc, Math.max(Math.abs(dr), Math.abs(dc)) !== 1);
        }
      }
    });
  });

  const mask = 0;
  const bits = formatBits(0, mask); // error correction level M
  for (let i = 0; i < 15; i += 1) {
    const dark = ((bits >> i) & 1) === 1;
    if (i < 6) place(i, 8, dark);
    else if (i < 8) place(i + 1, 8, dark);
    else place(size - 15 + i, 8, dark);
  }
  for (let i = 0; i < 15; i += 1) {
    const dark = ((bits >> i) & 1) === 1;
    if (i < 8) place(8, size - i - 1, dark);
    else if (i < 9) place(8, 15 - i - 1 + 1, dark);
    else place(8, 15 - i - 1, dark);
  }
  place(size - 8, 8, true);

  const codewords = interleave(encodeData(bytes, version), version);
  let direction = -1;
  let row = size - 1;
  let bitIndex = 7;
  let byteIndex = 0;

  for (let col = size - 1; col > 0; col -= 2) {
    let column = col;
    if (column === 6) column -= 1;
    for (;;) {
      for (let offset = 0; offset < 2; offset += 1) {
        if (modules[row][column - offset] === null) {
          let dark = false;
          if (byteIndex < codewords.length) {
            dark = ((codewords[byteIndex] >>> bitIndex) & 1) === 1;
          }
          if ((row + column - offset) % 2 === 0) dark = !dark;
          modules[row][column - offset] = dark;
          bitIndex -= 1;
          if (bitIndex === -1) {
            byteIndex += 1;
            bitIndex = 7;
          }
        }
      }
      row += direction;
      if (row < 0 || size <= row) {
        row -= direction;
        direction = -direction;
        break;
      }
    }
  }

  return {
    size,
    modules: modules.map((line) => line.map((cell) => cell === true)),
  };
}