import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, X } from 'lucide-react';
import { useOrg } from '../hooks/useOrg';
import { useAuth } from '../hooks/useAuth';
import { useToast } from '../hooks/useToast';
import { ShipmentDoc } from '../types';
import { fetchPagedCollection, softDeleteOrgDoc } from '../services/firestoreList';
import { markShipmentDelivered } from '../services/salesService';
import { DataTable, TableColumn } from '../components/DataTable';
import { StatusBadge } from '../components/StatusBadge';
import { RecordCommentsAndAttachments } from '../components/RecordCommentsAndAttachments';
import { exportToCsv } from '../lib/csv';
import { formatDisplayDate, formatLKR } from '../lib/formatters';

export function ShipmentsPage() {
  const { orgId, can } = useOrg();
  const { user } = useAuth();
  const { showToast } = useToast();

  const [rows, setRows] = useState<ShipmentDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<ShipmentDoc | null>(null);

  const load = useCallback(async () => {
    if (!orgId) return;
    setLoading(true);
    try {
      const res = await fetchPagedCollection<ShipmentDoc>({
        orgId,
        subcollection: 'shipments',
        pageSize: 30,
      });
      setRows(res.items);
    } finally {
      setLoading(false);
    }
  }, [orgId]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleMarkDelivered = async (shp: ShipmentDoc) => {
    if (!orgId || !user) return;
    try {
      await markShipmentDelivered({
        orgId,
        userId: user.uid,
        userName: user.displayName || user.email || 'User',
        shipmentId: shp.id,
      });
      showToast(`${shp.shipmentNumber} marked delivered`, 'success');
      setSelected(null);
      await load();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Update failed', 'error');
    }
  };

  const columns: TableColumn<ShipmentDoc>[] = [
    { key: 'date', label: 'Date', render: (r) => formatDisplayDate(r.date) },
    {
      key: 'shipmentNumber',
      label: 'Shipment #',
      render: (r) => <span className="font-mono-num font-semibold text-[#408dfb]">{r.shipmentNumber}</span>,
    },
    { key: 'salesOrderNumber', label: 'Sales Order', render: (r) => <span className="font-mono-num">{r.salesOrderNumber}</span> },
    { key: 'customerName', label: 'Customer', render: (r) => r.customerName },
    { key: 'carrier', label: 'Carrier', render: (r) => r.carrier },
    { key: 'trackingNumber', label: 'Tracking #', render: (r) => <span className="font-mono-num">{r.trackingNumber || '—'}</span> },
    { key: 'status', label: 'Status', render: (r) => <StatusBadge status={r.status} /> },
    {
      key: 'action',
      label: 'Delivery',
      align: 'right',
      render: (r) =>
        r.status === 'shipped' && can('shipments', 'edit') ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              void handleMarkDelivered(r);
            }}
            className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium bg-emerald-600 text-white rounded hover:bg-emerald-700"
          >
            <CheckCircle2 className="w-3 h-3" /> Mark Delivered
          </button>
        ) : null,
    },
  ];

  return (
    <div className="space-y-6">
      <DataTable
        title="Shipments"
        subtitle="Track outbound courier dispatches and confirm customer delivery"
        rows={rows}
        columns={columns}
        loading={loading}
        searchQuery={search}
        onSearchChange={setSearch}
        searchPredicate={(r, q) =>
          r.shipmentNumber.toLowerCase().includes(q) ||
          r.customerName.toLowerCase().includes(q) ||
          (r.trackingNumber || '').toLowerCase().includes(q)
        }
        onRowClick={(r) => setSelected(r)}
        canDelete={can('shipments', 'delete')}
        onBulkDelete={async (ids) => {
          if (!orgId || !user) return;
          for (const id of ids) await softDeleteOrgDoc(orgId, 'shipments', id, user.uid);
          showToast('Deleted selected shipments', 'success');
          await load();
        }}
        onExportCsv={(visible) => {
          exportToCsv(
            'shipments.csv',
            ['Date', 'Shipment #', 'SO #', 'Customer', 'Carrier', 'Tracking #', 'Status'],
            visible.map((r) => [
              r.date,
              r.shipmentNumber,
              r.salesOrderNumber,
              r.customerName,
              r.carrier,
              r.trackingNumber || '',
              r.status,
            ])
          );
        }}
      />

      {selected && (
        <div className="fixed inset-0 z-[70] flex items-center justify-end bg-slate-900/40">
          <div className="bg-white h-full max-w-2xl w-full p-6 overflow-y-auto shadow-2xl">
            <div className="flex items-center justify-between pb-4 border-b border-slate-200">
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-lg font-bold text-slate-900">{selected.shipmentNumber}</h2>
                  <StatusBadge status={selected.status} />
                </div>
                <p className="text-xs text-slate-500 mt-0.5">
                  {selected.carrier} · Tracking: {selected.trackingNumber || 'N/A'} · Cost: {formatLKR(selected.shippingCost ?? 0)}
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
                    <th className="text-right px-3 py-2">Shipped Qty</th>
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
                subcollection="shipments"
                recordId={selected.id}
                comments={selected.comments}
                attachments={selected.attachments}
                canEdit={can('shipments', 'edit')}
                onUpdated={load}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
