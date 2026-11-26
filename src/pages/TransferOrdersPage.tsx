import { useCallback, useEffect, useState } from 'react';
import { collection, getDocs } from 'firebase/firestore';
import { ArrowRightLeft, CheckCircle2, Plus, Trash2, X } from 'lucide-react';
import { db } from '../firebase';
import { useOrg } from '../hooks/useOrg';
import { useAuth } from '../hooks/useAuth';
import { useToast } from '../hooks/useToast';
import { Item, TransferOrder, Warehouse } from '../types';
import { fetchPagedCollection, softDeleteOrgDoc } from '../services/firestoreList';
import { completeDraftTransferOrder, createTransferOrder } from '../services/stockService';
import { DataTable, TableColumn } from '../components/DataTable';
import { StatusBadge } from '../components/StatusBadge';
import { RecordCommentsAndAttachments } from '../components/RecordCommentsAndAttachments';
import { exportToCsv } from '../lib/csv';
import { formatDateISO, formatDisplayDate } from '../lib/formatters';

export function TransferOrdersPage() {
  const { orgId, can } = useOrg();
  const { user } = useAuth();
  const { showToast } = useToast();

  const [rows, setRows] = useState<TransferOrder[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [selected, setSelected] = useState<TransferOrder | null>(null);

  const [date, setDate] = useState(formatDateISO());
  const [sourceWarehouseId, setSourceWarehouseId] = useState('');
  const [destinationWarehouseId, setDestinationWarehouseId] = useState('');
  const [reason, setReason] = useState('Branch stock replenishment');
  const [lines, setLines] = useState<{ itemId: string; quantity: number }[]>([{ itemId: '', quantity: 1 }]);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!orgId) return;
    setLoading(true);
    try {
      const [res, itemSnap, whSnap] = await Promise.all([
        fetchPagedCollection<TransferOrder>({ orgId, subcollection: 'transferOrders', pageSize: 30 }),
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
      if (whs.length >= 2 && !sourceWarehouseId) {
        setSourceWarehouseId(whs[0].id);
        setDestinationWarehouseId(whs[1].id);
      } else if (whs.length === 1 && !sourceWarehouseId) {
        setSourceWarehouseId(whs[0].id);
      }
    } finally {
      setLoading(false);
    }
  }, [orgId, sourceWarehouseId]);

  useEffect(() => {
    void load();
  }, [load]);

  const whMap = Object.fromEntries(warehouses.map((w) => [w.id, w.name]));
  const itemMap = Object.fromEntries(items.map((i) => [i.id, i]));

  const handleCreate = async (completeImmediately: boolean) => {
    if (!orgId || !user) return;
    const validLines = lines.filter((l) => l.itemId && l.quantity > 0);
    if (!sourceWarehouseId || !destinationWarehouseId || validLines.length === 0) {
      showToast('Select source & destination warehouses and at least one item', 'error');
      return;
    }
    setSaving(true);
    try {
      await createTransferOrder({
        orgId,
        userId: user.uid,
        userName: user.displayName || user.email || 'User',
        date,
        sourceWarehouseId,
        destinationWarehouseId,
        reason,
        lines: validLines,
        completeImmediately,
      });
      setModalOpen(false);
      setLines([{ itemId: '', quantity: 1 }]);
      showToast(completeImmediately ? 'Stock transferred' : 'Transfer order saved as draft', 'success');
      await load();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Transfer failed', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleCompleteDraft = async (tr: TransferOrder) => {
    if (!orgId || !user) return;
    try {
      await completeDraftTransferOrder({
        orgId,
        userId: user.uid,
        userName: user.displayName || user.email || 'User',
        transferId: tr.id,
      });
      showToast(`${tr.transferNumber} completed`, 'success');
      setSelected(null);
      await load();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to complete transfer', 'error');
    }
  };

  const columns: TableColumn<TransferOrder>[] = [
    {
      key: 'transferNumber',
      label: 'Transfer #',
      sortable: true,
      sortValue: (r) => r.transferNumber,
      render: (r) => <span className="font-mono-num font-semibold text-[#408dfb]">{r.transferNumber}</span>,
    },
    { key: 'date', label: 'Date', render: (r) => formatDisplayDate(r.date) },
    {
      key: 'route',
      label: 'Route',
      render: (r) => (
        <span className="inline-flex items-center gap-1.5">
          <span>{whMap[r.sourceWarehouseId] || r.sourceWarehouseId}</span>
          <ArrowRightLeft className="w-3 h-3 text-slate-400" />
          <span>{whMap[r.destinationWarehouseId] || r.destinationWarehouseId}</span>
        </span>
      ),
    },
    { key: 'lines', label: 'Items', align: 'right', render: (r) => r.lines.length },
    { key: 'status', label: 'Status', render: (r) => <StatusBadge status={r.status} /> },
  ];

  return (
    <div className="space-y-6">
      <DataTable
        title="Transfer Orders"
        subtitle="Move spare parts between Main Store, Showroom, and branch warehouses"
        rows={rows}
        columns={columns}
        loading={loading}
        searchQuery={search}
        onSearchChange={setSearch}
        searchPredicate={(r, q) =>
          r.transferNumber.toLowerCase().includes(q) || (r.reason || '').toLowerCase().includes(q)
        }
        onRowClick={(r) => setSelected(r)}
        canCreate={can('transferOrders', 'create')}
        newButtonLabel="New Transfer Order"
        onNewClick={() => setModalOpen(true)}
        canDelete={can('transferOrders', 'delete')}
        onBulkDelete={async (ids) => {
          if (!orgId || !user) return;
          for (const id of ids) await softDeleteOrgDoc(orgId, 'transferOrders', id, user.uid);
          showToast('Deleted selected transfer orders', 'success');
          await load();
        }}
        onExportCsv={(visible) => {
          exportToCsv(
            'transfer-orders.csv',
            ['Transfer #', 'Date', 'Source', 'Destination', 'Status', 'Lines'],
            visible.map((r) => [
              r.transferNumber,
              r.date,
              whMap[r.sourceWarehouseId] || r.sourceWarehouseId,
              whMap[r.destinationWarehouseId] || r.destinationWarehouseId,
              r.status,
              r.lines.length,
            ])
          );
        }}
      />

      {modalOpen && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-900/50 p-4">
          <div className="bg-white rounded-xl border border-slate-200 shadow-xl max-w-2xl w-full p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-semibold text-slate-900">New Transfer Order</h2>
              <button type="button" onClick={() => setModalOpen(false)} aria-label="Close">
                <X className="w-4 h-4 text-slate-400" />
              </button>
            </div>
            <div className="space-y-4 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
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
                  <label className="block font-medium text-slate-700 mb-1">Source Warehouse *</label>
                  <select
                    value={sourceWarehouseId}
                    onChange={(e) => setSourceWarehouseId(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white"
                  >
                    {warehouses.map((w) => (
                      <option key={w.id} value={w.id}>{w.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Destination Warehouse *</label>
                  <select
                    value={destinationWarehouseId}
                    onChange={(e) => setDestinationWarehouseId(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white"
                  >
                    <option value="">Select destination...</option>
                    {warehouses.map((w) => (
                      <option key={w.id} value={w.id}>{w.name}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block font-medium text-slate-700 mb-1">Reason</label>
                <input
                  type="text"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                />
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-slate-800">Items</span>
                  <button
                    type="button"
                    onClick={() => setLines([...lines, { itemId: '', quantity: 1 }])}
                    className="text-[#408dfb] font-medium inline-flex items-center gap-1"
                  >
                    <Plus className="w-3.5 h-3.5" /> Add Item
                  </button>
                </div>

                {lines.map((line, idx) => {
                  const it = itemMap[line.itemId];
                  const avail = it ? Number(it.stockByWarehouse?.[sourceWarehouseId] ?? 0) : 0;
                  return (
                    <div key={idx} className="grid grid-cols-12 gap-2 items-center">
                      <select
                        value={line.itemId}
                        onChange={(e) => {
                          const next = [...lines];
                          next[idx].itemId = e.target.value;
                          setLines(next);
                        }}
                        className="col-span-7 px-2.5 py-2 border border-slate-300 rounded-lg bg-white"
                      >
                        <option value="">Select item...</option>
                        {items.map((item) => (
                          <option key={item.id} value={item.id}>
                            {item.sku} — {item.name}
                          </option>
                        ))}
                      </select>
                      <span className="col-span-2 text-right text-slate-500 tabular-nums">
                        Avail: {avail}
                      </span>
                      <input
                        type="number"
                        min="1"
                        value={line.quantity}
                        onChange={(e) => {
                          const next = [...lines];
                          next[idx].quantity = Math.max(1, Number(e.target.value) || 1);
                          setLines(next);
                        }}
                        className="col-span-2 px-2.5 py-2 border border-slate-300 rounded-lg text-right tabular-nums"
                      />
                      <div className="col-span-1 text-right">
                        {lines.length > 1 && (
                          <button
                            type="button"
                            onClick={() => setLines(lines.filter((_, i) => i !== idx))}
                            aria-label="Remove item"
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
                <button type="button" onClick={() => setModalOpen(false)} className="px-4 py-2 border border-slate-300 rounded-lg">
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => handleCreate(false)}
                  className="px-4 py-2 border border-slate-300 bg-slate-50 rounded-lg font-medium"
                >
                  Save Draft
                </button>
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => handleCreate(true)}
                  className="px-4 py-2 bg-[#408dfb] text-white rounded-lg font-medium"
                >
                  {saving ? 'Transferring...' : 'Transfer Immediately'}
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
                  <h2 className="text-lg font-bold text-slate-900">{selected.transferNumber}</h2>
                  <StatusBadge status={selected.status} />
                </div>
                <p className="text-xs text-slate-500 mt-0.5">
                  {whMap[selected.sourceWarehouseId]} → {whMap[selected.destinationWarehouseId]} · {formatDisplayDate(selected.date)}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {selected.status !== 'transferred' && can('transferOrders', 'edit') && (
                  <button
                    type="button"
                    onClick={() => handleCompleteDraft(selected)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-[#408dfb] text-white rounded-lg"
                  >
                    <CheckCircle2 className="w-3.5 h-3.5" /> Complete Transfer
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
                    <th className="text-right px-3 py-2">Quantity</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {selected.lines.map((l, i) => (
                    <tr key={i}>
                      <td className="px-3 py-2">
                        <p className="font-medium text-slate-900">{l.itemName}</p>
                        <p className="text-[11px] font-mono-num text-slate-500">{l.sku}</p>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums font-medium">{l.quantity}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <RecordCommentsAndAttachments
                subcollection="transferOrders"
                recordId={selected.id}
                comments={selected.comments}
                attachments={selected.attachments}
                canEdit={can('transferOrders', 'edit')}
                onUpdated={load}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
