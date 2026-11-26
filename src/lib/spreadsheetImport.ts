import * as XLSX from 'xlsx';
import { parseCsvText } from './csv';

export type ColumnAliases = Record<string, string[]>;

export const ITEM_COLUMN_ALIASES: ColumnAliases = {
  name: ['name', 'item name', 'item_name', 'product name', 'product', 'description', 'title'],
  sku: ['sku', 'item code', 'code', 'part no', 'part number', 'part_number', 'item_sku'],
  unit: ['unit', 'uom', 'unit of measure'],
  category: ['category', 'group', 'item group', 'type'],
  brand: ['brand', 'make', 'manufacturer'],
  sellingPrice: ['sellingprice', 'selling price', 'selling_price', 'rate', 'sales price', 'price', 'mrp'],
  costPrice: ['costprice', 'cost price', 'cost_price', 'purchase price', 'purchase rate', 'cost', 'buying price'],
  openingStock: ['openingstock', 'opening stock', 'opening_stock', 'stock', 'qty', 'quantity', 'on hand', 'initial stock'],
  reorderLevel: ['reorderlevel', 'reorder level', 'reorder_level', 'reorder', 'min stock', 'min level'],
  reorderQty: ['reorderqty', 'reorder qty', 'reorder_qty', 'reorder quantity'],
  barcode: ['barcode', 'ean', 'upc'],
  taxRate: ['taxrate', 'tax rate', 'tax_rate', 'vat', 'tax %', 'tax'],
};

export function normalizeHeaderKey(header: string): string {
  return String(header || '')
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, ' ');
}

export function resolveHeaderMap(
  rawHeaders: string[],
  expectedColumns: string[],
  aliases: ColumnAliases = {}
): Record<string, string> {
  const map: Record<string, string> = {};

  for (const raw of rawHeaders) {
    const norm = normalizeHeaderKey(raw);
    if (!norm) continue;

    // 1. Direct match against expectedColumns (ignoring case/separators)
    const direct = expectedColumns.find((col) => normalizeHeaderKey(col) === norm);
    if (direct) {
      map[raw] = direct;
      continue;
    }

    // 2. Alias match against expectedColumns or extra aliases
    let matched: string | undefined;
    for (const [targetCol, list] of Object.entries(aliases)) {
      if (
        normalizeHeaderKey(targetCol) === norm ||
        list.some((alias) => normalizeHeaderKey(alias) === norm)
      ) {
        matched = targetCol;
        break;
      }
    }
    map[raw] = matched ?? raw.trim();
  }

  return map;
}

export function parseSpreadsheetRowsFromMatrix(
  matrix: unknown[][],
  expectedColumns: string[],
  aliases: ColumnAliases = {}
): { headers: string[]; rows: Record<string, string>[] } {
  const nonEmptyRows = matrix.filter(
    (row) => Array.isArray(row) && row.some((cell) => String(cell ?? '').trim() !== '')
  );
  if (nonEmptyRows.length < 2) {
    return { headers: [], rows: [] };
  }

  const rawHeaders = nonEmptyRows[0].map((c) => String(c ?? '').trim());
  const headerMap = resolveHeaderMap(rawHeaders, expectedColumns, aliases);
  const mappedHeaders: string[] = [];

  for (const raw of rawHeaders) {
    const target = headerMap[raw];
    if (target && !mappedHeaders.includes(target)) {
      mappedHeaders.push(target);
    }
  }

  const rows: Record<string, string>[] = [];
  for (let i = 1; i < nonEmptyRows.length; i += 1) {
    const cells = nonEmptyRows[i];
    const rowObj: Record<string, string> = {};
    let hasValue = false;

    for (let c = 0; c < rawHeaders.length; c += 1) {
      const rawKey = rawHeaders[c];
      const targetKey = headerMap[rawKey];
      if (!targetKey) continue;
      const val = String(cells[c] ?? '').trim();
      if (val !== '') hasValue = true;
      if (!(targetKey in rowObj) || rowObj[targetKey] === '') {
        rowObj[targetKey] = val;
      }
    }

    if (hasValue) {
      rows.push(rowObj);
    }
  }

  return { headers: mappedHeaders, rows };
}

export async function parseSpreadsheetFile(
  file: File,
  expectedColumns: string[],
  aliases: ColumnAliases = {}
): Promise<{ headers: string[]; rows: Record<string, string>[] }> {
  const lower = file.name.toLowerCase();
  if (lower.endsWith('.csv')) {
    const text = await file.text();
    const parsed = parseCsvText(text);
    const matrix: unknown[][] = [
      parsed.headers,
      ...parsed.rows.map((r) => parsed.headers.map((h) => r[h] ?? '')),
    ];
    return parseSpreadsheetRowsFromMatrix(matrix, expectedColumns, aliases);
  }

  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: 'array' });
  const firstSheetName = workbook.SheetNames[0];
  if (!firstSheetName) {
    return { headers: [], rows: [] };
  }
  const sheet = workbook.Sheets[firstSheetName];
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    defval: '',
    raw: false,
  });
  return parseSpreadsheetRowsFromMatrix(matrix, expectedColumns, aliases);
}

export function downloadSampleSpreadsheet(
  filenameBase: string,
  expectedColumns: string[],
  sampleRows: Record<string, string>[],
  format: 'xlsx' | 'csv'
): void {
  const aoa: string[][] = [
    expectedColumns,
    ...sampleRows.map((row) => expectedColumns.map((col) => row[col] ?? '')),
  ];

  const worksheet = XLSX.utils.aoa_to_sheet(aoa);
  if (format === 'csv') {
    const csvContent = XLSX.utils.sheet_to_csv(worksheet);
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${filenameBase}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    return;
  }

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Products');
  XLSX.writeFile(workbook, `${filenameBase}.xlsx`);
}
