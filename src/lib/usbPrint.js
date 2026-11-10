/**
 * USB label printing — T5 (plan §2.12 + owner addition Nov 9).
 *
 * Four connections total: Bluetooth, Wi-Fi, Ethernet, USB. USB works
 * like this, per device:
 *
 *  - DESKTOP (website): a USB printer plugged into the computer is
 *    an OS-installed printer — the app prints through the browser
 *    print dialog. That already works; no code beyond the dialog.
 *  - ANDROID phone: USB OTG — the website can use the WebUSB API
 *    (Android Chrome) to talk straight to the printer. This module
 *    is that path: the browser's device picker, then the
 *    client-generated ESC/POS label bytes (src/lib/escPos.js) sent
 *    over a bulk OUT endpoint. No internet, no server round-trip.
 *    A label is a generic payload — { title, lines, code, codeType }
 *    — so a location / bin label prints through exactly the same
 *    path as a product label (src/lib/labelPayload.js).
 *  - iPHONE: direct USB printing is NOT supported — iOS has no
 *    WebUSB and gives apps no raw USB access to printers. The
 *    workaround is Wi-Fi / AirPrint, or Bluetooth from the native
 *    mobile app (CoreBluetooth). The UI says this plainly.
 *
 * Gating: same as Bluetooth — USB label printing works on BOTH
 * plans; the plan decides WHAT you may print (labels both plans,
 * documents Business-only). No plan check lives in this module.
 *
 * Direct-printer behaviour is NOT verified against real hardware
 * here — that needs a live check with the owner and a real printer.
 */
import { escPosLabelsBytes } from './escPos.js';

export const USB_UNAVAILABLE_COPY =
  'USB printing from the website needs Android Chrome and a USB OTG cable. On a desktop, plug the printer into the computer and use the Print button — it prints through the printer installed there. iPhones cannot print over USB directly — use Wi-Fi with AirPrint, or Bluetooth from the mobile app (coming with the mobile app).';

export const USB_NO_ENDPOINT_COPY =
  'That printer did not offer a USB channel the browser can write to. Use the Print button instead — it prints through the printer installed on this computer.';

/** True when this browser can even ask for a USB device. */
export function usbAvailable(usb = globalThis.navigator?.usb) {
  return Boolean(usb && typeof usb.requestDevice === 'function');
}

function findBulkOutEndpoint(device) {
  const interfaces = device.configuration?.interfaces || [];
  for (const iface of interfaces) {
    for (const alternate of iface.alternates || []) {
      const endpoint = (alternate.endpoints || []).find(
        (ep) => ep.direction === 'out' && ep.type === 'bulk',
      );
      if (endpoint) return { interfaceNumber: iface.interfaceNumber, endpointNumber: endpoint.endpointNumber };
    }
  }
  return null;
}

/**
 * Print labels to a USB printer (Android WebUSB). Picks the printer
 * (browser picker), claims the interface, streams the
 * client-generated ESC/POS bytes, and returns what was sent.
 */
export async function printLabelsViaUsb(
  products,
  { usb = globalThis.navigator?.usb, copies = 1 } = {},
) {
  if (!products?.length) throw new Error('Choose at least one product to print.');
  if (!usbAvailable(usb)) throw new Error(USB_UNAVAILABLE_COPY);
  const bytes = escPosLabelsBytes(products, copies);
  const device = await usb.requestDevice({ filters: [] });
  await device.open();
  if (device.configuration === null) await device.selectConfiguration(1);
  const channel = findBulkOutEndpoint(device);
  if (!channel) throw new Error(USB_NO_ENDPOINT_COPY);
  await device.claimInterface(channel.interfaceNumber);
  const chunk = 512;
  for (let i = 0; i < bytes.length; i += chunk) {
    await device.transferOut(channel.endpointNumber, bytes.slice(i, i + chunk));
  }
  return { deviceName: device.productName || 'USB printer', bytes: bytes.length };
}
