import React, { useCallback, useEffect, useState } from 'react';
import { collection, getDocs } from 'firebase/firestore';
import { CheckCircle2, Plus, Trash2, X } from 'lucide-react';
import { db } from '../firebase';
import { useOrg } from '../hooks/useOrg';
import { useAuth } from '../hooks/useAuth';
import { useToast } from '../hooks/useToast';
import { InventoryAdjustment, Item, Warehouse } from '../types';
import { fetchPagedCollection, softDeleteOrgDoc } from '../services/firestoreList';
import { applyDraftAdjustment, createStockAdjustment } from '../services/stockService';
import { DataTable, TableColumn } from '../components/DataTable';
import { StatusBadge } from '../components/StatusBadge';
import { RecordCommentsAndAttachments } from '../components/RecordCommentsAndAttachments';
import { exportToCsv } from '../lib/csv';
import { formatDateISO, formatDisplayDate, formatLKR } from '../lib/formatters';

export function AdjustmentsPage() {
  const { orgId, can } = useOrg();
  const { user } = useAuth();
  const { showToast } = useToast();

  const [rows, setRows] = useState<InventoryAdjustment[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [selected, setSelected] = useState<InventoryAdjustment | null>(null);

  const [date, setDate] = useState(formatDateISO());
  const [mode, setMode] = useState<'quantity' | 'value'>('quantity');
  const [warehouseId, setWarehouseId] = useState('');
  const [reason, setReason] = useState('Stock Count Variance');
  const [description, setDescription] = useState('');
  const [lines, setLines] = useState<{ itemId: string; newQuantity: number; unitCost: number }[]>([
    { itemId: '', newQuantity: 0, unitCost: 0 },
  ]);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!orgId) return;
    setLoading(true);
    try {
      const [res, itemSnap, whSnap] = await Promise.all([
        fetchPagedCollection<InventoryAdjustment>({ orgId, subcollection: 'adjustments', pageSize: 30 }),
        getDocs(collection(db, `organizations/${orgId}/items`)),
        getDocs(collection(db, `organizations/${orgId}/warehouses`)),
      ]);
      setRows(res.items);
      setItems(
        itemSnap.docs
          .map((d) => ({ id: d.id, ...(d.data() as Omit<Item, 'id'>) }))
          .filter((i) => !i.isDeleted)
      );
      const whs = whSnap.docs
        .map((d) => ({ id: d.id, ...(d.data() as Omit<Warehouse, 'id'>) }))
        .filter((w) => !w.isDeleted);
      setWarehouses(whs);
      if (whs.length > 0 && !warehouseId) setWarehouseId(whs[0].id);
    } finally {
      setLoading(false);
    }
  }, [orgId, warehouseId]);

  useEffect(() => {
    void load();
  }, [load]);

  const itemMap = Object.fromEntries(items.map((i) => [i.id, i]));
  const whMap = Object.fromEntries(warehouses.map((w) => [w.id, w.name]));

  const handleSave = async (applyImmediately: boolean) => {
    if (!orgId || !user) return;
    const validLines = lines.filter((l) => l.itemId && itemMap[l.itemId]);
    if (validLines.length === 0 || !warehouseId) {
      showToast('Select a warehouse and at least one item', 'error');
      return;
    }
    setSaving(true);
    try {
      await createStockAdjustment({
        orgId,
        userId: user.uid,
        userName: user.displayName || user.email || 'User',
        date,
        mode,
        warehouseId,
        reason: reason.trim() || 'Stock Count Variance',
        description,
        lines: validLines,
        applyImmediately,
      });
      setModalOpen(false);
      setDescription('');
      setLines([{ itemId: '', newQuantity: 0, unitCost: 0 }]);
      showToast(applyImmediately ? 'Stock adjustment applied' : 'Adjustment saved as draft', 'success');
      await load();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to save adjustment', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleApplyDraft = async (adj: InventoryAdjustment) => {
    if (!orgId || !user) return;
    try {
      await applyDraftAdjustment({
        orgId,
        userId: user.uid,
        userName: user.displayName || user.email || 'User',
        adjustmentId: adj.id,
      });
      showToast(`${adj.adjustmentNumber} applied to stock ledger`, 'success');
      setSelected(null);
      await load();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to apply adjustment', 'error');
    }
  };

  const columns: TableColumn<InventoryAdjustment>[] = [
    {
      key: 'adjustmentNumber',
      label: 'Adjustment #',
      sortable: true,
      sortValue: (r) => r.adjustmentNumber,
      render: (r) => <span className="font-mono-num font-semibold text-[#408dfb]">{r.adjustmentNumber}</span>,
    },
    { key: 'date', label: 'Date', render: (r) => formatDisplayDate(r.date) },
    { key: 'warehouseId', label: 'Warehouse', render: (r) => whMap[r.warehouseId] || r.warehouseId },
    { key: 'mode', label: 'Mode', render: (r) => <span className="capitalize">{r.mode}</span> },
    { key: 'reason', label: 'Reason', render: (r) => r.reason },
    { key: 'lines', label: 'Items', align: 'right', render: (r) => r.lines.length },
    { key: 'status', label: 'Status', render: (r) => <StatusBadge status={r.status} /> },
  ];

  return (
    <div className="space-y-6">
      <DataTable
        title="Inventory Adjustments"
        subtitle="Reconcile stock quantities or unit costs with append-only stock ledger tracking"
        rows={rows}
        columns={columns}
        loading={loading}
        searchQuery={search}
        onSearchChange={setSearch}
        searchPredicate={(r, q) =>
          r.adjustmentNumber.toLowerCase().includes(q) || r.reason.toLowerCase().includes(q)
        }
        onRowClick={(r) => setSelected(r)}
        canCreate={can('adjustments', 'create')}
        newButtonLabel="New Adjustment"
        onNewClick={() => setModalOpen(true)}
        canDelete={can('adjustments', 'delete')}
        onBulkDelete={async (ids) => {
          if (!orgId || !user) return;
          for (const id of ids) await softDeleteOrgDoc(orgId, 'adjustments', id, user.uid);
          showToast('Deleted selected adjustments', 'success');
          await load();
        }}
        onExportCsv={(visible) => {
          exportToCsv(
            'inventory-adjustments.csv',
            ['Number', 'Date', 'Warehouse', 'Mode', 'Reason', 'Status', 'Lines'],
            visible.map((r) => [
              r.adjustmentNumber,
              r.date,
              whMap[r.warehouseId] || r.warehouseId,
              r.mode,
              r.reason,
              r.status,
              r.lines.length,
            ])
          );
        }}
      />

      {modalOpen && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-900/50 p-4 overflow-y-auto">
          <div className="bg-white rounded-xl border border-slate-200 shadow-xl max-w-3xl w-full p-5 my-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-semibold text-slate-900">New Inventory Adjustment</h2>
              <button type="button" onClick={() => setModalOpen(false)} aria-label="Close">
                <X className="w-4 h-4 text-slate-400" />
              </button>
            </div>
            <div className="space-y-4 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Mode</label>
                  <select
                    value={mode}
                    onChange={(e) => setMode(e.target.value as 'quantity' | 'value')}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white"
                  >
                    <option value="quantity">Quantity Adjustment</option>
                    <option value="value">Value Adjustment</option>
                  </select>
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Date</label>
                  <input
                    type="date"
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Warehouse *</label>
                  <select
                    value={warehouseId}
                    onChange={(e) => setWarehouseId(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white"
                  >
                    {warehouses.map((w) => (
                      <option key={w.id} value={w.id}>
                        {w.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Reason *</label>
                  <input
                    type="text"
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                  />
                </div>
              </div>

              <div>
                <label className="block font-medium text-slate-700 mb-1">Description</label>
                <input
                  type="text"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Cycle count or damaged stock write-off notes"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                />
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-slate-800">Items to Adjust</span>
                  <button
                    type="button"
                    onClick={() => setLines([...lines, { itemId: '', newQuantity: 0, unitCost: 0 }])}
                    className="text-[#408dfb] font-medium inline-flex items-center gap-1"
                  >
                    <Plus className="w-3.5 h-3.5" /> Add Item
                  </button>
                </div>

                {lines.map((line, idx) => {
                  const it = itemMap[line.itemId];
                  const onHand = it ? Number(it.stockByWarehouse?.[warehouseId] ?? 0) : 0;
                  const diff = line.newQuantity - onHand;

                  return (
                    <div key={idx} className="grid grid-cols-12 gap-2 items-center">
                      <select
                        value={line.itemId}
                        onChange={(e) => {
                          const selectedIt = itemMap[e.target.value];
                          const curQty = selectedIt ? Number(selectedIt.stockByWarehouse?.[warehouseId] ?? 0) : 0;
                          const next = [...lines];
                          next[idx] = {
                            itemId: e.target.value,
                            newQuantity: curQty,
                            unitCost: selectedIt?.costPrice ?? 0,
                          };
                          setLines(next);
                        }}
                        className="col-span-5 px-2.5 py-2 border border-slate-300 rounded-lg bg-white"
                      >
                        <option value="">Select item...</option>
                        {items.map((item) => (
                          <option key={item.id} value={item.id}>
                            {item.sku} — {item.name}
                          </option>
                        ))}
                      </select>
                      <div className="col-span-2 text-right px-2 py-2 bg-slate-50 rounded-lg border border-slate-200 tabular-nums">
                        On hand: {onHand}
                      </div>
                      <input
                        type="number"
                        min="0"
                        value={line.newQuantity}
                        onChange={(e) => {
                          const next = [...lines];
                          next[idx].newQuantity = Math.max(0, Number(e.target.value) || 0);
                          setLines(next);
                        }}
                        placeholder="New qty"
                        className="col-span-2 px-2.5 py-2 border border-slate-300 rounded-lg text-right tabular-nums"
                      />
                      <div
                        className={`col-span-2 text-right font-semibold tabular-nums ${
                          diff > 0 ? 'text-emerald-600' : diff < 0 ? 'text-red-600' : 'text-slate-500'
                        }`}
                      >
                        {diff > 0 ? `+${diff}` : diff}
                      </div>
                      <div className="col-span-1 text-right">
                        {lines.length > 1 && (
                          <button
                            type="button"
                            onClick={() => setLines(lines.filter((_, i) => i !== idx))}
                            aria-label="Remove line"
                            className="p-1.5 text-slate-400 hover:text-red-600"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="pt-3 flex justify-end gap-2 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="px-4 py-2 border border-slate-300 rounded-lg"
                >
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
                  {saving ? 'Applying...' : 'Convert to Adjusted'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {selected && (
        <div className="fixed inset-0 z-[70] flex items-center justify-end bg-slate-900/40">
          <div className="bg-white h-full max-w-2xl w-full p-6 overflow-y-auto shadow-2xl">
            <div className="flex items-center justify-between pb-4 border-b border-slate-200">
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-lg font-bold text-slate-900">{selected.adjustmentNumber}</h2>
                  <StatusBadge status={selected.status} />
                </div>
                <p className="text-xs text-slate-500 mt-0.5">
                  {formatDisplayDate(selected.date)} · {whMap[selected.warehouseId] || selected.warehouseId}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {selected.status === 'draft' && can('adjustments', 'edit') && (
                  <button
                    type="button"
                    onClick={() => handleApplyDraft(selected)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-[#408dfb] text-white rounded-lg"
                  >
                    <CheckCircle2 className="w-3.5 h-3.5" /> Apply Adjustment
                  </button>
                )}
                <button type="button" onClick={() => setSelected(null)} aria-label="Close details">
                  <X className="w-5 h-5 text-slate-400" />
                </button>
              </div>
            </div>

            <div className="mt-4 space-y-4 text-xs">
              <div className="bg-slate-50 border border-slate-200 rounded-lg p-3">
                <p className="font-semibold text-slate-700">Reason: {selected.reason}</p>
                {selected.description && <p className="text-slate-600 mt-1">{selected.description}</p>}
              </div>

              <table className="w-full border border-slate-200 rounded-lg overflow-hidden">
                <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                  <tr>
                    <th className="text-left px-3 py-2">Item</th>
                    <th className="text-right px-3 py-2">Previous</th>
                    <th className="text-right px-3 py-2">New</th>
                    <th className="text-right px-3 py-2">Delta</th>
                    <th className="text-right px-3 py-2">Unit Cost</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {selected.lines.map((l, idx) => (
                    <tr key={idx}>
                      <td className="px-3 py-2">
                        <p className="font-medium text-slate-900">{l.itemName}</p>
                        <p className="text-[11px] font-mono-num text-slate-500">{l.sku}</p>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{l.quantityOnHand}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{l.newQuantity}</td>
                      <td className="px-3 py-2 text-right font-semibold tabular-nums">
                        {l.quantityAdjusted > 0 ? `+${l.quantityAdjusted}` : l.quantityAdjusted}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{formatLKR(l.unitCost)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <RecordCommentsAndAttachments
                subcollection="adjustments"
                recordId={selected.id}
                comments={selected.comments}
                attachments={selected.attachments}
                canEdit={can('adjustments', 'edit')}
                onUpdated={load}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
