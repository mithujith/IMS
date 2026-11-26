import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { collection, DocumentData, getDocs, QueryDocumentSnapshot } from 'firebase/firestore';
import { CheckCircle2, Copy, CreditCard, Printer, X } from 'lucide-react';
import { db } from '../firebase';
import { useOrg } from '../hooks/useOrg';
import { useAuth } from '../hooks/useAuth';
import { useToast } from '../hooks/useToast';
import { BillDoc, Item, TaxRate, Vendor, Warehouse } from '../types';
import { fetchPagedCollection, PagedFilter, softDeleteOrgDoc } from '../services/firestoreList';
import { createBill, recordPaymentMade } from '../services/purchasesService';
import { DataTable, TableColumn } from '../components/DataTable';
import { StatusBadge } from '../components/StatusBadge';
import { buildComputedDocumentLines, EditableLineInput, LineItemsEditor } from '../components/LineItemsEditor';
import { DocumentPrintModal, PrintableDocumentData } from '../components/DocumentPrintModal';
import { RecordCommentsAndAttachments } from '../components/RecordCommentsAndAttachments';
import { exportToCsv } from '../lib/csv';
import { formatDateISO, formatDisplayDate, formatLKR } from '../lib/formatters';

const BILL_TABS = [
  { key: 'all', label: 'All Bills' },
  { key: 'draft', label: 'Draft' },
  { key: 'open', label: 'Open' },
  { key: 'partially_paid', label: 'Partially Paid' },
  { key: 'paid', label: 'Paid' },
  { key: 'overdue', label: 'Overdue' },
];

