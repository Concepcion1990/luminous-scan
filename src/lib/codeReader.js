import { BrowserMultiFormatReader } from '@zxing/browser';
import { BarcodeFormat, DecodeHintType } from '@zxing/library';

/**
 * Everything the universal scanner tries to decode, in one pass.
 * QR codes are listed first so the JavaScript decoder attempts them before
 * the slower one-dimensional readers.
 */
const ZXING_FORMATS = [
  BarcodeFormat.QR_CODE,
  BarcodeFormat.DATA_MATRIX,
  BarcodeFormat.AZTEC,
  BarcodeFormat.UPC_A,
  BarcodeFormat.UPC_E,
  BarcodeFormat.EAN_13,
  BarcodeFormat.EAN_8,
  BarcodeFormat.CODE_128,
  BarcodeFormat.CODE_39,
  BarcodeFormat.ITF,
  BarcodeFormat.CODABAR,
];

const NATIVE_FORMATS = [
  'qr_code',
  'data_matrix',
  'aztec',
  'upc_a',
  'upc_e',
  'ean_13',
  'ean_8',
  'code_128',
  'code_39',
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
            return codes.length ? String(codes[0].rawValue || '') : null;
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
        return null;
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