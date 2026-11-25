/**
 * Photo capture — the pure decisions behind the "Take a photo"
 * door (diagnosis ~/workspace/diagnosis-photo-camera/report.md).
 *
 * The product form's camera button used to click a hidden
 * `<input type="file" capture="environment">`. The `capture`
 * attribute is a mobile-only hint: desktop browsers ignore it and
 * open the ordinary file picker, so on a laptop the button
 * promised a camera and delivered a file browser. The live door
 * is the PhotoCapture overlay (getUserMedia); the capture input
 * stays as the fallback where no live camera can open.
 *
 * These helpers are deliberately free of DOM and React so the
 * door's decisions are testable without a camera (tests/t65):
 * which door opens, how a camera failure is classified, and how
 * a captured frame becomes the File the upload pipeline accepts.
 */

/**
 * The door decision: 'camera' when the browser can open a live
 * camera (the overlay), 'fallback' when it cannot (the existing
 * capture input — the native camera on phones, the file picker
 * where the device has no camera at all). Never anything else:
 * there is no third door and no dead end.
 */
export function photoDoorDecision(mediaDevices) {
  return typeof mediaDevices?.getUserMedia === 'function' ? 'camera' : 'fallback';
}

/**
 * Classify a getUserMedia failure. Every class resolves to the
 * same graceful exit in the overlay — the photo-context failure
 * line plus the gallery door — but the classes are named so the
 * mapping is pinned by test and no failure can strand the user
 * on an error card:
 *   'denied'    — permission refused (NotAllowedError/SecurityError)
 *   'no-camera' — no camera on the device (NotFoundError/
 *                 OverconstrainedError; the common desktop case)
 *   'failed'    — anything else (camera busy, start failure, …)
 */
export function classifyCameraError(error) {
  const name = error?.name || '';
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'denied';
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'no-camera';
  return 'failed';
}

/**
 * Wrap a captured JPEG frame as the File the photo pipeline
 * takes. addPhotos' only client-side gate is
 * `file.type.startsWith('image/')`, and UploadPublicFile
 * downscales/re-encodes whatever it is handed — so a webcam
 * still needs no other preparation. Returns null for no blob,
 * so a failed grab can never hand the pipeline a phantom file.
 */
export function capturedPhotoFile(blob, now = new Date()) {
  if (!blob) return null;
  const stamp = now.toISOString().replace(/[:.]/g, '-');
  return new File([blob], `photo-${stamp}.jpg`, { type: 'image/jpeg' });
}
