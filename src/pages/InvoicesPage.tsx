import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { collection, DocumentData, getDocs, QueryDocumentSnapshot } from 'firebase/firestore';
import { Ban, CheckCircle2, Copy, CreditCard, Link2, Printer, Send, X } from 'lucide-react';
import { db } from '../firebase';
import { useOrg } from '../hooks/useOrg';
import { useAuth } from '../hooks/useAuth';
import { useToast } from '../hooks/useToast';
import { Customer, InvoiceDoc, Item, PriceList, TaxRate, Warehouse } from '../types';
import { fetchPagedCollection, PagedFilter, softDeleteOrgDoc } from '../services/firestoreList';
import {
  createInvoice,
  createInvoiceShareLink,
  recordPaymentReceived,
  updateInvoiceStatus,
} from '../services/salesService';
import { DataTable, TableColumn } from '../components/DataTable';
import { StatusBadge } from '../components/StatusBadge';
import {
  buildComputedDocumentLines,
  EditableLineInput,
  LineItemsEditor,
} from '../components/LineItemsEditor';
import { DocumentPrintModal, PrintableDocumentData } from '../components/DocumentPrintModal';
import { RecordCommentsAndAttachments } from '../components/RecordCommentsAndAttachments';
import { exportToCsv } from '../lib/csv';
import { formatDateISO, formatDisplayDate, formatLKR } from '../lib/formatters';

const INV_TABS = [
  { key: 'all', label: 'All Invoices' },
  { key: 'draft', label: 'Draft' },
  { key: 'sent', label: 'Sent' },
  { key: 'partially_paid', label: 'Partially Paid' },
  { key: 'paid', label: 'Paid' },
  { key: 'overdue', label: 'Overdue' },
  { key: 'void', label: 'Void' },
];

