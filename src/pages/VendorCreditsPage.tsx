import React, { useCallback, useEffect, useState } from 'react';
import { collection, getDocs } from 'firebase/firestore';
import { X } from 'lucide-react';
import { db } from '../firebase';
import { useOrg } from '../hooks/useOrg';
import { useAuth } from '../hooks/useAuth';
import { useToast } from '../hooks/useToast';
import { Item, TaxRate, Vendor, VendorCredit } from '../types';
import { fetchPagedCollection, softDeleteOrgDoc } from '../services/firestoreList';
import { createVendorCredit } from '../services/purchasesService';
import { DataTable, TableColumn } from '../components/DataTable';
import { StatusBadge } from '../components/StatusBadge';
import { buildComputedDocumentLines, EditableLineInput, LineItemsEditor } from '../components/LineItemsEditor';
import { exportToCsv } from '../lib/csv';
import { formatDateISO, formatDisplayDate, formatLKR } from '../lib/formatters';

export function VendorCreditsPage() {
  const { orgId, can } = useOrg();
  const { user } = useAuth();
  const { showToast } = useToast();

  const [rows, setRows] = useState<VendorCredit[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [taxes, setTaxes] = useState<TaxRate[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [modalOpen, setModalOpen] = useState(false);

  const [vendorId, setVendorId] = useState('');
  const [date, setDate] = useState(formatDateISO());
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<EditableLineInput[]>([
    { itemId: '', quantity: 1, rate: 0, discountType: 'percent', discountValue: 0, taxRate: 18, taxInclusive: false },
  ]);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!orgId) return;
    setLoading(true);
    try {
      const [res, vendSnap, itemSnap, taxSnap] = await Promise.all([
        fetchPagedCollection<VendorCredit>({ orgId, subcollection: 'vendorCredits', pageSize: 30 }),
        getDocs(collection(db, `organizations/${orgId}/vendors`)),
        getDocs(collection(db, `organizations/${orgId}/items`)),
        getDocs(collection(db, `organizations/${orgId}/taxes`)),
      ]);
      setRows(res.items);
      const vends = vendSnap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Vendor, 'id'>) })).filter((v) => !v.isDeleted);
      setVendors(vends);
      setItems(itemSnap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Item, 'id'>) })).filter((i) => !i.isDeleted));
      setTaxes(taxSnap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<TaxRate, 'id'>) })).filter((t) => !t.isDeleted));
      if (vends.length > 0 && !vendorId) setVendorId(vends[0].id);
    } finally {
      setLoading(false);
    }
  }, [orgId, vendorId]);

  useEffect(() => {
    void load();
  }, [load]);

  const itemMap = Object.fromEntries(items.map((i) => [i.id, i]));

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!orgId || !user) return;
    const vend = vendors.find((v) => v.id === vendorId);
    const totals = buildComputedDocumentLines(lines, itemMap, '');
    if (!vend || totals.lines.length === 0) {
      showToast('Select vendor and at least one item', 'error');
      return;
    }
    setSaving(true);
    try {
      await createVendorCredit({
        orgId,
        userId: user.uid,
        userName: user.displayName || user.email || 'User',
        vendorId: vend.id,
        vendorName: vend.name,
        date,
        lines: totals.lines,
        subtotal: totals.subtotal,
        taxTotal: totals.taxTotal,
        total: totals.total,
        notes: notes.trim(),
      });
      setModalOpen(false);
      showToast('Vendor credit recorded', 'success');
      await load();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to create vendor credit', 'error');
    } finally {
      setSaving(false);
    }
  };

  const columns: TableColumn<VendorCredit>[] = [
    { key: 'date', label: 'Date', render: (r) => formatDisplayDate(r.date) },
    {
      key: 'creditNumber',
      label: 'Credit #',
      render: (r) => <span className="font-mono-num font-semibold text-[#408dfb]">{r.creditNumber}</span>,
    },
    { key: 'vendorName', label: 'Vendor', render: (r) => r.vendorName },
    { key: 'status', label: 'Status', render: (r) => <StatusBadge status={r.status} /> },
    { key: 'total', label: 'Amount', align: 'right', render: (r) => formatLKR(r.total) },
    { key: 'remainingCredits', label: 'Balance', align: 'right', render: (r) => formatLKR(r.remainingCredits) },
  ];

  return (
    <>
      <DataTable
        title="Vendor Credits"
        subtitle="Track supplier credit memos for damaged shipments or price adjustments"
        rows={rows}
        columns={columns}
        loading={loading}
        searchQuery={search}
        onSearchChange={setSearch}
        searchPredicate={(r, q) => r.creditNumber.toLowerCase().includes(q) || r.vendorName.toLowerCase().includes(q)}
        canCreate={can('vendorCredits', 'create')}
        newButtonLabel="New Vendor Credit"
        onNewClick={() => setModalOpen(true)}
        canDelete={can('vendorCredits', 'delete')}
        onBulkDelete={async (ids) => {
          if (!orgId || !user) return;
          for (const id of ids) await softDeleteOrgDoc(orgId, 'vendorCredits', id, user.uid);
          showToast('Deleted selected vendor credits', 'success');
          await load();
        }}
        onExportCsv={(visible) => {
          exportToCsv(
            'vendor-credits.csv',
            ['Date', 'Credit #', 'Vendor', 'Status', 'Total', 'Remaining'],
            visible.map((r) => [r.date, r.creditNumber, r.vendorName, r.status, r.total, r.remainingCredits])
          );
        }}
      />

      {modalOpen && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-900/50 p-4 overflow-y-auto">
          <div className="bg-white rounded-xl border border-slate-200 shadow-xl max-w-4xl w-full p-5 my-6 max-h-[92vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-semibold text-slate-900">New Vendor Credit</h2>
              <button type="button" onClick={() => setModalOpen(false)} aria-label="Close"><X className="w-4 h-4 text-slate-400" /></button>
            </div>
            <form onSubmit={handleSave} className="space-y-4 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Vendor *</label>
                  <select value={vendorId} onChange={(e) => setVendorId(e.target.value)} className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white">
                    {vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Date</label>
                  <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-full px-3 py-2 border border-slate-300 rounded-lg" />
                </div>
              </div>

              <LineItemsEditor
                mode="purchase"
                items={items}
                taxes={taxes}
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
                  {saving ? 'Saving...' : 'Save Vendor Credit'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
