/**
 * The ISBN digits reader's engine room (owner ruling, Nov 19,
 * 2026). tesseract.js is loaded LAZILY and from the app's own
 * origin: the first tap on the ISBN button injects the engine's
 * API script from /ocr-assets/ (server/ocrAssets.js), and its
 * worker, core and English language data come from the same
 * place — no CDN, and nothing is fetched or bundled until the
 * feature is actually used.
 *
 * Recognition is fenced in twice: the engine only ever reports
 * digits and X (a whitelist), on a single printed line; and the
 * result still has to pass the ISBN check digit in
 * src/lib/isbn.js before anything is filled in. Any failure —
 * engine unavailable, nothing read, checksum disagrees — comes
 * back as { valid: false } and the caller shows the plain
 * try-again-or-type message. This module never throws.
 */
import { extractIsbn } from '@/lib/isbn';

let apiPromise = null;

function loadTesseractApi() {
  if (typeof window !== 'undefined' && window.Tesseract?.createWorker) {
    return Promise.resolve(window.Tesseract);
  }
  if (!apiPromise) {
    apiPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = '/ocr-assets/tesseract.min.js';
      script.async = true;
      script.onload = () => {
        if (window.Tesseract?.createWorker) resolve(window.Tesseract);
        else reject(new Error('tesseract api unavailable'));
      };
      script.onerror = () => reject(new Error('tesseract api failed to load'));
      document.head.appendChild(script);
    });
    // A failed load must not poison the session: the next tap
    // tries again from the top.
    apiPromise.catch(() => { apiPromise = null; });
  }
  return apiPromise;
}

let workerPromise = null;

async function getWorker() {
  if (!workerPromise) {
    workerPromise = (async () => {
      const { createWorker, OEM, PSM } = await loadTesseractApi();
      const worker = await createWorker('eng', OEM.LSTM_ONLY, {
        workerPath: '/ocr-assets/worker.min.js',
        corePath: '/ocr-assets',
        langPath: '/ocr-assets',
        gzip: true,
        cacheMethod: 'none',
        logger: () => {},
      });
      await worker.setParameters({
        tessedit_char_whitelist: '0123456789X',
        tessedit_pageseg_mode: PSM.SINGLE_LINE,
      });
      return worker;
    })();
    workerPromise.catch(() => { workerPromise = null; });
  }
  return workerPromise;
}

/**
 * Read the printed ISBN digits in an image (a canvas captured
 * from the camera). Resolves { isbn, valid } — isbn is filled
 * only when valid is true.
 */
export async function readIsbnFromImage(image) {
  try {
    const worker = await getWorker();
    const { data } = await worker.recognize(image);
    return extractIsbn(data?.text || '');
  } catch {
    return { isbn: '', valid: false };
  }
}
