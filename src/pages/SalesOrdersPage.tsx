import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { collection, DocumentData, getDocs, QueryDocumentSnapshot } from 'firebase/firestore';
import { Ban, CheckCircle2, Copy, FileText, PackageCheck, Printer, X } from 'lucide-react';
import { db } from '../firebase';
import { useOrg } from '../hooks/useOrg';
import { useAuth } from '../hooks/useAuth';
import { useToast } from '../hooks/useToast';
import { Customer, Item, PriceList, SalesOrder, TaxRate, Warehouse } from '../types';
import { fetchPagedCollection, PagedFilter, softDeleteOrgDoc } from '../services/firestoreList';
import {
  confirmSalesOrder,
  createInvoice,
  createPackageFromSO,
  createSalesOrder,
  voidSalesOrder,
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

const SO_TABS = [
  { key: 'all', label: 'All Orders' },
  { key: 'draft', label: 'Draft' },
  { key: 'confirmed', label: 'Confirmed' },
  { key: 'packed', label: 'Packed' },
  { key: 'shipped', label: 'Shipped' },
  { key: 'delivered', label: 'Delivered' },
  { key: 'invoiced', label: 'Invoiced' },
  { key: 'void', label: 'Void' },
];

export function SalesOrdersPage() {
  const { orgId, org, can } = useOrg();
  const { user } = useAuth();
  const { showToast } = useToast();
  const [searchParams, setSearchParams] = useSearchParams();

  const [rows, setRows] = useState<SalesOrder[]>([]);
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
  const [selected, setSelected] = useState<SalesOrder | null>(null);
  const [printDoc, setPrintDoc] = useState<PrintableDocumentData | null>(null);

  const [customerId, setCustomerId] = useState('');
  const [warehouseId, setWarehouseId] = useState('');
  const [date, setDate] = useState(formatDateISO());
  const [expectedShipmentDate, setExpectedShipmentDate] = useState(formatDateISO());
  const [channel, setChannel] = useState<SalesOrder['channel']>('Direct');
  const [referenceNumber, setReferenceNumber] = useState('');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<EditableLineInput[]>([
    { itemId: '', quantity: 1, rate: 0, discountType: 'percent', discountValue: 0, taxRate: 18, taxInclusive: false },
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
        const [res, custSnap, itemSnap, whSnap, taxSnap, plSnap] = await Promise.all([
          fetchPagedCollection<SalesOrder>({
            orgId,
            subcollection: 'salesOrders',
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

  const openNewOrClone = (cloneFrom?: SalesOrder) => {
    if (cloneFrom) {
      setCustomerId(cloneFrom.customerId);
      setWarehouseId(cloneFrom.warehouseId);
      setDate(formatDateISO());
      setChannel(cloneFrom.channel);
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
      setExpectedShipmentDate(formatDateISO());
      setChannel('Direct');
      setReferenceNumber('');
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

  const handleSave = async (confirmImmediately: boolean) => {
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
      await createSalesOrder({
        orgId,
        userId: user.uid,
        userName: user.displayName || user.email || 'User',
        confirmImmediately,
        data: {
          customerId: cust.id,
          customerName: cust.name,
          date,
          expectedShipmentDate,
          referenceNumber: referenceNumber.trim(),
          channel,
          warehouseId: warehouseId || warehouses[0]?.id || '',
          paymentTerms: cust.paymentTerms,
          status: confirmImmediately ? 'confirmed' : 'draft',
          lines: totals.lines,
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
      showToast(confirmImmediately ? 'Sales order confirmed & stock committed' : 'Draft sales order created', 'success');
      await load(cursorStack[pageIdx] ?? null);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to create sales order', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleConfirm = async (so: SalesOrder) => {
    if (!orgId || !user) return;
    try {
      await confirmSalesOrder({
        orgId,
        userId: user.uid,
        userName: user.displayName || user.email || 'User',
        salesOrderId: so.id,
      });
      showToast(`${so.orderNumber} confirmed & stock committed`, 'success');
      setSelected(null);
      await load(cursorStack[pageIdx] ?? null);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Confirmation failed', 'error');
    }
  };

  const handleCreatePackage = async (so: SalesOrder) => {
    if (!orgId || !user) return;
    try {
      await createPackageFromSO({
        orgId,
        userId: user.uid,
        userName: user.displayName || user.email || 'User',
        salesOrderId: so.id,
        date: formatDateISO(),
      });
      showToast(`Package created for ${so.orderNumber}`, 'success');
      setSelected(null);
      await load(cursorStack[pageIdx] ?? null);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to create package', 'error');
    }
  };

  const handleConvertToInvoice = async (so: SalesOrder) => {
    if (!orgId || !user) return;
    try {
      await createInvoice({
        orgId,
        userId: user.uid,
        userName: user.displayName || user.email || 'User',
        fromSalesOrderId: so.id,
        data: {
          salesOrderId: so.id,
          salesOrderNumber: so.orderNumber,
          customerId: so.customerId,
          customerName: so.customerName,
          date: formatDateISO(),
          dueDate: formatDateISO(new Date(Date.now() + 30 * 86400000)),
          paymentTerms: so.paymentTerms || 'Net 30',
          warehouseId: so.warehouseId,
          channel: so.channel,
          status: 'sent',
          lines: so.lines,
          subtotal: so.subtotal,
          discountType: so.discountType,
          discountValue: so.discountValue,
          discountAmount: so.discountAmount,
          taxTotal: so.taxTotal,
          shippingCharges: so.shippingCharges,
          adjustment: so.adjustment,
          total: so.total,
          amountPaid: 0,
          balanceDue: so.total,
          notes: so.notes,
        },
      });
      showToast(`Invoice created from ${so.orderNumber}`, 'success');
      setSelected(null);
      await load(cursorStack[pageIdx] ?? null);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to create invoice', 'error');
    }
  };

  const handleVoid = async (so: SalesOrder) => {
    if (!orgId || !user) return;
    try {
      await voidSalesOrder({
        orgId,
        userId: user.uid,
        userName: user.displayName || user.email || 'User',
        salesOrderId: so.id,
      });
      showToast(`${so.orderNumber} voided`, 'success');
      setSelected(null);
      await load(cursorStack[pageIdx] ?? null);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Unable to void order', 'error');
    }
  };

  const columns: TableColumn<SalesOrder>[] = [
    { key: 'date', label: 'Date', render: (r) => formatDisplayDate(r.date) },
    {
      key: 'orderNumber',
      label: 'Sales Order #',
      sortable: true,
      sortValue: (r) => r.orderNumber,
      render: (r) => <span className="font-mono-num font-semibold text-[#408dfb]">{r.orderNumber}</span>,
    },
    { key: 'customerName', label: 'Customer', render: (r) => <span className="font-medium text-slate-900">{r.customerName}</span> },
    { key: 'channel', label: 'Channel', render: (r) => r.channel },
    { key: 'status', label: 'Status', render: (r) => <StatusBadge status={r.status} /> },
    { key: 'total', label: 'Amount', align: 'right', sortable: true, sortValue: (r) => r.total, render: (r) => formatLKR(r.total) },
  ];

  return (
    <div className="space-y-6">
      <DataTable
        title="Sales Orders"
        subtitle="Manage customer orders, reserve warehouse stock, pack & ship, and invoice"
        rows={rows}
        columns={columns}
        loading={loading}
        statusTabs={SO_TABS}
        activeTab={activeTab}
        onTabChange={setActiveTab}
        searchQuery={search}
        onSearchChange={setSearch}
        searchPredicate={(r, q) =>
          r.orderNumber.toLowerCase().includes(q) || r.customerName.toLowerCase().includes(q)
        }
        onRowClick={(r) => setSelected(r)}
        canCreate={can('salesOrders', 'create')}
        newButtonLabel="New Sales Order"
        onNewClick={() => openNewOrClone()}
        canDelete={can('salesOrders', 'delete')}
        onBulkDelete={async (ids) => {
          if (!orgId || !user) return;
          for (const id of ids) await softDeleteOrgDoc(orgId, 'salesOrders', id, user.uid);
          showToast('Deleted selected sales orders', 'success');
          await load(cursorStack[pageIdx] ?? null);
        }}
        onExportCsv={(visible) => {
          exportToCsv(
            'sales-orders.csv',
            ['Date', 'Order #', 'Customer', 'Channel', 'Status', 'Total'],
            visible.map((r) => [r.date, r.orderNumber, r.customerName, r.channel, r.status, r.total])
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
              <h2 className="text-base font-semibold text-slate-900">New Sales Order</h2>
              <button type="button" onClick={() => setModalOpen(false)} aria-label="Close">
                <X className="w-4 h-4 text-slate-400" />
              </button>
            </div>
            <div className="space-y-4 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
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
                  <label className="block font-medium text-slate-700 mb-1">Warehouse *</label>
                  <select
                    value={warehouseId}
                    onChange={(e) => setWarehouseId(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white"
                  >
                    {warehouses.map((w) => (
                      <option key={w.id} value={w.id}>{w.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Sales Channel</label>
                  <select
                    value={channel}
                    onChange={(e) => setChannel(e.target.value as SalesOrder['channel'])}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white"
                  >
                    <option value="Direct">Direct</option>
                    <option value="Counter">Counter</option>
                    <option value="Wholesale">Wholesale</option>
                    <option value="Online">Online</option>
                  </select>
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Order Date</label>
                  <input
                    type="date"
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Expected Shipment</label>
                  <input
                    type="date"
                    value={expectedShipmentDate}
                    onChange={(e) => setExpectedShipmentDate(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Reference #</label>
                  <input
                    type="text"
                    value={referenceNumber}
                    onChange={(e) => setReferenceNumber(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                  />
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
                <label className="block font-medium text-slate-700 mb-1">Customer Notes</label>
                <textarea
                  rows={2}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                />
              </div>

              <div className="pt-3 flex justify-end gap-2 border-t border-slate-200">
                <button type="button" onClick={() => setModalOpen(false)} className="px-4 py-2 border border-slate-300 rounded-lg">
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => handleSave(false)}
                  className="px-4 py-2 border border-slate-300 bg-slate-50 rounded-lg font-medium"
                >
                  Save as Draft
                </button>
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => handleSave(true)}
                  className="px-4 py-2 bg-[#408dfb] text-white rounded-lg font-medium"
                >
                  {saving ? 'Saving...' : 'Save & Confirm'}
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
                  <h2 className="text-lg font-bold text-slate-900">{selected.orderNumber}</h2>
                  <StatusBadge status={selected.status} />
                </div>
                <p className="text-xs text-slate-500 mt-0.5">
                  {selected.customerName} · {formatDisplayDate(selected.date)}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() =>
                    setPrintDoc({
                      docTitle: 'SALES ORDER',
                      docNumber: selected.orderNumber,
                      date: selected.date,
                      partyLabel: 'Customer',
                      partyName: selected.customerName,
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
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg hover:bg-slate-50"
                >
                  <Printer className="w-3.5 h-3.5" /> Print / PDF
                </button>
                {can('salesOrders', 'create') && (
                  <button
                    type="button"
                    onClick={() => {
                      const so = selected;
                      setSelected(null);
                      openNewOrClone(so);
                    }}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg hover:bg-slate-50"
                  >
                    <Copy className="w-3.5 h-3.5" /> Clone
                  </button>
                )}
                {selected.status === 'draft' && can('salesOrders', 'edit') && (
                  <button
                    type="button"
                    onClick={() => handleConfirm(selected)}
                    className="inline-flex items-center gap-1 px-3 py-1.5 text-xs bg-[#408dfb] text-white rounded-lg font-medium"
                  >
                    <CheckCircle2 className="w-3.5 h-3.5" /> Confirm Order
                  </button>
                )}
                {selected.status === 'confirmed' && can('packages', 'create') && (
                  <button
                    type="button"
                    onClick={() => handleCreatePackage(selected)}
                    className="inline-flex items-center gap-1 px-3 py-1.5 text-xs bg-emerald-600 text-white rounded-lg font-medium"
                  >
                    <PackageCheck className="w-3.5 h-3.5" /> Convert to Package
                  </button>
                )}
                {['confirmed', 'packed', 'shipped', 'delivered'].includes(selected.status) &&
                  can('invoices', 'create') && (
                    <button
                      type="button"
                      onClick={() => handleConvertToInvoice(selected)}
                      className="inline-flex items-center gap-1 px-3 py-1.5 text-xs bg-[#1f2a44] text-white rounded-lg font-medium"
                    >
                      <FileText className="w-3.5 h-3.5" /> Convert to Invoice
                    </button>
                  )}
                {['draft', 'confirmed', 'packed'].includes(selected.status) &&
                  can('salesOrders', 'edit') && (
                    <button
                      type="button"
                      onClick={() => handleVoid(selected)}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs text-red-700 border border-red-200 bg-red-50 rounded-lg"
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
                    <th className="text-right px-3 py-2">Tax</th>
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
                      <td className="px-3 py-2 text-right tabular-nums">{formatLKR(l.lineTax)}</td>
                      <td className="px-3 py-2 text-right font-semibold tabular-nums">{formatLKR(l.lineTotal)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <div className="flex justify-end">
                <div className="w-64 space-y-1 bg-slate-50 border border-slate-200 rounded-lg p-3">
                  <div className="flex justify-between"><span className="text-slate-600">Subtotal</span><span>{formatLKR(selected.subtotal)}</span></div>
                  <div className="flex justify-between"><span className="text-slate-600">Tax</span><span>{formatLKR(selected.taxTotal)}</span></div>
                  <div className="flex justify-between font-bold text-sm border-t border-slate-200 pt-1.5"><span>Total</span><span>{formatLKR(selected.total)}</span></div>
                </div>
              </div>

              <RecordCommentsAndAttachments
                subcollection="salesOrders"
                recordId={selected.id}
                comments={selected.comments}
                attachments={selected.attachments}
                canEdit={can('salesOrders', 'edit')}
                onUpdated={() => load(cursorStack[pageIdx] ?? null)}
              />
            </div>
          </div>
        </div>
      )}

      <DocumentPrintModal
        open={Boolean(printDoc)}
        org={org}
        doc={printDoc}
        onClose={() => setPrintDoc(null)}
      />
    </div>
  );
}
