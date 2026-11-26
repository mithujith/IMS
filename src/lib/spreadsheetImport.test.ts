import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ITEM_COLUMN_ALIASES,
  parseSpreadsheetRowsFromMatrix,
  resolveHeaderMap,
} from './spreadsheetImport';

test('resolveHeaderMap maps friendly Excel headers to canonical item keys', () => {
  const map = resolveHeaderMap(
    ['Item Name', 'Part Number', 'UOM', 'Sales Price', 'Purchase Price', 'Stock', 'Min Stock'],
    ['name', 'sku', 'unit', 'sellingPrice', 'costPrice', 'openingStock', 'reorderLevel'],
    ITEM_COLUMN_ALIASES
  );

  assert.equal(map['Item Name'], 'name');
  assert.equal(map['Part Number'], 'sku');
  assert.equal(map['UOM'], 'unit');
  assert.equal(map['Sales Price'], 'sellingPrice');
  assert.equal(map['Purchase Price'], 'costPrice');
  assert.equal(map['Stock'], 'openingStock');
  assert.equal(map['Min Stock'], 'reorderLevel');
});

test('parseSpreadsheetRowsFromMatrix extracts rows and preserves optional columns', () => {
  const matrix = [
    ['Item Name', 'SKU', 'Unit', 'Selling Price', 'Cost Price', 'Opening Stock', 'Brand'],
    ['CLUTCH PLATE SET', 'YYCP100', 'SET', '1850', '1220', '20', 'ASK'],
    ['', '', '', '', '', '', ''],
    ['OIL FILTER', 'YYOF150', 'PCS', '650', '410', '50', 'Yamaha'],
  ];

  const parsed = parseSpreadsheetRowsFromMatrix(
    matrix,
    ['name', 'sku', 'unit', 'sellingPrice', 'costPrice', 'openingStock', 'reorderLevel'],
    ITEM_COLUMN_ALIASES
  );

  assert.equal(parsed.rows.length, 2);
  assert.equal(parsed.rows[0].name, 'CLUTCH PLATE SET');
  assert.equal(parsed.rows[0].sku, 'YYCP100');
  assert.equal(parsed.rows[0].sellingPrice, '1850');
  assert.equal(parsed.rows[0].brand, 'ASK');
  assert.equal(parsed.rows[1].sku, 'YYOF150');
});
