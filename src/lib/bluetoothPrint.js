/**
 * Bluetooth label printing — T5 (plan §2.12 + owner refinement Nov 9).
 *
 * Web Bluetooth, direct from the app to the printer — no internet,
 * no server round-trip: the label bytes are generated client-side
 * (src/lib/escPos.js) from labels the page already has. A label is
 * a generic payload — { title, lines, code, codeType } — so a
 * location / bin label prints through exactly the same path as a
 * product label (src/lib/labelPayload.js).
 *
 * What works where:
 *  - Desktop Chrome / Edge: yes (Web Bluetooth).
 *  - Android Chrome: yes (Web Bluetooth).
 *  - iOS Safari: NO — Apple does not expose Web Bluetooth there.
 *    The website cannot print to a Bluetooth printer from an
 *    iPhone. The workaround is the native mobile app (CoreBluetooth)
 *    — a mobile-app feature, never presented as something the
 *    website does — or Wi-Fi / AirPrint. The UI says this plainly.
 *
 * Gating: the Bluetooth connection and label printing work on BOTH
 * plans — the connection is how you reach the printer; the plan
 * decides WHAT you may print (labels both plans, documents
 * Business-only). No plan check lives in this module.
 *
 * Pairing flow: the browser's own device picker (requestDevice) —
 * the owner picks the printer once per session; the app then finds
 * a writable GATT characteristic on it and streams the label bytes
 * in small chunks. If the printer offers no writable channel, the
 * error says so and points at the browser-print fallback.
 * Direct-printer behaviour is NOT verified against real hardware
 * here — that needs a live check with the owner and a real printer.
 */
import { escPosLabelsBytes } from './escPos.js';
import { t } from './i18n.js';

/** BLE services label printers commonly expose (Zebra / Brother / DYMO class). */
export const BLUETOOTH_PRINTER_SERVICES = [
  '6e400001-b5a3-f393-e0a9-e50e24dcca9e', // Nordic UART — used by many BLE printers
  '000018f0-0000-1000-8000-00805f9b34fb', // Immediate Alert service, used by some Zebra printers
  '0000ff00-0000-1000-8000-00805f9b34fb', // vendor serial service used by several label printers
  '49535343-fe7d-4ae5-8fa9-9fafd205e455', // HM-10 / serial module service
];

// Plain module-level t(): this copy is exported as a bare string — the print
// page renders it directly and the node tests match against it — so it cannot
// be a getter the way the label tables are. It resolves at import time.
export const BLUETOOTH_UNAVAILABLE_COPY = t('printLib.bluetoothUnavailable');

export const BLUETOOTH_NO_CHANNEL_COPY =
  'That printer did not offer a writable Bluetooth channel. Use the Print button instead — it prints through the printer installed on this computer.';

/** True when this browser can even ask for a Bluetooth device. */
export function bluetoothAvailable(bluetooth = globalThis.navigator?.bluetooth) {
  return Boolean(bluetooth && typeof bluetooth.requestDevice === 'function');
}

/** Pick a printer in the browser picker and open a writable channel to it. */
export async function connectBluetoothPrinter({ bluetooth = globalThis.navigator?.bluetooth } = {}) {
  if (!bluetoothAvailable(bluetooth)) throw new Error(BLUETOOTH_UNAVAILABLE_COPY);
  const device = await bluetooth.requestDevice({
    acceptAllDevices: true,
    optionalServices: BLUETOOTH_PRINTER_SERVICES,
  });
  const server = await device.gatt.connect();
  const services = await server.getPrimaryServices();
  for (const service of services) {
    const characteristics = await service.getCharacteristics();
    const writable = characteristics.find(
      (c) => c.properties.write || c.properties.writeWithoutResponse,
    );
    if (writable) return { device, server, characteristic: writable };
  }
  throw new Error(BLUETOOTH_NO_CHANNEL_COPY);
}

/**
 * Print labels to a Bluetooth printer. Picks the printer (browser
 * picker), streams the client-generated ESC/POS bytes, and returns
 * what was sent. Throws with plain-language copy on every failure
 * so the UI can offer the browser-print fallback.
 */
export async function printLabelsViaBluetooth(
  products,
  { bluetooth = globalThis.navigator?.bluetooth, copies = 1 } = {},
) {
  if (!products?.length) throw new Error('Choose at least one product to print.');
  const bytes = escPosLabelsBytes(products, copies);
  const { device, characteristic } = await connectBluetoothPrinter({ bluetooth });
  const chunk = 100; // BLE writes stay small; the printer re-assembles them.
  for (let i = 0; i < bytes.length; i += chunk) {
    const slice = bytes.slice(i, i + chunk);
    if (characteristic.properties.writeWithoutResponse) {
      await characteristic.writeValueWithoutResponse(slice);
    } else {
      await characteristic.writeValue(slice);
    }
  }
  return { deviceName: device?.name || 'Bluetooth printer', bytes: bytes.length };
}
