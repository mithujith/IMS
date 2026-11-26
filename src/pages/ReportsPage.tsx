import { useCallback, useEffect, useMemo, useState } from 'react';
import { collection, getDocs } from 'firebase/firestore';
import { Download, Printer } from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { db } from '../firebase';
import { useOrg } from '../hooks/useOrg';
import { BillDoc, InvoiceDoc, Item, StockLedgerEntry } from '../types';
import { exportToCsv } from '../lib/csv';
import { formatDateISO, formatLKR, roundCurrency } from '../lib/formatters';

type ReportId =
  | 'inventory_summary'
  | 'stock_valuation'
  | 'stock_aging'
  | 'reorder_level'
  | 'sales_by_item'
  | 'sales_by_customer'
  | 'purchases_by_vendor'
  | 'receivables_aging'
  | 'payables_aging'
  | 'profit_and_loss'
  | 'sales_tax_summary';

const REPORTS_MENU: { id: ReportId; label: string; group: string }[] = [
  { id: 'inventory_summary', label: 'Inventory Summary', group: 'Inventory' },
  { id: 'stock_valuation', label: 'Stock Valuation (Weighted Avg)', group: 'Inventory' },
  { id: 'stock_aging', label: 'Stock Aging', group: 'Inventory' },
  { id: 'reorder_level', label: 'Reorder Level Alert', group: 'Inventory' },
  { id: 'sales_by_item', label: 'Sales by Item', group: 'Sales' },
  { id: 'sales_by_customer', label: 'Sales by Customer', group: 'Sales' },
  { id: 'purchases_by_vendor', label: 'Purchases by Vendor', group: 'Purchases' },
  { id: 'receivables_aging', label: 'Receivables Aging', group: 'Receivables & Payables' },
  { id: 'payables_aging', label: 'Payables Aging', group: 'Receivables & Payables' },
  { id: 'profit_and_loss', label: 'Profit & Loss', group: 'Financial' },
  { id: 'sales_tax_summary', label: 'Sales Tax Summary', group: 'Financial' },
];

