import { useCallback, useEffect, useState } from 'react';
import { collection, DocumentData, getDocs, QueryDocumentSnapshot } from 'firebase/firestore';
import { db } from '../firebase';
import { useOrg } from '../hooks/useOrg';
import { StockLedgerEntry, Warehouse } from '../types';
import { fetchPagedCollection, PagedFilter } from '../services/firestoreList';
import { DataTable, TableColumn } from '../components/DataTable';
import { exportToCsv } from '../lib/csv';
import { formatDisplayDate, formatLKR } from '../lib/formatters';

export function StockLedgerPage() {
  const { orgId } = useOrg();
  const [rows, setRows] = useState<StockLedgerEntry[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [whFilter, setWhFilter] = useState('all');
  const [cursorStack, setCursorStack] = useState<(QueryDocumentSnapshot<DocumentData> | null)[]>([null]);
  const [pageIdx, setPageIdx] = useState(0);
  const [hasMore, setHasMore] = useState(false);

  const load = useCallback(
    async (cursor: QueryDocumentSnapshot<DocumentData> | null) => {
      if (!orgId) return;
      setLoading(true);
      try {
        const filters: PagedFilter[] = [];
        if (typeFilter !== 'all') filters.push({ field: 'type', op: '==', value: typeFilter });
        if (whFilter !== 'all') filters.push({ field: 'warehouseId', op: '==', value: whFilter });

        const [res, whSnap] = await Promise.all([
          fetchPagedCollection<StockLedgerEntry>({
            orgId,
            subcollection: 'stockLedger',
            pageSize: 30,
            cursor,
            filters,
            includeDeleted: true,
          }),
          getDocs(collection(db, `organizations/${orgId}/warehouses`)),
        ]);
        setRows(res.items);
        setHasMore(res.hasMore);
        setWarehouses(
          whSnap.docs
            .map((d) => ({ id: d.id, ...(d.data() as Omit<Warehouse, 'id'>) }))
            .filter((w) => !w.isDeleted)
        );
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
    [orgId, typeFilter, whFilter, pageIdx]
  );

  useEffect(() => {
    setPageIdx(0);
    setCursorStack([null]);
    void load(null);
  }, [orgId, typeFilter, whFilter]);

  const whMap = Object.fromEntries(warehouses.map((w) => [w.id, w.name]));

  const columns: TableColumn<StockLedgerEntry>[] = [
    { key: 'date', label: 'Date', render: (r) => formatDisplayDate(r.date) },
    {
      key: 'itemSku',
      label: 'SKU & Item',
      render: (r) => (
        <div>
          <p className="font-medium text-slate-900">{r.itemName || r.itemId}</p>
          <p className="text-[11px] font-mono-num text-slate-500">{r.itemSku || '—'}</p>
        </div>
      ),
    },
    { key: 'warehouseId', label: 'Warehouse', render: (r) => whMap[r.warehouseId] || r.warehouseId },
    {
      key: 'type',
      label: 'Movement Type',
      render: (r) => <span className="capitalize">{r.type.replace(/_/g, ' ')}</span>,
    },
    {
      key: 'referenceNumber',
      label: 'Reference',
      render: (r) => <span className="font-mono-num">{r.referenceNumber || r.referenceId}</span>,
    },
    {
      key: 'quantityChange',
      label: 'Qty Change',
      align: 'right',
      render: (r) => (
        <span
          className={`font-semibold tabular-nums ${
            r.quantityChange >= 0 ? 'text-emerald-600' : 'text-red-600'
          }`}
        >
          {r.quantityChange >= 0 ? `+${r.quantityChange}` : r.quantityChange}
        </span>
      ),
    },
    { key: 'unitCost', label: 'Unit Cost', align: 'right', render: (r) => formatLKR(r.unitCost) },
    { key: 'notes', label: 'Notes', render: (r) => <span className="text-slate-500">{r.notes || '—'}</span> },
  ];

  return (
    <DataTable
      title="Stock Ledger (Append-Only Audit Trail)"
      subtitle="Immutable transaction ledger synced atomically with every warehouse stock mutation"
      rows={rows}
      columns={columns}
      loading={loading}
      searchQuery={search}
      onSearchChange={setSearch}
      searchPredicate={(r, q) =>
        (r.itemName || '').toLowerCase().includes(q) ||
        (r.itemSku || '').toLowerCase().includes(q) ||
        (r.referenceNumber || '').toLowerCase().includes(q)
      }
      pageNumber={pageIdx + 1}
      hasMore={hasMore}
      onNextPage={() => {
        const nextIdx = pageIdx + 1;
        const nextCursor = cursorStack[nextIdx] ?? null;
        setPageIdx(nextIdx);
        void load(nextCursor);
      }}
      onPrevPage={() => {
        const prevIdx = Math.max(0, pageIdx - 1);
        setPageIdx(prevIdx);
        void load(cursorStack[prevIdx] ?? null);
      }}
      extraToolbarActions={
        <div className="flex items-center gap-2">
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            aria-label="Filter by movement type"
            className="px-2.5 py-2 text-xs bg-white border border-slate-300 rounded-lg"
          >
            <option value="all">All Types</option>
            <option value="opening">Opening Stock</option>
            <option value="purchase_receive">Purchase Receive</option>
            <option value="sale_ship">Sale Ship</option>
            <option value="adjustment">Adjustment</option>
            <option value="transfer_in">Transfer In</option>
            <option value="transfer_out">Transfer Out</option>
            <option value="sales_return">Sales Return</option>
            <option value="assembly_consume">Assembly Consume</option>
            <option value="assembly_produce">Assembly Produce</option>
          </select>
          <select
            value={whFilter}
            onChange={(e) => setWhFilter(e.target.value)}
            aria-label="Filter by warehouse"
            className="px-2.5 py-2 text-xs bg-white border border-slate-300 rounded-lg"
          >
            <option value="all">All Warehouses</option>
            {warehouses.map((w) => (
              <option key={w.id} value={w.id}>{w.name}</option>
            ))}
          </select>
        </div>
      }
      onExportCsv={(visible) => {
        exportToCsv(
          'stock-ledger.csv',
          ['Date', 'SKU', 'Item', 'Warehouse', 'Type', 'Reference', 'Qty Change', 'Unit Cost', 'Notes'],
          visible.map((r) => [
            r.date,
            r.itemSku || '',
            r.itemName || '',
            whMap[r.warehouseId] || r.warehouseId,
            r.type,
            r.referenceNumber || r.referenceId,
            r.quantityChange,
            r.unitCost,
            r.notes || '',
          ])
        );
      }}
    />
  );
}
