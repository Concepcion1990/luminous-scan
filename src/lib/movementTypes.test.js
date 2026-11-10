import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { BUNDLE_MOVEMENT_TYPES, isBundleMovementType } from './plans.js';

/**
 * Bundle movement types: Business-only, on the Movements filter and at the
 * write funnel.
 *
 * LIVE FINDING (2026-11-07, on the fresh Essentials account): the Movements
 * "Choose movement type" dropdown offered Consumed (builds), Built, Taken
 * apart and Parts recovered. Essentials has no Bundles feature, so those
 * four must not appear there; the other types stay on both plans.
 *
 * The four bundle types are the only movement types a build or teardown
 * writes (src/lib/bom.js: consume + produce on assemble, disassemble +
 * recovered on teardown). Every movement write funnels through
 * recordMovement in src/lib/inventory.js, so the refusal lives there.
 */

const NON_BUNDLE_TYPES = [
  'receive',
  'sale',
  'count',
  'transfer',
  'transfer_in',
  'returned',
  'damaged',
  'lost',
  'found',
  'write_off',
  'correction',
  'reserved',
  'released',
];

test('the bundle movement types are exactly the four build/teardown types', () => {
  assert.deepEqual(BUNDLE_MOVEMENT_TYPES, ['consume', 'produce', 'disassemble', 'recovered']);
  for (const type of BUNDLE_MOVEMENT_TYPES) assert.equal(isBundleMovementType(type), true);
  for (const type of NON_BUNDLE_TYPES) assert.equal(isBundleMovementType(type), false);
});

test('the Movements filter offers bundle types on Business only', () => {
  const page = readFileSync('src/pages/Movements.jsx', 'utf8');
  assert.match(page, /import \{ BUNDLE_MOVEMENT_TYPES \} from '@\/lib\/plans';/);
  assert.match(page, /const \{ isEssentials, isLoading: entitlementLoading \} = useEntitlements\(\);/);
  assert.match(page, /const showBundleTypes = !isEssentials && !entitlementLoading;/);
  // The four options are spread in only when the plan is known Business.
  assert.match(page, /\.\.\.\(showBundleTypes\s*\n?\s*\? \[/);
  assert.match(page, /\{ value: 'consume', label: 'Consumed \(builds\)' \}/);
  assert.match(page, /\{ value: 'produce', label: 'Built' \}/);
  assert.match(page, /\{ value: 'disassemble', label: 'Taken apart' \}/);
  assert.match(page, /\{ value: 'recovered', label: 'Parts recovered' \}/);
  assert.match(page, /options=\{typeOptions\}/);
  // A bundle filter picked on Business must not linger on Essentials.
  assert.match(
    page,
    /if \(isEssentials && BUNDLE_MOVEMENT_TYPES\.includes\(type\)\) setType\('all'\);/
  );
});

test('the Adjustments filter never included bundle types', () => {
  const page = readFileSync('src/pages/Movements.jsx', 'utf8');
  const match = page.match(/const ADJUSTMENT_TYPES = \[([\s\S]*?)\];/);
  assert.ok(match, 'ADJUSTMENT_TYPES must be defined');
  for (const type of BUNDLE_MOVEMENT_TYPES) {
    assert.doesNotMatch(match[1], new RegExp(`'${type}'`), `adjust must not include ${type}`);
  }
  for (const type of ['returned', 'damaged', 'lost', 'found', 'write_off', 'correction']) {
    assert.match(match[1], new RegExp(`'${type}'`), `adjust keeps ${type}`);
  }
});

test('Scan never offers a bundle action', () => {
  const scan = readFileSync('src/pages/Scan.jsx', 'utf8');
  for (const type of BUNDLE_MOVEMENT_TYPES) {
    assert.doesNotMatch(scan, new RegExp(`key: '${type}'`), `Scan must not offer ${type}`);
  }
  // The twelve actions Scan does offer are all non-bundle types. (Transfer
  // in is not one of them: it is the second leg a transfer writes, not an
  // action the scanner offers.)
  const scanTypes = NON_BUNDLE_TYPES.filter((type) => type !== 'transfer_in');
  for (const type of scanTypes) {
    assert.match(scan, new RegExp(`key: '${type}'`), `Scan keeps ${type}`);
  }
});

test('recordMovement refuses bundle types on a non-Business plan', () => {
  const inventory = readFileSync('src/lib/inventory.js', 'utf8');
  const fn = inventory.slice(inventory.indexOf('export async function recordMovement'));
  // The guard reads the stored entitlement row and asks the feature system;
  // a missing or unverified record resolves to Essentials and refuses.
  assert.match(fn, /if \(BUNDLE_MOVEMENT_TYPES\.includes\(type\)\) \{/);
  assert.match(fn, /const record = await loadEntitlement\(business\);/);
  assert.match(fn, /featureAllowed\(resolveEntitlement\(record, user\)\.planKey, 'builds'\)/);
  assert.match(fn, /throw new Error\(\s*'Bundle movements are a Business feature/);
  // The guard runs before any stock level is touched, so a refused build
  // writes nothing at all.
  assert.ok(
    fn.indexOf('Bundle movements are a Business feature') < fn.indexOf('await setLevel('),
    'refusal must precede the first level write'
  );
});

test('reversing a bundle entry names the build, not a transfer', () => {
  const inventory = readFileSync('src/lib/inventory.js', 'utf8');
  const fn = inventory.slice(inventory.indexOf('export function reversalBlocker'));
  // The bundle check must come before the reversible-list check: bundle
  // types are not in REVERSIBLE_TYPES, so without this order they would get
  // the transfer message.
  assert.ok(
    fn.indexOf("['consume', 'produce', 'disassemble', 'recovered']") <
      fn.indexOf('!REVERSIBLE_TYPES.includes(movement.type)'),
    'bundle branch must precede the reversible-list branch'
  );
  assert.match(fn, /This entry came from a build or teardown/);
});
