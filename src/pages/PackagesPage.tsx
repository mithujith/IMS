import React, { useCallback, useEffect, useState } from 'react';
import { collection, getDocs } from 'firebase/firestore';
import { Truck, X } from 'lucide-react';
import { db } from '../firebase';
import { useOrg } from '../hooks/useOrg';
import { useAuth } from '../hooks/useAuth';
import { useToast } from '../hooks/useToast';
import { PackageDoc, SalesOrder } from '../types';
import { fetchPagedCollection, softDeleteOrgDoc } from '../services/firestoreList';
import { createPackageFromSO, createShipmentFromPackage } from '../services/salesService';
import { DataTable, TableColumn } from '../components/DataTable';
import { StatusBadge } from '../components/StatusBadge';
import { RecordCommentsAndAttachments } from '../components/RecordCommentsAndAttachments';
import { exportToCsv } from '../lib/csv';
import { formatDateISO, formatDisplayDate } from '../lib/formatters';

export function PackagesPage() {
  const { orgId, can } = useOrg();
  const { user } = useAuth();
  const { showToast } = useToast();

  const [rows, setRows] = useState<PackageDoc[]>([]);
  const [confirmedSOs, setConfirmedSOs] = useState<SalesOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [shipPkg, setShipPkg] = useState<PackageDoc | null>(null);
  const [selected, setSelected] = useState<PackageDoc | null>(null);

  const [selectedSoId, setSelectedSoId] = useState('');
  const [pkgDate, setPkgDate] = useState(formatDateISO());
  const [carrier, setCarrier] = useState('Prompt Express LK');
  const [trackingNumber, setTrackingNumber] = useState('');
  const [shippingCost, setShippingCost] = useState('350');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!orgId) return;
    setLoading(true);
    try {
      const [res, soSnap] = await Promise.all([
        fetchPagedCollection<PackageDoc>({ orgId, subcollection: 'packages', pageSize: 30 }),
        getDocs(collection(db, `organizations/${orgId}/salesOrders`)),
      ]);
      setRows(res.items);
      const sos = soSnap.docs
        .map((d) => ({ id: d.id, ...(d.data() as Omit<SalesOrder, 'id'>) }))
        .filter((s) => !s.isDeleted && s.status === 'confirmed');
      setConfirmedSOs(sos);
      if (sos.length > 0 && !selectedSoId) setSelectedSoId(sos[0].id);
    } finally {
      setLoading(false);
    }
  }, [orgId, selectedSoId]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleCreatePackage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!orgId || !user || !selectedSoId) return;
    setSaving(true);
    try {
      await createPackageFromSO({
        orgId,
        userId: user.uid,
        userName: user.displayName || user.email || 'User',
        salesOrderId: selectedSoId,
        date: pkgDate,
      });
      setCreateOpen(false);
      showToast('Package created', 'success');
      await load();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to create package', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleShipPackage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!orgId || !user || !shipPkg) return;
    setSaving(true);
    try {
      await createShipmentFromPackage({
        orgId,
        userId: user.uid,
        userName: user.displayName || user.email || 'User',
        packageId: shipPkg.id,
        date: formatDateISO(),
        carrier: carrier.trim() || 'Prompt Express LK',
        trackingNumber: trackingNumber.trim(),
        shippingCost: Number(shippingCost) || 0,
      });
      setShipPkg(null);
      setTrackingNumber('');
      showToast(`Shipped ${shipPkg.packageNumber} & deducted warehouse stock`, 'success');
      await load();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Shipment failed', 'error');
    } finally {
      setSaving(false);
    }
  };

  const columns: TableColumn<PackageDoc>[] = [
    { key: 'date', label: 'Date', render: (r) => formatDisplayDate(r.date) },
    {
      key: 'packageNumber',
      label: 'Package #',
      render: (r) => <span className="font-mono-num font-semibold text-[#408dfb]">{r.packageNumber}</span>,
    },
    { key: 'salesOrderNumber', label: 'Sales Order', render: (r) => <span className="font-mono-num">{r.salesOrderNumber}</span> },
    { key: 'customerName', label: 'Customer', render: (r) => r.customerName },
    { key: 'lines', label: 'Items', align: 'right', render: (r) => r.lines.length },
    { key: 'status', label: 'Status', render: (r) => <StatusBadge status={r.status} /> },
    {
      key: 'action',
      label: 'Fulfillment',
      align: 'right',
      render: (r) =>
        r.status === 'not_shipped' && can('shipments', 'create') ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setShipPkg(r);
            }}
            className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium bg-[#408dfb] text-white rounded hover:bg-[#2f7ae5]"
          >
            <Truck className="w-3 h-3" /> Ship Package
          </button>
        ) : null,
    },
  ];

  return (
    <div className="space-y-6">
      <DataTable
        title="Packages"
        subtitle="Pack confirmed sales orders and dispatch shipments with atomic stock deduction"
        rows={rows}
        columns={columns}
        loading={loading}
        searchQuery={search}
        onSearchChange={setSearch}
        searchPredicate={(r, q) =>
          r.packageNumber.toLowerCase().includes(q) ||
          r.salesOrderNumber.toLowerCase().includes(q) ||
          r.customerName.toLowerCase().includes(q)
        }
        onRowClick={(r) => setSelected(r)}
        canCreate={can('packages', 'create')}
        newButtonLabel="New Package"
        onNewClick={() => setCreateOpen(true)}
        canDelete={can('packages', 'delete')}
        onBulkDelete={async (ids) => {
          if (!orgId || !user) return;
          for (const id of ids) await softDeleteOrgDoc(orgId, 'packages', id, user.uid);
          showToast('Deleted selected packages', 'success');
          await load();
        }}
        onExportCsv={(visible) => {
          exportToCsv(
            'packages.csv',
            ['Date', 'Package #', 'Sales Order #', 'Customer', 'Status'],
            visible.map((r) => [r.date, r.packageNumber, r.salesOrderNumber, r.customerName, r.status])
          );
        }}
      />

      {createOpen && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-900/50 p-4">
          <div className="bg-white rounded-xl border border-slate-200 shadow-xl max-w-md w-full p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-semibold text-slate-900">Create Package from Sales Order</h2>
              <button type="button" onClick={() => setCreateOpen(false)} aria-label="Close">
                <X className="w-4 h-4 text-slate-400" />
              </button>
            </div>
            <form onSubmit={handleCreatePackage} className="space-y-3 text-xs">
              <div>
                <label className="block font-medium text-slate-700 mb-1">Confirmed Sales Order *</label>
                <select
                  required
                  value={selectedSoId}
                  onChange={(e) => setSelectedSoId(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white"
                >
                  <option value="">Select confirmed order...</option>
                  {confirmedSOs.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.orderNumber} — {s.customerName}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block font-medium text-slate-700 mb-1">Package Date</label>
                <input
                  type="date"
                  value={pkgDate}
                  onChange={(e) => setPkgDate(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                />
              </div>
              <div className="pt-3 flex justify-end gap-2">
                <button type="button" onClick={() => setCreateOpen(false)} className="px-4 py-2 border border-slate-300 rounded-lg">
                  Cancel
                </button>
                <button type="submit" disabled={saving || !selectedSoId} className="px-4 py-2 bg-[#408dfb] text-white rounded-lg font-medium">
                  {saving ? 'Creating...' : 'Create Package'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {shipPkg && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-900/50 p-4">
          <div className="bg-white rounded-xl border border-slate-200 shadow-xl max-w-md w-full p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-semibold text-slate-900">Ship {shipPkg.packageNumber}</h2>
              <button type="button" onClick={() => setShipPkg(null)} aria-label="Close">
                <X className="w-4 h-4 text-slate-400" />
              </button>
            </div>
            <form onSubmit={handleShipPackage} className="space-y-3 text-xs">
              <div>
                <label className="block font-medium text-slate-700 mb-1">Carrier *</label>
                <input
                  type="text"
                  required
                  value={carrier}
                  onChange={(e) => setCarrier(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                />
              </div>
              <div>
                <label className="block font-medium text-slate-700 mb-1">Tracking Number</label>
                <input
                  type="text"
                  value={trackingNumber}
                  onChange={(e) => setTrackingNumber(e.target.value)}
                  placeholder="e.g. PEX-88241"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                />
              </div>
              <div>
                <label className="block font-medium text-slate-700 mb-1">Shipping Cost (LKR)</label>
                <input
                  type="number"
                  min="0"
                  value={shippingCost}
                  onChange={(e) => setShippingCost(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                />
              </div>
              <div className="pt-3 flex justify-end gap-2">
                <button type="button" onClick={() => setShipPkg(null)} className="px-4 py-2 border border-slate-300 rounded-lg">
                  Cancel
                </button>
                <button type="submit" disabled={saving} className="px-4 py-2 bg-[#408dfb] text-white rounded-lg font-medium">
                  {saving ? 'Shipping...' : 'Confirm Shipment'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {selected && (
        <div className="fixed inset-0 z-[70] flex items-center justify-end bg-slate-900/40">
          <div className="bg-white h-full max-w-2xl w-full p-6 overflow-y-auto shadow-2xl">
            <div className="flex items-center justify-between pb-4 border-b border-slate-200">
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-lg font-bold text-slate-900">{selected.packageNumber}</h2>
                  <StatusBadge status={selected.status} />
                </div>
                <p className="text-xs text-slate-500 mt-0.5">
                  {selected.salesOrderNumber} · {selected.customerName}
                </p>
              </div>
              <button type="button" onClick={() => setSelected(null)} aria-label="Close">
                <X className="w-5 h-5 text-slate-400" />
              </button>
            </div>
            <div className="mt-4 space-y-4 text-xs">
              <table className="w-full border border-slate-200 rounded-lg overflow-hidden">
                <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                  <tr>
                    <th className="text-left px-3 py-2">Item</th>
                    <th className="text-right px-3 py-2">Packed Qty</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {selected.lines.map((l, i) => (
                    <tr key={i}>
                      <td className="px-3 py-2">
                        <p className="font-medium text-slate-900">{l.itemName}</p>
                        <p className="text-[11px] font-mono-num text-slate-500">{l.sku}</p>
                      </td>
                      <td className="px-3 py-2 text-right font-medium tabular-nums">{l.quantity}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <RecordCommentsAndAttachments
                subcollection="packages"
                recordId={selected.id}
                comments={selected.comments}
                attachments={selected.attachments}
                canEdit={can('packages', 'edit')}
                onUpdated={load}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