export function BillsPage() {
  const { orgId, org, can } = useOrg();
  const { user } = useAuth();
  const { showToast } = useToast();
  const [searchParams, setSearchParams] = useSearchParams();

  const [rows, setRows] = useState<BillDoc[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [taxes, setTaxes] = useState<TaxRate[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('all');
  const [search, setSearch] = useState('');
  const [cursorStack, setCursorStack] = useState<(QueryDocumentSnapshot<DocumentData> | null)[]>([null]);
  const [pageIdx, setPageIdx] = useState(0);
  const [hasMore, setHasMore] = useState(false);

  const [modalOpen, setModalOpen] = useState(false);
  const [selected, setSelected] = useState<BillDoc | null>(null);
  const [printDoc, setPrintDoc] = useState<PrintableDocumentData | null>(null);
  const [payTarget, setPayTarget] = useState<BillDoc | null>(null);

  const [vendorId, setVendorId] = useState('');
  const [warehouseId, setWarehouseId] = useState('');
  const [date, setDate] = useState(formatDateISO());
  const [dueDate, setDueDate] = useState(formatDateISO(new Date(Date.now() + 30 * 86400000)));
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<EditableLineInput[]>([
    { itemId: '', quantity: 10, rate: 0, discountType: 'percent', discountValue: 0, taxRate: 18, taxInclusive: false },
  ]);
  const [docDiscountType, setDocDiscountType] = useState<'percent' | 'amount'>('percent');
  const [docDiscountValue, setDocDiscountValue] = useState(0);
  const [shippingCharges, setShippingCharges] = useState(0);
  const [adjustment, setAdjustment] = useState(0);
  const [saving, setSaving] = useState(false);

  const [payAmount, setPayAmount] = useState('0');
  const [payMode, setPayMode] = useState<'Cash' | 'Bank Transfer' | 'Cheque' | 'Card'>('Bank Transfer');
  const [payRef, setPayRef] = useState('');

  const load = useCallback(
    async (cursor: QueryDocumentSnapshot<DocumentData> | null) => {
      if (!orgId) return;
      setLoading(true);
      try {
        const filters: PagedFilter[] = [];
        if (activeTab !== 'all') filters.push({ field: 'status', op: '==', value: activeTab });
        const [res, vendSnap, itemSnap, whSnap, taxSnap] = await Promise.all([
          fetchPagedCollection<BillDoc>({ orgId, subcollection: 'bills', pageSize: 25, cursor, filters }),
          getDocs(collection(db, `organizations/${orgId}/vendors`)),
          getDocs(collection(db, `organizations/${orgId}/items`)),
          getDocs(collection(db, `organizations/${orgId}/warehouses`)),
          getDocs(collection(db, `organizations/${orgId}/taxes`)),
        ]);
        setRows(res.items);
        setHasMore(res.hasMore);
        const vends = vendSnap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Vendor, 'id'>) })).filter((v) => !v.isDeleted);
        setVendors(vends);
        if (vends.length > 0 && !vendorId) setVendorId(vends[0].id);
        setItems(itemSnap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Item, 'id'>) })).filter((i) => !i.isDeleted));
        const whs = whSnap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Warehouse, 'id'>) })).filter((w) => !w.isDeleted);
        setWarehouses(whs);
        setTaxes(taxSnap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<TaxRate, 'id'>) })).filter((t) => !t.isDeleted));
        if (whs.length > 0 && !warehouseId) setWarehouseId(whs[0].id);
        if (res.lastDoc) {
          setCursorStack((prev) => {
            const copy = [...prev];
            copy[pageIdx + 1] = res.lastDoc;
            return copy;
          });
        }
      } finally {
        setLoading(false);
      }
    },
    [orgId, activeTab, pageIdx, warehouseId]
  );

  useEffect(() => {
    setPageIdx(0);
    setCursorStack([null]);
    void load(null);
  }, [orgId, activeTab]);

  const itemMap = Object.fromEntries(items.map((i) => [i.id, i]));

  const openNewOrClone = (cloneFrom?: BillDoc) => {
    if (cloneFrom) {
      setVendorId(cloneFrom.vendorId);
      setWarehouseId(cloneFrom.warehouseId);
      setDate(formatDateISO());
      setNotes(cloneFrom.notes || '');
      setDocDiscountType(cloneFrom.discountType);
      setDocDiscountValue(cloneFrom.discountValue);
      setShippingCharges(cloneFrom.shippingCharges);
      setAdjustment(cloneFrom.adjustment);
      setLines(
        cloneFrom.lines.map((l) => ({
          itemId: l.itemId,
          quantity: l.quantity,
          rate: l.rate,
          discountType: l.discountType,
          discountValue: l.discountValue,
          taxRate: l.taxRate,
          taxInclusive: Boolean(l.taxInclusive),
        }))
      );
    } else {
      setVendorId(vendors[0]?.id || '');
      setDate(formatDateISO());
      setDueDate(formatDateISO(new Date(Date.now() + 30 * 86400000)));
      setNotes('');
      setDocDiscountType('percent');
      setDocDiscountValue(0);
      setShippingCharges(0);
      setAdjustment(0);
      setLines([
        { itemId: '', quantity: 10, rate: 0, discountType: 'percent', discountValue: 0, taxRate: 18, taxInclusive: false },
      ]);
    }
    setModalOpen(true);
  };

  useEffect(() => {
    if (searchParams.get('new') === '1') {
      openNewOrClone();
      const next = new URLSearchParams(searchParams);
      next.delete('new');
      setSearchParams(next, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  const handleSave = async (status: 'draft' | 'open') => {
    if (!orgId || !user) return;
    const vend = vendors.find((v) => v.id === vendorId);
    const totals = buildComputedDocumentLines(lines, itemMap, warehouseId, docDiscountType, docDiscountValue, shippingCharges, adjustment);
    if (!vend || totals.lines.length === 0) {
      showToast('Select vendor and at least one item', 'error');
      return;
    }
    setSaving(true);
    try {
      await createBill({
        orgId,
        userId: user.uid,
        userName: user.displayName || user.email || 'User',
        data: {
          vendorId: vend.id,
          vendorName: vend.name,
          date,
          dueDate,
          paymentTerms: vend.paymentTerms,
          warehouseId: warehouseId || warehouses[0]?.id || '',
          status,
          lines: totals.lines,
          subtotal: totals.subtotal,
          discountType: docDiscountType,
          discountValue: docDiscountValue,
          discountAmount: totals.discountAmount,
          taxTotal: totals.taxTotal,
          shippingCharges,
          adjustment,
          total: totals.total,
          amountPaid: 0,
          balanceDue: totals.total,
          notes: notes.trim(),
        },
      });
      setModalOpen(false);
      showToast('Bill created', 'success');
      await load(cursorStack[pageIdx] ?? null);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to create bill', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handlePayBill = async () => {
    if (!orgId || !user || !payTarget) return;
    const amt = Number(payAmount) || 0;
    if (amt <= 0) return;
    setSaving(true);
    try {
      await recordPaymentMade({
        orgId,
        userId: user.uid,
        userName: user.displayName || user.email || 'User',
        vendorId: payTarget.vendorId,
        vendorName: payTarget.vendorName,
        date: formatDateISO(),
        mode: payMode,
        referenceNumber: payRef.trim(),
        allocations: [{ billId: payTarget.id, amountApplied: amt }],
      });
      setPayTarget(null);
      setSelected(null);
      showToast(`Recorded vendor payment for ${payTarget.billNumber}`, 'success');
      await load(cursorStack[pageIdx] ?? null);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Payment failed', 'error');
    } finally {
      setSaving(false);
    }
  };

  const columns: TableColumn<BillDoc>[] = [
    { key: 'date', label: 'Date', render: (r) => formatDisplayDate(r.date) },
    {
      key: 'billNumber',
      label: 'Bill #',
      sortable: true,
      sortValue: (r) => r.billNumber,
      render: (r) => <span className="font-mono-num font-semibold text-[#408dfb]">{r.billNumber}</span>,
    },
    { key: 'vendorName', label: 'Vendor', render: (r) => <span className="font-medium text-slate-900">{r.vendorName}</span> },
    { key: 'dueDate', label: 'Due Date', render: (r) => formatDisplayDate(r.dueDate) },
    { key: 'status', label: 'Status', render: (r) => <StatusBadge status={r.status} /> },
    { key: 'total', label: 'Total', align: 'right', render: (r) => formatLKR(r.total) },
    { key: 'balanceDue', label: 'Balance Due', align: 'right', render: (r) => <span className="font-semibold">{formatLKR(r.balanceDue)}</span> },
  ];

  return (
    <div className="space-y-6">
      <DataTable
        title="Vendor Bills"
        subtitle="Track supplier payables, partial payments, and aging balances"
        rows={rows}
        columns={columns}
        loading={loading}
        statusTabs={BILL_TABS}
        activeTab={activeTab}
        onTabChange={setActiveTab}
        searchQuery={search}
        onSearchChange={setSearch}
        searchPredicate={(r, q) => r.billNumber.toLowerCase().includes(q) || r.vendorName.toLowerCase().includes(q)}
        onRowClick={(r) => setSelected(r)}
        canCreate={can('bills', 'create')}
        newButtonLabel="New Bill"
        onNewClick={() => openNewOrClone()}
        canDelete={can('bills', 'delete')}
        onBulkDelete={async (ids) => {
          if (!orgId || !user) return;
          for (const id of ids) await softDeleteOrgDoc(orgId, 'bills', id, user.uid);
          showToast('Deleted selected bills', 'success');
          await load(cursorStack[pageIdx] ?? null);
        }}
        onExportCsv={(visible) => {
          exportToCsv(
            'bills.csv',
            ['Date', 'Bill #', 'Vendor', 'Due Date', 'Status', 'Total', 'Balance Due'],
            visible.map((r) => [r.date, r.billNumber, r.vendorName, r.dueDate, r.status, r.total, r.balanceDue])
          );
        }}
        pageNumber={pageIdx + 1}
        hasMore={hasMore}
        onNextPage={() => {
          const nextIdx = pageIdx + 1;
          setPageIdx(nextIdx);
          void load(cursorStack[nextIdx] ?? null);
        }}
        onPrevPage={() => {
          const prevIdx = Math.max(0, pageIdx - 1);
          setPageIdx(prevIdx);
          void load(cursorStack[prevIdx] ?? null);
        }}
      />

      {modalOpen && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-900/50 p-4 overflow-y-auto">
          <div className="bg-white rounded-xl border border-slate-200 shadow-xl max-w-4xl w-full p-5 my-6 max-h-[92vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-semibold text-slate-900">New Vendor Bill</h2>
              <button type="button" onClick={() => setModalOpen(false)} aria-label="Close"><X className="w-4 h-4 text-slate-400" /></button>
            </div>
            <div className="space-y-4 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                <div className="sm:col-span-2">
                  <label className="block font-medium text-slate-700 mb-1">Vendor *</label>
                  <select value={vendorId} onChange={(e) => setVendorId(e.target.value)} className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white">
                    <option value="">Select vendor...</option>
                    {vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Bill Date</label>
                  <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-full px-3 py-2 border border-slate-300 rounded-lg" />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Due Date</label>
                  <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className="w-full px-3 py-2 border border-slate-300 rounded-lg" />
                </div>
              </div>

              <LineItemsEditor
                mode="purchase"
                items={items}
                taxes={taxes}
                warehouseId={warehouseId}
                lines={lines}
                onChangeLines={setLines}
                docDiscountType={docDiscountType}
                docDiscountValue={docDiscountValue}
                onChangeDocDiscount={(t, v) => {
                  setDocDiscountType(t);
                  setDocDiscountValue(v);
                }}
                shippingCharges={shippingCharges}
                onChangeShippingCharges={setShippingCharges}
                adjustment={adjustment}
                onChangeAdjustment={setAdjustment}
              />

              <div>
                <label className="block font-medium text-slate-700 mb-1">Notes</label>
                <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} className="w-full px-3 py-2 border border-slate-300 rounded-lg" />
              </div>

              <div className="pt-3 flex justify-end gap-2 border-t border-slate-200">
                <button type="button" onClick={() => setModalOpen(false)} className="px-4 py-2 border border-slate-300 rounded-lg">Cancel</button>
                <button type="button" disabled={saving} onClick={() => handleSave('draft')} className="px-4 py-2 border border-slate-300 bg-slate-50 rounded-lg font-medium">Save Draft</button>
                <button type="button" disabled={saving} onClick={() => handleSave('open')} className="px-4 py-2 bg-[#408dfb] text-white rounded-lg font-medium">
                  {saving ? 'Saving...' : 'Save Bill'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {selected && (
        <div className="fixed inset-0 z-[70] flex items-center justify-end bg-slate-900/40">
          <div className="bg-white h-full max-w-3xl w-full p-6 overflow-y-auto shadow-2xl">
            <div className="flex flex-wrap items-center justify-between gap-2 pb-4 border-b border-slate-200">
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-lg font-bold text-slate-900">{selected.billNumber}</h2>
                  <StatusBadge status={selected.status} />
                </div>
                <p className="text-xs text-slate-500 mt-0.5">{selected.vendorName} · Due {formatDisplayDate(selected.dueDate)}</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() =>
                    setPrintDoc({
                      docTitle: 'VENDOR BILL',
                      docNumber: selected.billNumber,
                      date: selected.date,
                      dueDate: selected.dueDate,
                      partyLabel: 'Vendor',
                      partyName: selected.vendorName,
                      status: selected.status,
                      lines: selected.lines,
                      subtotal: selected.subtotal,
                      discountAmount: selected.discountAmount,
                      taxTotal: selected.taxTotal,
                      shippingCharges: selected.shippingCharges,
                      adjustment: selected.adjustment,
                      total: selected.total,
                      amountPaid: selected.amountPaid,
                      balanceDue: selected.balanceDue,
                      notes: selected.notes,
                    })
                  }
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg"
                >
                  <Printer className="w-3.5 h-3.5" /> Print / PDF
                </button>
                {can('bills', 'create') && (
                  <button type="button" onClick={() => { const b = selected; setSelected(null); openNewOrClone(b); }} className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg">
                    <Copy className="w-3.5 h-3.5" /> Clone
                  </button>
                )}
                {selected.balanceDue > 0 && can('paymentsMade', 'create') && (
                  <button
                    type="button"
                    onClick={() => {
                      setPayTarget(selected);
                      setPayAmount(String(selected.balanceDue));
                    }}
                    className="inline-flex items-center gap-1 px-3 py-1.5 text-xs bg-[#408dfb] text-white rounded-lg font-medium"
                  >
                    <CreditCard className="w-3.5 h-3.5" /> Record Payment
                  </button>
                )}
                <button type="button" onClick={() => setSelected(null)} aria-label="Close"><X className="w-5 h-5 text-slate-400" /></button>
              </div>
            </div>

            <div className="mt-4 space-y-4 text-xs">
              <table className="w-full border border-slate-200 rounded-lg overflow-hidden">
                <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                  <tr>
                    <th className="text-left px-3 py-2">Item</th>
                    <th className="text-right px-3 py-2">Qty</th>
                    <th className="text-right px-3 py-2">Rate</th>
                    <th className="text-right px-3 py-2">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {selected.lines.map((l, i) => (
                    <tr key={i}>
                      <td className="px-3 py-2">{l.sku} — {l.itemName}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{l.quantity}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{formatLKR(l.rate)}</td>
                      <td className="px-3 py-2 text-right font-semibold tabular-nums">{formatLKR(l.lineTotal)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <RecordCommentsAndAttachments
                subcollection="bills"
                recordId={selected.id}
                comments={selected.comments}
                attachments={selected.attachments}
                canEdit={can('bills', 'edit')}
                onUpdated={() => load(cursorStack[pageIdx] ?? null)}
              />
            </div>
          </div>
        </div>
      )}

      {payTarget && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-900/50 p-4">
          <div className="bg-white rounded-xl border border-slate-200 shadow-xl max-w-md w-full p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-semibold text-slate-900">Pay Bill · {payTarget.billNumber}</h2>
              <button type="button" onClick={() => setPayTarget(null)} aria-label="Close"><X className="w-4 h-4 text-slate-400" /></button>
            </div>
            <div className="space-y-3 text-xs">
              <div>
                <label className="block font-medium text-slate-700 mb-1">Amount (LKR)</label>
                <input type="number" min="0.01" max={payTarget.balanceDue} step="0.01" value={payAmount} onChange={(e) => setPayAmount(e.target.value)} className="w-full px-3 py-2 border border-slate-300 rounded-lg tabular-nums" />
              </div>
              <div>
                <label className="block font-medium text-slate-700 mb-1">Mode</label>
                <select value={payMode} onChange={(e) => setPayMode(e.target.value as typeof payMode)} className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white">
                  <option value="Bank Transfer">Bank Transfer</option>
                  <option value="Cash">Cash</option>
                  <option value="Cheque">Cheque</option>
                  <option value="Card">Card</option>
                </select>
              </div>
              <div>
                <label className="block font-medium text-slate-700 mb-1">Reference #</label>
                <input type="text" value={payRef} onChange={(e) => setPayRef(e.target.value)} className="w-full px-3 py-2 border border-slate-300 rounded-lg" />
              </div>
              <div className="pt-3 flex justify-end gap-2">
                <button type="button" onClick={() => setPayTarget(null)} className="px-4 py-2 border border-slate-300 rounded-lg">Cancel</button>
                <button type="button" disabled={saving} onClick={handlePayBill} className="inline-flex items-center gap-1 px-4 py-2 bg-[#408dfb] text-white rounded-lg font-medium">
                  <CheckCircle2 className="w-3.5 h-3.5" /> Record Payment
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <DocumentPrintModal open={Boolean(printDoc)} org={org} doc={printDoc} onClose={() => setPrintDoc(null)} />
    </div>
  );
}
