import React, { useMemo, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  ChevronLeft,
  ChevronRight,
  Columns3,
  Download,
  Plus,
  Search,
  Trash2,
  Upload,
} from 'lucide-react';
import { TableSkeleton } from './LoadingSkeleton';
import { EmptyState } from './EmptyState';

export interface TableColumn<T> {
  key: string;
  label: string;
  sortable?: boolean;
  align?: 'left' | 'right';
  defaultVisible?: boolean;
  sortValue?: (row: T) => string | number;
  render: (row: T) => React.ReactNode;
}

export interface StatusTab {
  key: string;
  label: string;
}

interface DataTableProps<T extends { id: string }> {
  title: string;
  subtitle?: string;
  rows: T[];
  columns: TableColumn<T>[];
  loading: boolean;
  statusTabs?: StatusTab[];
  activeTab?: string;
  onTabChange?: (tabKey: string) => void;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  searchPlaceholder?: string;
  searchPredicate?: (row: T, q: string) => boolean;
  onRowClick?: (row: T) => void;
  canCreate?: boolean;
  newButtonLabel?: string;
  onNewClick?: () => void;
  canDelete?: boolean;
  onBulkDelete?: (selectedIds: string[]) => Promise<void>;
  onExportCsv?: (visibleRows: T[]) => void;
  onOpenCsvImport?: () => void;
  importButtonLabel?: string;
  hasMore?: boolean;
  pageNumber?: number;
  onNextPage?: () => void;
  onPrevPage?: () => void;
  extraToolbarActions?: React.ReactNode;
  emptyTitle?: string;
  emptyDescription?: string;
}