export function InvoicesPage() {
  const { orgId, org, can } = useOrg();
  const { user } = useAuth();
  const { showToast } = useToast();
  const [searchParams, setSearchParams] = useSearchParams();

  const [rows, setRows] = useState<InvoiceDoc[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [taxes, setTaxes] = useState<TaxRate[]>([]);
  const [priceLists, setPriceLists] = useState<PriceList[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('all');
  const [search, setSearch] = useState('');
  const [cursorStack, setCursorStack] = useState<(QueryDocumentSnapshot<DocumentData> | null)[]>([null]);
  const [pageIdx, setPageIdx] = useState(0);
  const [hasMore, setHasMore] = useState(false);

  const [modalOpen, setModalOpen] = useState(false);
  const [selected, setSelected] = useState<InvoiceDoc | null>(null);
  const [printDoc, setPrintDoc] = useState<PrintableDocumentData | null>(null);
  const [payTarget, setPayTarget] = useState<InvoiceDoc | null>(null);

  const [customerId, setCustomerId] = useState('');
  const [warehouseId, setWarehouseId] = useState('');
  const [date, setDate] = useState(formatDateISO());
  const [dueDate, setDueDate] = useState(formatDateISO(new Date(Date.now() + 30 * 86400000)));
  const [paymentTerms, setPaymentTerms] = useState('Net 30');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<EditableLineInput[]>([
    { itemId: '', quantity: 1, rate: 0, discountType: 'percent', discountValue: 0, taxRate: 18, taxInclusive: false },
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
        const [res, custSnap, itemSnap, whSnap, taxSnap, plSnap] = await Promise.all([
          fetchPagedCollection<InvoiceDoc>({
            orgId,
            subcollection: 'invoices',
            pageSize: 25,
            cursor,
            filters,
          }),
          getDocs(collection(db, `organizations/${orgId}/customers`)),
          getDocs(collection(db, `organizations/${orgId}/items`)),
          getDocs(collection(db, `organizations/${orgId}/warehouses`)),
          getDocs(collection(db, `organizations/${orgId}/taxes`)),
          getDocs(collection(db, `organizations/${orgId}/priceLists`)),
        ]);
        setRows(res.items);
        setHasMore(res.hasMore);
        const custs = custSnap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Customer, 'id'>) })).filter((c) => !c.isDeleted);
        setCustomers(custs);
        if (custs.length > 0 && !customerId) setCustomerId(custs[0].id);
        setItems(itemSnap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Item, 'id'>) })).filter((i) => !i.isDeleted));
        const whs = whSnap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Warehouse, 'id'>) })).filter((w) => !w.isDeleted);
        setWarehouses(whs);
        setTaxes(taxSnap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<TaxRate, 'id'>) })).filter((t) => !t.isDeleted));
        setPriceLists(plSnap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<PriceList, 'id'>) })).filter((p) => !p.isDeleted));
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

  const custMap = Object.fromEntries(customers.map((c) => [c.id, c]));
  const itemMap = Object.fromEntries(items.map((i) => [i.id, i]));
  const selectedCustomer = custMap[customerId];
  const activePriceList = selectedCustomer?.priceListId
    ? priceLists.find((p) => p.id === selectedCustomer.priceListId) ?? null
    : null;

  const openNewOrClone = (cloneFrom?: InvoiceDoc) => {
    if (cloneFrom) {
      setCustomerId(cloneFrom.customerId);
      setWarehouseId(cloneFrom.warehouseId);
      setDate(formatDateISO());
      setPaymentTerms(cloneFrom.paymentTerms);
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
      setCustomerId(customers[0]?.id || '');
      setDate(formatDateISO());
      setDueDate(formatDateISO(new Date(Date.now() + 30 * 86400000)));
      setPaymentTerms('Net 30');
      setNotes('');
      setDocDiscountType('percent');
      setDocDiscountValue(0);
      setShippingCharges(0);
      setAdjustment(0);
      setLines([
        { itemId: '', quantity: 1, rate: 0, discountType: 'percent', discountValue: 0, taxRate: 18, taxInclusive: false },
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

  const handleSave = async (status: 'draft' | 'sent') => {
    if (!orgId || !user) return;
    const cust = custMap[customerId];
    if (!cust) {
      showToast('Select a customer', 'error');
      return;
    }
    const totals = buildComputedDocumentLines(
      lines,
      itemMap,
      warehouseId,
      docDiscountType,
      docDiscountValue,
      shippingCharges,
      adjustment
    );
    if (totals.lines.length === 0) {
      showToast('Add at least one line item', 'error');
      return;
    }

    setSaving(true);
    try {
      await createInvoice({
        orgId,
        userId: user.uid,
        userName: user.displayName || user.email || 'User',
        data: {
          customerId: cust.id,
          customerName: cust.name,
          date,
          dueDate,
          paymentTerms,
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
      showToast('Invoice created', 'success');
      await load(cursorStack[pageIdx] ?? null);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to create invoice', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleQuickPayment = async () => {
    if (!orgId || !user || !payTarget) return;
    const amt = Number(payAmount) || 0;
    if (amt <= 0) {
      showToast('Enter a valid payment amount', 'error');
      return;
    }
    setSaving(true);
    try {
      await recordPaymentReceived({
        orgId,
        userId: user.uid,
        userName: user.displayName || user.email || 'User',
        customerId: payTarget.customerId,
        customerName: payTarget.customerName,
        date: formatDateISO(),
        mode: payMode,
        referenceNumber: payRef.trim(),
        allocations: [{ invoiceId: payTarget.id, amountApplied: amt }],
      });
      setPayTarget(null);
      setSelected(null);
      showToast(`Recorded payment for ${payTarget.invoiceNumber}`, 'success');
      await load(cursorStack[pageIdx] ?? null);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Payment failed', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleShareInvoice = async (inv: InvoiceDoc): Promise<string> => {
    if (!org || !user) return '';
    const token = await createInvoiceShareLink({ org, invoice: inv, userId: user.uid });
    const url = `${window.location.origin}/share/invoice/${token}`;
    showToast('Shareable link created & copied', 'success');
    return url;
  };

  const columns: TableColumn<InvoiceDoc>[] = [
    { key: 'date', label: 'Date', render: (r) => formatDisplayDate(r.date) },
    {
      key: 'invoiceNumber',
      label: 'Invoice #',
      sortable: true,
      sortValue: (r) => r.invoiceNumber,
      render: (r) => <span className="font-mono-num font-semibold text-[#408dfb]">{r.invoiceNumber}</span>,
    },
    { key: 'customerName', label: 'Customer', render: (r) => <span className="font-medium text-slate-900">{r.customerName}</span> },
    { key: 'dueDate', label: 'Due Date', render: (r) => formatDisplayDate(r.dueDate) },
    { key: 'status', label: 'Status', render: (r) => <StatusBadge status={r.status} /> },
    { key: 'total', label: 'Total', align: 'right', sortable: true, sortValue: (r) => r.total, render: (r) => formatLKR(r.total) },
    { key: 'balanceDue', label: 'Balance Due', align: 'right', render: (r) => <span className="font-semibold">{formatLKR(r.balanceDue)}</span> },
  ];

  return (
    <div className="space-y-6">
      <DataTable
        title="Invoices"
        subtitle="Zoho Books-style tax invoicing with PDF download, shareable links, and payment tracking"
        rows={rows}
        columns={columns}
        loading={loading}
        statusTabs={INV_TABS}
        activeTab={activeTab}
        onTabChange={setActiveTab}
        searchQuery={search}
        onSearchChange={setSearch}
        searchPredicate={(r, q) =>
          r.invoiceNumber.toLowerCase().includes(q) || r.customerName.toLowerCase().includes(q)
        }
        onRowClick={(r) => setSelected(r)}
        canCreate={can('invoices', 'create')}
        newButtonLabel="New Invoice"
        onNewClick={() => openNewOrClone()}
        canDelete={can('invoices', 'delete')}
        onBulkDelete={async (ids) => {
          if (!orgId || !user) return;
          for (const id of ids) await softDeleteOrgDoc(orgId, 'invoices', id, user.uid);
          showToast('Deleted selected invoices', 'success');
          await load(cursorStack[pageIdx] ?? null);
        }}
        onExportCsv={(visible) => {
          exportToCsv(
            'invoices.csv',
            ['Date', 'Invoice #', 'Customer', 'Due Date', 'Status', 'Total', 'Paid', 'Balance Due'],
            visible.map((r) => [r.date, r.invoiceNumber, r.customerName, r.dueDate, r.status, r.total, r.amountPaid, r.balanceDue])
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
              <h2 className="text-base font-semibold text-slate-900">New Tax Invoice</h2>
              <button type="button" onClick={() => setModalOpen(false)} aria-label="Close">
                <X className="w-4 h-4 text-slate-400" />
              </button>
            </div>
            <div className="space-y-4 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                <div className="sm:col-span-2">
                  <label className="block font-medium text-slate-700 mb-1">Customer *</label>
                  <select
                    value={customerId}
                    onChange={(e) => setCustomerId(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white"
                  >
                    <option value="">Select customer...</option>
                    {customers.map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Invoice Date</label>
                  <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-full px-3 py-2 border border-slate-300 rounded-lg" />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Due Date</label>
                  <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className="w-full px-3 py-2 border border-slate-300 rounded-lg" />
                </div>
              </div>

              <LineItemsEditor
                mode="sales"
                items={items}
                taxes={taxes}
                priceList={activePriceList}
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
                <button type="button" onClick={() => setModalOpen(false)} className="px-4 py-2 border border-slate-300 rounded-lg">
                  Cancel
                </button>
                <button type="button" disabled={saving} onClick={() => handleSave('draft')} className="px-4 py-2 border border-slate-300 bg-slate-50 rounded-lg font-medium">
                  Save as Draft
                </button>
                <button type="button" disabled={saving} onClick={() => handleSave('sent')} className="px-4 py-2 bg-[#408dfb] text-white rounded-lg font-medium">
                  {saving ? 'Saving...' : 'Save & Send'}
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
                  <h2 className="text-lg font-bold text-slate-900">{selected.invoiceNumber}</h2>
                  <StatusBadge status={selected.status} />
                </div>
                <p className="text-xs text-slate-500 mt-0.5">
                  {selected.customerName} · Due {formatDisplayDate(selected.dueDate)}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() =>
                    setPrintDoc({
                      docTitle: 'TAX INVOICE',
                      docNumber: selected.invoiceNumber,
                      date: selected.date,
                      dueDate: selected.dueDate,
                      partyLabel: 'Bill To',
                      partyName: selected.customerName,
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
                      terms: selected.terms,
                    })
                  }
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg hover:bg-slate-50"
                >
                  <Printer className="w-3.5 h-3.5" /> Print / PDF
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    const url = await handleShareInvoice(selected);
                    if (url && navigator.clipboard) await navigator.clipboard.writeText(url);
                  }}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg hover:bg-slate-50"
                >
                  <Link2 className="w-3.5 h-3.5" /> Share Link
                </button>
                {can('invoices', 'create') && (
                  <button
                    type="button"
                    onClick={() => {
                      const inv = selected;
                      setSelected(null);
                      openNewOrClone(inv);
                    }}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg hover:bg-slate-50"
                  >
                    <Copy className="w-3.5 h-3.5" /> Clone
                  </button>
                )}
                {selected.status === 'draft' && can('invoices', 'edit') && (
                  <button
                    type="button"
                    onClick={async () => {
                      if (!orgId || !user) return;
                      await updateInvoiceStatus(orgId, selected.id, user.uid, 'sent');
                      showToast('Marked as sent', 'success');
                      setSelected(null);
                      await load(cursorStack[pageIdx] ?? null);
                    }}
                    className="inline-flex items-center gap-1 px-3 py-1.5 text-xs bg-[#1f2a44] text-white rounded-lg"
                  >
                    <Send className="w-3.5 h-3.5" /> Mark Sent
                  </button>
                )}
                {selected.balanceDue > 0 && selected.status !== 'void' && can('paymentsReceived', 'create') && (
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
                {selected.status !== 'void' && selected.amountPaid === 0 && can('invoices', 'edit') && (
                  <button
                    type="button"
                    onClick={async () => {
                      if (!orgId || !user) return;
                      await updateInvoiceStatus(orgId, selected.id, user.uid, 'void');
                      showToast('Invoice voided', 'success');
                      setSelected(null);
                      await load(cursorStack[pageIdx] ?? null);
                    }}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg"
                  >
                    <Ban className="w-3.5 h-3.5" /> Void
                  </button>
                )}
                <button type="button" onClick={() => setSelected(null)} aria-label="Close">
                  <X className="w-5 h-5 text-slate-400" />
                </button>
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
                      <td className="px-3 py-2">
                        <p className="font-medium text-slate-900">{l.itemName}</p>
                        <p className="text-[11px] font-mono-num text-slate-500">{l.sku}</p>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{l.quantity} {l.unit}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{formatLKR(l.rate)}</td>
                      <td className="px-3 py-2 text-right font-semibold tabular-nums">{formatLKR(l.lineTotal)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <div className="flex justify-end">
                <div className="w-64 bg-slate-50 border border-slate-200 rounded-lg p-3 space-y-1">
                  <div className="flex justify-between"><span className="text-slate-600">Total</span><span>{formatLKR(selected.total)}</span></div>
                  <div className="flex justify-between text-emerald-700"><span>Paid</span><span>{formatLKR(selected.amountPaid)}</span></div>
                  <div className="flex justify-between font-bold text-sm border-t border-slate-200 pt-1"><span>Balance Due</span><span>{formatLKR(selected.balanceDue)}</span></div>
                </div>
              </div>

              <RecordCommentsAndAttachments
                subcollection="invoices"
                recordId={selected.id}
                comments={selected.comments}
                attachments={selected.attachments}
                canEdit={can('invoices', 'edit')}
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
              <h2 className="text-base font-semibold text-slate-900">Record Payment · {payTarget.invoiceNumber}</h2>
              <button type="button" onClick={() => setPayTarget(null)} aria-label="Close"><X className="w-4 h-4 text-slate-400" /></button>
            </div>
            <div className="space-y-3 text-xs">
              <div>
                <label className="block font-medium text-slate-700 mb-1">Amount Received (LKR)</label>
                <input
                  type="number"
                  min="0.01"
                  max={payTarget.balanceDue}
                  step="0.01"
                  value={payAmount}
                  onChange={(e) => setPayAmount(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg tabular-nums"
                />
              </div>
              <div>
                <label className="block font-medium text-slate-700 mb-1">Payment Mode</label>
                <select
                  value={payMode}
                  onChange={(e) => setPayMode(e.target.value as typeof payMode)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white"
                >
                  <option value="Bank Transfer">Bank Transfer</option>
                  <option value="Cash">Cash</option>
                  <option value="Cheque">Cheque</option>
                  <option value="Card">Card</option>
                </select>
              </div>
              <div>
                <label className="block font-medium text-slate-700 mb-1">Reference #</label>
                <input
                  type="text"
                  value={payRef}
                  onChange={(e) => setPayRef(e.target.value)}
                  placeholder="Slip / Cheque / Transaction ID"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                />
              </div>
              <div className="pt-3 flex justify-end gap-2">
                <button type="button" onClick={() => setPayTarget(null)} className="px-4 py-2 border border-slate-300 rounded-lg">Cancel</button>
                <button type="button" disabled={saving} onClick={handleQuickPayment} className="inline-flex items-center gap-1 px-4 py-2 bg-[#408dfb] text-white rounded-lg font-medium">
                  <CheckCircle2 className="w-3.5 h-3.5" /> Save Payment
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <DocumentPrintModal
        open={Boolean(printDoc)}
        org={org}
        doc={printDoc}
        onClose={() => setPrintDoc(null)}
        onCreateShareLink={selected ? () => handleShareInvoice(selected) : undefined}
      />
    </div>
  );
}
