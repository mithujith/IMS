import { Plus, Trash2 } from 'lucide-react';
import { Item, PriceList, TaxRate } from '../types';
import {
  calculateDocumentLine,
  calculateDocumentTotals,
  getAvailableStock,
  LineCalcInput,
} from '../lib/calculations';
import { formatLKR, roundCurrency } from '../lib/formatters';

export interface EditableLineInput {
  itemId: string;
  quantity: number;
  rate: number;
  discountType: 'percent' | 'amount';
  discountValue: number;
  taxRate: number;
  taxInclusive: boolean;
}

interface LineItemsEditorProps {
  mode: 'sales' | 'purchase';
  items: Item[];
  taxes: TaxRate[];
  priceList?: PriceList | null;
  warehouseId?: string;
  lines: EditableLineInput[];
  onChangeLines: (lines: EditableLineInput[]) => void;
  docDiscountType: 'percent' | 'amount';
  docDiscountValue: number;
  onChangeDocDiscount: (type: 'percent' | 'amount', value: number) => void;
  shippingCharges: number;
  onChangeShippingCharges: (val: number) => void;
  adjustment: number;
  onChangeAdjustment: (val: number) => void;
  showDocumentAdjustments?: boolean;
}

export function resolveItemRateWithPriceList(
  item: Item,
  mode: 'sales' | 'purchase',
  priceList?: PriceList | null
): number {
  if (mode === 'purchase') return Number(item.costPrice ?? 0);
  const base = Number(item.sellingPrice ?? 0);
  if (!priceList) return base;
  if (priceList.type === 'custom' && priceList.customRates && priceList.customRates[item.id] !== undefined) {
    return Number(priceList.customRates[item.id]);
  }
  const pct = Number(priceList.percentage ?? 0);
  if (priceList.markupOrDiscount === 'markup') {
    return roundCurrency(base * (1 + pct / 100));
  }
  return roundCurrency(Math.max(0, base * (1 - pct / 100)));
}

export function buildComputedDocumentLines(
  rawLines: EditableLineInput[],
  itemsById: Record<string, Item>,
  warehouseId: string,
  docDiscountType: 'percent' | 'amount' = 'percent',
  docDiscountValue = 0,
  shippingCharges = 0,
  adjustment = 0
) {
  const calcInputs: LineCalcInput[] = rawLines
    .filter((l) => l.itemId && itemsById[l.itemId])
    .map((l) => {
      const it = itemsById[l.itemId];
      return {
        itemId: it.id,
        itemName: it.name,
        sku: it.sku,
        unit: it.unit,
        warehouseId,
        quantity: Number(l.quantity) || 0,
        rate: Number(l.rate) || 0,
        discountType: l.discountType,
        discountValue: Number(l.discountValue) || 0,
        taxRate: Number(l.taxRate) || 0,
        taxInclusive: Boolean(l.taxInclusive),
      };
    });

  return calculateDocumentTotals(
    calcInputs,
    docDiscountType,
    docDiscountValue,
    shippingCharges,
    adjustment
  );
}

