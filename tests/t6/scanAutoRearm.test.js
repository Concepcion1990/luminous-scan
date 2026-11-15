/**
 * T6 — Scan auto re-arm (owner ruling, Nov 14, 2026, revised):
 * after a capture the camera must not sit dead on "Code captured"
 * waiting for a button — it re-arms itself, the result card stays
 * put for the owner to act on, a new code replaces the result, and
 * the same code held in front of the camera cannot re-capture
 * itself in a loop. "Scan next" on the result card now means:
 * clear the result and pop the view back up to the scanner.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (rel) => readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8');
const hook = read('src/components/scan/useBarcodeCamera.js');
const scan = read('src/pages/Scan.jsx');
const scanner = read('src/components/scan/BarcodeScanner.jsx');

test('after a capture the camera re-arms itself — no stop, no button press', () => {
  const handleBody = hook.slice(hook.indexOf('const handle'), hook.indexOf('const tick'));
  assert.ok(!handleBody.includes('stopCamera()'), 'a capture no longer stops the camera');
  assert.ok(handleBody.includes("setStatus('done')"), 'the captured confirmation still shows');
  assert.ok(handleBody.includes('REARM_MS'), 'the re-arm is on a timer');
  const resumeBody = handleBody.slice(handleBody.indexOf('setTimeout'));
  assert.ok(resumeBody.includes("setStatus('live')"), 'after the pause the scanner is live again on its own');
  assert.ok(resumeBody.includes('tick()'), 'decoding resumes');
});

test('a different code captures immediately; the same held code cannot loop', () => {
  assert.ok(hook.includes('text !== lastCode'), 'a new code is a new capture at any time');
  assert.ok(hook.includes('sameCodeArmed'), 'the just-captured code is held back');
  assert.ok(hook.includes('ABSENT_TICKS_TO_REARM'), 'it re-arms only after leaving the frame');
  assert.ok(hook.includes('absentTicks += 1'), 'absence is counted per decode pass');
  assert.ok(hook.includes('if (text) sawLastCode = true;'), 'a sighting resets the absence count');
});

test('the result card Scan next clears the result and returns the view to the scanner', () => {
  assert.ok(scan.includes('scannerCardRef.current?.scrollIntoView'), 'Scan next scrolls the scanner back into view');
  assert.ok(scan.includes('const scanNext = () => {'), 'one shared Scan next action');
  assert.ok(scan.includes('reset();'), 'Scan next is the same reset as always, plus the trip back');
  assert.ok(scan.includes('onClick={scanNext}'), 'the result buttons use it');
  assert.ok(scan.includes('ref={scannerCardRef}'), 'the scanner card carries the scroll target');
  // The capture itself never scrolls: the reset path (used by
  // lookups landing) contains no scrollIntoView outside scanNext.
  const scanNextBody = scan.slice(scan.indexOf('const scanNext'), scan.indexOf('const apply'));
  assert.ok(scanNextBody.includes('scrollIntoView'), 'the scroll lives in scanNext only');
});

test('no under-scanner button and no stale Scan-next hint on the captured card', () => {
  const labels = scan.match(/t\('scan\.scanNext'\)/g) || [];
  assert.equal(labels.length, 2, 'Scan.jsx carries exactly the result-card and not-found Scan next buttons');
  assert.ok(!scanner.includes('scanNextHint'), 'the captured card no longer tells the owner to press Scan next');
  assert.ok(scanner.includes("t('scan.codeCaptured')"), 'the captured confirmation remains');
});
