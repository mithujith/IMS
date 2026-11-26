import React, { useCallback, useEffect, useState } from 'react';
import { collection, getDocs } from 'firebase/firestore';
import { Printer, X } from 'lucide-react';
import { db } from '../firebase';
import { useOrg } from '../hooks/useOrg';
import { useAuth } from '../hooks/useAuth';
import { useToast } from '../hooks/useToast';
import { CreditNote, Customer, Item, TaxRate, Warehouse } from '../types';
import { fetchPagedCollection, softDeleteOrgDoc } from '../services/firestoreList';
import { createCreditNote } from '../services/salesService';
import { DataTable, TableColumn } from '../components/DataTable';
import { StatusBadge } from '../components/StatusBadge';
import { buildComputedDocumentLines, EditableLineInput, LineItemsEditor } from '../components/LineItemsEditor';
import { DocumentPrintModal, PrintableDocumentData } from '../components/DocumentPrintModal';
import { exportToCsv } from '../lib/csv';
import { formatDateISO, formatDisplayDate, formatLKR } from '../lib/formatters';

export function CreditNotesPage() {
  const { orgId, org, can } = useOrg();
  const { user } = useAuth();
  const { showToast } = useToast();

  const [rows, setRows] = useState<CreditNote[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [taxes, setTaxes] = useState<TaxRate[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [printDoc, setPrintDoc] = useState<PrintableDocumentData | null>(null);

  const [customerId, setCustomerId] = useState('');
  const [warehouseId, setWarehouseId] = useState('');
  const [date, setDate] = useState(formatDateISO());
  const [restockItems, setRestockItems] = useState(false);
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<EditableLineInput[]>([
    { itemId: '', quantity: 1, rate: 0, discountType: 'percent', discountValue: 0, taxRate: 18, taxInclusive: false },
  ]);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!orgId) return;
    setLoading(true);
    try {
      const [res, custSnap, itemSnap, whSnap, taxSnap] = await Promise.all([
        fetchPagedCollection<CreditNote>({ orgId, subcollection: 'creditNotes', pageSize: 30 }),
        getDocs(collection(db, `organizations/${orgId}/customers`)),
        getDocs(collection(db, `organizations/${orgId}/items`)),
        getDocs(collection(db, `organizations/${orgId}/warehouses`)),
        getDocs(collection(db, `organizations/${orgId}/taxes`)),
      ]);
      setRows(res.items);
      const custs = custSnap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Customer, 'id'>) })).filter((c) => !c.isDeleted);
      setCustomers(custs);
      setItems(itemSnap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Item, 'id'>) })).filter((i) => !i.isDeleted));
      const whs = whSnap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Warehouse, 'id'>) })).filter((w) => !w.isDeleted);
      setWarehouses(whs);
      setTaxes(taxSnap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<TaxRate, 'id'>) })).filter((t) => !t.isDeleted));
      if (custs.length > 0 && !customerId) setCustomerId(custs[0].id);
      if (whs.length > 0 && !warehouseId) setWarehouseId(whs[0].id);
    } finally {
      setLoading(false);
    }
  }, [orgId, customerId, warehouseId]);

  useEffect(() => {
    void load();
  }, [load]);

  const itemMap = Object.fromEntries(items.map((i) => [i.id, i]));

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!orgId || !user) return;
    const cust = customers.find((c) => c.id === customerId);
    const totals = buildComputedDocumentLines(lines, itemMap, warehouseId);
    if (!cust || totals.lines.length === 0) {
      showToast('Select customer and at least one item', 'error');
      return;
    }
    setSaving(true);
    try {
      await createCreditNote({
        orgId,
        userId: user.uid,
        userName: user.displayName || user.email || 'User',
        customerId: cust.id,
        customerName: cust.name,
        warehouseId,
        date,
        lines: totals.lines,
        subtotal: totals.subtotal,
        taxTotal: totals.taxTotal,
        total: totals.total,
        restockItems,
        notes: notes.trim(),
      });
      setModalOpen(false);
      showToast('Credit note issued', 'success');
      await load();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to issue credit note', 'error');
    } finally {
      setSaving(false);
    }
  };

  const columns: TableColumn<CreditNote>[] = [
    { key: 'date', label: 'Date', render: (r) => formatDisplayDate(r.date) },
    {
      key: 'creditNoteNumber',
      label: 'Credit Note #',
      render: (r) => <span className="font-mono-num font-semibold text-[#408dfb]">{r.creditNoteNumber}</span>,
    },
    { key: 'customerName', label: 'Customer', render: (r) => r.customerName },
    { key: 'status', label: 'Status', render: (r) => <StatusBadge status={r.status} /> },
    { key: 'total', label: 'Amount', align: 'right', render: (r) => formatLKR(r.total) },
    { key: 'remainingCredits', label: 'Remaining Credit', align: 'right', render: (r) => formatLKR(r.remainingCredits) },
    {
      key: 'print',
      label: 'PDF',
      align: 'right',
      render: (r) => (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setPrintDoc({
              docTitle: 'CREDIT NOTE',
              docNumber: r.creditNoteNumber,
              date: r.date,
              partyLabel: 'Customer',
              partyName: r.customerName,
              status: r.status,
              lines: r.lines,
              subtotal: r.subtotal,
              taxTotal: r.taxTotal,
              total: r.total,
              notes: r.notes,
            });
          }}
          className="inline-flex items-center gap-1 px-2 py-1 text-[11px] border border-slate-300 rounded hover:bg-slate-50"
        >
          <Printer className="w-3 h-3" /> PDF
        </button>
      ),
    },
  ];

  return (
    <>
      <DataTable
        title="Credit Notes"
        subtitle="Issue customer credits with optional stock return to warehouse"
        rows={rows}
        columns={columns}
        loading={loading}
        searchQuery={search}
        onSearchChange={setSearch}
        searchPredicate={(r, q) =>
          r.creditNoteNumber.toLowerCase().includes(q) || r.customerName.toLowerCase().includes(q)
        }
        canCreate={can('creditNotes', 'create')}
        newButtonLabel="New Credit Note"
        onNewClick={() => setModalOpen(true)}
        canDelete={can('creditNotes', 'delete')}
        onBulkDelete={async (ids) => {
          if (!orgId || !user) return;
          for (const id of ids) await softDeleteOrgDoc(orgId, 'creditNotes', id, user.uid);
          showToast('Deleted selected credit notes', 'success');
          await load();
        }}
        onExportCsv={(visible) => {
          exportToCsv(
            'credit-notes.csv',
            ['Date', 'Credit Note #', 'Customer', 'Status', 'Total', 'Remaining'],
            visible.map((r) => [r.date, r.creditNoteNumber, r.customerName, r.status, r.total, r.remainingCredits])
          );
        }}
      />

      {modalOpen && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-900/50 p-4 overflow-y-auto">
          <div className="bg-white rounded-xl border border-slate-200 shadow-xl max-w-4xl w-full p-5 my-6 max-h-[92vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-semibold text-slate-900">New Credit Note</h2>
              <button type="button" onClick={() => setModalOpen(false)} aria-label="Close"><X className="w-4 h-4 text-slate-400" /></button>
            </div>
            <form onSubmit={handleSave} className="space-y-4 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Customer *</label>
                  <select value={customerId} onChange={(e) => setCustomerId(e.target.value)} className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white">
                    {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Warehouse</label>
                  <select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)} className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white">
                    {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Credit Note Date</label>
                  <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-full px-3 py-2 border border-slate-300 rounded-lg" />
                </div>
              </div>

              <label className="inline-flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={restockItems} onChange={(e) => setRestockItems(e.target.checked)} className="rounded border-slate-300 text-[#408dfb]" />
                <span className="font-medium text-slate-700">Restock credited items back into selected warehouse</span>
              </label>

              <LineItemsEditor
                mode="sales"
                items={items}
                taxes={taxes}
                warehouseId={warehouseId}
                lines={lines}
                onChangeLines={setLines}
                docDiscountType="percent"
                docDiscountValue={0}
                onChangeDocDiscount={() => {}}
                shippingCharges={0}
                onChangeShippingCharges={() => {}}
                adjustment={0}
                onChangeAdjustment={() => {}}
                showDocumentAdjustments={false}
              />

              <div>
                <label className="block font-medium text-slate-700 mb-1">Notes</label>
                <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} className="w-full px-3 py-2 border border-slate-300 rounded-lg" />
              </div>

              <div className="pt-3 flex justify-end gap-2">
                <button type="button" onClick={() => setModalOpen(false)} className="px-4 py-2 border border-slate-300 rounded-lg">Cancel</button>
                <button type="submit" disabled={saving} className="px-4 py-2 bg-[#408dfb] text-white rounded-lg font-medium">
                  {saving ? 'Issuing...' : 'Issue Credit Note'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <DocumentPrintModal open={Boolean(printDoc)} org={org} doc={printDoc} onClose={() => setPrintDoc(null)} />
    </>
  );
}
