import React, { useCallback, useEffect, useState } from 'react';
import { collection, getDocs } from 'firebase/firestore';
import { Layers, Plus, Trash2, X } from 'lucide-react';
import { db } from '../firebase';
import { useOrg } from '../hooks/useOrg';
import { useAuth } from '../hooks/useAuth';
import { useToast } from '../hooks/useToast';
import { CompositeComponent, CompositeItem, Item, Warehouse } from '../types';
import { fetchPagedCollection, softDeleteOrgDoc } from '../services/firestoreList';
import { assembleCompositeItem, createCompositeItem } from '../services/itemsService';
import { DataTable, TableColumn } from '../components/DataTable';
import { StatusBadge } from '../components/StatusBadge';
import { formatLKR } from '../lib/formatters';

export function CompositeItemsPage() {
  const { orgId, can } = useOrg();
  const { user } = useAuth();
  const { showToast } = useToast();

  const [rows, setRows] = useState<CompositeItem[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [modalOpen, setModalOpen] = useState(false);

  const [name, setName] = useState('');
  const [sku, setSku] = useState('');
  const [sellingPrice, setSellingPrice] = useState('0');
  const [warehouseId, setWarehouseId] = useState('');
  const [components, setComponents] = useState<{ itemId: string; quantity: number }[]>([
    { itemId: '', quantity: 1 },
  ]);
  const [saving, setSaving] = useState(false);
  const [assemblingId, setAssemblingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!orgId) return;
    setLoading(true);
    try {
      const [res, itemSnap, whSnap] = await Promise.all([
        fetchPagedCollection<CompositeItem>({ orgId, subcollection: 'compositeItems', pageSize: 30 }),
        getDocs(collection(db, `organizations/${orgId}/items`)),
        getDocs(collection(db, `organizations/${orgId}/warehouses`)),
      ]);
      setRows(res.items);
      setItems(itemSnap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Item, 'id'>) })).filter((i) => !i.isDeleted));
      const whs = whSnap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Warehouse, 'id'>) })).filter((w) => !w.isDeleted);
      setWarehouses(whs);
      if (whs.length > 0 && !warehouseId) setWarehouseId(whs[0].id);
    } finally {
      setLoading(false);
    }
  }, [orgId, warehouseId]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!orgId || !user) return;
    const itemMap = Object.fromEntries(items.map((i) => [i.id, i]));
    const builtComponents: CompositeComponent[] = components
      .filter((c) => c.itemId && c.quantity > 0 && itemMap[c.itemId])
      .map((c) => {
        const it = itemMap[c.itemId];
        return {
          itemId: it.id,
          itemName: it.name,
          sku: it.sku,
          quantity: Number(c.quantity),
          unitCost: it.costPrice,
        };
      });

    if (builtComponents.length === 0) {
      showToast('Add at least one component item', 'error');
      return;
    }

    const totalCost = builtComponents.reduce((s, c) => s + c.quantity * c.unitCost, 0);
    setSaving(true);
    try {
      await createCompositeItem(orgId, user.uid, {
        name: name.trim(),
        sku: sku.trim(),
        unit: 'SET',
        sellingPrice: Number(sellingPrice) || 0,
        costPrice: totalCost,
        warehouseId: warehouseId || warehouses[0]?.id || '',
        components: builtComponents,
        assembledQty: 0,
        status: 'active',
      });
      setModalOpen(false);
      setName('');
      setSku('');
      showToast('Composite BOM created', 'success');
      await load();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Save failed', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleAssemble = async (comp: CompositeItem) => {
    if (!orgId || !user) return;
    setAssemblingId(comp.id);
    try {
      await assembleCompositeItem({
        orgId,
        userId: user.uid,
        userName: user.displayName || user.email || 'User',
        compositeId: comp.id,
        quantityToAssemble: 1,
        warehouseId: comp.warehouseId || warehouses[0]?.id || '',
      });
      showToast(`Assembled 1 ${comp.unit} of ${comp.name}`, 'success');
      await load();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Assembly failed', 'error');
    } finally {
      setAssemblingId(null);
    }
  };

  const columns: TableColumn<CompositeItem>[] = [
    { key: 'name', label: 'Composite Name', render: (r) => <span className="font-medium text-slate-900">{r.name}</span> },
    { key: 'sku', label: 'SKU', render: (r) => <span className="font-mono-num">{r.sku}</span> },
    {
      key: 'components',
      label: 'BOM Components',
      render: (r) => `${r.components?.length ?? 0} part(s)`,
    },
    { key: 'costPrice', label: 'BOM Cost', align: 'right', render: (r) => formatLKR(r.costPrice) },
    { key: 'sellingPrice', label: 'Selling Price', align: 'right', render: (r) => formatLKR(r.sellingPrice) },
    { key: 'assembledQty', label: 'Assembled', align: 'right', render: (r) => `${r.assembledQty} ${r.unit}` },
    { key: 'status', label: 'Status', render: (r) => <StatusBadge status={r.status} /> },
    {
      key: 'actions',
      label: 'Action',
      align: 'right',
      render: (r) =>
        can('compositeItems', 'edit') ? (
          <button
            type="button"
            disabled={assemblingId === r.id}
            onClick={(e) => {
              e.stopPropagation();
              void handleAssemble(r);
            }}
            className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium bg-[#408dfb] text-white rounded hover:bg-[#2f7ae5] disabled:opacity-50"
          >
            <Layers className="w-3 h-3" />
            {assemblingId === r.id ? 'Assembling...' : 'Assemble +1'}
          </button>
        ) : null,
    },
  ];

  return (
    <>
      <DataTable
        title="Composite Items (BOM)"
        subtitle="Bundle motorcycle spare parts into service kits and assemble from warehouse stock"
        rows={rows}
        columns={columns}
        loading={loading}
        searchQuery={search}
        onSearchChange={setSearch}
        searchPredicate={(r, q) =>
          r.name.toLowerCase().includes(q) || r.sku.toLowerCase().includes(q)
        }
        canCreate={can('compositeItems', 'create')}
        newButtonLabel="New Composite Item"
        onNewClick={() => setModalOpen(true)}
        canDelete={can('compositeItems', 'delete')}
        onBulkDelete={async (ids) => {
          if (!orgId || !user) return;
          for (const id of ids) await softDeleteOrgDoc(orgId, 'compositeItems', id, user.uid);
          showToast('Deleted', 'success');
          await load();
        }}
      />

      {modalOpen && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-900/50 p-4">
          <div className="bg-white rounded-xl border border-slate-200 shadow-xl max-w-xl w-full p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-semibold text-slate-900">New Composite Kit (BOM)</h2>
              <button type="button" onClick={() => setModalOpen(false)} aria-label="Close">
                <X className="w-4 h-4 text-slate-400" />
              </button>
            </div>
            <form onSubmit={handleSave} className="space-y-3 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Kit Name *</label>
                  <input
                    type="text"
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="e.g. Pulsar 150 Tune-Up Kit"
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">SKU *</label>
                  <input
                    type="text"
                    required
                    value={sku}
                    onChange={(e) => setSku(e.target.value)}
                    placeholder="e.g. KIT-P150"
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg font-mono-num"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Selling Price (LKR)</label>
                  <input
                    type="number"
                    min="0"
                    value={sellingPrice}
                    onChange={(e) => setSellingPrice(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Assembly Warehouse</label>
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
              </div>

              <div className="space-y-2 pt-2">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-slate-700">Components</span>
                  <button
                    type="button"
                    onClick={() => setComponents([...components, { itemId: '', quantity: 1 }])}
                    className="text-[#408dfb] font-medium inline-flex items-center gap-1"
                  >
                    <Plus className="w-3.5 h-3.5" /> Add Part
                  </button>
                </div>
                {components.map((comp, idx) => (
                  <div key={idx} className="flex items-center gap-2">
                    <select
                      value={comp.itemId}
                      onChange={(e) => {
                        const next = [...components];
                        next[idx].itemId = e.target.value;
                        setComponents(next);
                      }}
                      className="flex-1 px-2.5 py-2 border border-slate-300 rounded-lg bg-white"
                    >
                      <option value="">Select component item...</option>
                      {items.map((it) => (
                        <option key={it.id} value={it.id}>
                          {it.sku} — {it.name}
                        </option>
                      ))}
                    </select>
                    <input
                      type="number"
                      min="1"
                      value={comp.quantity}
                      onChange={(e) => {
                        const next = [...components];
                        next[idx].quantity = Number(e.target.value) || 1;
                        setComponents(next);
                      }}
                      className="w-20 px-2.5 py-2 border border-slate-300 rounded-lg tabular-nums"
                    />
                    <button
                      type="button"
                      onClick={() => setComponents(components.filter((_, i) => i !== idx))}
                      aria-label="Remove component"
                      className="p-1.5 text-slate-400 hover:text-red-600"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>

              <div className="pt-3 flex justify-end gap-2">
                <button type="button" onClick={() => setModalOpen(false)} className="px-4 py-2 border border-slate-300 rounded-lg">
                  Cancel
                </button>
                <button type="submit" disabled={saving} className="px-4 py-2 bg-[#408dfb] text-white rounded-lg font-medium">
                  {saving ? 'Saving...' : 'Save Composite Item'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
