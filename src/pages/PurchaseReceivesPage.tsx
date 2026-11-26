import { useCallback, useEffect, useState } from 'react';
import { collection, getDocs } from 'firebase/firestore';
import { X } from 'lucide-react';
import { db } from '../firebase';
import { useOrg } from '../hooks/useOrg';
import { useAuth } from '../hooks/useAuth';
import { useToast } from '../hooks/useToast';
import { PurchaseOrder, PurchaseReceive } from '../types';
import { fetchPagedCollection, softDeleteOrgDoc } from '../services/firestoreList';
import { receivePurchaseOrder } from '../services/purchasesService';
import { DataTable, TableColumn } from '../components/DataTable';
import { StatusBadge } from '../components/StatusBadge';
import { RecordCommentsAndAttachments } from '../components/RecordCommentsAndAttachments';
import { exportToCsv } from '../lib/csv';
import { formatDateISO, formatDisplayDate } from '../lib/formatters';

export function PurchaseReceivesPage() {
  const { orgId, can } = useOrg();
  const { user } = useAuth();
  const { showToast } = useToast();

  const [rows, setRows] = useState<PurchaseReceive[]>([]);
  const [openPOs, setOpenPOs] = useState<PurchaseOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [selected, setSelected] = useState<PurchaseReceive | null>(null);

  const [selectedPoId, setSelectedPoId] = useState('');
  const [qtys, setQtys] = useState<Record<string, number>>({});
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!orgId) return;
    setLoading(true);
    try {
      const [res, poSnap] = await Promise.all([
        fetchPagedCollection<PurchaseReceive>({ orgId, subcollection: 'purchaseReceives', pageSize: 30 }),
        getDocs(collection(db, `organizations/${orgId}/purchaseOrders`)),
      ]);
      setRows(res.items);
      const pos = poSnap.docs
        .map((d) => ({ id: d.id, ...(d.data() as Omit<PurchaseOrder, 'id'>) }))
        .filter((p) => !p.isDeleted && ['issued', 'partially_received'].includes(p.status));
      setOpenPOs(pos);
      if (pos.length > 0 && !selectedPoId) {
        setSelectedPoId(pos[0].id);
        const init: Record<string, number> = {};
        for (const l of pos[0].lines) init[l.itemId] = Math.max(0, l.quantity - Number(l.receivedQty ?? 0));
        setQtys(init);
      }
    } finally {
      setLoading(false);
    }
  }, [orgId, selectedPoId]);

  useEffect(() => {
    void load();
  }, [load]);

  const activePO = openPOs.find((p) => p.id === selectedPoId);

  const handleSave = async () => {
    if (!orgId || !user || !activePO) return;
    setSaving(true);
    try {
      await receivePurchaseOrder({
        orgId,
        userId: user.uid,
        userName: user.displayName || user.email || 'User',
        purchaseOrderId: activePO.id,
        date: formatDateISO(),
        linesToReceive: Object.entries(qtys).map(([itemId, qtyReceived]) => ({ itemId, qtyReceived })),
      });
      setModalOpen(false);
      showToast('Purchase receive recorded & inventory increased', 'success');
      await load();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Receive failed', 'error');
    } finally {
      setSaving(false);
    }
  };

  const columns: TableColumn<PurchaseReceive>[] = [
    { key: 'date', label: 'Date', render: (r) => formatDisplayDate(r.date) },
    {
      key: 'receiveNumber',
      label: 'Receive #',
      render: (r) => <span className="font-mono-num font-semibold text-[#408dfb]">{r.receiveNumber}</span>,
    },
    { key: 'poNumber', label: 'Purchase Order', render: (r) => <span className="font-mono-num">{r.poNumber}</span> },
    { key: 'vendorName', label: 'Vendor', render: (r) => r.vendorName },
    { key: 'lines', label: 'Items', align: 'right', render: (r) => r.lines.length },
    { key: 'status', label: 'Status', render: (r) => <StatusBadge status={r.status} /> },
  ];

  return (
    <div className="space-y-6">
      <DataTable
        title="Purchase Receives"
        subtitle="Record incoming supplier deliveries against issued Purchase Orders"
        rows={rows}
        columns={columns}
        loading={loading}
        searchQuery={search}
        onSearchChange={setSearch}
        searchPredicate={(r, q) =>
          r.receiveNumber.toLowerCase().includes(q) ||
          r.poNumber.toLowerCase().includes(q) ||
          r.vendorName.toLowerCase().includes(q)
        }
        onRowClick={(r) => setSelected(r)}
        canCreate={can('purchaseReceives', 'create')}
        newButtonLabel="New Purchase Receive"
        onNewClick={() => setModalOpen(true)}
        canDelete={can('purchaseReceives', 'delete')}
        onBulkDelete={async (ids) => {
          if (!orgId || !user) return;
          for (const id of ids) await softDeleteOrgDoc(orgId, 'purchaseReceives', id, user.uid);
          showToast('Deleted selected purchase receives', 'success');
          await load();
        }}
        onExportCsv={(visible) => {
          exportToCsv(
            'purchase-receives.csv',
            ['Date', 'Receive #', 'PO #', 'Vendor', 'Status'],
            visible.map((r) => [r.date, r.receiveNumber, r.poNumber, r.vendorName, r.status])
          );
        }}
      />

      {modalOpen && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-900/50 p-4">
          <div className="bg-white rounded-xl border border-slate-200 shadow-xl max-w-xl w-full p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-semibold text-slate-900">Record Purchase Receive</h2>
              <button type="button" onClick={() => setModalOpen(false)} aria-label="Close"><X className="w-4 h-4 text-slate-400" /></button>
            </div>
            <div className="space-y-3 text-xs">
              <div>
                <label className="block font-medium text-slate-700 mb-1">Select Open Purchase Order *</label>
                <select
                  value={selectedPoId}
                  onChange={(e) => {
                    setSelectedPoId(e.target.value);
                    const found = openPOs.find((p) => p.id === e.target.value);
                    if (found) {
                      const init: Record<string, number> = {};
                      for (const l of found.lines) init[l.itemId] = Math.max(0, l.quantity - Number(l.receivedQty ?? 0));
                      setQtys(init);
                    }
                  }}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white"
                >
                  <option value="">Select PO...</option>
                  {openPOs.map((p) => <option key={p.id} value={p.id}>{p.poNumber} — {p.vendorName}</option>)}
                </select>
              </div>
              {activePO && (
                <table className="w-full border border-slate-200 rounded-lg overflow-hidden">
                  <thead className="bg-slate-50 border-b border-slate-200">
                    <tr>
                      <th className="text-left px-3 py-2">Item</th>
                      <th className="text-right px-3 py-2">Remaining</th>
                      <th className="text-right px-3 py-2">Receive Qty</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {activePO.lines.map((l) => {
                      const rem = Math.max(0, l.quantity - Number(l.receivedQty ?? 0));
                      return (
                        <tr key={l.itemId}>
                          <td className="px-3 py-2">{l.sku} — {l.itemName}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{rem}</td>
                          <td className="px-3 py-2 text-right">
                            <input
                              type="number"
                              min="0"
                              max={rem}
                              value={qtys[l.itemId] ?? 0}
                              onChange={(e) => setQtys((prev) => ({ ...prev, [l.itemId]: Number(e.target.value) || 0 }))}
                              className="w-20 px-2 py-1 border border-slate-300 rounded text-right tabular-nums"
                            />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
              <div className="pt-3 flex justify-end gap-2">
                <button type="button" onClick={() => setModalOpen(false)} className="px-4 py-2 border border-slate-300 rounded-lg">Cancel</button>
                <button type="button" disabled={saving || !activePO} onClick={handleSave} className="px-4 py-2 bg-[#408dfb] text-white rounded-lg font-medium">
                  {saving ? 'Receiving...' : 'Confirm Receive'}
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
                <h2 className="text-lg font-bold text-slate-900">{selected.receiveNumber}</h2>
                <p className="text-xs text-slate-500">{selected.poNumber} · {selected.vendorName}</p>
              </div>
              <button type="button" onClick={() => setSelected(null)} aria-label="Close"><X className="w-5 h-5 text-slate-400" /></button>
            </div>
            <div className="mt-4 space-y-4 text-xs">
              <table className="w-full border border-slate-200 rounded-lg overflow-hidden">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr>
                    <th className="text-left px-3 py-2">Item</th>
                    <th className="text-right px-3 py-2">Ordered</th>
                    <th className="text-right px-3 py-2">Received</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {selected.lines.map((l, i) => (
                    <tr key={i}>
                      <td className="px-3 py-2">{l.sku} — {l.itemName}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{l.orderedQty}</td>
                      <td className="px-3 py-2 text-right font-semibold tabular-nums text-emerald-700">{l.receivedQty}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <RecordCommentsAndAttachments
                subcollection="purchaseReceives"
                recordId={selected.id}
                comments={selected.comments}
                attachments={selected.attachments}
                canEdit={can('purchaseReceives', 'edit')}
                onUpdated={load}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
