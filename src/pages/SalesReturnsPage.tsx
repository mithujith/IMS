import React, { useCallback, useEffect, useState } from 'react';
import { collection, getDocs } from 'firebase/firestore';
import { Plus, Trash2, X } from 'lucide-react';
import { db } from '../firebase';
import { useOrg } from '../hooks/useOrg';
import { useAuth } from '../hooks/useAuth';
import { useToast } from '../hooks/useToast';
import { Customer, Item, SalesReturn, Warehouse } from '../types';
import { fetchPagedCollection, softDeleteOrgDoc } from '../services/firestoreList';
import { createSalesReturnAndRestock } from '../services/salesService';
import { DataTable, TableColumn } from '../components/DataTable';
import { StatusBadge } from '../components/StatusBadge';
import { exportToCsv } from '../lib/csv';
import { formatDateISO, formatDisplayDate, formatLKR } from '../lib/formatters';

export function SalesReturnsPage() {
  const { orgId, can } = useOrg();
  const { user } = useAuth();
  const { showToast } = useToast();

  const [rows, setRows] = useState<SalesReturn[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [modalOpen, setModalOpen] = useState(false);

  const [customerId, setCustomerId] = useState('');
  const [warehouseId, setWarehouseId] = useState('');
  const [date, setDate] = useState(formatDateISO());
  const [reason, setReason] = useState('Wrong spare part model ordered');
  const [lines, setLines] = useState<{ itemId: string; quantity: number; rate: number }[]>([
    { itemId: '', quantity: 1, rate: 0 },
  ]);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!orgId) return;
    setLoading(true);
    try {
      const [res, custSnap, itemSnap, whSnap] = await Promise.all([
        fetchPagedCollection<SalesReturn>({ orgId, subcollection: 'salesReturns', pageSize: 30 }),
        getDocs(collection(db, `organizations/${orgId}/customers`)),
        getDocs(collection(db, `organizations/${orgId}/items`)),
        getDocs(collection(db, `organizations/${orgId}/warehouses`)),
      ]);
      setRows(res.items);
      const custs = custSnap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Customer, 'id'>) })).filter((c) => !c.isDeleted);
      setCustomers(custs);
      setItems(itemSnap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Item, 'id'>) })).filter((i) => !i.isDeleted));
      const whs = whSnap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Warehouse, 'id'>) })).filter((w) => !w.isDeleted);
      setWarehouses(whs);
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
    const valid = lines.filter((l) => l.itemId && l.quantity > 0);
    if (!cust || !warehouseId || valid.length === 0) {
      showToast('Select customer, warehouse, and returned items', 'error');
      return;
    }
    setSaving(true);
    try {
      await createSalesReturnAndRestock({
        orgId,
        userId: user.uid,
        userName: user.displayName || user.email || 'User',
        customerId: cust.id,
        customerName: cust.name,
        warehouseId,
        date,
        reason,
        lines: valid,
      });
      setModalOpen(false);
      setLines([{ itemId: '', quantity: 1, rate: 0 }]);
      showToast('Sales return processed & stock restocked', 'success');
      await load();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Return failed', 'error');
    } finally {
      setSaving(false);
    }
  };

  const columns: TableColumn<SalesReturn>[] = [
    { key: 'date', label: 'Date', render: (r) => formatDisplayDate(r.date) },
    {
      key: 'returnNumber',
      label: 'Return #',
      render: (r) => <span className="font-mono-num font-semibold text-[#408dfb]">{r.returnNumber}</span>,
    },
    { key: 'customerName', label: 'Customer', render: (r) => r.customerName },
    { key: 'reason', label: 'Reason', render: (r) => r.reason },
    { key: 'status', label: 'Status', render: (r) => <StatusBadge status={r.status} /> },
    { key: 'total', label: 'Return Value', align: 'right', render: (r) => formatLKR(r.total) },
  ];

  return (
    <>
      <DataTable
        title="Sales Returns"
        subtitle="Receive returned parts back into warehouse inventory with automatic ledger entries"
        rows={rows}
        columns={columns}
        loading={loading}
        searchQuery={search}
        onSearchChange={setSearch}
        searchPredicate={(r, q) =>
          r.returnNumber.toLowerCase().includes(q) || r.customerName.toLowerCase().includes(q)
        }
        canCreate={can('salesReturns', 'create')}
        newButtonLabel="New Sales Return"
        onNewClick={() => setModalOpen(true)}
        canDelete={can('salesReturns', 'delete')}
        onBulkDelete={async (ids) => {
          if (!orgId || !user) return;
          for (const id of ids) await softDeleteOrgDoc(orgId, 'salesReturns', id, user.uid);
          showToast('Deleted selected sales returns', 'success');
          await load();
        }}
        onExportCsv={(visible) => {
          exportToCsv(
            'sales-returns.csv',
            ['Date', 'Return #', 'Customer', 'Reason', 'Status', 'Total'],
            visible.map((r) => [r.date, r.returnNumber, r.customerName, r.reason, r.status, r.total])
          );
        }}
      />

      {modalOpen && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-900/50 p-4">
          <div className="bg-white rounded-xl border border-slate-200 shadow-xl max-w-2xl w-full p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-semibold text-slate-900">New Sales Return &amp; Restock</h2>
              <button type="button" onClick={() => setModalOpen(false)} aria-label="Close"><X className="w-4 h-4 text-slate-400" /></button>
            </div>
            <form onSubmit={handleSave} className="space-y-3 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Customer *</label>
                  <select value={customerId} onChange={(e) => setCustomerId(e.target.value)} className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white">
                    {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Restock Warehouse *</label>
                  <select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)} className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white">
                    {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Return Date</label>
                  <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-full px-3 py-2 border border-slate-300 rounded-lg" />
                </div>
              </div>
              <div>
                <label className="block font-medium text-slate-700 mb-1">Reason *</label>
                <input type="text" required value={reason} onChange={(e) => setReason(e.target.value)} className="w-full px-3 py-2 border border-slate-300 rounded-lg" />
              </div>

              <div className="space-y-2 pt-2">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-slate-800">Returned Items</span>
                  <button type="button" onClick={() => setLines([...lines, { itemId: '', quantity: 1, rate: 0 }])} className="text-[#408dfb] font-medium inline-flex items-center gap-1">
                    <Plus className="w-3.5 h-3.5" /> Add Item
                  </button>
                </div>
                {lines.map((line, idx) => (
                  <div key={idx} className="grid grid-cols-12 gap-2 items-center">
                    <select
                      value={line.itemId}
                      onChange={(e) => {
                        const it = itemMap[e.target.value];
                        const next = [...lines];
                        next[idx] = { itemId: e.target.value, quantity: next[idx].quantity, rate: it?.sellingPrice ?? 0 };
                        setLines(next);
                      }}
                      className="col-span-6 px-2.5 py-2 border border-slate-300 rounded-lg bg-white"
                    >
                      <option value="">Select item...</option>
                      {items.map((it) => <option key={it.id} value={it.id}>{it.sku} — {it.name}</option>)}
                    </select>
                    <input
                      type="number"
                      min="1"
                      value={line.quantity}
                      onChange={(e) => {
                        const next = [...lines];
                        next[idx].quantity = Math.max(1, Number(e.target.value) || 1);
                        setLines(next);
                      }}
                      className="col-span-2 px-2 py-2 border border-slate-300 rounded-lg text-right tabular-nums"
                    />
                    <input
                      type="number"
                      min="0"
                      value={line.rate}
                      onChange={(e) => {
                        const next = [...lines];
                        next[idx].rate = Math.max(0, Number(e.target.value) || 0);
                        setLines(next);
                      }}
                      className="col-span-3 px-2 py-2 border border-slate-300 rounded-lg text-right tabular-nums"
                    />
                    <div className="col-span-1 text-right">
                      {lines.length > 1 && (
                        <button type="button" onClick={() => setLines(lines.filter((_, i) => i !== idx))} aria-label="Remove"><Trash2 className="w-3.5 h-3.5 text-slate-400 hover:text-red-600" /></button>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              <div className="pt-3 flex justify-end gap-2">
                <button type="button" onClick={() => setModalOpen(false)} className="px-4 py-2 border border-slate-300 rounded-lg">Cancel</button>
                <button type="submit" disabled={saving} className="px-4 py-2 bg-[#408dfb] text-white rounded-lg font-medium">
                  {saving ? 'Processing...' : 'Process Return & Restock'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