export function DataTable<T extends { id: string }>({
  title,
  subtitle,
  rows,
  columns,
  loading,
  statusTabs,
  activeTab,
  onTabChange,
  searchQuery,
  onSearchChange,
  searchPlaceholder = 'Search...',
  searchPredicate,
  onRowClick,
  canCreate,
  newButtonLabel = 'New',
  onNewClick,
  canDelete,
  onBulkDelete,
  onExportCsv,
  onOpenCsvImport,
  importButtonLabel = 'Import Excel / CSV',
  hasMore,
  pageNumber = 1,
  onNextPage,
  onPrevPage,
  extraToolbarActions,
  emptyTitle = 'No records found',
  emptyDescription = 'Try adjusting your filter or create a new record.',
}: DataTableProps<T>) {
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [columnMenuOpen, setColumnMenuOpen] = useState(false);
  const [visibleKeys, setVisibleKeys] = useState<Set<string>>(
    () => new Set(columns.filter((c) => c.defaultVisible !== false).map((c) => c.key))
  );

  const visibleColumns = useMemo(
    () => columns.filter((c) => visibleKeys.has(c.key)),
    [columns, visibleKeys]
  );

  const filteredAndSorted = useMemo(() => {
    let list = rows;
    const q = searchQuery.trim().toLowerCase();
    if (q && searchPredicate) {
      list = list.filter((row) => searchPredicate(row, q));
    }
    if (sortKey) {
      const col = columns.find((c) => c.key === sortKey);
      if (col?.sortValue) {
        const getter = col.sortValue;
        list = [...list].sort((a, b) => {
          const av = getter(a);
          const bv = getter(b);
          if (typeof av === 'number' && typeof bv === 'number') {
            return sortDir === 'asc' ? av - bv : bv - av;
          }
          return sortDir === 'asc'
            ? String(av).localeCompare(String(bv))
            : String(bv).localeCompare(String(av));
        });
      }
    }
    return list;
  }, [rows, searchQuery, searchPredicate, sortKey, sortDir, columns]);

  const toggleSort = (key: string) => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === filteredAndSorted.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredAndSorted.map((r) => r.id)));
    }
  };

  const toggleRow = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleColumn = (key: string) => {
    setVisibleKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key) && next.size > 1) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">{title}</h1>
          {subtitle && <p className="text-xs text-slate-500 mt-0.5">{subtitle}</p>}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {extraToolbarActions}
          {canCreate && onOpenCsvImport && (
            <button
              type="button"
              onClick={onOpenCsvImport}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 whitespace-nowrap"
            >
              <Upload className="w-3.5 h-3.5" />
              {importButtonLabel}
            </button>
          )}
          {onExportCsv && (
            <button
              type="button"
              onClick={() => onExportCsv(filteredAndSorted)}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 whitespace-nowrap"
            >
              <Download className="w-3.5 h-3.5" />
              Export CSV
            </button>
          )}
          {canCreate && onNewClick && (
            <button
              type="button"
              onClick={onNewClick}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-white bg-[#408dfb] hover:bg-[#2f7ae5] rounded-lg transition-colors whitespace-nowrap"
            >
              <Plus className="w-4 h-4" />
              {newButtonLabel}
            </button>
          )}
        </div>
      </div>

      {statusTabs && statusTabs.length > 0 && onTabChange && (
        <div className="flex items-center gap-1 overflow-x-auto border-b border-slate-200 pb-px">
          {statusTabs.map((tab) => {
            const active = activeTab === tab.key;
            return (
              <button
                key={tab.key}
                type="button"
                onClick={() => {
                  setSelectedIds(new Set());
                  onTabChange(tab.key);
                }}
                className={`px-3 py-2 text-xs font-medium whitespace-nowrap border-b-2 transition-colors ${
                  active
                    ? 'border-[#408dfb] text-[#408dfb]'
                    : 'border-transparent text-slate-600 hover:text-slate-900'
                }`}
              >
                {tab.label}
              </button>
            );
          })}
        </div>
      )}

      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
        <div className="relative flex-1 max-w-sm">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder={searchPlaceholder}
            aria-label={searchPlaceholder}
            className="w-full pl-9 pr-3 py-2 text-xs bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#408dfb]/30 focus:border-[#408dfb]"
          />
        </div>

        <div className="flex items-center gap-2">
          {selectedIds.size > 0 && canDelete && onBulkDelete && (
            <button
              type="button"
              onClick={async () => {
                await onBulkDelete(Array.from(selectedIds));
                setSelectedIds(new Set());
              }}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-red-700 bg-red-50 border border-red-200 rounded-lg hover:bg-red-100"
            >
              <Trash2 className="w-3.5 h-3.5" />
              Delete Selected ({selectedIds.size})
            </button>
          )}

          <div className="relative">
            <button
              type="button"
              onClick={() => setColumnMenuOpen((o) => !o)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-600 bg-white border border-slate-300 rounded-lg hover:bg-slate-50"
            >
              <Columns3 className="w-3.5 h-3.5" />
              Columns
            </button>
            {columnMenuOpen && (
              <div className="absolute right-0 mt-1 w-48 bg-white border border-slate-200 rounded-lg shadow-lg p-2 z-20">
                <p className="text-[11px] font-semibold text-slate-500 px-2 py-1">Show Columns</p>
                {columns.map((c) => (
                  <label
                    key={c.key}
                    className="flex items-center gap-2 px-2 py-1.5 text-xs text-slate-700 hover:bg-slate-50 rounded cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={visibleKeys.has(c.key)}
                      onChange={() => toggleColumn(c.key)}
                      className="rounded border-slate-300 text-[#408dfb]"
                    />
                    <span>{c.label}</span>
                  </label>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {loading ? (
        <TableSkeleton rows={6} cols={Math.min(6, visibleColumns.length)} />
      ) : filteredAndSorted.length === 0 ? (
        <EmptyState
          title={emptyTitle}
          description={emptyDescription}
          actionLabel={canCreate && onNewClick ? newButtonLabel : undefined}
          onAction={onNewClick}
        />
      ) : (
        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                <tr>
                  {canDelete && (
                    <th className="w-9 px-3 py-2.5 text-left">
                      <input
                        type="checkbox"
                        aria-label="Select all rows"
                        checked={
                          filteredAndSorted.length > 0 &&
                          selectedIds.size === filteredAndSorted.length
                        }
                        onChange={toggleSelectAll}
                        className="rounded border-slate-300 text-[#408dfb]"
                      />
                    </th>
                  )}
                  {visibleColumns.map((col) => (
                    <th
                      key={col.key}
                      className={`px-3 py-2.5 font-medium whitespace-nowrap ${
                        col.align === 'right' ? 'text-right' : 'text-left'
                      }`}
                    >
                      {col.sortable && col.sortValue ? (
                        <button
                          type="button"
                          onClick={() => toggleSort(col.key)}
                          className="inline-flex items-center gap-1 hover:text-slate-900"
                        >
                          <span>{col.label}</span>
                          {sortKey === col.key &&
                            (sortDir === 'asc' ? (
                              <ArrowUp className="w-3 h-3 text-[#408dfb]" />
                            ) : (
                              <ArrowDown className="w-3 h-3 text-[#408dfb]" />
                            ))}
                        </button>
                      ) : (
                        col.label
                      )}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredAndSorted.map((row) => (
                  <tr
                    key={row.id}
                    onClick={() => onRowClick?.(row)}
                    className={`transition-colors ${
                      onRowClick ? 'cursor-pointer hover:bg-blue-50/40' : 'hover:bg-slate-50/70'
                    }`}
                  >
                    {canDelete && (
                      <td
                        className="px-3 py-2.5"
                        onClick={(e) => {
                          e.stopPropagation();
                        }}
                      >
                        <input
                          type="checkbox"
                          aria-label={`Select row ${row.id}`}
                          checked={selectedIds.has(row.id)}
                          onChange={() => toggleRow(row.id)}
                          className="rounded border-slate-300 text-[#408dfb]"
                        />
                      </td>
                    )}
                    {visibleColumns.map((col) => (
                      <td
                        key={col.key}
                        className={`px-3 py-2.5 text-slate-700 ${
                          col.align === 'right' ? 'text-right tabular-nums' : 'text-left'
                        }`}
                      >
                        {col.render(row)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-between px-4 py-2.5 border-t border-slate-200 bg-slate-50 text-xs text-slate-600">
            <span>
              Page {pageNumber} · Showing {filteredAndSorted.length} record(s)
            </span>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                disabled={pageNumber <= 1 || !onPrevPage}
                onClick={onPrevPage}
                className="inline-flex items-center gap-1 px-2.5 py-1 bg-white border border-slate-300 rounded hover:bg-slate-50 disabled:opacity-40"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
                Prev
              </button>
              <button
                type="button"
                disabled={!hasMore || !onNextPage}
                onClick={onNextPage}
                className="inline-flex items-center gap-1 px-2.5 py-1 bg-white border border-slate-300 rounded hover:bg-slate-50 disabled:opacity-40"
              >
                Next
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
