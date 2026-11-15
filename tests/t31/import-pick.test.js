// Extension 1 (Nov 15, 2026): import preview pagination +
// pick-and-choose. Pins: every preview paginates through the
// shared pager, every importable row carries a tick box, the
// selection lives in each workbench (persisted in the draft),
// the dry-run signature covers the selection, and each commit
// writes only the ticked rows. Create judges the plan cap on
// the TICKED count and refuses — in plain words — past the room.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(p, 'utf8');

test('the shared pager speaks in pages and counts what renders', () => {
  const pager = read('src/components/import/ImportPager.jsx');
  assert.match(pager, /IMPORT_PAGE_SIZE = 25/);
  assert.match(pager, /t\('import\.pageOf', \{ page: page \+ 1, pages \}\)/);
  assert.match(pager, /import\.showingChangesRange/);
  assert.match(pager, /import\.showingRange/);
  assert.match(pager, /if \(pages <= 1\) return null/);
  assert.match(pager, /export function pageSlice/);
});

for (const [name, file] of [
  ['Create preview', 'src/components/import/ImportPreview.jsx'],
  ['Receive preview', 'src/components/import/ReceivePreview.jsx'],
  ['Update preview', 'src/components/import/UpdatePreview.jsx'],
]) {
  test(`${name}: paginated, tick boxes on importable rows, truthful counts`, () => {
    const src = read(file);
    assert.match(src, /pageSlice\(/);
    assert.match(src, /<ImportPager/);
    assert.match(src, /type="checkbox"/);
    assert.match(src, /import\.selectRowAria/);
    assert.match(src, /import\.rowsSelected/);
    assert.ok(!src.includes('showingFirst'), 'the old "first N" caption is gone');
    assert.ok(!src.includes('PREVIEW_ROWS') && !src.includes('PREVIEW_CHANGES'), 'no fixed slice remains');
  });
}

test('Create: selection-aware cap, dry-run gate covers the ticks, commit takes ticked only', () => {
  const wb = read('src/components/import/ImportWorkbench.jsx');
  assert.match(wb, /const \[excluded, setExcluded\] = useState\(\[\]\)/);
  assert.match(wb, /excluded,\n  \};/); // persisted in the draft snapshot
  assert.match(wb, /const overRoom = capInfo\.room != null \? Math\.max\(0, effectiveReady - capInfo\.room\) : 0/);
  assert.match(wb, /import\.tickedOverRoom/);
  assert.match(wb, /const valid = tickedReadyRows;/);
  assert.match(wb, /!effectiveReady \|\| overRoom > 0/);
  // The dry-run signature carries the selection: unticking after
  // a passed check makes the verdict stale.
  assert.match(wb, /\[\.\.\.excluded\]\.sort\(\(a, b\) => a - b\)/);
});

test('Update: commit writes ticked change rows only; counts follow the ticks', () => {
  const wb = read('src/components/import/UpdateWorkbench.jsx');
  assert.match(wb, /const changes = tickedChangeRows\.map/);
  assert.match(wb, /const effectiveChanged = tickedChangeRows\.length/);
  assert.match(wb, /excluded,\n  \};/);
});

test('Receive: commit receives ticked rows only; units follow the ticks', () => {
  const wb = read('src/components/import/ReceiveWorkbench.jsx');
  assert.match(wb, /const rows = tickedReadyRows;/);
  assert.match(wb, /const effectiveUnits = tickedReadyRows\.reduce/);
  assert.match(wb, /excluded,\n  \};/);
});
