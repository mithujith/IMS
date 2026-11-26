import React, { useCallback, useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { useOrg } from '../hooks/useOrg';
import { useAuth } from '../hooks/useAuth';
import { useToast } from '../hooks/useToast';
import { PriceList } from '../types';
import { fetchPagedCollection, softDeleteOrgDoc } from '../services/firestoreList';
import { createPriceList } from '../services/itemsService';
import { DataTable, TableColumn } from '../components/DataTable';
import { StatusBadge } from '../components/StatusBadge';

export function PriceListsPage() {
  const { orgId, can } = useOrg();
  const { user } = useAuth();
  const { showToast } = useToast();

  const [rows, setRows] = useState<PriceList[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [modalOpen, setModalOpen] = useState(false);

  const [name, setName] = useState('');
  const [type, setType] = useState<'percentage' | 'custom'>('percentage');
  const [markupOrDiscount, setMarkupOrDiscount] = useState<'markup' | 'discount'>('discount');
  const [percentage, setPercentage] = useState('10');
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!orgId) return;
    setLoading(true);
    try {
      const res = await fetchPagedCollection<PriceList>({ orgId, subcollection: 'priceLists', pageSize: 30 });
      setRows(res.items);
    } finally {
      setLoading(false);
    }
  }, [orgId]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!orgId || !user || !name.trim()) return;
    setSaving(true);
    try {
      await createPriceList(orgId, user.uid, {
        name: name.trim(),
        description: description.trim(),
        type,
        markupOrDiscount,
        percentage: Number(percentage) || 0,
        status: 'active',
      });
      setModalOpen(false);
      setName('');
      showToast('Price list created', 'success');
      await load();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Save failed', 'error');
    } finally {
      setSaving(false);
    }
  };

  const columns: TableColumn<PriceList>[] = [
    { key: 'name', label: 'Price List Name', render: (r) => <span className="font-medium text-slate-900">{r.name}</span> },
    { key: 'type', label: 'Type', render: (r) => <span className="capitalize">{r.type}</span> },
    {
      key: 'rate',
      label: 'Adjustment',
      render: (r) =>
        r.type === 'percentage'
          ? `${r.percentage}% ${r.markupOrDiscount}`
          : 'Custom item rates',
    },
    { key: 'status', label: 'Status', render: (r) => <StatusBadge status={r.status} /> },
  ];

  return (
    <>
      <DataTable
        title="Price Lists"
        subtitle="Wholesale and dealer pricing rules"
        rows={rows}
        columns={columns}
        loading={loading}
        searchQuery={search}
        onSearchChange={setSearch}
        searchPredicate={(r, q) => r.name.toLowerCase().includes(q)}
        canCreate={can('priceLists', 'create')}
        newButtonLabel="New Price List"
        onNewClick={() => setModalOpen(true)}
        canDelete={can('priceLists', 'delete')}
        onBulkDelete={async (ids) => {
          if (!orgId || !user) return;
          for (const id of ids) await softDeleteOrgDoc(orgId, 'priceLists', id, user.uid);
          showToast('Deleted', 'success');
          await load();
        }}
      />

      {modalOpen && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-900/50 p-4">
          <div className="bg-white rounded-xl border border-slate-200 shadow-xl max-w-md w-full p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-semibold text-slate-900">New Price List</h2>
              <button type="button" onClick={() => setModalOpen(false)} aria-label="Close">
                <X className="w-4 h-4 text-slate-400" />
              </button>
            </div>
            <form onSubmit={handleSave} className="space-y-3 text-xs">
              <div>
                <label className="block font-medium text-slate-700 mb-1">Name *</label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Wholesale Dealer Tier 1"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Type</label>
                  <select
                    value={type}
                    onChange={(e) => setType(e.target.value as 'percentage' | 'custom')}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white"
                  >
                    <option value="percentage">Percentage</option>
                    <option value="custom">Custom Rate</option>
                  </select>
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Mode</label>
                  <select
                    value={markupOrDiscount}
                    onChange={(e) => setMarkupOrDiscount(e.target.value as 'markup' | 'discount')}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white"
                  >
                    <option value="discount">Discount (-)</option>
                    <option value="markup">Markup (+)</option>
                  </select>
                </div>
              </div>
              {type === 'percentage' && (
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Percentage (%)</label>
                  <input
                    type="number"
                    min="0"
                    max="100"
                    step="0.1"
                    value={percentage}
                    onChange={(e) => setPercentage(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg tabular-nums"
                  />
                </div>
              )}
              <div>
                <label className="block font-medium text-slate-700 mb-1">Description</label>
                <textarea
                  rows={2}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                />
              </div>
              <div className="pt-3 flex justify-end gap-2">
                <button type="button" onClick={() => setModalOpen(false)} className="px-4 py-2 border border-slate-300 rounded-lg">
                  Cancel
                </button>
                <button type="submit" disabled={saving} className="px-4 py-2 bg-[#408dfb] text-white rounded-lg font-medium">
                  {saving ? 'Saving...' : 'Save Price List'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
