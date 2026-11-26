import React, { useCallback, useEffect, useState } from 'react';
import { collection, getDocs } from 'firebase/firestore';
import { X } from 'lucide-react';
import { db } from '../firebase';
import { useOrg } from '../hooks/useOrg';
import { useAuth } from '../hooks/useAuth';
import { useToast } from '../hooks/useToast';
import { Customer, InvoiceDoc, PaymentReceived } from '../types';
import { fetchPagedCollection, softDeleteOrgDoc } from '../services/firestoreList';
import { recordPaymentReceived } from '../services/salesService';
import { DataTable, TableColumn } from '../components/DataTable';
import { exportToCsv } from '../lib/csv';
import { formatDateISO, formatDisplayDate, formatLKR } from '../lib/formatters';

export function PaymentsReceivedPage() {
  const { orgId, can } = useOrg();
  const { user } = useAuth();
  const { showToast } = useToast();

  const [rows, setRows] = useState<PaymentReceived[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [invoices, setInvoices] = useState<InvoiceDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [modalOpen, setModalOpen] = useState(false);

  const [customerId, setCustomerId] = useState('');
  const [date, setDate] = useState(formatDateISO());
  const [mode, setMode] = useState<PaymentReceived['mode']>('Bank Transfer');
  const [referenceNumber, setReferenceNumber] = useState('');
  const [allocations, setAllocations] = useState<Record<string, number>>({});
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!orgId) return;
    setLoading(true);
    try {
      const [res, custSnap, invSnap] = await Promise.all([
        fetchPagedCollection<PaymentReceived>({ orgId, subcollection: 'paymentsReceived', pageSize: 30 }),
        getDocs(collection(db, `organizations/${orgId}/customers`)),
        getDocs(collection(db, `organizations/${orgId}/invoices`)),
      ]);
      setRows(res.items);
      const custs = custSnap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Customer, 'id'>) })).filter((c) => !c.isDeleted);
      setCustomers(custs);
      setInvoices(invSnap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<InvoiceDoc, 'id'>) })).filter((i) => !i.isDeleted && i.balanceDue > 0 && i.status !== 'void'));
      if (custs.length > 0 && !customerId) setCustomerId(custs[0].id);
    } finally {
      setLoading(false);
    }
  }, [orgId, customerId]);

  useEffect(() => {
    void load();
  }, [load]);

  const customerOpenInvoices = invoices.filter((i) => i.customerId === customerId);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!orgId || !user) return;
    const cust = customers.find((c) => c.id === customerId);
    if (!cust) return;
    const allocList = customerOpenInvoices
      .map((inv) => ({ invoiceId: inv.id, amountApplied: Number(allocations[inv.id] ?? 0) }))
      .filter((a) => a.amountApplied > 0);

    if (allocList.length === 0) {
      showToast('Allocate payment amount to at least one open invoice', 'error');
      return;
    }

    setSaving(true);
    try {
      await recordPaymentReceived({
        orgId,
        userId: user.uid,
        userName: user.displayName || user.email || 'User',
        customerId: cust.id,
        customerName: cust.name,
        date,
        mode,
        referenceNumber: referenceNumber.trim(),
        allocations: allocList,
        notes: notes.trim(),
      });
      setModalOpen(false);
      setAllocations({});
      setReferenceNumber('');
      showToast('Payment received recorded', 'success');
      await load();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to record payment', 'error');
    } finally {
      setSaving(false);
    }
  };

  const columns: TableColumn<PaymentReceived>[] = [
    { key: 'date', label: 'Date', render: (r) => formatDisplayDate(r.date) },
    {
      key: 'paymentNumber',
      label: 'Payment #',
      render: (r) => <span className="font-mono-num font-semibold text-[#408dfb]">{r.paymentNumber}</span>,
    },
    { key: 'customerName', label: 'Customer', render: (r) => r.customerName },
    { key: 'mode', label: 'Mode', render: (r) => r.mode },
    { key: 'referenceNumber', label: 'Reference #', render: (r) => <span className="font-mono-num">{r.referenceNumber || '—'}</span> },
    {
      key: 'allocations',
      label: 'Invoices',
      render: (r) => r.allocations.map((a) => a.invoiceNumber).join(', '),
    },
    { key: 'amount', label: 'Amount', align: 'right', render: (r) => <span className="font-semibold">{formatLKR(r.amount)}</span> },
  ];

  return (
    <>
      <DataTable
        title="Payments Received"
        subtitle="Record customer receipts and allocate across one or multiple open invoices"
        rows={rows}
        columns={columns}
        loading={loading}
        searchQuery={search}
        onSearchChange={setSearch}
        searchPredicate={(r, q) =>
          r.paymentNumber.toLowerCase().includes(q) || r.customerName.toLowerCase().includes(q)
        }
        canCreate={can('paymentsReceived', 'create')}
        newButtonLabel="Record Payment"
        onNewClick={() => setModalOpen(true)}
        canDelete={can('paymentsReceived', 'delete')}
        onBulkDelete={async (ids) => {
          if (!orgId || !user) return;
          for (const id of ids) await softDeleteOrgDoc(orgId, 'paymentsReceived', id, user.uid);
          showToast('Deleted selected payments', 'success');
          await load();
        }}
        onExportCsv={(visible) => {
          exportToCsv(
            'payments-received.csv',
            ['Date', 'Payment #', 'Customer', 'Mode', 'Reference', 'Amount'],
            visible.map((r) => [r.date, r.paymentNumber, r.customerName, r.mode, r.referenceNumber || '', r.amount])
          );
        }}
      />

      {modalOpen && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-900/50 p-4 overflow-y-auto">
          <div className="bg-white rounded-xl border border-slate-200 shadow-xl max-w-2xl w-full p-5 my-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-semibold text-slate-900">Record Customer Payment</h2>
              <button type="button" onClick={() => setModalOpen(false)} aria-label="Close"><X className="w-4 h-4 text-slate-400" /></button>
            </div>
            <form onSubmit={handleSave} className="space-y-4 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Customer *</label>
                  <select
                    value={customerId}
                    onChange={(e) => {
                      setCustomerId(e.target.value);
                      setAllocations({});
                    }}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white"
                  >
                    {customers.map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Payment Date</label>
                  <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-full px-3 py-2 border border-slate-300 rounded-lg" />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Mode</label>
                  <select value={mode} onChange={(e) => setMode(e.target.value as PaymentReceived['mode'])} className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white">
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
                  Open Invoices for Customer ({customerOpenInvoices.length})
                </div>
                {customerOpenInvoices.length === 0 ? (
                  <p className="p-3 text-slate-500">No open invoices for the selected customer.</p>
                ) : (
                  <table className="w-full">
                    <thead className="border-b border-slate-100 text-slate-500">
                      <tr>
                        <th className="text-left px-3 py-2">Invoice #</th>
                        <th className="text-left px-3 py-2">Due Date</th>
                        <th className="text-right px-3 py-2">Balance Due</th>
                        <th className="text-right px-3 py-2">Payment Amount</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {customerOpenInvoices.map((inv) => (
                        <tr key={inv.id}>
                          <td className="px-3 py-2 font-mono-num font-medium">{inv.invoiceNumber}</td>
                          <td className="px-3 py-2">{formatDisplayDate(inv.dueDate)}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{formatLKR(inv.balanceDue)}</td>
                          <td className="px-3 py-2 text-right">
                            <input
                              type="number"
                              min="0"
                              max={inv.balanceDue}
                              step="0.01"
                              value={allocations[inv.id] ?? ''}
                              onChange={(e) =>
                                setAllocations((prev) => ({
                                  ...prev,
                                  [inv.id]: Number(e.target.value) || 0,
                                }))
                              }
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
                <button type="submit" disabled={saving || customerOpenInvoices.length === 0} className="px-4 py-2 bg-[#408dfb] text-white rounded-lg font-medium">
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
