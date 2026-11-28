// Lesson visuals — the absence pins (release 360, Nov 23, 2026).
//
// This file pinned the visuals' PRESENCE from Nov 15, 2026: the
// lessons carried live embed-frame pictures of the app's own
// pages, one visual slot per step, rendered by StepVisual in the
// Training page. Release 360 (Nov 23, 2026) removed every visual
// at the owner's word — the lessons are words-only again — and
// the same file now pins their ABSENCE: no lesson carries a
// visuals property in either catalog, the catalog itself is
// untouched (107 lessons at 360, step counts intact; 114 since the restaurant operations batch (Nov 23, 2026) added its 4; 110 since
// the cross-store messages build added its three), the Training page
// renders no StepVisual, the component file is gone, and the
// embed guard in embedMode.js survives dormant (a framed document
// may still be a picture; nothing frames one anymore).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { TRAINING_LESSONS as CLIENT_LESSONS } from '../../src/lib/trainingCatalog.js';
import { TRAINING_LESSONS as SERVER_LESSONS } from '../../server/trainingCatalog.js';

test('no lesson carries a visuals property — client catalog or server catalog', () => {
  for (const lesson of CLIENT_LESSONS) {
    assert.ok(!('visuals' in lesson), `client: ${lesson.id} carries no visuals`);
    assert.equal(lesson.visuals, undefined, `client: ${lesson.id} visuals is undefined`);
  }
  for (const lesson of SERVER_LESSONS) {
    assert.ok(!('visuals' in lesson), `server: ${lesson.id} carries no visuals`);
    assert.equal(lesson.visuals, undefined, `server: ${lesson.id} visuals is undefined`);
  }
});

test('the catalog itself is untouched: 130 lessons (107 through 360; +3 cross-store messages lessons, +4 restaurant operations lessons, +1 eBay storefront lesson in 362, +1 log book lesson in 378, +1 record-prints lesson in the prints build, +1 age-check lesson in the age check build, +1 own-training lesson in the training build, +1 barcode-pool lesson in the barcode-pool build, +1 checklists lesson in the checklists build, +1 kitchen-menu lesson in the kitchen-menu build, +1 equipment lesson in the equipment build, +1 tip-pooling lesson in the tip-pooling build, +2 labor lessons in the labor-warnings build, +1 catering lesson in the catering build, +1 reservations lesson in the reservations build), spot step counts unchanged', () => {
  assert.equal(CLIENT_LESSONS.length, 137, 'client catalog holds 130 lessons');
  assert.equal(SERVER_LESSONS.length, 137, 'server catalog holds 130 lessons');
  // Release 365 (Nov 23, 2026) deliberately grew owner-import
  // 2 -> 4 steps: the lesson gained the column-marriage step and
  // the dry-run-promise step (the owner's import rulings).
  // Release 366 (Nov 24, 2026) grew it once more, 4 -> 5: the
  // photo truth step (photos arrive on their own; the Bring in
  // missing photos door). The other spot counts stand exactly
  // as 360 left them.
  const spot = { 'owner-import': 5, 'products-find-edit': 11, 'welcome-basics': 6 };
  for (const catalog of [CLIENT_LESSONS, SERVER_LESSONS]) {
    for (const [id, steps] of Object.entries(spot)) {
      const lesson = catalog.find((l) => l.id === id);
      assert.ok(lesson, `${id} still exists`);
      assert.equal(lesson.steps, steps, `${id}: step count unchanged`);
    }
  }
});

test('the Training page renders no StepVisual and names no visuals', () => {
  const training = readFileSync('src/pages/Training.jsx', 'utf8');
  assert.ok(!training.includes('StepVisual'), 'Training.jsx contains no StepVisual');
  assert.ok(!training.includes('visuals'), 'Training.jsx contains no visuals');
});

test('the StepVisual component does not exist', () => {
  assert.equal(existsSync('src/components/training/StepVisual.jsx'), false, 'StepVisual.jsx is gone');
});

test('the embed guard survives dormant in embedMode.js', () => {
  const embed = readFileSync('src/lib/embedMode.js', 'utf8');
  assert.ok(embed.includes('window.self === window.top'), 'the frame check is still there');
});
