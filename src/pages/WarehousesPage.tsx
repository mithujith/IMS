import React, { useCallback, useEffect, useState } from 'react';
import { Warehouse as WarehouseIcon, X } from 'lucide-react';
import { useOrg } from '../hooks/useOrg';
import { useAuth } from '../hooks/useAuth';
import { useToast } from '../hooks/useToast';
import { Warehouse } from '../types';
import { fetchPagedCollection, softDeleteOrgDoc, updateOrgDoc } from '../services/firestoreList';
import { createWarehouse } from '../services/itemsService';
import { DataTable, TableColumn } from '../components/DataTable';
import { StatusBadge } from '../components/StatusBadge';
import { exportToCsv } from '../lib/csv';

export function WarehousesPage() {
  const { orgId, can } = useOrg();
  const { user } = useAuth();
  const { showToast } = useToast();

  const [rows, setRows] = useState<Warehouse[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Warehouse | null>(null);

  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [address, setAddress] = useState('');
  const [city, setCity] = useState('Colombo');
  const [phone, setPhone] = useState('');
  const [isPrimary, setIsPrimary] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!orgId) return;
    setLoading(true);
    try {
      const res = await fetchPagedCollection<Warehouse>({
        orgId,
        subcollection: 'warehouses',
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

  const openModal = (wh?: Warehouse) => {
    if (wh) {
      setEditing(wh);
      setName(wh.name);
      setCode(wh.code);
      setAddress(wh.address || '');
      setCity(wh.city || '');
      setPhone(wh.phone || '');
      setIsPrimary(Boolean(wh.isPrimary));
    } else {
      setEditing(null);
      setName('');
      setCode('');
      setAddress('');
      setCity('Colombo');
      setPhone('');
      setIsPrimary(false);
    }
    setModalOpen(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!orgId || !user || !name.trim() || !code.trim()) return;
    setSaving(true);
    try {
      if (editing) {
        await updateOrgDoc(orgId, 'warehouses', editing.id, user.uid, {
          name: name.trim(),
          code: code.trim().toUpperCase(),
          address: address.trim(),
          city: city.trim(),
          phone: phone.trim(),
          isPrimary,
        });
        showToast('Warehouse updated', 'success');
      } else {
        await createWarehouse(orgId, user.uid, {
          name: name.trim(),
          code: code.trim().toUpperCase(),
          address: address.trim(),
          city: city.trim(),
          phone: phone.trim(),
          isPrimary,
          status: 'active',
        });
        showToast('Warehouse created', 'success');
      }
      setModalOpen(false);
      await load();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Save failed', 'error');
    } finally {
      setSaving(false);
    }
  };

  const columns: TableColumn<Warehouse>[] = [
    {
      key: 'name',
      label: 'Warehouse Name',
      sortable: true,
      sortValue: (r) => r.name,
      render: (r) => (
        <div className="flex items-center gap-2">
          <WarehouseIcon className="w-4 h-4 text-[#408dfb]" />
          <span className="font-medium text-slate-900">{r.name}</span>
          {r.isPrimary && (
            <span className="px-1.5 py-0.5 text-[10px] font-semibold bg-blue-50 text-blue-700 rounded">
              Primary
            </span>
          )}
        </div>
      ),
    },
    { key: 'code', label: 'Code', render: (r) => <span className="font-mono-num">{r.code}</span> },
    { key: 'city', label: 'City', render: (r) => r.city || '—' },
    { key: 'address', label: 'Address', render: (r) => r.address || '—' },
    { key: 'phone', label: 'Phone', render: (r) => r.phone || '—' },
    { key: 'status', label: 'Status', render: (r) => <StatusBadge status={r.status} /> },
  ];

  return (
    <>
      <DataTable
        title="Warehouses"
        subtitle="Manage Main Store, Showroom, and multi-location spare parts storage"
        rows={rows}
        columns={columns}
        loading={loading}
        searchQuery={search}
        onSearchChange={setSearch}
        searchPredicate={(r, q) =>
          r.name.toLowerCase().includes(q) || r.code.toLowerCase().includes(q)
        }
        onRowClick={(r) => (can('warehouses', 'edit') ? openModal(r) : undefined)}
        canCreate={can('warehouses', 'create')}
        newButtonLabel="New Warehouse"
        onNewClick={() => openModal()}
        canDelete={can('warehouses', 'delete')}
        onBulkDelete={async (ids) => {
          if (!orgId || !user) return;
          for (const id of ids) await softDeleteOrgDoc(orgId, 'warehouses', id, user.uid);
          showToast('Deleted selected warehouses', 'success');
          await load();
        }}
        onExportCsv={(visible) => {
          exportToCsv(
            'warehouses.csv',
            ['Name', 'Code', 'Address', 'City', 'Phone', 'Primary', 'Status'],
            visible.map((w) => [w.name, w.code, w.address || '', w.city || '', w.phone || '', w.isPrimary ? 'Yes' : 'No', w.status])
          );
        }}
      />

      {modalOpen && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-900/50 p-4">
          <div className="bg-white rounded-xl border border-slate-200 shadow-xl max-w-md w-full p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-semibold text-slate-900">
                {editing ? 'Edit Warehouse' : 'New Warehouse'}
              </h2>
              <button type="button" onClick={() => setModalOpen(false)} aria-label="Close">
                <X className="w-4 h-4 text-slate-400" />
              </button>
            </div>
            <form onSubmit={handleSave} className="space-y-3 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Name *</label>
                  <input
                    type="text"
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="e.g. Kandy Depot"
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Code *</label>
                  <input
                    type="text"
                    required
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    placeholder="e.g. WH-KDY"
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg font-mono-num"
                  />
                </div>
              </div>
              <div>
                <label className="block font-medium text-slate-700 mb-1">Address</label>
                <input
                  type="text"
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium text-slate-700 mb-1">City</label>
                  <input
                    type="text"
                    value={city}
                    onChange={(e) => setCity(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Phone</label>
                  <input
                    type="text"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                  />
                </div>
              </div>
              <label className="flex items-center gap-2 pt-1 cursor-pointer">
                <input
                  type="checkbox"
                  checked={isPrimary}
                  onChange={(e) => setIsPrimary(e.target.checked)}
                  className="rounded border-slate-300 text-[#408dfb]"
                />
                <span className="text-slate-700">Set as Primary Warehouse</span>
              </label>

              <div className="pt-3 flex justify-end gap-2">
                <button type="button" onClick={() => setModalOpen(false)} className="px-4 py-2 border border-slate-300 rounded-lg">
                  Cancel
                </button>
                <button type="submit" disabled={saving} className="px-4 py-2 bg-[#408dfb] text-white rounded-lg font-medium">
                  {saving ? 'Saving...' : 'Save Warehouse'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
