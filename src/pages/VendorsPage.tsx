import React, { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { DocumentData, QueryDocumentSnapshot } from 'firebase/firestore';
import { Copy, Edit2, X } from 'lucide-react';
import { useOrg } from '../hooks/useOrg';
import { useAuth } from '../hooks/useAuth';
import { useToast } from '../hooks/useToast';
import { Vendor } from '../types';
import { fetchPagedCollection, softDeleteOrgDoc, updateOrgDoc } from '../services/firestoreList';
import { createVendor } from '../services/purchasesService';
import { DataTable, TableColumn } from '../components/DataTable';
import { StatusBadge } from '../components/StatusBadge';
import { CsvImportModal } from '../components/CsvImportModal';
import { RecordCommentsAndAttachments } from '../components/RecordCommentsAndAttachments';
import { exportToCsv } from '../lib/csv';

export function VendorsPage() {
  const { orgId, can } = useOrg();
  const { user } = useAuth();
  const { showToast } = useToast();
  const [searchParams, setSearchParams] = useSearchParams();

  const [rows, setRows] = useState<Vendor[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [cursorStack, setCursorStack] = useState<(QueryDocumentSnapshot<DocumentData> | null)[]>([null]);
  const [pageIdx, setPageIdx] = useState(0);
  const [hasMore, setHasMore] = useState(false);

  const [modalOpen, setModalOpen] = useState(false);
  const [csvOpen, setCsvOpen] = useState(false);
  const [editing, setEditing] = useState<Vendor | null>(null);
  const [selected, setSelected] = useState<Vendor | null>(null);

  const [name, setName] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [paymentTerms, setPaymentTerms] = useState('Net 30');
  const [taxNumber, setTaxNumber] = useState('');
  const [street, setStreet] = useState('');
  const [city, setCity] = useState('Colombo 10');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(
    async (cursor: QueryDocumentSnapshot<DocumentData> | null) => {
      if (!orgId) return;
      setLoading(true);
      try {
        const res = await fetchPagedCollection<Vendor>({
          orgId,
          subcollection: 'vendors',
          pageSize: 25,
          cursor,
        });
        setRows(res.items);
        setHasMore(res.hasMore);
        if (res.lastDoc) {
          setCursorStack((prev) => {
            const copy = [...prev];
            copy[pageIdx + 1] = res.lastDoc;
            return copy;
          });
        }
      } finally {
        setLoading(false);
      }
    },
    [orgId, pageIdx]
  );

  useEffect(() => {
    setPageIdx(0);
    setCursorStack([null]);
    void load(null);
  }, [orgId]);

  const openForm = (v?: Vendor, asClone = false) => {
    if (v) {
      setEditing(asClone ? null : v);
      setName(asClone ? `${v.name} (Copy)` : v.name);
      setCompanyName(v.companyName || '');
      setEmail(v.email || '');
      setPhone(v.phone || '');
      setPaymentTerms(v.paymentTerms || 'Net 30');
      setTaxNumber(v.taxNumber || '');
      setStreet(v.billingAddress?.street || '');
      setCity(v.billingAddress?.city || 'Colombo');
      setNotes(v.notes || '');
    } else {
      setEditing(null);
      setName('');
      setCompanyName('');
      setEmail('');
      setPhone('');
      setPaymentTerms('Net 30');
      setTaxNumber('');
      setStreet('');
      setCity('Colombo 10');
      setNotes('');
    }
    setModalOpen(true);
  };

  useEffect(() => {
    if (searchParams.get('new') === '1') {
      openForm();
      const next = new URLSearchParams(searchParams);
      next.delete('new');
      setSearchParams(next, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!orgId || !user || !name.trim()) return;
    setSaving(true);
    try {
      const payload = {
        name: name.trim(),
        companyName: companyName.trim() || name.trim(),
        email: email.trim(),
        phone: phone.trim(),
        paymentTerms,
        taxNumber: taxNumber.trim(),
        billingAddress: {
          street: street.trim() || 'Main Supply Road',
          city: city.trim() || 'Colombo',
          country: 'Sri Lanka',
          phone: phone.trim(),
        },
        status: 'active' as const,
        notes: notes.trim(),
      };
      if (editing) {
        await updateOrgDoc(orgId, 'vendors', editing.id, user.uid, payload);
        showToast('Vendor updated', 'success');
      } else {
        await createVendor(orgId, user.uid, payload);
        showToast('Vendor created', 'success');
      }
      setModalOpen(false);
      await load(cursorStack[pageIdx] ?? null);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Save failed', 'error');
    } finally {
      setSaving(false);
    }
  };

  const columns: TableColumn<Vendor>[] = [
    { key: 'name', label: 'Vendor Name', sortable: true, sortValue: (r) => r.name, render: (r) => <span className="font-medium text-[#408dfb]">{r.name}</span> },
    { key: 'email', label: 'Email', render: (r) => r.email || '—' },
    { key: 'phone', label: 'Phone', render: (r) => r.phone || '—' },
    { key: 'city', label: 'City', render: (r) => r.billingAddress?.city || '—' },
    { key: 'paymentTerms', label: 'Payment Terms', render: (r) => r.paymentTerms },
    { key: 'status', label: 'Status', render: (r) => <StatusBadge status={r.status} /> },
  ];

  return (
    <div className="space-y-6">
      <DataTable
        title="Vendors"
        subtitle="Manage genuine parts importers, OEM distributors, and local suppliers"
        rows={rows}
        columns={columns}
        loading={loading}
        searchQuery={search}
        onSearchChange={setSearch}
        searchPredicate={(r, q) =>
          r.name.toLowerCase().includes(q) || (r.email || '').toLowerCase().includes(q) || (r.phone || '').toLowerCase().includes(q)
        }
        onRowClick={(r) => setSelected(r)}
        canCreate={can('vendors', 'create')}
        newButtonLabel="New Vendor"
        onNewClick={() => openForm()}
        canDelete={can('vendors', 'delete')}
        onBulkDelete={async (ids) => {
          if (!orgId || !user) return;
          for (const id of ids) await softDeleteOrgDoc(orgId, 'vendors', id, user.uid);
          showToast('Deleted selected vendors', 'success');
          await load(cursorStack[pageIdx] ?? null);
        }}
        onOpenCsvImport={() => setCsvOpen(true)}
        onExportCsv={(visible) => {
          exportToCsv(
            'vendors.csv',
            ['Name', 'Email', 'Phone', 'City', 'Payment Terms'],
            visible.map((v) => [v.name, v.email || '', v.phone || '', v.billingAddress?.city || '', v.paymentTerms])
          );
        }}
        pageNumber={pageIdx + 1}
        hasMore={hasMore}
        onNextPage={() => {
          const nextIdx = pageIdx + 1;
          setPageIdx(nextIdx);
          void load(cursorStack[nextIdx] ?? null);
        }}
        onPrevPage={() => {
          const prevIdx = Math.max(0, pageIdx - 1);
          setPageIdx(prevIdx);
          void load(cursorStack[prevIdx] ?? null);
        }}
      />

      {modalOpen && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-900/50 p-4">
          <div className="bg-white rounded-xl border border-slate-200 shadow-xl max-w-lg w-full p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-semibold text-slate-900">{editing ? 'Edit Vendor' : 'New Vendor'}</h2>
              <button type="button" onClick={() => setModalOpen(false)} aria-label="Close"><X className="w-4 h-4 text-slate-400" /></button>
            </div>
            <form onSubmit={handleSave} className="space-y-3 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Vendor Name *</label>
                  <input type="text" required value={name} onChange={(e) => setName(e.target.value)} className="w-full px-3 py-2 border border-slate-300 rounded-lg" />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Company Name</label>
                  <input type="text" value={companyName} onChange={(e) => setCompanyName(e.target.value)} className="w-full px-3 py-2 border border-slate-300 rounded-lg" />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Email</label>
                  <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="w-full px-3 py-2 border border-slate-300 rounded-lg" />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Phone</label>
                  <input type="text" value={phone} onChange={(e) => setPhone(e.target.value)} className="w-full px-3 py-2 border border-slate-300 rounded-lg" />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Payment Terms</label>
                  <select value={paymentTerms} onChange={(e) => setPaymentTerms(e.target.value)} className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white">
                    <option value="Due on Receipt">Due on Receipt</option>
                    <option value="Net 15">Net 15</option>
                    <option value="Net 30">Net 30</option>
                    <option value="Net 45">Net 45</option>
                  </select>
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">City</label>
                  <input type="text" value={city} onChange={(e) => setCity(e.target.value)} className="w-full px-3 py-2 border border-slate-300 rounded-lg" />
                </div>
              </div>
              <div>
                <label className="block font-medium text-slate-700 mb-1">Address</label>
                <input type="text" value={street} onChange={(e) => setStreet(e.target.value)} className="w-full px-3 py-2 border border-slate-300 rounded-lg" />
              </div>
              <div className="pt-3 flex justify-end gap-2">
                <button type="button" onClick={() => setModalOpen(false)} className="px-4 py-2 border border-slate-300 rounded-lg">Cancel</button>
                <button type="submit" disabled={saving} className="px-4 py-2 bg-[#408dfb] text-white rounded-lg font-medium">{saving ? 'Saving...' : 'Save Vendor'}</button>
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
                <h2 className="text-lg font-bold text-slate-900">{selected.name}</h2>
                <p className="text-xs text-slate-500">{selected.email || 'No email'} · {selected.phone || 'No phone'}</p>
              </div>
              <div className="flex items-center gap-2">
                {can('vendors', 'create') && (
                  <button type="button" onClick={() => { const v = selected; setSelected(null); openForm(v, true); }} className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg">
                    <Copy className="w-3.5 h-3.5" /> Clone
                  </button>
                )}
                {can('vendors', 'edit') && (
                  <button type="button" onClick={() => { const v = selected; setSelected(null); openForm(v, false); }} className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs bg-[#408dfb] text-white rounded-lg">
                    <Edit2 className="w-3.5 h-3.5" /> Edit
                  </button>
                )}
                <button type="button" onClick={() => setSelected(null)} aria-label="Close"><X className="w-5 h-5 text-slate-400" /></button>
              </div>
            </div>
            <RecordCommentsAndAttachments
              subcollection="vendors"
              recordId={selected.id}
              comments={selected.comments}
              attachments={selected.attachments}
              canEdit={can('vendors', 'edit')}
              onUpdated={() => load(cursorStack[pageIdx] ?? null)}
            />
          </div>
        </div>
      )}

      <CsvImportModal
        open={csvOpen}
        title="Import Vendors from CSV"
        expectedColumns={['name', 'email', 'phone', 'city', 'paymentTerms']}
        sampleRow={{ name: 'Lanka Importers Ltd', email: 'supply@lankaimporters.lk', phone: '+94 11 232 9000', city: 'Colombo 11', paymentTerms: 'Net 30' }}
        onClose={() => setCsvOpen(false)}
        onImport={async (csvRows) => {
          if (!orgId || !user) return;
          for (const row of csvRows) {
            if (!row.name) continue;
            await createVendor(orgId, user.uid, {
              name: row.name.trim(),
              companyName: row.name.trim(),
              email: row.email?.trim() || '',
              phone: row.phone?.trim() || '',
              paymentTerms: row.paymentTerms?.trim() || 'Net 30',
              billingAddress: { street: 'Supply Road', city: row.city?.trim() || 'Colombo', country: 'Sri Lanka' },
              status: 'active',
            });
          }
          showToast(`Imported ${csvRows.length} vendor(s)`, 'success');
          await load(null);
        }}
      />
    </div>
  );
}