export function LineItemsEditor({
  mode,
  items,
  taxes,
  priceList,
  warehouseId,
  lines,
  onChangeLines,
  docDiscountType,
  docDiscountValue,
  onChangeDocDiscount,
  shippingCharges,
  onChangeShippingCharges,
  adjustment,
  onChangeAdjustment,
  showDocumentAdjustments = true,
}: LineItemsEditorProps) {
  const itemMap = Object.fromEntries(items.map((i) => [i.id, i]));
  const defaultTax = taxes.find((t) => t.isDefault && t.status === 'active')?.rate ?? 18;

  const totals = buildComputedDocumentLines(
    lines,
    itemMap,
    warehouseId || '',
    docDiscountType,
    docDiscountValue,
    shippingCharges,
    adjustment
  );

  const handleSelectItem = (idx: number, nextItemId: string) => {
    const it = itemMap[nextItemId];
    const next = [...lines];
    if (!it) {
      next[idx] = { ...next[idx], itemId: '' };
    } else {
      next[idx] = {
        ...next[idx],
        itemId: it.id,
        rate: resolveItemRateWithPriceList(it, mode, priceList),
        taxRate: it.taxRate ?? defaultTax,
        taxInclusive: Boolean(it.taxInclusive),
      };
    }
    onChangeLines(next);
  };

  const updateLine = (idx: number, patch: Partial<EditableLineInput>) => {
    const next = [...lines];
    next[idx] = { ...next[idx], ...patch };
    onChangeLines(next);
  };

  const addRow = () => {
    onChangeLines([
      ...lines,
      {
        itemId: '',
        quantity: 1,
        rate: 0,
        discountType: 'percent',
        discountValue: 0,
        taxRate: defaultTax,
        taxInclusive: false,
      },
    ]);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-slate-800">Line Items</span>
        <button
          type="button"
          onClick={addRow}
          className="inline-flex items-center gap-1 text-xs font-medium text-[#408dfb] hover:underline"
        >
          <Plus className="w-3.5 h-3.5" />
          Add Line
        </button>
      </div>

      <div className="border border-slate-200 rounded-lg overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
            <tr>
              <th className="text-left px-2.5 py-2 font-medium min-w-[210px]">Item</th>
              <th className="text-right px-2 py-2 font-medium w-20">Qty</th>
              <th className="text-right px-2 py-2 font-medium w-28">Rate (LKR)</th>
              <th className="text-right px-2 py-2 font-medium w-28">Discount</th>
              <th className="text-right px-2 py-2 font-medium w-24">Tax %</th>
              <th className="text-center px-2 py-2 font-medium w-16">Incl.</th>
              <th className="text-right px-2.5 py-2 font-medium w-28">Amount</th>
              <th className="w-8 px-1" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {lines.map((line, idx) => {
              const it = itemMap[line.itemId];
              const stockInfo = it ? getAvailableStock(it, warehouseId) : null;
              const computed = it
                ? calculateDocumentLine({
                    itemId: it.id,
                    itemName: it.name,
                    sku: it.sku,
                    unit: it.unit,
                    quantity: line.quantity,
                    rate: line.rate,
                    discountType: line.discountType,
                    discountValue: line.discountValue,
                    taxRate: line.taxRate,
                    taxInclusive: line.taxInclusive,
                  })
                : null;

              return (
                <tr key={idx}>
                  <td className="px-2.5 py-2 align-top">
                    <select
                      value={line.itemId}
                      onChange={(e) => handleSelectItem(idx, e.target.value)}
                      className="w-full px-2 py-1.5 border border-slate-300 rounded bg-white text-xs"
                    >
                      <option value="">Select spare part...</option>
                      {items.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.sku} — {item.name}
                        </option>
                      ))}
                    </select>
                    {it && stockInfo && (
                      <p className="text-[11px] text-slate-500 mt-0.5">
                        Available: {stockInfo.available} {it.unit} (On hand: {stockInfo.onHand})
                      </p>
                    )}
                  </td>
                  <td className="px-2 py-2 align-top">
                    <input
                      type="number"
                      min="1"
                      step="1"
                      value={line.quantity}
                      onChange={(e) =>
                        updateLine(idx, { quantity: Math.max(1, Number(e.target.value) || 1) })
                      }
                      className="w-full px-2 py-1.5 border border-slate-300 rounded text-right tabular-nums"
                    />
                  </td>
                  <td className="px-2 py-2 align-top">
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={line.rate}
                      onChange={(e) =>
                        updateLine(idx, { rate: Math.max(0, Number(e.target.value) || 0) })
                      }
                      className="w-full px-2 py-1.5 border border-slate-300 rounded text-right tabular-nums"
                    />
                  </td>
                  <td className="px-2 py-2 align-top">
                    <div className="flex items-center border border-slate-300 rounded overflow-hidden">
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={line.discountValue}
                        onChange={(e) =>
                          updateLine(idx, {
                            discountValue: Math.max(0, Number(e.target.value) || 0),
                          })
                        }
                        className="w-full px-1.5 py-1.5 text-right tabular-nums focus:outline-none"
                      />
                      <select
                        value={line.discountType}
                        onChange={(e) =>
                          updateLine(idx, {
                            discountType: e.target.value as 'percent' | 'amount',
                          })
                        }
                        aria-label="Discount type"
                        className="bg-slate-50 border-l border-slate-300 px-1 py-1.5 text-[11px]"
                      >
                        <option value="percent">%</option>
                        <option value="amount">Rs</option>
                      </select>
                    </div>
                  </td>
                  <td className="px-2 py-2 align-top">
                    <select
                      value={line.taxRate}
                      onChange={(e) => updateLine(idx, { taxRate: Number(e.target.value) })}
                      className="w-full px-1.5 py-1.5 border border-slate-300 rounded bg-white tabular-nums"
                    >
                      <option value={0}>0%</option>
                      {taxes
                        .filter((t) => t.status === 'active' && t.rate !== 0)
                        .map((t) => (
                          <option key={t.id} value={t.rate}>
                            {t.name}
                          </option>
                        ))}
                      {!taxes.some((t) => t.rate === 18) && <option value={18}>VAT 18%</option>}
                    </select>
                  </td>
                  <td className="px-2 py-2 text-center align-top pt-3">
                    <input
                      type="checkbox"
                      checked={line.taxInclusive}
                      onChange={(e) => updateLine(idx, { taxInclusive: e.target.checked })}
                      aria-label="Tax inclusive"
                      className="rounded border-slate-300 text-[#408dfb]"
                    />
                  </td>
                  <td className="px-2.5 py-2 text-right font-medium text-slate-900 tabular-nums align-top pt-3">
                    {formatLKR(computed?.lineTotal ?? 0)}
                  </td>
                  <td className="px-1 py-2 align-top pt-2.5">
                    {lines.length > 1 && (
                      <button
                        type="button"
                        onClick={() => onChangeLines(lines.filter((_, i) => i !== idx))}
                        aria-label="Remove line"
                        className="p-1 text-slate-400 hover:text-red-600"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="flex flex-col sm:flex-row justify-end gap-4 pt-2">
        <div className="w-full sm:w-80 bg-slate-50 border border-slate-200 rounded-lg p-3.5 space-y-2 text-xs">
          <div className="flex justify-between">
            <span className="text-slate-600">Sub Total</span>
            <span className="font-medium tabular-nums">{formatLKR(totals.subtotal)}</span>
          </div>

          {showDocumentAdjustments && (
            <>
              <div className="flex items-center justify-between gap-2">
                <span className="text-slate-600">Order Discount</span>
                <div className="flex items-center gap-1">
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={docDiscountValue}
                    onChange={(e) =>
                      onChangeDocDiscount(
                        docDiscountType,
                        Math.max(0, Number(e.target.value) || 0)
                      )
                    }
                    className="w-20 px-2 py-1 border border-slate-300 rounded bg-white text-right tabular-nums"
                  />
                  <select
                    value={docDiscountType}
                    onChange={(e) =>
                      onChangeDocDiscount(
                        e.target.value as 'percent' | 'amount',
                        docDiscountValue
                      )
                    }
                    className="px-1.5 py-1 border border-slate-300 rounded bg-white"
                  >
                    <option value="percent">%</option>
                    <option value="amount">LKR</option>
                  </select>
                </div>
              </div>

              <div className="flex items-center justify-between gap-2">
                <span className="text-slate-600">Shipping (LKR)</span>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={shippingCharges}
                  onChange={(e) => onChangeShippingCharges(Math.max(0, Number(e.target.value) || 0))}
                  className="w-28 px-2 py-1 border border-slate-300 rounded bg-white text-right tabular-nums"
                />
              </div>

              <div className="flex items-center justify-between gap-2">
                <span className="text-slate-600">Adjustment (LKR)</span>
                <input
                  type="number"
                  step="0.01"
                  value={adjustment}
                  onChange={(e) => onChangeAdjustment(Number(e.target.value) || 0)}
                  className="w-28 px-2 py-1 border border-slate-300 rounded bg-white text-right tabular-nums"
                />
              </div>
            </>
          )}

          <div className="flex justify-between">
            <span className="text-slate-600">Tax Total</span>
            <span className="font-medium tabular-nums">{formatLKR(totals.taxTotal)}</span>
          </div>

          <div className="flex justify-between pt-2 border-t border-slate-300 text-sm font-bold text-slate-900">
            <span>Total</span>
            <span className="tabular-nums">{formatLKR(totals.total)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
