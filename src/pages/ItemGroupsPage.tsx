import React, { useCallback, useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { useOrg } from '../hooks/useOrg';
import { useAuth } from '../hooks/useAuth';
import { useToast } from '../hooks/useToast';
import { ItemGroup } from '../types';
import { fetchPagedCollection, softDeleteOrgDoc } from '../services/firestoreList';
import { createItemGroup } from '../services/itemsService';
import { DataTable, TableColumn } from '../components/DataTable';
import { StatusBadge } from '../components/StatusBadge';
import { exportToCsv } from '../lib/csv';

export function ItemGroupsPage() {
  const { orgId, can } = useOrg();
  const { user } = useAuth();
  const { showToast } = useToast();

  const [rows, setRows] = useState<ItemGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [modalOpen, setModalOpen] = useState(false);

  const [name, setName] = useState('');
  const [unit, setUnit] = useState('PCS');
  const [description, setDescription] = useState('');
  const [attrName, setAttrName] = useState('Bike Model');
  const [attrValues, setAttrValues] = useState('Pulsar 150, Discover 125, CT100');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!orgId) return;
    setLoading(true);
    try {
      const res = await fetchPagedCollection<ItemGroup>({
        orgId,
        subcollection: 'itemGroups',
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

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!orgId || !user || !name.trim()) return;
    setSaving(true);
    try {
      await createItemGroup(orgId, user.uid, {
        name: name.trim(),
        unit,
        description: description.trim(),
        attributes: attrName.trim()
          ? [
              {
                name: attrName.trim(),
                options: attrValues
                  .split(',')
                  .map((s) => s.trim())
                  .filter(Boolean),
              },
            ]
          : [],
        itemIds: [],
        status: 'active',
      });
      setModalOpen(false);
      setName('');
      setDescription('');
      showToast('Item group created', 'success');
      await load();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to create group', 'error');
    } finally {
      setSaving(false);
    }
  };

  const columns: TableColumn<ItemGroup>[] = [
    { key: 'name', label: 'Group Name', sortable: true, sortValue: (r) => r.name, render: (r) => <span className="font-medium text-slate-900">{r.name}</span> },
    { key: 'unit', label: 'Unit', render: (r) => r.unit },
    {
      key: 'attributes',
      label: 'Variant Attributes',
      render: (r) =>
        r.attributes?.map((a) => `${a.name}: ${a.options.join(', ')}`).join(' | ') || '—',
    },
    { key: 'status', label: 'Status', render: (r) => <StatusBadge status={r.status} /> },
  ];

  return (
    <>
      <DataTable
        title="Item Groups"
        subtitle="Group spare-part variants by bike model, length, or size"
        rows={rows}
        columns={columns}
        loading={loading}
        searchQuery={search}
        onSearchChange={setSearch}
        searchPredicate={(r, q) => r.name.toLowerCase().includes(q)}
        canCreate={can('itemGroups', 'create')}
        newButtonLabel="New Item Group"
        onNewClick={() => setModalOpen(true)}
        canDelete={can('itemGroups', 'delete')}
        onBulkDelete={async (ids) => {
          if (!orgId || !user) return;
          for (const id of ids) await softDeleteOrgDoc(orgId, 'itemGroups', id, user.uid);
          showToast('Group(s) deleted', 'success');
          await load();
        }}
        onExportCsv={(v) =>
          exportToCsv(
            'item-groups.csv',
            ['Name', 'Unit', 'Status'],
            v.map((g) => [g.name, g.unit, g.status])
          )
        }
      />

      {modalOpen && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-900/50 p-4">
          <div className="bg-white rounded-xl border border-slate-200 shadow-xl max-w-md w-full p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-semibold text-slate-900">New Item Group</h2>
              <button type="button" onClick={() => setModalOpen(false)} aria-label="Close">
                <X className="w-4 h-4 text-slate-400" />
              </button>
            </div>
            <form onSubmit={handleSave} className="space-y-3 text-xs">
              <div>
                <label className="block font-medium text-slate-700 mb-1">Group Name *</label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Fuel Pipes Series"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                />
              </div>
              <div>
                <label className="block font-medium text-slate-700 mb-1">Unit</label>
                <select
                  value={unit}
                  onChange={(e) => setUnit(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white"
                >
                  <option value="PCS">PCS</option>
                  <option value="SET">SET</option>
                  <option value="BOX">BOX</option>
                  <option value="PAIR">PAIR</option>
                </select>
              </div>
              <div>
                <label className="block font-medium text-slate-700 mb-1">Attribute Name</label>
                <input
                  type="text"
                  value={attrName}
                  onChange={(e) => setAttrName(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                />
              </div>
              <div>
                <label className="block font-medium text-slate-700 mb-1">Attribute Options (comma-separated)</label>
                <input
                  type="text"
                  value={attrValues}
                  onChange={(e) => setAttrValues(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                />
              </div>
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
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="px-4 py-2 border border-slate-300 rounded-lg"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-4 py-2 bg-[#408dfb] text-white rounded-lg font-medium"
                >
                  {saving ? 'Saving...' : 'Save Group'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
