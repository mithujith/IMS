import { DocumentLine, Item, StockLedgerEntry } from '../types';
import { roundCurrency } from './formatters';

export interface LineCalcInput {
  itemId: string;
  itemName: string;
  sku: string;
  unit: string;
  warehouseId?: string;
  quantity: number;
  rate: number;
  discountType?: 'percent' | 'amount';
  discountValue?: number;
  taxRate?: number;
  taxInclusive?: boolean;
}

export function calculateDocumentLine(input: LineCalcInput): DocumentLine {
  const qty = Math.max(0, Number(input.quantity) || 0);
  const rate = Math.max(0, Number(input.rate) || 0);
  const discountType = input.discountType ?? 'percent';
  const discountValue = Math.max(0, Number(input.discountValue) || 0);
  const taxRate = Math.max(0, Number(input.taxRate) || 0);
  const taxInclusive = Boolean(input.taxInclusive);

  const gross = roundCurrency(qty * rate);
  const rawDiscount =
    discountType === 'percent'
      ? roundCurrency((gross * Math.min(100, discountValue)) / 100)
      : roundCurrency(Math.min(gross, discountValue));

  const afterDiscount = roundCurrency(Math.max(0, gross - rawDiscount));

  let lineSubtotal = afterDiscount;
  let lineTax = 0;
  let lineTotal = afterDiscount;

  if (taxRate > 0) {
    if (taxInclusive) {
      const base = roundCurrency(afterDiscount / (1 + taxRate / 100));
      lineTax = roundCurrency(afterDiscount - base);
      lineSubtotal = base;
      lineTotal = afterDiscount;
    } else {
      lineTax = roundCurrency((afterDiscount * taxRate) / 100);
      lineSubtotal = afterDiscount;
      lineTotal = roundCurrency(afterDiscount + lineTax);
    }
  }

  return {
    itemId: input.itemId,
    itemName: input.itemName,
    sku: input.sku,
    unit: input.unit,
    warehouseId: input.warehouseId,
    quantity: qty,
    rate,
    discountType,
    discountValue,
    taxRate,
    taxInclusive,
    lineSubtotal,
    lineDiscount: rawDiscount,
    lineTax,
    lineTotal,
  };
}

export interface DocumentTotalsResult {
  lines: DocumentLine[];
  subtotal: number;
  discountAmount: number;
  taxTotal: number;
  total: number;
}

export function calculateDocumentTotals(
  rawLines: LineCalcInput[],
  docDiscountType: 'percent' | 'amount' = 'percent',
  docDiscountValue = 0,
  shippingCharges = 0,
  adjustment = 0
): DocumentTotalsResult {
  const lines = rawLines.map(calculateDocumentLine);
  const subtotal = roundCurrency(lines.reduce((sum, l) => sum + l.lineSubtotal, 0));
  const rawLineTax = roundCurrency(lines.reduce((sum, l) => sum + l.lineTax, 0));

  const discountVal = Math.max(0, Number(docDiscountValue) || 0);
  const discountAmount =
    docDiscountType === 'percent'
      ? roundCurrency((subtotal * Math.min(100, discountVal)) / 100)
      : roundCurrency(Math.min(subtotal, discountVal));

  // Proportionally scale tax if a document-level discount is applied
  const discountFactor = subtotal > 0 ? Math.max(0, (subtotal - discountAmount) / subtotal) : 1;
  const taxTotal = roundCurrency(rawLineTax * discountFactor);

  const shipping = Math.max(0, Number(shippingCharges) || 0);
  const adj = Number(adjustment) || 0;

  const total = roundCurrency(
    Math.max(0, subtotal - discountAmount + taxTotal + shipping + adj)
  );

  return {
    lines,
    subtotal,
    discountAmount,
    taxTotal,
    total,
  };
}

