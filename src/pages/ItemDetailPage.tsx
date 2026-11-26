import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  collection,
  doc,
  limit,
  onSnapshot,
  orderBy,
  query,
  where,
} from 'firebase/firestore';
import { ArrowLeft, Copy, Package, Trash2 } from 'lucide-react';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { useOrg } from '../hooks/useOrg';
import { useAuth } from '../hooks/useAuth';
import { useToast } from '../hooks/useToast';
import { Item, StockLedgerEntry, Warehouse } from '../types';
import { formatDisplayDate, formatLKR } from '../lib/formatters';
import { getAvailableStock } from '../lib/calculations';
import { createItemWithOpeningStock } from '../services/itemsService';
import { softDeleteOrgDoc } from '../services/firestoreList';
import { RecordCommentsAndAttachments } from '../components/RecordCommentsAndAttachments';
import { StatusBadge } from '../components/StatusBadge';
import { ConfirmDialog } from '../components/ConfirmDialog';

export function ItemDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { orgId, can } = useOrg();
  const { user } = useAuth();
  const { showToast } = useToast();
  const navigate = useNavigate();

  const [item, setItem] = useState<Item | null>(null);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [ledger, setLedger] = useState<StockLedgerEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (!orgId || !id) return;
    setLoading(true);

    const itemPath = `organizations/${orgId}/items/${id}`;
    const unsubItem = onSnapshot(
      doc(db, itemPath),
      (snap) => {
        if (snap.exists()) {
          setItem({ id: snap.id, ...(snap.data() as Omit<Item, 'id'>) });
        } else {
          setItem(null);
        }
        setLoading(false);
      },
      (err) => {
        handleFirestoreError(err, OperationType.GET, itemPath);
      }
    );

    const whUnsub = onSnapshot(
      collection(db, `organizations/${orgId}/warehouses`),
      (snap) => {
        setWarehouses(
          snap.docs
            .map((d) => ({ id: d.id, ...(d.data() as Omit<Warehouse, 'id'>) }))
            .filter((w) => !w.isDeleted)
        );
      }
    );

    const ledgerQ = query(
      collection(db, `organizations/${orgId}/stockLedger`),
      where('itemId', '==', id),
      orderBy('createdAt', 'desc'),
      limit(50)
    );
    const unsubLedger = onSnapshot(
      ledgerQ,
      (snap) => {
        setLedger(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<StockLedgerEntry, 'id'>) })));
      },
      () => {
        // Fallback query without composite index if not yet created
        const simpleQ = query(
          collection(db, `organizations/${orgId}/stockLedger`),
          where('itemId', '==', id),
          limit(50)
        );
        onSnapshot(simpleQ, (s2) => {
          setLedger(s2.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<StockLedgerEntry, 'id'>) })));
        });
      }
    );

    return () => {
      unsubItem();
      whUnsub();
      unsubLedger();
    };
  }, [orgId, id]);

  if (loading) {
    return <div className="p-8 text-xs text-slate-500">Loading item details...</div>;
  }

  if (!item || item.isDeleted) {
    return (
      <div className="p-8 text-center">
        <p className="text-sm font-medium text-slate-800">Item not found.</p>
        <button
          type="button"
          onClick={() => navigate('/items')}
          className="mt-3 text-xs text-[#408dfb] hover:underline"
        >
          Back to Items
        </button>
      </div>
    );
  }

  const { onHand, committed, available } = getAvailableStock(item);
  const whNames = Object.fromEntries(warehouses.map((w) => [w.id, w.name]));

  const handleClone = async () => {
    if (!orgId || !user) return;
    try {
      const clonedId = await createItemWithOpeningStock({
        orgId,
        userId: user.uid,
        userName: user.displayName || user.email || 'User',
        warehouseId: warehouses[0]?.id || '',
        data: {
          name: `${item.name} (Copy)`,
          sku: `${item.sku}-COPY-${Date.now().toString().slice(-4)}`,
          unit: item.unit,
          category: item.category,
          brand: item.brand,
          manufacturer: item.manufacturer,
          sellingPrice: item.sellingPrice,
          costPrice: item.costPrice,
          taxRate: item.taxRate,
          preferredVendorId: item.preferredVendorId,
          openingStock: 0,
          reorderLevel: item.reorderLevel,
          reorderQty: item.reorderQty,
          barcode: item.barcode,
          images: item.images || [],
          status: 'active',
        },
      });
      showToast('Item cloned', 'success');
      navigate(`/items/${clonedId}`);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Clone failed', 'error');
    }
  };

  return (
    <div className="space-y-5 max-w-6xl mx-auto">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => navigate('/items')}
            aria-label="Back to items"
            className="p-2 bg-white border border-slate-200 rounded-lg text-slate-600 hover:text-slate-900"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-semibold text-slate-900">{item.name}</h1>
              <StatusBadge status={item.status} />
            </div>
            <p className="text-xs text-slate-500 mt-0.5 font-mono-num">
              SKU: {item.sku} · Unit: {item.unit} {item.brand ? `· ${item.brand}` : ''}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {can('items', 'create') && (
            <button
              type="button"
              onClick={handleClone}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50"
            >
              <Copy className="w-3.5 h-3.5" />
              Clone
            </button>
          )}
          {can('items', 'delete') && (
            <button
              type="button"
              onClick={() => setConfirmDelete(true)}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-red-700 bg-white border border-red-200 rounded-lg hover:bg-red-50"
            >
              <Trash2 className="w-3.5 h-3.5" />
              Delete
            </button>
          )}
        </div>
      </div>

      {/* Overview Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <p className="text-[11px] text-slate-500 uppercase font-medium">Stock on Hand</p>
          <p className="text-2xl font-bold text-slate-900 mt-1 tabular-nums">
            {onHand} <span className="text-xs font-normal text-slate-500">{item.unit}</span>
          </p>
        </div>
        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <p className="text-[11px] text-slate-500 uppercase font-medium">Committed Stock</p>
          <p className="text-2xl font-bold text-amber-600 mt-1 tabular-nums">
            {committed} <span className="text-xs font-normal text-slate-500">{item.unit}</span>
          </p>
        </div>
        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <p className="text-[11px] text-slate-500 uppercase font-medium">Available for Sale</p>
          <p className="text-2xl font-bold text-emerald-600 mt-1 tabular-nums">
            {available} <span className="text-xs font-normal text-slate-500">{item.unit}</span>
          </p>
        </div>
        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <p className="text-[11px] text-slate-500 uppercase font-medium">Selling / Cost Price</p>
          <p className="text-base font-bold text-slate-900 mt-1 tabular-nums">
            {formatLKR(item.sellingPrice)}
          </p>
          <p className="text-[11px] text-slate-500 tabular-nums">Cost: {formatLKR(item.costPrice)}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Per Warehouse Breakdown */}
        <div className="bg-white border border-slate-200 rounded-lg p-4 space-y-4">
          <div className="flex items-center gap-3">
            {item.images?.[0] ? (
              <img
                src={item.images[0]}
                alt={item.name}
                referrerPolicy="no-referrer"
                className="w-20 h-20 rounded-lg object-cover border border-slate-200"
              />
            ) : (
              <div className="w-20 h-20 rounded-lg bg-slate-100 flex items-center justify-center">
                <Package className="w-8 h-8 text-slate-300" />
              </div>
            )}
            <div className="text-xs space-y-1">
              <p className="text-slate-500">Category: <span className="text-slate-900 font-medium">{item.category || '—'}</span></p>
              <p className="text-slate-500">Reorder Level: <span className="text-slate-900 font-medium tabular-nums">{item.reorderLevel} {item.unit}</span></p>
              <p className="text-slate-500">Reorder Qty: <span className="text-slate-900 font-medium tabular-nums">{item.reorderQty} {item.unit}</span></p>
            </div>
          </div>

          <div className="pt-3 border-t border-slate-200">
            <h3 className="text-xs font-semibold text-slate-900 mb-2">Warehouse Stock Breakdown</h3>
            <div className="divide-y divide-slate-100 text-xs">
              {warehouses.map((w) => {
                const whStock = getAvailableStock(item, w.id);
                return (
                  <div key={w.id} className="py-2 flex items-center justify-between">
                    <div>
                      <p className="font-medium text-slate-800">{w.name}</p>
                      <p className="text-[11px] text-slate-400">Committed: {whStock.committed}</p>
                    </div>
                    <div className="text-right tabular-nums">
                      <p className="font-semibold text-slate-900">{whStock.onHand} {item.unit}</p>
                      <p className="text-[11px] text-emerald-600">Avail: {whStock.available}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Transaction / Ledger History */}
        <div className="lg:col-span-2 bg-white border border-slate-200 rounded-lg overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
            <h3 className="text-xs font-semibold text-slate-900">
              Stock Ledger History ({ledger.length})
            </h3>
          </div>
          {ledger.length === 0 ? (
            <p className="p-6 text-xs text-slate-500 text-center">No stock movements recorded yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-slate-50 border-b border-slate-200 text-slate-500">
                  <tr>
                    <th className="py-2 px-3 text-left font-medium">Date</th>
                    <th className="py-2 px-3 text-left font-medium">Type</th>
                    <th className="py-2 px-3 text-left font-medium">Reference</th>
                    <th className="py-2 px-3 text-left font-medium">Warehouse</th>
                    <th className="py-2 px-3 text-right font-medium">Qty Change</th>
                    <th className="py-2 px-3 text-right font-medium">Unit Cost</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {ledger.map((entry) => (
                    <tr key={entry.id}>
                      <td className="py-2 px-3 text-slate-600">{formatDisplayDate(entry.date)}</td>
                      <td className="py-2 px-3 capitalize text-slate-700">{entry.type.replace(/_/g, ' ')}</td>
                      <td className="py-2 px-3 font-mono-num text-slate-700">
                        {entry.referenceNumber || entry.referenceType}
                      </td>
                      <td className="py-2 px-3 text-slate-600">
                        {whNames[entry.warehouseId] || entry.warehouseId}
                      </td>
                      <td
                        className={`py-2 px-3 text-right font-semibold tabular-nums ${
                          entry.quantityChange >= 0 ? 'text-emerald-600' : 'text-red-600'
                        }`}
                      >
                        {entry.quantityChange >= 0 ? `+${entry.quantityChange}` : entry.quantityChange}
                      </td>
                      <td className="py-2 px-3 text-right tabular-nums text-slate-700">
                        {formatLKR(entry.unitCost)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      <RecordCommentsAndAttachments
        subcollection="items"
        recordId={item.id}
        comments={item.comments}
        attachments={item.attachments}
        canEdit={can('items', 'edit')}
      />

      <ConfirmDialog
        open={confirmDelete}
        title="Delete Item"
        message={`Soft-delete "${item.name}" (${item.sku})?`}
        confirmLabel="Delete"
        danger
        onCancel={() => setConfirmDelete(false)}
        onConfirm={async () => {
          if (!orgId || !user) return;
          await softDeleteOrgDoc(orgId, 'items', item.id, user.uid);
          showToast('Item deleted', 'success');
          navigate('/items');
        }}
      />
    </div>
  );
}
