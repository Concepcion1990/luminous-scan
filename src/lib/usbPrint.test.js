/**
 * T5 — USB printing, client-side (no hardware).
 *
 * WebUSB availability detection + fallback, label bytes over a USB
 * bulk OUT endpoint, and the PrintCenter copy that states the iPhone
 * USB gap plainly. Direct-printer behaviour against real hardware
 * is NOT verified here — that needs a live check with the owner.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  usbAvailable,
  USB_UNAVAILABLE_COPY,
  USB_NO_ENDPOINT_COPY,
  printLabelsViaUsb,
} from './usbPrint.js';
import { escPosLabelsBytes } from './escPos.js';

const PRODUCT = { id: 'p1', name: 'Cat Bookmark', sku: 'BM-001', barcode: '9781234567890', price: 9 };

test('usbAvailable detects WebUSB and its absence', () => {
  assert.equal(usbAvailable({ requestDevice: async () => ({}) }), true);
  assert.equal(usbAvailable({}), false);
  assert.equal(usbAvailable(undefined), false);
  assert.equal(usbAvailable(null), false);
});

test('the unavailable copy names Android OTG, desktop, and the iPhone gap', () => {
  assert.match(USB_UNAVAILABLE_COPY, /Android Chrome/);
  assert.match(USB_UNAVAILABLE_COPY, /USB OTG/);
  assert.match(USB_UNAVAILABLE_COPY, /plug the printer into the computer/);
  assert.match(USB_UNAVAILABLE_COPY, /iPhones cannot print over USB directly/);
  assert.match(USB_UNAVAILABLE_COPY, /AirPrint/);
});

test('printLabelsViaUsb streams ESC/POS bytes over a bulk OUT endpoint', async () => {
  const transfers = [];
  const device = {
    productName: 'Brother QL-820NWB',
    configuration: {
      interfaces: [
        {
          interfaceNumber: 0,
          alternates: [
            { endpoints: [{ direction: 'out', type: 'bulk', endpointNumber: 2 }] },
          ],
        },
      ],
    },
    open: async () => {},
    claimInterface: async (n) => {
      assert.equal(n, 0);
    },
    transferOut: async (endpoint, data) => {
      assert.equal(endpoint, 2);
      transfers.push(Buffer.from(data));
      return { status: 'ok' };
    },
  };
  const fakeUsb = { requestDevice: async () => device };
  const result = await printLabelsViaUsb([PRODUCT], { usb: fakeUsb, copies: 1 });
  assert.equal(result.deviceName, 'Brother QL-820NWB');
  const sent = Buffer.concat(transfers);
  assert.deepEqual(sent, Buffer.from(escPosLabelsBytes([PRODUCT], 1)));
  assert.deepEqual([...sent.slice(0, 2)], [0x1b, 0x40]);
});

test('USB printing selects a configuration when none is active', async () => {
  let selected = null;
  const device = {
    productName: 'DYMO LabelWriter',
    configuration: null,
    open: async () => {},
    selectConfiguration: async (n) => {
      selected = n;
      device.configuration = {
        interfaces: [
          {
            interfaceNumber: 1,
            alternates: [{ endpoints: [{ direction: 'out', type: 'bulk', endpointNumber: 1 }] }],
          },
        ],
      };
    },
    claimInterface: async () => {},
    transferOut: async () => ({ status: 'ok' }),
  };
  await printLabelsViaUsb([PRODUCT], { usb: { requestDevice: async () => device } });
  assert.equal(selected, 1);
});

test('USB printing fails closed with plain copy when unavailable', async () => {
  await assert.rejects(
    printLabelsViaUsb([PRODUCT], { usb: {} }),
    (error) => error.message === USB_UNAVAILABLE_COPY,
  );
});

test('a printer with no bulk OUT endpoint is refused with the fallback copy', async () => {
  const device = {
    productName: 'No Endpoint Printer',
    configuration: {
      interfaces: [
        { interfaceNumber: 0, alternates: [{ endpoints: [{ direction: 'in', type: 'bulk', endpointNumber: 1 }] }] },
      ],
    },
    open: async () => {},
    claimInterface: async () => {},
    transferOut: async () => ({ status: 'ok' }),
  };
  await assert.rejects(
    printLabelsViaUsb([PRODUCT], { usb: { requestDevice: async () => device } }),
    (error) => error.message === USB_NO_ENDPOINT_COPY,
  );
});

test('PrintCenter USB copy states the desktop path and the iPhone gap', () => {
  // T6.3 moved the copy out of PrintCenter.jsx into t() keys — check the
  // rendered English copy (print.howUsbBody) and that the page wires it.
  const page = readFileSync('src/pages/PrintCenter.jsx', 'utf8');
  assert.ok(page.includes('print.howUsbBody'), 'PrintCenter is missing the USB help key');
  const copy = readFileSync('src/lib/locales/en.js', 'utf8');
  assert.match(copy, /Plug the printer into the\s+computer with its cord/);
  assert.match(copy, /On an Android phone with a USB OTG cable/);
  assert.match(copy, /iPhones cannot print over USB directly/);
  assert.match(copy, /USB button above talks straight to\s+the printer/);
});
