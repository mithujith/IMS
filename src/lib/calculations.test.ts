import test from 'node:test';
import assert from 'node:assert/strict';
import { formatLKR, amountInWordsLKR } from './formatters';
import {
  calculateDocumentLine,
  calculateDocumentTotals,
  computeWeightedAverageCost,
  reconcileStockFromLedger,
  validateNoOverSelling,
} from './calculations';
import { canPerform } from './permissions';
import { parseCsvText } from './csv';
import type { Item } from '../types';

test('formatLKR formats currency accurately', () => {
  assert.equal(formatLKR(12500), 'Rs. 12,500.00');
  assert.equal(formatLKR(0), 'Rs. 0.00');
  assert.equal(formatLKR(-450.5), '-Rs. 450.50');
});

test('amountInWordsLKR formats Sri Lankan Rupees and cents', () => {
  assert.equal(
    amountInWordsLKR(12500.5),
    'Sri Lankan Rupees Twelve Thousand Five Hundred and Fifty Cents Only'
  );
  assert.equal(amountInWordsLKR(100), 'Sri Lankan Rupees One Hundred Only');
});

test('calculateDocumentLine handles exclusive and inclusive taxes with discounts', () => {
  const excl = calculateDocumentLine({
    itemId: 'i1',
    itemName: 'Petrol Pipe',
    sku: 'YYPP005',
    unit: 'PCS',
    quantity: 10,
    rate: 100,
    discountType: 'percent',
    discountValue: 10,
    taxRate: 18,
    taxInclusive: false,
  });
  assert.equal(excl.lineDiscount, 100);
  assert.equal(excl.lineSubtotal, 900);
  assert.equal(excl.lineTax, 162);
  assert.equal(excl.lineTotal, 1062);

  const incl = calculateDocumentLine({
    itemId: 'i1',
    itemName: 'Petrol Pipe',
    sku: 'YYPP005',
    unit: 'PCS',
    quantity: 1,
    rate: 1180,
    taxRate: 18,
    taxInclusive: true,
  });
  assert.equal(incl.lineSubtotal, 1000);
  assert.equal(incl.lineTax, 180);
  assert.equal(incl.lineTotal, 1180);
});

test('calculateDocumentTotals applies document-level discount and shipping', () => {
  const totals = calculateDocumentTotals(
    [
      {
        itemId: 'i1',
        itemName: 'Plug Cap',
        sku: 'YYP002',
        unit: 'PCS',
        quantity: 2,
        rate: 500,
        taxRate: 18,
      },
    ],
    'percent',
    10,
    250,
    0
  );
  assert.equal(totals.subtotal, 1000);
  assert.equal(totals.discountAmount, 100);
  assert.equal(totals.taxTotal, 162);
  assert.equal(totals.total, 1312);
});

test('validateNoOverSelling blocks orders exceeding available stock', () => {
  const itemsById: Record<string, Item> = {
    i1: {
      id: 'i1',
      organizationId: 'org1',
      name: 'PETROL PIPE PULSAR/DISCOVER 270mm',
      sku: 'YYPP005',
      unit: 'PCS',
      sellingPrice: 450,
      costPrice: 280,
      openingStock: 20,
      reorderLevel: 10,
      reorderQty: 25,
      images: [],
      stockByWarehouse: { wh1: 12 },
      committedByWarehouse: { wh1: 4 },
      totalStock: 12,
      totalCommitted: 4,
      status: 'active',
      createdBy: 'u1',
      createdAt: '',
      updatedAt: '',
      updatedBy: 'u1',
    },
  };

  const fail = validateNoOverSelling(
    itemsById,
    [{ itemId: 'i1', itemName: 'Petrol Pipe', quantity: 9, warehouseId: 'wh1' }],
    'wh1'
  );
  assert.equal(fail.ok, false);

  const pass = validateNoOverSelling(
    itemsById,
    [{ itemId: 'i1', itemName: 'Petrol Pipe', quantity: 8, warehouseId: 'wh1' }],
    'wh1'
  );
  assert.equal(pass.ok, true);
});

test('reconcileStockFromLedger computes exact stock per warehouse', () => {
  const map = reconcileStockFromLedger([
    { itemId: 'i1', warehouseId: 'wh1', quantityChange: 50 },
    { itemId: 'i1', warehouseId: 'wh1', quantityChange: -12 },
    { itemId: 'i1', warehouseId: 'wh2', quantityChange: 12 },
  ]);
  assert.equal(map.i1.stockByWarehouse.wh1, 38);
  assert.equal(map.i1.stockByWarehouse.wh2, 12);
  assert.equal(map.i1.totalStock, 50);
});

test('computeWeightedAverageCost blends stock valuation properly', () => {
  assert.equal(computeWeightedAverageCost(10, 100, 10, 200), 150);
});

test('RBAC permissions enforce role boundaries', () => {
  assert.equal(canPerform('Read-only', 'items', 'create'), false);
  assert.equal(canPerform('Read-only', 'items', 'view'), true);
  assert.equal(canPerform('Sales', 'settings', 'view'), false);
  assert.equal(canPerform('Sales', 'invoices', 'create'), true);
  assert.equal(canPerform('Warehouse', 'purchaseReceives', 'create'), true);
  assert.equal(canPerform('Admin', 'settings', 'edit'), true);
});

test('parseCsvText handles quoted fields and commas', () => {
  const parsed = parseCsvText('name,sku,sellingPrice\n"Pipe, 270mm",YYPP005,450');
  assert.equal(parsed.rows.length, 1);
  assert.equal(parsed.rows[0].name, 'Pipe, 270mm');
  assert.equal(parsed.rows[0].sku, 'YYPP005');
});
