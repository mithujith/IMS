import React, { useCallback, useEffect, useState } from 'react';
import { collection, getDocs } from 'firebase/firestore';
import { X } from 'lucide-react';
import { db } from '../firebase';
import { useOrg } from '../hooks/useOrg';
import { useAuth } from '../hooks/useAuth';
import { useToast } from '../hooks/useToast';
import { BillDoc, PaymentMade, Vendor } from '../types';
import { fetchPagedCollection, softDeleteOrgDoc } from '../services/firestoreList';
import { recordPaymentMade } from '../services/purchasesService';
import { DataTable, TableColumn } from '../components/DataTable';
import { exportToCsv } from '../lib/csv';
import { formatDateISO, formatDisplayDate, formatLKR } from '../lib/formatters';

export function PaymentsMadePage() {
  const { orgId, can } = useOrg();
  const { user } = useAuth();
  const { showToast } = useToast();

  const [rows, setRows] = useState<PaymentMade[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [bills, setBills] = useState<BillDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [modalOpen, setModalOpen] = useState(false);

  const [vendorId, setVendorId] = useState('');
  const [date, setDate] = useState(formatDateISO());
  const [mode, setMode] = useState<PaymentMade['mode']>('Bank Transfer');
  const [referenceNumber, setReferenceNumber] = useState('');
  const [allocations, setAllocations] = useState<Record<string, number>>({});
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!orgId) return;
    setLoading(true);
    try {
      const [res, vendSnap, billSnap] = await Promise.all([
        fetchPagedCollection<PaymentMade>({ orgId, subcollection: 'paymentsMade', pageSize: 30 }),
        getDocs(collection(db, `organizations/${orgId}/vendors`)),
        getDocs(collection(db, `organizations/${orgId}/bills`)),
      ]);
      setRows(res.items);
      const vends = vendSnap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Vendor, 'id'>) })).filter((v) => !v.isDeleted);
      setVendors(vends);
      setBills(billSnap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<BillDoc, 'id'>) })).filter((b) => !b.isDeleted && b.balanceDue > 0 && b.status !== 'void'));
      if (vends.length > 0 && !vendorId) setVendorId(vends[0].id);
    } finally {
      setLoading(false);
    }
  }, [orgId, vendorId]);

  useEffect(() => {
    void load();
  }, [load]);

  const vendorOpenBills = bills.filter((b) => b.vendorId === vendorId);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!orgId || !user) return;
    const vend = vendors.find((v) => v.id === vendorId);
    if (!vend) return;
    const allocList = vendorOpenBills
      .map((b) => ({ billId: b.id, amountApplied: Number(allocations[b.id] ?? 0) }))
      .filter((a) => a.amountApplied > 0);
    if (allocList.length === 0) {
      showToast('Allocate payment amount to at least one open bill', 'error');
      return;
    }
    setSaving(true);
    try {
      await recordPaymentMade({
        orgId,
        userId: user.uid,
        userName: user.displayName || user.email || 'User',
        vendorId: vend.id,
        vendorName: vend.name,
        date,
        mode,
        referenceNumber: referenceNumber.trim(),
        allocations: allocList,
      });
      setModalOpen(false);
      setAllocations({});
      setReferenceNumber('');
      showToast('Vendor payment recorded', 'success');
      await load();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Payment failed', 'error');
    } finally {
      setSaving(false);
    }
  };

  const columns: TableColumn<PaymentMade>[] = [
    { key: 'date', label: 'Date', render: (r) => formatDisplayDate(r.date) },
    {
      key: 'paymentNumber',
      label: 'Payment #',
      render: (r) => <span className="font-mono-num font-semibold text-[#408dfb]">{r.paymentNumber}</span>,
    },
    { key: 'vendorName', label: 'Vendor', render: (r) => r.vendorName },
    { key: 'mode', label: 'Mode', render: (r) => r.mode },
    { key: 'referenceNumber', label: 'Reference #', render: (r) => <span className="font-mono-num">{r.referenceNumber || '—'}</span> },
    { key: 'allocations', label: 'Bills Paid', render: (r) => r.allocations.map((a) => a.billNumber).join(', ') },
    { key: 'amount', label: 'Amount', align: 'right', render: (r) => <span className="font-semibold">{formatLKR(r.amount)}</span> },
  ];

  return (
    <>
      <DataTable
        title="Payments Made"
        subtitle="Record supplier disbursements and allocate across open bills"
        rows={rows}
        columns={columns}
        loading={loading}
        searchQuery={search}
        onSearchChange={setSearch}
        searchPredicate={(r, q) => r.paymentNumber.toLowerCase().includes(q) || r.vendorName.toLowerCase().includes(q)}
        canCreate={can('paymentsMade', 'create')}
        newButtonLabel="Record Vendor Payment"
        onNewClick={() => setModalOpen(true)}
        canDelete={can('paymentsMade', 'delete')}
        onBulkDelete={async (ids) => {
          if (!orgId || !user) return;
          for (const id of ids) await softDeleteOrgDoc(orgId, 'paymentsMade', id, user.uid);
          showToast('Deleted selected payments', 'success');
          await load();
        }}
        onExportCsv={(visible) => {
          exportToCsv(
            'payments-made.csv',
            ['Date', 'Payment #', 'Vendor', 'Mode', 'Reference', 'Amount'],
            visible.map((r) => [r.date, r.paymentNumber, r.vendorName, r.mode, r.referenceNumber || '', r.amount])
          );
        }}
      />

      {modalOpen && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-900/50 p-4 overflow-y-auto">
          <div className="bg-white rounded-xl border border-slate-200 shadow-xl max-w-2xl w-full p-5 my-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-semibold text-slate-900">Record Vendor Payment</h2>
              <button type="button" onClick={() => setModalOpen(false)} aria-label="Close"><X className="w-4 h-4 text-slate-400" /></button>
            </div>
            <form onSubmit={handleSave} className="space-y-4 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Vendor *</label>
                  <select value={vendorId} onChange={(e) => { setVendorId(e.target.value); setAllocations({}); }} className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white">
                    {vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Date</label>
                  <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-full px-3 py-2 border border-slate-300 rounded-lg" />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Mode</label>
                  <select value={mode} onChange={(e) => setMode(e.target.value as PaymentMade['mode'])} className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white">
                    <option value="Bank Transfer">Bank Transfer</option>
                    <option value="Cash">Cash</option>
                    <option value="Cheque">Cheque</option>
                    <option value="Card">Card</option>
                  </select>
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Reference #</label>
                  <input type="text" value={referenceNumber} onChange={(e) => setReferenceNumber(e.target.value)} className="w-full px-3 py-2 border border-slate-300 rounded-lg" />
                </div>
              </div>

              <div className="border border-slate-200 rounded-lg overflow-hidden">
                <div className="px-3 py-2 bg-slate-50 border-b border-slate-200 font-semibold text-slate-700">
                  Open Bills ({vendorOpenBills.length})
                </div>
                {vendorOpenBills.length === 0 ? (
                  <p className="p-3 text-slate-500">No open bills for selected vendor.</p>
                ) : (
                  <table className="w-full">
                    <thead className="border-b border-slate-100 text-slate-500">
                      <tr>
                        <th className="text-left px-3 py-2">Bill #</th>
                        <th className="text-left px-3 py-2">Due Date</th>
                        <th className="text-right px-3 py-2">Balance</th>
                        <th className="text-right px-3 py-2">Pay Amount</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {vendorOpenBills.map((b) => (
                        <tr key={b.id}>
                          <td className="px-3 py-2 font-mono-num font-medium">{b.billNumber}</td>
                          <td className="px-3 py-2">{formatDisplayDate(b.dueDate)}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{formatLKR(b.balanceDue)}</td>
                          <td className="px-3 py-2 text-right">
                            <input
                              type="number"
                              min="0"
                              max={b.balanceDue}
                              step="0.01"
                              value={allocations[b.id] ?? ''}
                              onChange={(e) => setAllocations((prev) => ({ ...prev, [b.id]: Number(e.target.value) || 0 }))}
                              placeholder="0.00"
                              className="w-32 px-2 py-1 border border-slate-300 rounded text-right tabular-nums"
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>

              <div className="pt-3 flex justify-end gap-2">
                <button type="button" onClick={() => setModalOpen(false)} className="px-4 py-2 border border-slate-300 rounded-lg">Cancel</button>
                <button type="submit" disabled={saving || vendorOpenBills.length === 0} className="px-4 py-2 bg-[#408dfb] text-white rounded-lg font-medium">
                  {saving ? 'Recording...' : 'Save Payment'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
