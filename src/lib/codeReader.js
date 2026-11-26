import { BrowserMultiFormatReader } from '@zxing/browser';
import { BarcodeFormat, DecodeHintType } from '@zxing/library';
import { readSupplementFromCanvas } from './supplementReader.js';
import { readUpceFromCanvas } from './upceReader.js';

/**
 * Everything the universal scanner tries to decode, in one pass.
 * QR codes are listed first so the JavaScript decoder attempts them before
 * the slower one-dimensional readers.
 *
 * Coverage completed Nov 25, 2026 on the owner's ruling ("it should scan
 * anything"): PDF417, Code 93 and GS1 DataBar (RSS_14) join the original
 * eleven — every standalone symbology either engine can read. Two formats
 * stay OFF on evidence, not oversight: RSS_EXPANDED (the library itself
 * warns its reader is not production-ready, and a confident wrong number
 * is the worst failure this app can make) and MAXICODE (named in the
 * library's enum but never ported — no reader exists to switch on).
 * EAN-5/EAN-2 supplements are not standalone codes in either engine;
 * the hand-built supplement pass (supplementReader.js, the owner's
 * build-it-ourselves ruling) reads one standing alone, and only after
 * the main decode found nothing — a frame holding a main code behaves
 * exactly as it always has.
 * UPC-E is the mirror case: a real standalone code the native engine
 * reads but the library's fallback cannot (its UPC-E decode is broken
 * inside the library itself — pinned at the coverage build); the
 * hand-built UPC-E pass (upceReader.js, the owner's repair ruling)
 * fixes the fallback, returning the symbol's UPC-A expansion, and
 * likewise runs only after the main decode found nothing.
 */
export const ZXING_FORMATS = [
  BarcodeFormat.QR_CODE,
  BarcodeFormat.DATA_MATRIX,
  BarcodeFormat.AZTEC,
  BarcodeFormat.PDF_417,
  BarcodeFormat.UPC_A,
  BarcodeFormat.UPC_E,
  BarcodeFormat.EAN_13,
  BarcodeFormat.EAN_8,
  BarcodeFormat.CODE_128,
  BarcodeFormat.CODE_39,
  BarcodeFormat.CODE_93,
  BarcodeFormat.ITF,
  BarcodeFormat.CODABAR,
  BarcodeFormat.RSS_14,
];

export const NATIVE_FORMATS = [
  'qr_code',
  'data_matrix',
  'aztec',
  'pdf417',
  'upc_a',
  'upc_e',
  'ean_13',
  'ean_8',
  'code_128',
  'code_39',
  'code_93',
  'itf',
  'codabar',
];

/**
 * Builds the single decoder used for every code type. Android and iOS browsers
 * expose BarcodeDetector, which reads QR codes far more reliably than the
 * JavaScript decoder; when it is missing or cannot handle QR we fall back to
 * ZXing with QR explicitly registered.
 */
export async function createCodeReader() {
  if (typeof window !== 'undefined' && typeof window.BarcodeDetector === 'function') {
    try {
      const supported = await window.BarcodeDetector.getSupportedFormats();
      const formats = NATIVE_FORMATS.filter((format) => supported.includes(format));
      if (formats.includes('qr_code')) {
        const detector = new window.BarcodeDetector({ formats });
        return {
          engine: 'native',
          async read(canvas) {
            const codes = await detector.detect(canvas);
            if (codes.length) return String(codes[0].rawValue || '');
            // The native API has no supplement format at all, so a
            // lone EAN-5/EAN-2 strip falls through to the hand-built
            // pass rather than being stranded by the engine choice.
            return readSupplementFromCanvas(canvas);
          },
        };
      }
    } catch {
      // Fall through to the JavaScript decoder below.
    }
  }

  const hints = new Map();
  hints.set(DecodeHintType.POSSIBLE_FORMATS, ZXING_FORMATS);
  hints.set(DecodeHintType.TRY_HARDER, true);
  const reader = new BrowserMultiFormatReader(hints);

  return {
    engine: 'zxing',
    async read(canvas) {
      try {
        return reader.decodeFromCanvas(canvas).getText();
      } catch {
        // The main decode found nothing: only now may our own UPC-E
        // pass and the standalone supplement speak, so combined
        // frames keep their main code. UPC-E first — it is a whole
        // product code; a supplement only ever names a price.
        return readUpceFromCanvas(canvas) ?? readSupplementFromCanvas(canvas);
      }
    },
  };
}

/**
 * Returns a function that copies the current video frame onto a reusable
 * canvas, optionally cropped to the centre where the code is being held.
 */
export function createFrameGrabber(maxSize = 1280) {
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d', { willReadFrequently: true });

  return function grab(video, crop = 1) {
    const width = video.videoWidth;
    const height = video.videoHeight;
    if (!context || !width || !height) return null;

    const cropWidth = Math.round(width * crop);
    const cropHeight = Math.round(height * crop);
    const scale = Math.min(maxSize / cropWidth, maxSize / cropHeight, 2);

    canvas.width = Math.max(1, Math.round(cropWidth * scale));
    canvas.height = Math.max(1, Math.round(cropHeight * scale));
    context.drawImage(
      video,
      Math.round((width - cropWidth) / 2),
      Math.round((height - cropHeight) / 2),
      cropWidth,
      cropHeight,
      0,
      0,
      canvas.width,
      canvas.height
    );
    return canvas;
  };
}