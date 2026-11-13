/**
 * T5 — Bluetooth printing, client-side (no hardware).
 *
 * Web Bluetooth availability detection + fallback, ESC/POS label
 * generation from cached data, and the PrintCenter help copy that
 * states the iOS Safari gap and the AirPrint workaround in plain
 * words. Direct-printer behaviour against real hardware is NOT
 * verified here — that needs a live check with the owner.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  bluetoothAvailable,
  BLUETOOTH_UNAVAILABLE_COPY,
  BLUETOOTH_NO_CHANNEL_COPY,
  printLabelsViaBluetooth,
  connectBluetoothPrinter,
} from './bluetoothPrint.js';
import { escPosLabelBytes, escPosLabelsBytes } from './escPos.js';
import { toLabel, locationToLabel } from './labelPayload.js';
import { buildLabelsPdfBytes } from './labelsPdf.js';

const PRODUCT = { id: 'p1', name: 'Cat Bookmark', sku: 'BM-001', upc: '9781234567890', price: 9 };

test('bluetoothAvailable detects Web Bluetooth and its absence', () => {
  assert.equal(bluetoothAvailable({ requestDevice: async () => ({}) }), true);
  assert.equal(bluetoothAvailable({}), false);
  assert.equal(bluetoothAvailable(undefined), false);
  assert.equal(bluetoothAvailable(null), false);
});

test('the unavailable copy names iOS Safari and the workarounds plainly', () => {
  assert.match(BLUETOOTH_UNAVAILABLE_COPY, /iOS Safari/);
  assert.match(BLUETOOTH_UNAVAILABLE_COPY, /desktop Chrome or Edge/);
  assert.match(BLUETOOTH_UNAVAILABLE_COPY, /Android Chrome/);
  assert.match(BLUETOOTH_UNAVAILABLE_COPY, /AirPrint/);
  assert.match(BLUETOOTH_UNAVAILABLE_COPY, /mobile app/);
});

test('ESC/POS label bytes are generated client-side from cached data', () => {
  const bytes = escPosLabelBytes(PRODUCT);
  assert.ok(bytes instanceof Uint8Array);
  // ESC @ initialise, then the name, the Code 128 selector, the code, then cut.
  assert.deepEqual([...bytes.slice(0, 2)], [0x1b, 0x40]);
  const text = Buffer.from(bytes).toString('latin1');
  assert.ok(text.includes('Cat Bookmark'));
  assert.ok(text.includes('{B9781234567890'));
  assert.ok(text.includes('SKU BM-001'));
  assert.ok(text.includes('$9.00'));
  assert.deepEqual([...bytes.slice(-3)], [0x1d, 0x56, 0x00]);
});

test('copies multiply the labels, capped at 20', () => {
  const one = escPosLabelsBytes([PRODUCT], 1);
  const three = escPosLabelsBytes([PRODUCT], 3);
  assert.equal(three.length, one.length * 3);
  const capped = escPosLabelsBytes([PRODUCT], 99);
  assert.equal(capped.length, one.length * 20);
});

test('printLabelsViaBluetooth streams the bytes to a writable characteristic', async () => {
  const written = [];
  const characteristic = {
    properties: { writeWithoutResponse: true },
    writeValueWithoutResponse: async (chunk) => written.push(Buffer.from(chunk)),
  };
  const fakeBluetooth = {
    requestDevice: async (options) => {
      assert.equal(options.acceptAllDevices, true);
      assert.ok(Array.isArray(options.optionalServices) && options.optionalServices.length > 0);
      return {
        name: 'Zebra ZD410',
        gatt: {
          connect: async () => ({
            getPrimaryServices: async () => [
              { getCharacteristics: async () => [characteristic] },
            ],
          }),
        },
      };
    },
  };
  const result = await printLabelsViaBluetooth([PRODUCT], { bluetooth: fakeBluetooth, copies: 2 });
  assert.equal(result.deviceName, 'Zebra ZD410');
  const sent = Buffer.concat(written);
  assert.equal(sent.length, escPosLabelsBytes([PRODUCT], 2).length);
  assert.deepEqual([...sent.slice(0, 2)], [0x1b, 0x40]);
});

test('Bluetooth printing fails closed with plain copy when unavailable', async () => {
  await assert.rejects(
    printLabelsViaBluetooth([PRODUCT], { bluetooth: {} }),
    (error) => error.message === BLUETOOTH_UNAVAILABLE_COPY,
  );
});

test('a printer with no writable channel is refused with the fallback copy', async () => {
  const fakeBluetooth = {
    requestDevice: async () => ({
      name: 'Silent Printer',
      gatt: {
        connect: async () => ({
          getPrimaryServices: async () => [
            { getCharacteristics: async () => [{ properties: { read: true } }] },
          ],
        }),
      },
    }),
  };
  await assert.rejects(
    connectBluetoothPrinter({ bluetooth: fakeBluetooth }),
    (error) => error.message === BLUETOOTH_NO_CHANNEL_COPY,
  );
});

test('client-side labels PDF needs no fetch: real PDF from cached data', () => {
  const bytes = buildLabelsPdfBytes([PRODUCT], { copies: 1, businessName: 'Test Shop' });
  assert.ok(bytes instanceof Uint8Array);
  assert.ok(bytes.length > 500, `labels PDF too small: ${bytes.length}`);
  const text = Buffer.from(bytes).toString('latin1');
  assert.ok(text.startsWith('%PDF-'));
  assert.ok(text.includes('Cat Bookmark'));
  assert.ok(text.includes('9781234567890'));
  assert.ok(text.includes('BM-001'));
});

test('PrintCenter help copy covers all four connections and the iPhone workarounds', () => {
  // T6.3 moved the copy out of PrintCenter.jsx into t() keys — the page
  // renders print.how*, so check the rendered English copy, not the JSX
  // source, and check the page wires those keys.
  const page = readFileSync('src/pages/PrintCenter.jsx', 'utf8');
  for (const key of ['print.howBluetoothLead', 'print.howBluetoothBody', 'print.howWifiLead', 'print.howWifiBody', 'print.howEthernetLead', 'print.howEthernetBody', 'print.howUsbLead', 'print.howUsbBody', 'print.howCordsLead', 'print.howCordsBody', 'print.howOfflineLead', 'print.howOfflineBody', 'print.howIntro']) {
    assert.ok(page.includes(key), `PrintCenter is missing the help key: ${key}`);
  }
  const copy = readFileSync('src/lib/locales/en.js', 'utf8');
  // The four connections, by name.
  for (const word of ['Bluetooth', 'Wi-Fi', 'Ethernet', 'USB']) {
    assert.match(copy, new RegExp(word), `PrintCenter must document ${word}`);
  }
  // iOS Safari gap, stated plainly, with the mobile-app Bluetooth workaround.
  assert.match(copy, /does not work in iOS Safari/);
  assert.match(copy, /Bluetooth printing comes with the mobile\s+app/);
  // AirPrint: built in, no app code, same-Wi-Fi requirement.
  assert.match(copy, /AirPrint is built in/);
  assert.match(copy, /the app needs no AirPrint-specific code/);
  assert.match(copy, /must be on the same Wi-Fi/);
  // Cords serve iPhones one step removed.
  assert.match(copy, /shows up on your iPhone over the shop Wi-Fi/);
  // Ethernet is a desktop/computer path.
  assert.match(copy, /iPhones do not use Ethernet cords/);
  // Internet-drop resilience, honestly bounded.
  assert.match(copy, /If the internet drops,/);
  assert.match(copy, /Full offline mode[\s\S]*?is a separate, bigger build and is not claimed here/);
  // Gating: labels both plans, documents Business-only, whatever the connection.
  assert.match(copy, /Labels print on both plans/);
  assert.match(copy, /Packing slips, purchase\s+orders, supplier documents and reports are Business-only/);
  // The direct-print section is plan-free: no plan check gates Bluetooth/USB/labels.
  assert.doesNotMatch(page, /isEssentials.*printLabelsViaBluetooth|printLabelsViaBluetooth.*isEssentials/);
});

test('the same label generator prints a location/bin label as well as a product label', async () => {
  // Generic payload (owner design note Nov 9): a label is a title,
  // detail lines, and a code — a product label and a location label
  // are the same shape, so one generator serves both. The bin here
  // holds overstock Harry Potter books that do not fit on the aisle.
  const binLabel = locationToLabel({
    name: 'Bin B-12',
    room: 'Back stock room',
    contents: 'Harry Potter overstock',
    code: 'BIN-B-12',
  });
  assert.deepEqual(binLabel, {
    title: 'Bin B-12',
    lines: ['Back stock room', 'Harry Potter overstock'],
    code: 'BIN-B-12',
    codeType: 'CODE128',
  });
  // A product maps to the same shape, and a payload passes through.
  assert.deepEqual(toLabel(PRODUCT), {
    title: 'Cat Bookmark',
    lines: ['$9.00', 'SKU BM-001'],
    code: '9781234567890',
    codeType: 'CODE128',
  });
  assert.deepEqual(toLabel(binLabel), binLabel);

  // ESC/POS bytes: the bin label carries its title, lines, barcode
  // and code text — same machinery as the product label.
  const binBytes = escPosLabelsBytes([binLabel]);
  const binText = Buffer.from(binBytes).toString('latin1');
  assert.ok(binText.includes('Bin B-12'));
  assert.ok(binText.includes('Back stock room'));
  assert.ok(binText.includes('Harry Potter overstock'));
  assert.ok(binText.includes('{BBIN-B-12'));
  assert.ok(binText.includes('Code: BIN-B-12'));
  assert.deepEqual([...binBytes.slice(0, 2)], [0x1b, 0x40]);
  assert.deepEqual([...binBytes.slice(-3)], [0x1d, 0x56, 0x00]);

  // The same bin label streams over Bluetooth through the same send
  // path as a product label.
  const written = [];
  const characteristic = {
    properties: { writeWithoutResponse: true },
    writeValueWithoutResponse: async (chunk) => written.push(Buffer.from(chunk)),
  };
  const fakeBluetooth = {
    requestDevice: async () => ({
      name: 'Zebra ZD410',
      gatt: {
        connect: async () => ({
          getPrimaryServices: async () => [
            { getCharacteristics: async () => [characteristic] },
          ],
        }),
      },
    }),
  };
  await printLabelsViaBluetooth([binLabel], { bluetooth: fakeBluetooth });
  assert.ok(Buffer.concat(written).toString('latin1').includes('BIN-B-12'));

  // Client-side PDF: the bin label and the product label come out of
  // the same builder, no fetch, no server.
  const pdf = buildLabelsPdfBytes([PRODUCT, binLabel], { copies: 1, businessName: 'Test Shop' });
  const pdfText = Buffer.from(pdf).toString('latin1');
  assert.ok(pdfText.startsWith('%PDF-'));
  for (const needle of ['Cat Bookmark', '9781234567890', 'Bin B-12', 'BIN-B-12', 'Harry Potter overstock']) {
    assert.ok(pdfText.includes(needle), `labels PDF is missing ${needle}`);
  }
});

test('PrintCenter offers the client-side labels PDF and the server PDF', () => {
  const page = readFileSync('src/pages/PrintCenter.jsx', 'utf8');
  assert.match(page, /downloadLabelsPdf\(selected/);
  assert.match(page, /\/print\/labels\?product_ids=/);
  assert.match(page, /\/print\/po\?po_id=/);
  assert.match(page, /\/print\/packing-slip\?order_id=/);
});
