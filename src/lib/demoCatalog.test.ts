import test from 'node:test';
import assert from 'node:assert/strict';
import { filterMissingByKey, mergeCounterNextNumber, SEED_WAREHOUSES } from './demoCatalog';

test('SEED_WAREHOUSES defines Main Store primary and Showroom secondary warehouses', () => {
  assert.equal(SEED_WAREHOUSES.length, 2);
  assert.equal(SEED_WAREHOUSES[0].code, 'WH-MAIN');
  assert.equal(SEED_WAREHOUSES[0].isPrimary, true);
  assert.equal(SEED_WAREHOUSES[1].code, 'WH-SHOW');
  assert.equal(SEED_WAREHOUSES[1].isPrimary, false);
});

test('filterMissingByKey skips existing records case-insensitively and avoids duplicates', () => {
  const candidates = [
    { sku: 'YYPP005', name: 'Petrol Pipe' },
    { sku: 'YYPP001', name: 'Petrol Pipe 170' },
    { sku: 'YYP002', name: 'Plug Cap' },
  ];
  const missing = filterMissingByKey(candidates, [' yypp005 ', 'YYP002'], (c) => c.sku);
  assert.deepEqual(missing, [{ sku: 'YYPP001', name: 'Petrol Pipe 170' }]);
});

test('mergeCounterNextNumber never lowers an existing sequence counter', () => {
  assert.equal(mergeCounterNextNumber(undefined, 15), 15);
  assert.equal(mergeCounterNextNumber(5, 15), 15);
  assert.equal(mergeCounterNextNumber(42, 15), 42);
});
