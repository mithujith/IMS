import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { collection, DocumentData, getDocs, QueryDocumentSnapshot } from 'firebase/firestore';
import { Ban, Copy, FileText, PackagePlus, Printer, Send, X } from 'lucide-react';
import { db } from '../firebase';
import { useOrg } from '../hooks/useOrg';
import { useAuth } from '../hooks/useAuth';
import { useToast } from '../hooks/useToast';
import { Item, PurchaseOrder, TaxRate, Vendor, Warehouse } from '../types';
import { fetchPagedCollection, PagedFilter, softDeleteOrgDoc } from '../services/firestoreList';
import {
  createBill,
  createPurchaseOrder,
  receivePurchaseOrder,
  updatePOStatus,
} from '../services/purchasesService';
import { DataTable, TableColumn } from '../components/DataTable';
import { StatusBadge } from '../components/StatusBadge';
import { buildComputedDocumentLines, EditableLineInput, LineItemsEditor } from '../components/LineItemsEditor';
import { DocumentPrintModal, PrintableDocumentData } from '../components/DocumentPrintModal';
import { RecordCommentsAndAttachments } from '../components/RecordCommentsAndAttachments';
import { exportToCsv } from '../lib/csv';
import { formatDateISO, formatDisplayDate, formatLKR } from '../lib/formatters';

const PO_TABS = [
  { key: 'all', label: 'All Orders' },
  { key: 'draft', label: 'Draft' },
  { key: 'issued', label: 'Issued' },
  { key: 'partially_received', label: 'Partially Received' },
  { key: 'received', label: 'Received' },
  { key: 'billed', label: 'Billed' },
  { key: 'cancelled', label: 'Cancelled' },
];