export function getAvailableStock(
  item: Pick<Item, 'stockByWarehouse' | 'committedByWarehouse' | 'totalStock' | 'totalCommitted'>,
  warehouseId?: string
): { onHand: number; committed: number; available: number } {
  if (warehouseId) {
    const onHand = Number(item.stockByWarehouse?.[warehouseId] ?? 0);
    const committed = Number(item.committedByWarehouse?.[warehouseId] ?? 0);
    return {
      onHand,
      committed,
      available: Math.max(0, onHand - committed),
    };
  }
  const onHand = Number(item.totalStock ?? 0);
  const committed = Number(item.totalCommitted ?? 0);
  return {
    onHand,
    committed,
    available: Math.max(0, onHand - committed),
  };
}

export function validateNoOverSelling(
  itemsById: Record<string, Item>,
  lines: { itemId: string; itemName: string; quantity: number; warehouseId?: string }[],
  defaultWarehouseId: string,
  ignoreAlreadyCommitted = false
): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  const requestedByKey: Record<string, { item: Item; warehouseId: string; qty: number }> = {};

  for (const line of lines) {
    const item = itemsById[line.itemId];
    if (!item) {
      errors.push(`Item "${line.itemName}" not found in inventory.`);
      continue;
    }
    const wh = line.warehouseId || defaultWarehouseId;
    const key = `${line.itemId}::${wh}`;
    if (!requestedByKey[key]) {
      requestedByKey[key] = { item, warehouseId: wh, qty: 0 };
    }
    requestedByKey[key].qty += Number(line.quantity) || 0;
  }

  for (const entry of Object.values(requestedByKey)) {
    const { onHand, available } = getAvailableStock(entry.item, entry.warehouseId);
    const ceiling = ignoreAlreadyCommitted ? onHand : available;
    if (entry.qty > ceiling) {
      errors.push(
        `Insufficient stock for ${entry.item.name} (${entry.item.sku}): requested ${entry.qty} ${entry.item.unit}, available ${ceiling} ${entry.item.unit}.`
      );
    }
  }

  return { ok: errors.length === 0, errors };
}

export function computeWeightedAverageCost(
  currentQty: number,
  currentUnitCost: number,
  addedQty: number,
  addedUnitCost: number
): number {
  const safeCurrentQty = Math.max(0, currentQty);
  const safeAddedQty = Math.max(0, addedQty);
  const totalQty = safeCurrentQty + safeAddedQty;
  if (totalQty <= 0) return roundCurrency(addedUnitCost || currentUnitCost || 0);
  const totalValue = safeCurrentQty * currentUnitCost + safeAddedQty * addedUnitCost;
  return roundCurrency(totalValue / totalQty);
}

export function reconcileStockFromLedger(
  entries: Pick<StockLedgerEntry, 'itemId' | 'warehouseId' | 'quantityChange'>[]
): Record<string, { stockByWarehouse: Record<string, number>; totalStock: number }> {
  const result: Record<string, { stockByWarehouse: Record<string, number>; totalStock: number }> = {};
  for (const entry of entries) {
    if (!result[entry.itemId]) {
      result[entry.itemId] = { stockByWarehouse: {}, totalStock: 0 };
    }
    const itemBucket = result[entry.itemId];
    const prev = itemBucket.stockByWarehouse[entry.warehouseId] ?? 0;
    const next = prev + Number(entry.quantityChange || 0);
    itemBucket.stockByWarehouse[entry.warehouseId] = next;
  }

  for (const itemId of Object.keys(result)) {
    const whMap = result[itemId].stockByWarehouse;
    let total = 0;
    for (const wh of Object.keys(whMap)) {
      if (whMap[wh] < 0) whMap[wh] = 0;
      total += whMap[wh];
    }
    result[itemId].totalStock = total;
  }

  return result;
}

export function computePercentageDelta(current: number, previous: number): number {
  if (previous === 0) {
    return current > 0 ? 100 : 0;
  }
  return roundCurrency(((current - previous) / Math.abs(previous)) * 100);
}