export function ReportsPage() {
  const { orgId } = useOrg();
  const [activeReport, setActiveReport] = useState<ReportId>('inventory_summary');
  const [startDate, setStartDate] = useState(
    formatDateISO(new Date(Date.now() - 90 * 86400000))
  );
  const [endDate, setEndDate] = useState(formatDateISO());
  const [loading, setLoading] = useState(true);

  const [items, setItems] = useState<Item[]>([]);
  const [invoices, setInvoices] = useState<InvoiceDoc[]>([]);
  const [bills, setBills] = useState<BillDoc[]>([]);
  const [ledger, setLedger] = useState<StockLedgerEntry[]>([]);

  const loadData = useCallback(async () => {
    if (!orgId) return;
    setLoading(true);
    try {
      const [itemSnap, invSnap, billSnap, ledSnap] = await Promise.all([
        getDocs(collection(db, `organizations/${orgId}/items`)),
        getDocs(collection(db, `organizations/${orgId}/invoices`)),
        getDocs(collection(db, `organizations/${orgId}/bills`)),
        getDocs(collection(db, `organizations/${orgId}/stockLedger`)),
      ]);
      setItems(
        itemSnap.docs
          .map((d) => ({ id: d.id, ...(d.data() as Omit<Item, 'id'>) }))
          .filter((i) => !i.isDeleted)
      );
      setInvoices(
        invSnap.docs
          .map((d) => ({ id: d.id, ...(d.data() as Omit<InvoiceDoc, 'id'>) }))
          .filter((i) => !i.isDeleted && i.status !== 'void')
      );
      setBills(
        billSnap.docs
          .map((d) => ({ id: d.id, ...(d.data() as Omit<BillDoc, 'id'>) }))
          .filter((b) => !b.isDeleted && b.status !== 'void')
      );
      setLedger(
        ledSnap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<StockLedgerEntry, 'id'>) }))
      );
    } finally {
      setLoading(false);
    }
  }, [orgId]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const inRange = (dateStr: string) => {
    if (!dateStr) return true;
    return dateStr >= startDate && dateStr <= endDate;
  };

  const filteredInvoices = useMemo(
    () => invoices.filter((i) => inRange(i.date)),
    [invoices, startDate, endDate]
  );
  const filteredBills = useMemo(
    () => bills.filter((b) => inRange(b.date)),
    [bills, startDate, endDate]
  );

  const reportPayload = useMemo((): {
    headers: string[];
    rows: (string | number)[][];
    chartData: { name: string; value: number }[];
    summary: string;
  } => {
    const todayMs = Date.now();
    const itemCostMap = Object.fromEntries(items.map((i) => [i.id, i.costPrice]));

    switch (activeReport) {
      case 'inventory_summary': {
        const tableRows = items.map((it) => [
          it.sku,
          it.name,
          it.unit,
          it.totalStock,
          it.totalCommitted ?? 0,
          Math.max(0, it.totalStock - (it.totalCommitted ?? 0)),
          it.reorderLevel,
        ]);
        return {
          headers: ['SKU', 'Item Name', 'Unit', 'On Hand', 'Committed', 'Available', 'Reorder Level'],
          rows: tableRows,
          chartData: items
            .slice()
            .sort((a, b) => b.totalStock - a.totalStock)
            .slice(0, 10)
            .map((i) => ({ name: i.sku, value: i.totalStock })),
          summary: `${items.length} active SKUs tracked across all warehouses.`,
        };
      }

      case 'stock_valuation': {
        let totalVal = 0;
        const tableRows = items.map((it) => {
          const val = roundCurrency(it.totalStock * it.costPrice);
          totalVal += val;
          return [it.sku, it.name, it.totalStock, formatLKR(it.costPrice), formatLKR(val)];
        });
        return {
          headers: ['SKU', 'Item Name', 'Qty On Hand', 'Weighted Avg Cost', 'Asset Value'],
          rows: tableRows,
          chartData: items
            .map((i) => ({ name: i.sku, value: roundCurrency(i.totalStock * i.costPrice) }))
            .sort((a, b) => b.value - a.value)
            .slice(0, 10),
          summary: `Total Inventory Valuation: ${formatLKR(totalVal)}`,
        };
      }

      case 'stock_aging': {
        const lastMovedByItem: Record<string, string> = {};
        for (const entry of ledger) {
          if (!lastMovedByItem[entry.itemId] || entry.date > lastMovedByItem[entry.itemId]) {
            lastMovedByItem[entry.itemId] = entry.date;
          }
        }
        const buckets = { '0-30 Days': 0, '31-60 Days': 0, '61-90 Days': 0, '90+ Days': 0 };
        const tableRows = items.map((it) => {
          const lastDate = lastMovedByItem[it.id] || formatDateISO();
          const ageDays = Math.max(0, Math.floor((todayMs - new Date(lastDate).getTime()) / 86400000));
          const val = roundCurrency(it.totalStock * it.costPrice);
          if (ageDays <= 30) buckets['0-30 Days'] += val;
          else if (ageDays <= 60) buckets['31-60 Days'] += val;
          else if (ageDays <= 90) buckets['61-90 Days'] += val;
          else buckets['90+ Days'] += val;
          return [it.sku, it.name, it.totalStock, lastDate, ageDays, formatLKR(val)];
        });
        return {
          headers: ['SKU', 'Item', 'On Hand', 'Last Movement', 'Age (Days)', 'Stock Value'],
          rows: tableRows,
          chartData: Object.entries(buckets).map(([name, value]) => ({ name, value: roundCurrency(value) })),
          summary: 'Stock value grouped by days since last warehouse movement.',
        };
      }

      case 'reorder_level': {
        const low = items.filter((i) => i.totalStock <= i.reorderLevel);
        return {
          headers: ['SKU', 'Item Name', 'On Hand', 'Reorder Level', 'Suggested Order Qty', 'Est. Cost'],
          rows: low.map((i) => [
            i.sku,
            i.name,
            i.totalStock,
            i.reorderLevel,
            i.reorderQty || 10,
            formatLKR((i.reorderQty || 10) * i.costPrice),
          ]),
          chartData: low.slice(0, 10).map((i) => ({ name: i.sku, value: i.reorderLevel - i.totalStock })),
          summary: `${low.length} spare part(s) currently at or below reorder threshold.`,
        };
      }

      case 'sales_by_item': {
        const agg: Record<string, { sku: string; name: string; qty: number; rev: number }> = {};
        for (const inv of filteredInvoices) {
          for (const l of inv.lines) {
            if (!agg[l.itemId]) agg[l.itemId] = { sku: l.sku, name: l.itemName, qty: 0, rev: 0 };
            agg[l.itemId].qty += l.quantity;
            agg[l.itemId].rev = roundCurrency(agg[l.itemId].rev + l.lineTotal);
          }
        }
        const sorted = Object.values(agg).sort((a, b) => b.rev - a.rev);
        return {
          headers: ['SKU', 'Item Name', 'Units Sold', 'Sales Revenue'],
          rows: sorted.map((r) => [r.sku, r.name, r.qty, formatLKR(r.rev)]),
          chartData: sorted.slice(0, 10).map((r) => ({ name: r.sku, value: r.rev })),
          summary: `Total invoiced item revenue: ${formatLKR(sorted.reduce((s, r) => s + r.rev, 0))}`,
        };
      }

      case 'sales_by_customer': {
        const agg: Record<string, { name: string; count: number; total: number; balance: number }> = {};
        for (const inv of filteredInvoices) {
          if (!agg[inv.customerId]) {
            agg[inv.customerId] = { name: inv.customerName, count: 0, total: 0, balance: 0 };
          }
          agg[inv.customerId].count += 1;
          agg[inv.customerId].total = roundCurrency(agg[inv.customerId].total + inv.total);
          agg[inv.customerId].balance = roundCurrency(agg[inv.customerId].balance + inv.balanceDue);
        }
        const sorted = Object.values(agg).sort((a, b) => b.total - a.total);
        return {
          headers: ['Customer', 'Invoices', 'Total Sales', 'Balance Due'],
          rows: sorted.map((r) => [r.name, r.count, formatLKR(r.total), formatLKR(r.balance)]),
          chartData: sorted.slice(0, 8).map((r) => ({ name: r.name.slice(0, 18), value: r.total })),
          summary: `Active customers in range: ${sorted.length}`,
        };
      }

      case 'purchases_by_vendor': {
        const agg: Record<string, { name: string; count: number; total: number; balance: number }> = {};
        for (const b of filteredBills) {
          if (!agg[b.vendorId]) {
            agg[b.vendorId] = { name: b.vendorName, count: 0, total: 0, balance: 0 };
          }
          agg[b.vendorId].count += 1;
          agg[b.vendorId].total = roundCurrency(agg[b.vendorId].total + b.total);
          agg[b.vendorId].balance = roundCurrency(agg[b.vendorId].balance + b.balanceDue);
        }
        const sorted = Object.values(agg).sort((a, b) => b.total - a.total);
        return {
          headers: ['Vendor', 'Bills', 'Total Billed', 'Payable Balance'],
          rows: sorted.map((r) => [r.name, r.count, formatLKR(r.total), formatLKR(r.balance)]),
          chartData: sorted.slice(0, 8).map((r) => ({ name: r.name.slice(0, 18), value: r.total })),
          summary: `Total purchases: ${formatLKR(sorted.reduce((s, r) => s + r.total, 0))}`,
        };
      }

      case 'receivables_aging': {
        const openInv = invoices.filter((i) => i.balanceDue > 0);
        const buckets = { Current: 0, '1-30 Days': 0, '31-60 Days': 0, '60+ Days': 0 };
        const rowsList = openInv.map((inv) => {
          const overdueDays = Math.floor((todayMs - new Date(inv.dueDate).getTime()) / 86400000);
          if (overdueDays <= 0) buckets.Current += inv.balanceDue;
          else if (overdueDays <= 30) buckets['1-30 Days'] += inv.balanceDue;
          else if (overdueDays <= 60) buckets['31-60 Days'] += inv.balanceDue;
          else buckets['60+ Days'] += inv.balanceDue;
          return [
            inv.invoiceNumber,
            inv.customerName,
            inv.dueDate,
            overdueDays > 0 ? `${overdueDays}d overdue` : 'Current',
            formatLKR(inv.balanceDue),
          ];
        });
        return {
          headers: ['Invoice #', 'Customer', 'Due Date', 'Aging Bucket', 'Balance Due'],
          rows: rowsList,
          chartData: Object.entries(buckets).map(([name, value]) => ({ name, value: roundCurrency(value) })),
          summary: `Total Receivables: ${formatLKR(openInv.reduce((s, i) => s + i.balanceDue, 0))}`,
        };
      }

      case 'payables_aging': {
        const openBills = bills.filter((b) => b.balanceDue > 0);
        const buckets = { Current: 0, '1-30 Days': 0, '31-60 Days': 0, '60+ Days': 0 };
        const rowsList = openBills.map((b) => {
          const overdueDays = Math.floor((todayMs - new Date(b.dueDate).getTime()) / 86400000);
          if (overdueDays <= 0) buckets.Current += b.balanceDue;
          else if (overdueDays <= 30) buckets['1-30 Days'] += b.balanceDue;
          else if (overdueDays <= 60) buckets['31-60 Days'] += b.balanceDue;
          else buckets['60+ Days'] += b.balanceDue;
          return [
            b.billNumber,
            b.vendorName,
            b.dueDate,
            overdueDays > 0 ? `${overdueDays}d overdue` : 'Current',
            formatLKR(b.balanceDue),
          ];
        });
        return {
          headers: ['Bill #', 'Vendor', 'Due Date', 'Aging Bucket', 'Balance Due'],
          rows: rowsList,
          chartData: Object.entries(buckets).map(([name, value]) => ({ name, value: roundCurrency(value) })),
          summary: `Total Payables: ${formatLKR(openBills.reduce((s, b) => s + b.balanceDue, 0))}`,
        };
      }

      case 'profit_and_loss': {
        const revenueExTax = roundCurrency(
          filteredInvoices.reduce((s, i) => s + (i.subtotal - i.discountAmount), 0)
        );
        let cogs = 0;
        for (const inv of filteredInvoices) {
          for (const l of inv.lines) {
            cogs = roundCurrency(cogs + l.quantity * (itemCostMap[l.itemId] ?? 0));
          }
        }
        const grossProfit = roundCurrency(revenueExTax - cogs);
        const purchaseBills = roundCurrency(
          filteredBills.reduce((s, b) => s + (b.subtotal - b.discountAmount), 0)
        );
        const taxCollected = roundCurrency(filteredInvoices.reduce((s, i) => s + i.taxTotal, 0));
        return {
          headers: ['Account / Metric', 'Amount (LKR)'],
          rows: [
            ['Sales Revenue (Excl. Tax)', formatLKR(revenueExTax)],
            ['Cost of Goods Sold (COGS)', formatLKR(cogs)],
            ['Gross Profit', formatLKR(grossProfit)],
            ['Vendor Purchases Billed (Excl. Tax)', formatLKR(purchaseBills)],
            ['Output VAT / Sales Tax Collected', formatLKR(taxCollected)],
          ],
          chartData: [
            { name: 'Revenue', value: revenueExTax },
            { name: 'COGS', value: cogs },
            { name: 'Gross Profit', value: Math.max(0, grossProfit) },
            { name: 'Billed Purchases', value: purchaseBills },
          ],
          summary: `Gross Margin: ${revenueExTax > 0 ? ((grossProfit / revenueExTax) * 100).toFixed(1) : '0.0'}%`,
        };
      }

      case 'sales_tax_summary': {
        const outTax = roundCurrency(filteredInvoices.reduce((s, i) => s + i.taxTotal, 0));
        const inTax = roundCurrency(filteredBills.reduce((s, b) => s + b.taxTotal, 0));
        const netTax = roundCurrency(outTax - inTax);
        return {
          headers: ['Tax Category', 'Taxable Amount', 'Tax Amount (LKR)'],
          rows: [
            ['Output VAT on Sales Invoices', formatLKR(filteredInvoices.reduce((s, i) => s + i.subtotal, 0)), formatLKR(outTax)],
            ['Input VAT on Vendor Bills', formatLKR(filteredBills.reduce((s, b) => s + b.subtotal, 0)), formatLKR(inTax)],
            ['Net VAT Payable / (Claimable)', '—', formatLKR(netTax)],
          ],
          chartData: [
            { name: 'Output VAT', value: outTax },
            { name: 'Input VAT', value: inTax },
            { name: 'Net VAT', value: Math.max(0, netTax) },
          ],
          summary: `Net VAT Position for Period: ${formatLKR(netTax)}`,
        };
      }
    }
  }, [activeReport, items, invoices, bills, ledger, filteredInvoices, filteredBills]);

  const activeTitle = REPORTS_MENU.find((r) => r.id === activeReport)?.label || 'Report';

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 no-print">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Business &amp; Inventory Reports</h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Real-time financial, tax, aging, and warehouse analytics for A &amp; P Brothers (Pvt) Ltd
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-xs">
          <input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            aria-label="Report start date"
            className="px-2.5 py-1.5 bg-white border border-slate-300 rounded-lg"
          />
          <span className="text-slate-400">to</span>
          <input
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            aria-label="Report end date"
            className="px-2.5 py-1.5 bg-white border border-slate-300 rounded-lg"
          />
          <button
            type="button"
            onClick={() => exportToCsv(`${activeReport}.csv`, reportPayload.headers, reportPayload.rows)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white border border-slate-300 rounded-lg font-medium hover:bg-slate-50"
          >
            <Download className="w-3.5 h-3.5" /> Export CSV
          </button>
          <button
            type="button"
            onClick={() => window.print()}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-[#408dfb] text-white rounded-lg font-medium hover:bg-[#2f7ae5]"
          >
            <Printer className="w-3.5 h-3.5" /> Print / PDF
          </button>
        </div>
      </div>

      <div className="hidden print-only border-b border-slate-200 pb-3 mb-4">
        <p className="text-base font-bold text-[#1f2a44]">A &amp; P Brothers (Pvt) Ltd</p>
        <p className="text-xs text-slate-600 mt-0.5">
          {activeTitle} · Period: {startDate} to {endDate}
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-5 print:block">
        <div className="bg-white border border-slate-200 rounded-lg p-3 h-fit no-print">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 px-2 pb-2">
            Report Catalog
          </p>
          <div className="space-y-1">
            {REPORTS_MENU.map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => setActiveReport(r.id)}
                className={`w-full text-left px-3 py-2 rounded-lg text-xs transition-colors ${
                  activeReport === r.id
                    ? 'bg-[#408dfb] text-white font-semibold'
                    : 'text-slate-700 hover:bg-slate-100'
                }`}
              >
                {r.label}
              </button>
            ))}
          </div>
        </div>

        <div className="lg:col-span-3 space-y-5 print:w-full">
          <div className="bg-white border border-slate-200 rounded-lg p-5 print:border-0 print:p-0">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-base font-semibold text-slate-900">{activeTitle}</h2>
                <p className="text-xs text-slate-500 mt-0.5">{reportPayload.summary}</p>
              </div>
            </div>

            {reportPayload.chartData.length > 0 && (
              <div className="h-60 mb-6 print-avoid-break">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={reportPayload.chartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#64748b' }} />
                    <YAxis tick={{ fontSize: 11, fill: '#64748b' }} />
                    <Tooltip />
                    <Bar dataKey="value" fill="#408dfb" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}

            {loading ? (
              <p className="text-xs text-slate-500 py-8 text-center">Generating report...</p>
            ) : (
              <div className="border border-slate-200 rounded-lg overflow-x-auto print:overflow-visible print:border-slate-300">
                <table className="w-full text-xs print-sheet-table">
                  <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                    <tr>
                      {reportPayload.headers.map((h) => (
                        <th key={h} className="text-left px-3 py-2.5 font-medium whitespace-nowrap">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {reportPayload.rows.length === 0 ? (
                      <tr>
                        <td colSpan={reportPayload.headers.length} className="px-3 py-6 text-center text-slate-400">
                          No records match the selected date range.
                        </td>
                      </tr>
                    ) : (
                      reportPayload.rows.map((row, idx) => (
                        <tr key={idx} className="hover:bg-slate-50">
                          {row.map((cell, ci) => (
                            <td key={ci} className="px-3 py-2.5 text-slate-700 tabular-nums whitespace-nowrap">
                              {cell}
                            </td>
                          ))}
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