export function PurchaseOrdersPage() {
  const { orgId, org, can } = useOrg();
  const { user } = useAuth();
  const { showToast } = useToast();
  const [searchParams, setSearchParams] = useSearchParams();

  const [rows, setRows] = useState<PurchaseOrder[]>([]);
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
  const [selected, setSelected] = useState<PurchaseOrder | null>(null);
  const [printDoc, setPrintDoc] = useState<PrintableDocumentData | null>(null);
  const [receiveTarget, setReceiveTarget] = useState<PurchaseOrder | null>(null);
  const [receiveQtys, setReceiveQtys] = useState<Record<string, number>>({});

  const [vendorId, setVendorId] = useState('');
  const [warehouseId, setWarehouseId] = useState('');
  const [date, setDate] = useState(formatDateISO());
  const [expectedDeliveryDate, setExpectedDeliveryDate] = useState(formatDateISO(new Date(Date.now() + 7 * 86400000)));
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<EditableLineInput[]>([
    { itemId: '', quantity: 10, rate: 0, discountType: 'percent', discountValue: 0, taxRate: 18, taxInclusive: false },
  ]);
  const [docDiscountType, setDocDiscountType] = useState<'percent' | 'amount'>('percent');
  const [docDiscountValue, setDocDiscountValue] = useState(0);
  const [shippingCharges, setShippingCharges] = useState(0);
  const [adjustment, setAdjustment] = useState(0);
  const [saving, setSaving] = useState(false);

  const load = useCallback(
    async (cursor: QueryDocumentSnapshot<DocumentData> | null) => {
      if (!orgId) return;
      setLoading(true);
      try {
        const filters: PagedFilter[] = [];
        if (activeTab !== 'all') filters.push({ field: 'status', op: '==', value: activeTab });
        const [res, vendSnap, itemSnap, whSnap, taxSnap] = await Promise.all([
          fetchPagedCollection<PurchaseOrder>({ orgId, subcollection: 'purchaseOrders', pageSize: 25, cursor, filters }),
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

  const openNewOrClone = (cloneFrom?: PurchaseOrder) => {
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
      setExpectedDeliveryDate(formatDateISO(new Date(Date.now() + 7 * 86400000)));
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

  const handleSave = async (status: 'draft' | 'issued') => {
    if (!orgId || !user) return;
    const vend = vendors.find((v) => v.id === vendorId);
    const totals = buildComputedDocumentLines(lines, itemMap, warehouseId, docDiscountType, docDiscountValue, shippingCharges, adjustment);
    if (!vend || totals.lines.length === 0) {
      showToast('Select a vendor and at least one item', 'error');
      return;
    }
    setSaving(true);
    try {
      await createPurchaseOrder({
        orgId,
        userId: user.uid,
        userName: user.displayName || user.email || 'User',
        data: {
          vendorId: vend.id,
          vendorName: vend.name,
          date,
          expectedDeliveryDate,
          warehouseId: warehouseId || warehouses[0]?.id || '',
          status,
          lines: totals.lines.map((l) => ({ ...l, receivedQty: 0 })),
          subtotal: totals.subtotal,
          discountType: docDiscountType,
          discountValue: docDiscountValue,
          discountAmount: totals.discountAmount,
          taxTotal: totals.taxTotal,
          shippingCharges,
          adjustment,
          total: totals.total,
          notes: notes.trim(),
        },
      });
      setModalOpen(false);
      showToast('Purchase Order saved', 'success');
      await load(cursorStack[pageIdx] ?? null);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to create PO', 'error');
    } finally {
      setSaving(false);
    }
  };

  const openReceiveModal = (po: PurchaseOrder) => {
    const initial: Record<string, number> = {};
    for (const l of po.lines) {
      const rem = Math.max(0, l.quantity - Number(l.receivedQty ?? 0));
      initial[l.itemId] = rem;
    }
    setReceiveQtys(initial);
    setReceiveTarget(po);
  };

  const handleReceive = async () => {
    if (!orgId || !user || !receiveTarget) return;
    setSaving(true);
    try {
      await receivePurchaseOrder({
        orgId,
        userId: user.uid,
        userName: user.displayName || user.email || 'User',
        purchaseOrderId: receiveTarget.id,
        date: formatDateISO(),
        linesToReceive: Object.entries(receiveQtys).map(([itemId, qtyReceived]) => ({
          itemId,
          qtyReceived: Number(qtyReceived) || 0,
        })),
      });
      setReceiveTarget(null);
      setSelected(null);
      showToast(`Stock received against ${receiveTarget.poNumber}`, 'success');
      await load(cursorStack[pageIdx] ?? null);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Receive failed', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleConvertToBill = async (po: PurchaseOrder) => {
    if (!orgId || !user) return;
    try {
      await createBill({
        orgId,
        userId: user.uid,
        userName: user.displayName || user.email || 'User',
        fromPurchaseOrderId: po.id,
        data: {
          purchaseOrderId: po.id,
          poNumber: po.poNumber,
          vendorId: po.vendorId,
          vendorName: po.vendorName,
          date: formatDateISO(),
          dueDate: formatDateISO(new Date(Date.now() + 30 * 86400000)),
          paymentTerms: 'Net 30',
          warehouseId: po.warehouseId,
          status: 'open',
          lines: po.lines,
          subtotal: po.subtotal,
          discountType: po.discountType,
          discountValue: po.discountValue,
          discountAmount: po.discountAmount,
          taxTotal: po.taxTotal,
          shippingCharges: po.shippingCharges,
          adjustment: po.adjustment,
          total: po.total,
          amountPaid: 0,
          balanceDue: po.total,
          notes: po.notes,
        },
      });
      showToast(`Bill created from ${po.poNumber}`, 'success');
      setSelected(null);
      await load(cursorStack[pageIdx] ?? null);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to convert to bill', 'error');
    }
  };

  const columns: TableColumn<PurchaseOrder>[] = [
    { key: 'date', label: 'Date', render: (r) => formatDisplayDate(r.date) },
    {
      key: 'poNumber',
      label: 'PO #',
      sortable: true,
      sortValue: (r) => r.poNumber,
      render: (r) => <span className="font-mono-num font-semibold text-[#408dfb]">{r.poNumber}</span>,
    },
    { key: 'vendorName', label: 'Vendor', render: (r) => <span className="font-medium text-slate-900">{r.vendorName}</span> },
    { key: 'expectedDeliveryDate', label: 'Expected', render: (r) => formatDisplayDate(r.expectedDeliveryDate || r.date) },
    { key: 'status', label: 'Status', render: (r) => <StatusBadge status={r.status} /> },
    { key: 'total', label: 'Amount', align: 'right', render: (r) => formatLKR(r.total) },
  ];

  return (
    <div className="space-y-6">
      <DataTable
        title="Purchase Orders"
        subtitle="Create supplier POs, receive partial or full deliveries into stock, and convert to bills"
        rows={rows}
        columns={columns}
        loading={loading}
        statusTabs={PO_TABS}
        activeTab={activeTab}
        onTabChange={setActiveTab}
        searchQuery={search}
        onSearchChange={setSearch}
        searchPredicate={(r, q) => r.poNumber.toLowerCase().includes(q) || r.vendorName.toLowerCase().includes(q)}
        onRowClick={(r) => setSelected(r)}
        canCreate={can('purchaseOrders', 'create')}
        newButtonLabel="New Purchase Order"
        onNewClick={() => openNewOrClone()}
        canDelete={can('purchaseOrders', 'delete')}
        onBulkDelete={async (ids) => {
          if (!orgId || !user) return;
          for (const id of ids) await softDeleteOrgDoc(orgId, 'purchaseOrders', id, user.uid);
          showToast('Deleted selected purchase orders', 'success');
          await load(cursorStack[pageIdx] ?? null);
        }}
        onExportCsv={(visible) => {
          exportToCsv(
            'purchase-orders.csv',
            ['Date', 'PO #', 'Vendor', 'Status', 'Total'],
            visible.map((r) => [r.date, r.poNumber, r.vendorName, r.status, r.total])
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
              <h2 className="text-base font-semibold text-slate-900">New Purchase Order</h2>
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
                  <label className="block font-medium text-slate-700 mb-1">Destination Warehouse *</label>
                  <select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)} className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white">
                    {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Order Date</label>
                  <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-full px-3 py-2 border border-slate-300 rounded-lg" />
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
                <label className="block font-medium text-slate-700 mb-1">Vendor Instructions</label>
                <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} className="w-full px-3 py-2 border border-slate-300 rounded-lg" />
              </div>

              <div className="pt-3 flex justify-end gap-2 border-t border-slate-200">
                <button type="button" onClick={() => setModalOpen(false)} className="px-4 py-2 border border-slate-300 rounded-lg">Cancel</button>
                <button type="button" disabled={saving} onClick={() => handleSave('draft')} className="px-4 py-2 border border-slate-300 bg-slate-50 rounded-lg font-medium">Save Draft</button>
                <button type="button" disabled={saving} onClick={() => handleSave('issued')} className="px-4 py-2 bg-[#408dfb] text-white rounded-lg font-medium">
                  {saving ? 'Issuing...' : 'Save & Issue PO'}
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
                  <h2 className="text-lg font-bold text-slate-900">{selected.poNumber}</h2>
                  <StatusBadge status={selected.status} />
                </div>
                <p className="text-xs text-slate-500 mt-0.5">{selected.vendorName} · {formatDisplayDate(selected.date)}</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() =>
                    setPrintDoc({
                      docTitle: 'PURCHASE ORDER',
                      docNumber: selected.poNumber,
                      date: selected.date,
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
                      notes: selected.notes,
                    })
                  }
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg"
                >
                  <Printer className="w-3.5 h-3.5" /> Print / PDF
                </button>
                {can('purchaseOrders', 'create') && (
                  <button type="button" onClick={() => { const p = selected; setSelected(null); openNewOrClone(p); }} className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg">
                    <Copy className="w-3.5 h-3.5" /> Clone
                  </button>
                )}
                {selected.status === 'draft' && can('purchaseOrders', 'edit') && (
                  <button
                    type="button"
                    onClick={async () => {
                      if (!orgId || !user) return;
                      await updatePOStatus(orgId, selected.id, user.uid, 'issued');
                      showToast('PO issued', 'success');
                      setSelected(null);
                      await load(cursorStack[pageIdx] ?? null);
                    }}
                    className="inline-flex items-center gap-1 px-3 py-1.5 text-xs bg-[#1f2a44] text-white rounded-lg"
                  >
                    <Send className="w-3.5 h-3.5" /> Issue PO
                  </button>
                )}
                {['issued', 'partially_received'].includes(selected.status) && can('purchaseReceives', 'create') && (
                  <button
                    type="button"
                    onClick={() => openReceiveModal(selected)}
                    className="inline-flex items-center gap-1 px-3 py-1.5 text-xs bg-[#408dfb] text-white rounded-lg font-medium"
                  >
                    <PackagePlus className="w-3.5 h-3.5" /> Receive Goods
                  </button>
                )}
                {['issued', 'partially_received', 'received'].includes(selected.status) && can('bills', 'create') && (
                  <button
                    type="button"
                    onClick={() => handleConvertToBill(selected)}
                    className="inline-flex items-center gap-1 px-3 py-1.5 text-xs bg-emerald-600 text-white rounded-lg font-medium"
                  >
                    <FileText className="w-3.5 h-3.5" /> Convert to Bill
                  </button>
                )}
                {['draft', 'issued'].includes(selected.status) && can('purchaseOrders', 'edit') && (
                  <button
                    type="button"
                    onClick={async () => {
                      if (!orgId || !user) return;
                      await updatePOStatus(orgId, selected.id, user.uid, 'cancelled');
                      showToast('PO cancelled', 'success');
                      setSelected(null);
                      await load(cursorStack[pageIdx] ?? null);
                    }}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg"
                  >
                    <Ban className="w-3.5 h-3.5" /> Cancel
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
                    <th className="text-right px-3 py-2">Ordered</th>
                    <th className="text-right px-3 py-2">Received</th>
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
                      <td className="px-3 py-2 text-right tabular-nums">{l.quantity}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-emerald-700 font-medium">{l.receivedQty ?? 0}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{formatLKR(l.rate)}</td>
                      <td className="px-3 py-2 text-right font-semibold tabular-nums">{formatLKR(l.lineTotal)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <RecordCommentsAndAttachments
                subcollection="purchaseOrders"
                recordId={selected.id}
                comments={selected.comments}
                attachments={selected.attachments}
                canEdit={can('purchaseOrders', 'edit')}
                onUpdated={() => load(cursorStack[pageIdx] ?? null)}
              />
            </div>
          </div>
        </div>
      )}

      {receiveTarget && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-900/50 p-4">
          <div className="bg-white rounded-xl border border-slate-200 shadow-xl max-w-xl w-full p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-semibold text-slate-900">Receive Goods · {receiveTarget.poNumber}</h2>
              <button type="button" onClick={() => setReceiveTarget(null)} aria-label="Close"><X className="w-4 h-4 text-slate-400" /></button>
            </div>
            <div className="space-y-3 text-xs">
              <table className="w-full border border-slate-200 rounded-lg overflow-hidden">
                <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                  <tr>
                    <th className="text-left px-3 py-2">Item</th>
                    <th className="text-right px-3 py-2">Ordered</th>
                    <th className="text-right px-3 py-2">Already Rec.</th>
                    <th className="text-right px-3 py-2">Receive Now</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {receiveTarget.lines.map((l) => {
                    const maxRem = Math.max(0, l.quantity - Number(l.receivedQty ?? 0));
                    return (
                      <tr key={l.itemId}>
                        <td className="px-3 py-2 font-medium">{l.sku} — {l.itemName}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{l.quantity}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{l.receivedQty ?? 0}</td>
                        <td className="px-3 py-2 text-right">
                          <input
                            type="number"
                            min="0"
                            max={maxRem}
                            value={receiveQtys[l.itemId] ?? 0}
                            onChange={(e) =>
                              setReceiveQtys((prev) => ({
                                ...prev,
                                [l.itemId]: Math.max(0, Number(e.target.value) || 0),
                              }))
                            }
                            className="w-20 px-2 py-1 border border-slate-300 rounded text-right tabular-nums"
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <div className="pt-3 flex justify-end gap-2">
                <button type="button" onClick={() => setReceiveTarget(null)} className="px-4 py-2 border border-slate-300 rounded-lg">Cancel</button>
                <button type="button" disabled={saving} onClick={handleReceive} className="px-4 py-2 bg-[#408dfb] text-white rounded-lg font-medium">
                  {saving ? 'Receiving...' : 'Confirm Receipt & Update Stock'}
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
