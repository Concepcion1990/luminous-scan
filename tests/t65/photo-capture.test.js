/**
 * The photo capture batch (Nov 24, 2026) — "Take a photo" opens
 * a real camera (diagnosis ~/workspace/diagnosis-photo-camera/
 * report.md).
 *
 * THE DEFECT: the product form's "Take a photo" button clicked a
 * hidden `<input type="file" capture="environment">`. The
 * `capture` attribute is a mobile-only hint — desktop browsers
 * ignore it and open the ordinary file picker, so on a laptop
 * the button promised a camera and delivered a file browser.
 *
 * THE FIX: where the browser can open a live camera, the button
 * opens the PhotoCapture overlay (live preview, shutter, Retake /
 * Use this photo) and a used photo feeds the SAME addPhotos
 * pipeline a picked file takes — the upload and the owner's
 * photo-approval flow (release 335) never change. Where no live
 * camera can open, the capture input remains the door: the
 * native camera on phones, the picker where no camera exists.
 *
 * WHAT IS PROVEN WHERE (the diagnosis's own split): the door
 * decision, the failure mapping and the captured-File conversion
 * are pure logic and are proven here by execution. The live
 * camera itself cannot be exercised headlessly (no webcam —
 * the same caveat as the scanner and voice harnesses), so the
 * overlay's wiring is pinned by source and the by-hand proof
 * joins the owner's combined hand-test pass.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LOCALES } from '../../src/lib/i18n.js';
import { en } from '../../src/lib/locales/en.js';
import {
  photoDoorDecision,
  classifyCameraError,
  capturedPhotoFile,
} from '../../src/lib/photoCapture.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(here, '../..');
const read = (rel) => readFileSync(path.join(repoRoot, rel), 'utf8');
const dialog = read('src/components/products/ProductFormDialog.jsx');
const capture = read('src/components/scan/PhotoCapture.jsx');
const hook = read('src/components/scan/usePhotoCamera.js');

test('door decision: a browser that can open a camera gets the overlay', () => {
  assert.equal(photoDoorDecision({ getUserMedia: () => {} }), 'camera');
  assert.equal(photoDoorDecision({ getUserMedia: async () => {} }), 'camera');
});

test('door decision: no camera API falls back to the capture input, never a dead end', () => {
  assert.equal(photoDoorDecision(undefined), 'fallback');
  assert.equal(photoDoorDecision(null), 'fallback');
  assert.equal(photoDoorDecision({}), 'fallback');
  assert.equal(photoDoorDecision({ getUserMedia: 'not-a-function' }), 'fallback');
});

test('failure mapping: every camera failure classifies, and every class has the gallery exit', () => {
  assert.equal(classifyCameraError({ name: 'NotAllowedError' }), 'denied');
  assert.equal(classifyCameraError({ name: 'SecurityError' }), 'denied');
  assert.equal(classifyCameraError({ name: 'NotFoundError' }), 'no-camera');
  assert.equal(classifyCameraError({ name: 'OverconstrainedError' }), 'no-camera');
  assert.equal(classifyCameraError({ name: 'NotReadableError' }), 'failed');
  assert.equal(classifyCameraError(new Error('boom')), 'failed');
  assert.equal(classifyCameraError(null), 'failed');
  assert.equal(classifyCameraError(undefined), 'failed');
  // The overlay answers EVERY error state with the failure line
  // and the gallery door — no class can strand the user.
  assert.ok(capture.includes("status === 'error'"), 'the overlay has an error state');
  assert.ok(capture.includes("t('photoCapture.unavailable')"), 'the error state speaks the photo failure line');
  assert.ok(capture.includes('onUseGallery'), 'the error state offers the gallery door');
  assert.ok(capture.includes("t('productForm.chooseFromGallery')"), 'the gallery exit uses the existing gallery string');
  // And the hook routes its failures through the classifier.
  assert.ok(hook.includes('classifyCameraError(error)'), 'the hook classifies getUserMedia failures');
  assert.ok(hook.includes("setFailure('no-api')"), 'the no-API case lands in the same error state');
});

test('captured frame: the blob becomes a JPEG File the upload gate accepts', async () => {
  const blob = new Blob(['fake-jpeg-bytes'], { type: 'image/jpeg' });
  const file = capturedPhotoFile(blob, new Date('2026-11-24T17:00:00.000Z'));
  assert.ok(file instanceof File);
  assert.equal(file.type, 'image/jpeg');
  assert.match(file.name, /^photo-2026-11-24T17-00-00-000Z\.jpg$/);
  assert.equal(file.size, blob.size);
  // addPhotos' only client-side refusal is a non-image file —
  // the captured still passes it by construction.
  assert.ok(file.type.startsWith('image/'), 'passes the addPhotos image gate');
  assert.equal(await file.text(), 'fake-jpeg-bytes');
});

test('captured frame: no blob, no phantom file', () => {
  assert.equal(capturedPhotoFile(null), null);
  assert.equal(capturedPhotoFile(undefined), null);
});

test('the dialog: Take a photo consults the door decision before opening anything', () => {
  assert.ok(
    dialog.includes("import PhotoCapture from '@/components/scan/PhotoCapture';"),
    'the dialog mounts the photo overlay',
  );
  assert.ok(
    dialog.includes("import { photoDoorDecision } from '@/lib/photoCapture';"),
    'the dialog uses the pinned decision helper',
  );
  assert.ok(
    dialog.includes("photoDoorDecision(navigator.mediaDevices) === 'camera'"),
    'the camera choice opens the overlay only when a live camera can open',
  );
  assert.ok(dialog.includes('setPhotoCaptureOpen(true)'), 'the overlay state opens');
  // The fallback door survives untouched: the capture input with
  // its own ref, still feeding the same pipeline.
  assert.ok(dialog.includes('capture="environment"'), 'the capture input remains the fallback door');
  assert.ok(dialog.includes('ref={cameraFileRef}'), 'the fallback input keeps its ref');
  const addPhotoCalls = dialog.match(/addPhotos\(Array\.from\(event\.target\.files \|\| \[\]\)\)/g) || [];
  assert.equal(addPhotoCalls.length, 2, 'camera-input and gallery files still go through the same addPhotos pipeline');
});

test('the dialog: a used photo lands in addPhotos exactly like a picked file', () => {
  assert.ok(dialog.includes('onCapture={(file) => {'), 'the overlay hands back the captured file');
  assert.ok(dialog.includes('addPhotos([file]);'), 'the captured file feeds the same pipeline, unchanged');
  assert.ok(
    dialog.includes('onUseGallery={() => {'),
    'the gallery exit is wired',
  );
  assert.ok(
    dialog.includes('fileRef.current?.click();'),
    'the gallery exit opens the gallery input',
  );
  // Same in-dialog shell as the scanner and ISBN overlays: the
  // half-filled form never unmounts.
  const mount = dialog.slice(dialog.indexOf('{photoCaptureOpen &&'));
  assert.ok(mount.includes('fixed inset-0 z-[70]'), 'the photo overlay uses the in-dialog shell');
  assert.ok(mount.includes("t('productForm.cancel')"), 'the overlay keeps the dialog Cancel door');
});

test('the overlay: live preview, full-frame shutter, retake and use', () => {
  assert.ok(capture.includes('usePhotoCamera()'), 'the overlay drives the photo camera hook');
  assert.ok(capture.includes('canvas.width = video.videoWidth'), 'the shutter grabs the full frame width');
  assert.ok(capture.includes('canvas.height = video.videoHeight'), 'the shutter grabs the full frame height');
  assert.ok(capture.includes('canvas.toBlob('), 'the still is produced through toBlob');
  assert.ok(capture.includes("'image/jpeg'"), 'the still is encoded as JPEG');
  assert.ok(capture.includes('capturedPhotoFile(still?.blob)'), 'Use this photo converts through the pinned helper');
  assert.ok(capture.includes("t('photoCapture.shutter')"), 'the shutter speaks its own string');
  assert.ok(capture.includes("t('photoCapture.retake')"), 'Retake speaks its own string');
  assert.ok(capture.includes("t('photoCapture.usePhoto')"), 'Use this photo speaks its own string');
  assert.ok(capture.includes("t('scan.startingCamera')"), 'the starting state reuses the scanner string');
  assert.ok(capture.includes("t('scan.cameraUnavailable')"), 'the error heading reuses the scanner string');
  assert.ok(capture.includes('URL.revokeObjectURL'), 'preview object URLs are revoked, never leaked');
});

test('the hook: the scanner skeleton without the decode loop, tracks stopped on unmount', () => {
  assert.ok(hook.includes('navigator.mediaDevices.getUserMedia'), 'the hook opens the camera');
  assert.ok(hook.includes("facingMode: { ideal: 'environment' }"), 'the rear camera is preferred, like the scanner');
  assert.ok(hook.includes('stream?.getTracks().forEach((track) => track.stop())'), 'every track stops on the exit path');
  assert.ok(!hook.includes('createCodeReader'), 'no decode loop rides along');
  assert.ok(!hook.includes('createFrameGrabber'), 'no frame grabber rides along');
});

test('strings: the four photo-capture keys exist in English and in every one of the 52 locales', () => {
  const keys = [
    'photoCapture.shutter',
    'photoCapture.retake',
    'photoCapture.usePhoto',
    'photoCapture.unavailable',
  ];
  assert.equal(Object.keys(en).length, 5812, 'the keyset stands at 5812');
  assert.equal(en['photoCapture.shutter'], 'Take the photo');
  assert.equal(en['photoCapture.retake'], 'Retake');
  assert.equal(en['photoCapture.usePhoto'], 'Use this photo');
  assert.equal(
    en['photoCapture.unavailable'],
    'The camera could not be used here — choose a photo from your gallery instead.',
  );
  for (const [code, dict] of Object.entries(LOCALES)) {
    assert.equal(Object.keys(dict).length, 5812, `${code} keyset`);
    for (const key of keys) {
      assert.ok(dict[key], `${code} missing ${key}`);
      // Genuinely translated: outside the English variants, no
      // value may sit byte-identical to the English (the t20
      // debt rule, applied to this batch's keys).
      if (!code.startsWith('en')) {
        assert.notEqual(dict[key], en[key], `${code} ${key} is untranslated English`);
      }
    }
  }
});
