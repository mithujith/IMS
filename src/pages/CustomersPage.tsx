import React, { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { collection, DocumentData, getDocs, QueryDocumentSnapshot } from 'firebase/firestore';
import { Copy, Edit2, X } from 'lucide-react';
import { db } from '../firebase';
import { useOrg } from '../hooks/useOrg';
import { useAuth } from '../hooks/useAuth';
import { useToast } from '../hooks/useToast';
import { Customer, PriceList } from '../types';
import { fetchPagedCollection, softDeleteOrgDoc, updateOrgDoc } from '../services/firestoreList';
import { createCustomer } from '../services/salesService';
import { DataTable, TableColumn } from '../components/DataTable';
import { StatusBadge } from '../components/StatusBadge';
import { CsvImportModal } from '../components/CsvImportModal';
import { RecordCommentsAndAttachments } from '../components/RecordCommentsAndAttachments';
import { exportToCsv } from '../lib/csv';
import { formatLKR } from '../lib/formatters';

export function CustomersPage() {
  const { orgId, can } = useOrg();
  const { user } = useAuth();
  const { showToast } = useToast();
  const [searchParams, setSearchParams] = useSearchParams();

  const [rows, setRows] = useState<Customer[]>([]);
  const [priceLists, setPriceLists] = useState<PriceList[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [cursorStack, setCursorStack] = useState<(QueryDocumentSnapshot<DocumentData> | null)[]>([null]);
  const [pageIdx, setPageIdx] = useState(0);
  const [hasMore, setHasMore] = useState(false);

  const [modalOpen, setModalOpen] = useState(false);
  const [csvOpen, setCsvOpen] = useState(false);
  const [editing, setEditing] = useState<Customer | null>(null);
  const [selected, setSelected] = useState<Customer | null>(null);

  const [name, setName] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [paymentTerms, setPaymentTerms] = useState('Net 30');
  const [creditLimit, setCreditLimit] = useState('250000');
  const [priceListId, setPriceListId] = useState('');
  const [taxNumber, setTaxNumber] = useState('');
  const [billStreet, setBillStreet] = useState('');
  const [billCity, setBillCity] = useState('Colombo');
  const [shipStreet, setShipStreet] = useState('');
  const [shipCity, setShipCity] = useState('Colombo');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(
    async (cursor: QueryDocumentSnapshot<DocumentData> | null) => {
      if (!orgId) return;
      setLoading(true);
      try {
        const [res, plSnap] = await Promise.all([
          fetchPagedCollection<Customer>({
            orgId,
            subcollection: 'customers',
            pageSize: 25,
            cursor,
          }),
          getDocs(collection(db, `organizations/${orgId}/priceLists`)),
        ]);
        setRows(res.items);
        setHasMore(res.hasMore);
        setPriceLists(
          plSnap.docs
            .map((d) => ({ id: d.id, ...(d.data() as Omit<PriceList, 'id'>) }))
            .filter((p) => !p.isDeleted)
        );
        if (res.lastDoc) {
          setCursorStack((prev) => {
            const next = [...prev];
            next[pageIdx + 1] = res.lastDoc;
            return next;
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

  const openForm = (c?: Customer, asClone = false) => {
    if (c) {
      setEditing(asClone ? null : c);
      setName(asClone ? `${c.name} (Copy)` : c.name);
      setCompanyName(c.companyName || '');
      setEmail(c.email || '');
      setPhone(c.phone || '');
      setPaymentTerms(c.paymentTerms || 'Net 30');
      setCreditLimit(String(c.creditLimit ?? 0));
      setPriceListId(c.priceListId || '');
      setTaxNumber(c.taxNumber || '');
      setBillStreet(c.billingAddress?.street || '');
      setBillCity(c.billingAddress?.city || 'Colombo');
      setShipStreet(c.shippingAddress?.street || '');
      setShipCity(c.shippingAddress?.city || 'Colombo');
      setNotes(c.notes || '');
    } else {
      setEditing(null);
      setName('');
      setCompanyName('');
      setEmail('');
      setPhone('');
      setPaymentTerms('Net 30');
      setCreditLimit('250000');
      setPriceListId('');
      setTaxNumber('');
      setBillStreet('');
      setBillCity('Colombo');
      setShipStreet('');
      setShipCity('Colombo');
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
        creditLimit: Number(creditLimit) || 0,
        priceListId: priceListId || undefined,
        taxNumber: taxNumber.trim(),
        billingAddress: {
          street: billStreet.trim() || 'Main Street',
          city: billCity.trim() || 'Colombo',
          country: 'Sri Lanka',
          phone: phone.trim(),
        },
        shippingAddress: {
          street: shipStreet.trim() || billStreet.trim() || 'Main Street',
          city: shipCity.trim() || billCity.trim() || 'Colombo',
          country: 'Sri Lanka',
          phone: phone.trim(),
        },
        status: 'active' as const,
        notes: notes.trim(),
      };

      if (editing) {
        await updateOrgDoc(orgId, 'customers', editing.id, user.uid, payload);
        showToast('Customer updated', 'success');
      } else {
        await createCustomer(orgId, user.uid, user.displayName || user.email || 'User', payload);
        showToast('Customer created', 'success');
      }
      setModalOpen(false);
      await load(cursorStack[pageIdx] ?? null);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Save failed', 'error');
    } finally {
      setSaving(false);
    }
  };

  const columns: TableColumn<Customer>[] = [
    {
      key: 'name',
      label: 'Customer Name',
      sortable: true,
      sortValue: (r) => r.name,
      render: (r) => (
        <div>
          <p className="font-medium text-[#408dfb]">{r.name}</p>
          {r.companyName && r.companyName !== r.name && (
            <p className="text-[11px] text-slate-500">{r.companyName}</p>
          )}
        </div>
      ),
    },
    { key: 'email', label: 'Email', render: (r) => r.email || '—' },
    { key: 'phone', label: 'Phone', render: (r) => r.phone || '—' },
    { key: 'city', label: 'City', render: (r) => r.billingAddress?.city || '—' },
    { key: 'paymentTerms', label: 'Terms', render: (r) => r.paymentTerms },
    {
      key: 'creditLimit',
      label: 'Credit Limit',
      align: 'right',
      render: (r) => formatLKR(r.creditLimit),
    },
    { key: 'status', label: 'Status', render: (r) => <StatusBadge status={r.status} /> },
  ];

  return (
    <div className="space-y-6">
      <DataTable
        title="Customers"
        subtitle="Manage motorcycle spare parts dealers, garages, and wholesale accounts"
        rows={rows}
        columns={columns}
        loading={loading}
        searchQuery={search}
        onSearchChange={setSearch}
        searchPredicate={(r, q) =>
          r.name.toLowerCase().includes(q) ||
          (r.email || '').toLowerCase().includes(q) ||
          (r.phone || '').toLowerCase().includes(q) ||
          (r.billingAddress?.city || '').toLowerCase().includes(q)
        }
        onRowClick={(r) => setSelected(r)}
        canCreate={can('customers', 'create')}
        newButtonLabel="New Customer"
        onNewClick={() => openForm()}
        canDelete={can('customers', 'delete')}
        onBulkDelete={async (ids) => {
          if (!orgId || !user) return;
          for (const id of ids) await softDeleteOrgDoc(orgId, 'customers', id, user.uid);
          showToast('Deleted selected customers', 'success');
          await load(cursorStack[pageIdx] ?? null);
        }}
        onOpenCsvImport={() => setCsvOpen(true)}
        onExportCsv={(visible) => {
          exportToCsv(
            'customers.csv',
            ['Name', 'Company', 'Email', 'Phone', 'City', 'Payment Terms', 'Credit Limit'],
            visible.map((c) => [
              c.name,
              c.companyName || '',
              c.email || '',
              c.phone || '',
              c.billingAddress?.city || '',
              c.paymentTerms,
              c.creditLimit,
            ])
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
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-900/50 p-4 overflow-y-auto">
          <div className="bg-white rounded-xl border border-slate-200 shadow-xl max-w-2xl w-full p-5 my-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-semibold text-slate-900">
                {editing ? 'Edit Customer' : 'New Customer'}
              </h2>
              <button type="button" onClick={() => setModalOpen(false)} aria-label="Close">
                <X className="w-4 h-4 text-slate-400" />
              </button>
            </div>
            <form onSubmit={handleSave} className="space-y-3 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Display Name *</label>
                  <input
                    type="text"
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Company Name</label>
                  <input
                    type="text"
                    value={companyName}
                    onChange={(e) => setCompanyName(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Email</label>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
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
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Payment Terms</label>
                  <select
                    value={paymentTerms}
                    onChange={(e) => setPaymentTerms(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white"
                  >
                    <option value="Due on Receipt">Due on Receipt</option>
                    <option value="Net 15">Net 15</option>
                    <option value="Net 30">Net 30</option>
                    <option value="Net 45">Net 45</option>
                    <option value="Net 60">Net 60</option>
                  </select>
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Credit Limit (LKR)</label>
                  <input
                    type="number"
                    min="0"
                    value={creditLimit}
                    onChange={(e) => setCreditLimit(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Assigned Price List</label>
                  <select
                    value={priceListId}
                    onChange={(e) => setPriceListId(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white"
                  >
                    <option value="">Standard Selling Price</option>
                    {priceLists.map((pl) => (
                      <option key={pl.id} value={pl.id}>{pl.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Tax / VAT Number</label>
                  <input
                    type="text"
                    value={taxNumber}
                    onChange={(e) => setTaxNumber(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 border-t border-slate-100">
                <div className="space-y-2">
                  <p className="font-semibold text-slate-700">Billing Address</p>
                  <input
                    type="text"
                    value={billStreet}
                    onChange={(e) => setBillStreet(e.target.value)}
                    placeholder="Street Address"
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                  />
                  <input
                    type="text"
                    value={billCity}
                    onChange={(e) => setBillCity(e.target.value)}
                    placeholder="City"
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                  />
                </div>
                <div className="space-y-2">
                  <p className="font-semibold text-slate-700">Shipping Address</p>
                  <input
                    type="text"
                    value={shipStreet}
                    onChange={(e) => setShipStreet(e.target.value)}
                    placeholder="Street Address (defaults to billing)"
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                  />
                  <input
                    type="text"
                    value={shipCity}
                    onChange={(e) => setShipCity(e.target.value)}
                    placeholder="City"
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                  />
                </div>
              </div>

              <div>
                <label className="block font-medium text-slate-700 mb-1">Notes</label>
                <textarea
                  rows={2}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                />
              </div>

              <div className="pt-3 flex justify-end gap-2">
                <button type="button" onClick={() => setModalOpen(false)} className="px-4 py-2 border border-slate-300 rounded-lg">
                  Cancel
                </button>
                <button type="submit" disabled={saving} className="px-4 py-2 bg-[#408dfb] text-white rounded-lg font-medium">
                  {saving ? 'Saving...' : 'Save Customer'}
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
                <h2 className="text-lg font-bold text-slate-900">{selected.name}</h2>
                <p className="text-xs text-slate-500">
                  {selected.email || 'No email'} · {selected.phone || 'No phone'}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {can('customers', 'create') && (
                  <button
                    type="button"
                    onClick={() => {
                      const c = selected;
                      setSelected(null);
                      openForm(c, true);
                    }}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg hover:bg-slate-50"
                  >
                    <Copy className="w-3.5 h-3.5" /> Clone
                  </button>
                )}
                {can('customers', 'edit') && (
                  <button
                    type="button"
                    onClick={() => {
                      const c = selected;
                      setSelected(null);
                      openForm(c, false);
                    }}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs bg-[#408dfb] text-white rounded-lg"
                  >
                    <Edit2 className="w-3.5 h-3.5" /> Edit
                  </button>
                )}
                <button type="button" onClick={() => setSelected(null)} aria-label="Close">
                  <X className="w-5 h-5 text-slate-400" />
                </button>
              </div>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-3 text-xs">
              <div className="bg-slate-50 border border-slate-200 rounded-lg p-3">
                <p className="font-semibold text-slate-700 mb-1">Billing Address</p>
                <p className="text-slate-600">{selected.billingAddress?.street}</p>
                <p className="text-slate-600">{selected.billingAddress?.city}, {selected.billingAddress?.country}</p>
              </div>
              <div className="bg-slate-50 border border-slate-200 rounded-lg p-3">
                <p className="font-semibold text-slate-700 mb-1">Account Terms</p>
                <p className="text-slate-600">Terms: {selected.paymentTerms}</p>
                <p className="text-slate-600">Credit Limit: {formatLKR(selected.creditLimit)}</p>
              </div>
            </div>

            <RecordCommentsAndAttachments
              subcollection="customers"
              recordId={selected.id}
              comments={selected.comments}
              attachments={selected.attachments}
              canEdit={can('customers', 'edit')}
              onUpdated={() => load(cursorStack[pageIdx] ?? null)}
            />
          </div>
        </div>
      )}

      <CsvImportModal
        open={csvOpen}
        title="Import Customers from CSV"
        expectedColumns={['name', 'email', 'phone', 'city', 'paymentTerms', 'creditLimit']}
        sampleRow={{
          name: 'Colombo Bike Spares',
          email: 'orders@colombobike.lk',
          phone: '+94 11 255 1234',
          city: 'Colombo 10',
          paymentTerms: 'Net 30',
          creditLimit: '250000',
        }}
        onClose={() => setCsvOpen(false)}
        onImport={async (csvRows) => {
          if (!orgId || !user) return;
          for (const row of csvRows) {
            if (!row.name) continue;
            await createCustomer(orgId, user.uid, user.displayName || user.email || 'User', {
              name: row.name.trim(),
              companyName: row.name.trim(),
              email: row.email?.trim() || '',
              phone: row.phone?.trim() || '',
              paymentTerms: row.paymentTerms?.trim() || 'Net 30',
              creditLimit: Number(row.creditLimit) || 100000,
              billingAddress: {
                street: 'Commercial Street',
                city: row.city?.trim() || 'Colombo',
                country: 'Sri Lanka',
              },
              shippingAddress: {
                street: 'Commercial Street',
                city: row.city?.trim() || 'Colombo',
                country: 'Sri Lanka',
              },
              status: 'active',
            });
          }
          showToast(`Imported ${csvRows.length} customer(s)`, 'success');
          await load(null);
        }}
      />
    </div>
  );
}
