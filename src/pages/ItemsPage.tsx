import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { collection, getDocs, QueryDocumentSnapshot, DocumentData } from 'firebase/firestore';
import { Sparkles, Upload, X, AlertTriangle, Eraser } from 'lucide-react';
import { db } from '../firebase';
import { useOrg } from '../hooks/useOrg';
import { useAuth } from '../hooks/useAuth';
import { useToast } from '../hooks/useToast';
import { Item, Vendor, Warehouse } from '../types';
import { fetchPagedCollection, softDeleteOrgDoc } from '../services/firestoreList';
import { createItemWithOpeningStock, updateItemRecord, uploadItemImage } from '../services/itemsService';
import { createPurchaseOrder } from '../services/purchasesService';
import { fetchAiReorderSuggestions, ReorderSuggestionsResponse } from '../services/aiService';
import { clearDemoItems, DEMO_SKUS } from '../services/seedService';
import { DataTable, TableColumn } from '../components/DataTable';
import { CsvImportModal } from '../components/CsvImportModal';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { StatusBadge } from '../components/StatusBadge';
import { formatDateISO, formatLKR } from '../lib/formatters';
import { exportToCsv } from '../lib/csv';
import { ITEM_COLUMN_ALIASES } from '../lib/spreadsheetImport';
import { calculateDocumentTotals, getAvailableStock } from '../lib/calculations';

export function ItemsPage() {
  const { orgId, can } = useOrg();
  const { user } = useAuth();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const initialTab = searchParams.get('tab') || 'all';
  const [activeTab, setActiveTab] = useState(initialTab);
  const [searchQuery, setSearchQuery] = useState('');
  const [rows, setRows] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [pageStack, setPageStack] = useState<(QueryDocumentSnapshot<DocumentData> | null)[]>([null]);
  const [currentPageIdx, setCurrentPageIdx] = useState(0);
  const [hasMore, setHasMore] = useState(false);

  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);

  const [modalOpen, setModalOpen] = useState(searchParams.get('new') === '1');
  const [editingItem, setEditingItem] = useState<Item | null>(null);
  const [csvOpen, setCsvOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<string[] | null>(null);
  const [clearScope, setClearScope] = useState<'demo' | 'all' | null>(null);
  const [clearing, setClearing] = useState(false);

  // Form state
  const [name, setName] = useState('');
  const [sku, setSku] = useState('');
  const [unit, setUnit] = useState('PCS');
  const [category, setCategory] = useState('');
  const [brand, setBrand] = useState('');
  const [manufacturer, setManufacturer] = useState('');
  const [sellingPrice, setSellingPrice] = useState('0');
  const [costPrice, setCostPrice] = useState('0');
  const [taxRate, setTaxRate] = useState('18');
  const [preferredVendorId, setPreferredVendorId] = useState('');
  const [openingStock, setOpeningStock] = useState('0');
  const [warehouseId, setWarehouseId] = useState('');
  const [reorderLevel, setReorderLevel] = useState('10');
  const [reorderQty, setReorderQty] = useState('25');
  const [barcode, setBarcode] = useState('');
  const [images, setImages] = useState<string[]>([]);
  const [status, setStatus] = useState<'active' | 'inactive'>('active');
  const [saving, setSaving] = useState(false);
  const [uploadingImg, setUploadingImg] = useState(false);

  // AI Reorder state
  const [aiModalOpen, setAiModalOpen] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiSuggestions, setAiSuggestions] = useState<ReorderSuggestionsResponse | null>(null);
  const [creatingDraftPoFor, setCreatingDraftPoFor] = useState<string | null>(null);

  useEffect(() => {
    if (searchParams.get('new') === '1') {
      openCreateModal();
    }
    const tabParam = searchParams.get('tab');
    if (tabParam) setActiveTab(tabParam);
  }, [searchParams]);

  const loadAux = useCallback(async () => {
    if (!orgId) return;
    const [whSnap, vSnap] = await Promise.all([
      getDocs(collection(db, `organizations/${orgId}/warehouses`)),
      getDocs(collection(db, `organizations/${orgId}/vendors`)),
    ]);
    const whs = whSnap.docs
      .map((d) => ({ id: d.id, ...(d.data() as Omit<Warehouse, 'id'>) }))
      .filter((w) => !w.isDeleted);
    const vends = vSnap.docs
      .map((d) => ({ id: d.id, ...(d.data() as Omit<Vendor, 'id'>) }))
      .filter((v) => !v.isDeleted);
    setWarehouses(whs);
    setVendors(vends);
    if (whs.length > 0 && !warehouseId) {
      setWarehouseId(whs.find((w) => w.isPrimary)?.id || whs[0].id);
    }
  }, [orgId, warehouseId]);

  const loadPage = useCallback(
    async (pageIdx = 0, stack = pageStack) => {
      if (!orgId) {
        setLoading(false);
        return;
      }
      setLoading(true);
      try {
        const filters =
          activeTab === 'active' || activeTab === 'inactive'
            ? [{ field: 'status', op: '==' as const, value: activeTab }]
            : undefined;

        const res = await fetchPagedCollection<Item>({
          orgId,
          subcollection: 'items',
          pageSize: 40,
          cursor: stack[pageIdx] ?? null,
          sortField: 'name',
          sortDirection: 'asc',
          filters,
        });

        let list = res.items;
        if (activeTab === 'low_stock') {
          list = list.filter((i) => i.totalStock <= i.reorderLevel);
        }
        setRows(list);
        setHasMore(res.hasMore);
        setCurrentPageIdx(pageIdx);
        if (res.lastDoc && stack.length <= pageIdx + 1) {
          setPageStack([...stack.slice(0, pageIdx + 1), res.lastDoc]);
        }
      } catch (err) {
        showToast(err instanceof Error ? err.message : 'Failed to load items', 'error');
      } finally {
        setLoading(false);
      }
    },
    [orgId, activeTab, pageStack, showToast]
  );

  useEffect(() => {
    void loadAux();
  }, [loadAux]);

  useEffect(() => {
    setPageStack([null]);
    void loadPage(0, [null]);
  }, [orgId, activeTab]);

  const openCreateModal = () => {
    setEditingItem(null);
    setName('');
    setSku('');
    setUnit('PCS');
    setCategory('');
    setBrand('');
    setManufacturer('');
    setSellingPrice('0');
    setCostPrice('0');
    setTaxRate('18');
    setPreferredVendorId('');
    setOpeningStock('0');
    setReorderLevel('10');
    setReorderQty('25');
    setBarcode('');
    setImages([]);
    setStatus('active');
    setModalOpen(true);
  };

  const submitItemForm = async (saveAndAnother = false) => {
    if (!orgId || !user) return;
    if (!name.trim() || !sku.trim()) {
      showToast('Item name and SKU are required', 'error');
      return;
    }
    const sell = Number(sellingPrice);
    const cost = Number(costPrice);
    if (sell < 0 || cost < 0) {
      showToast('Prices cannot be negative', 'error');
      return;
    }

    setSaving(true);
    try {
      const userName = user.displayName || user.email || 'User';
      if (editingItem) {
        await updateItemRecord({
          orgId,
          userId: user.uid,
          userName,
          itemId: editingItem.id,
          patch: {
            name: name.trim(),
            sku: sku.trim(),
            unit,
            category: category.trim(),
            brand: brand.trim(),
            manufacturer: manufacturer.trim(),
            sellingPrice: sell,
            costPrice: cost,
            taxRate: Number(taxRate) || 0,
            preferredVendorId,
            reorderLevel: Math.max(0, Number(reorderLevel) || 0),
            reorderQty: Math.max(0, Number(reorderQty) || 0),
            barcode: barcode.trim(),
            images,
            status,
          },
        });
        showToast('Item updated', 'success');
      } else {
        await createItemWithOpeningStock({
          orgId,
          userId: user.uid,
          userName,
          warehouseId: warehouseId || warehouses[0]?.id || '',
          data: {
            name: name.trim(),
            sku: sku.trim(),
            unit,
            category: category.trim(),
            brand: brand.trim(),
            manufacturer: manufacturer.trim(),
            sellingPrice: sell,
            costPrice: cost,
            taxRate: Number(taxRate) || 0,
            taxInclusive: false,
            preferredVendorId,
            openingStock: Math.max(0, Number(openingStock) || 0),
            reorderLevel: Math.max(0, Number(reorderLevel) || 0),
            reorderQty: Math.max(0, Number(reorderQty) || 0),
            barcode: barcode.trim(),
            images,
            status,
          },
        });
        showToast(
          saveAndAnother ? 'Item saved — ready for next item' : 'Item created',
          'success'
        );
      }

      if (saveAndAnother && !editingItem) {
        setName('');
        setSku('');
        setCategory('');
        setBrand('');
        setManufacturer('');
        setSellingPrice('0');
        setCostPrice('0');
        setPreferredVendorId('');
        setOpeningStock('0');
        setBarcode('');
        setImages([]);
        setStatus('active');
        if (searchParams.get('new')) setSearchParams({});
        await loadPage(0);
      } else {
        setModalOpen(false);
        if (searchParams.get('new')) setSearchParams({});
        await loadPage(currentPageIdx);
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Save failed', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleSaveItem = async (e: React.FormEvent) => {
    e.preventDefault();
    await submitItemForm(false);
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !orgId) return;
    setUploadingImg(true);
    try {
      const targetId = editingItem?.id || `draft_${Date.now()}`;
      const url = await uploadItemImage(orgId, targetId, file);
      setImages((prev) => [...prev, url]);
      showToast('Image uploaded', 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Image upload failed', 'error');
    } finally {
      setUploadingImg(false);
    }
  };

  const handleGenerateReorder = async () => {
    const lowItems = rows.filter((i) => i.totalStock <= i.reorderLevel);
    if (lowItems.length === 0) {
      showToast('No items are currently below reorder level.', 'info');
      return;
    }
    setAiModalOpen(true);
    setAiLoading(true);
    setAiSuggestions(null);
    try {
      const res = await fetchAiReorderSuggestions({
        lowStockItems: lowItems.map((i) => ({
          id: i.id,
          sku: i.sku,
          name: i.name,
          unit: i.unit,
          totalStock: i.totalStock,
          reorderLevel: i.reorderLevel,
          reorderQty: i.reorderQty || 25,
          costPrice: i.costPrice,
          preferredVendorId: i.preferredVendorId,
        })),
        vendors: vendors.map((v) => ({ id: v.id, name: v.name })),
      });
      setAiSuggestions(res);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'AI reorder failed', 'error');
      setAiModalOpen(false);
    } finally {
      setAiLoading(false);
    }
  };

  const handleCreateDraftPoFromAi = async (
    group: ReorderSuggestionsResponse['groups'][number]
  ) => {
    if (!orgId || !user) return;
    setCreatingDraftPoFor(group.vendorId || group.vendorName);
    try {
      const vendor =
        vendors.find((v) => v.id === group.vendorId) ||
        vendors.find((v) => v.name.toLowerCase() === group.vendorName.toLowerCase()) ||
        vendors[0];
      if (!vendor) throw new Error('Please add at least one vendor first.');
      const whId = warehouses.find((w) => w.isPrimary)?.id || warehouses[0]?.id || '';
      const itemMap = Object.fromEntries(rows.map((r) => [r.id, r]));

      const totals = calculateDocumentTotals(
        group.items.map((it) => {
          const item = itemMap[it.itemId];
          return {
            itemId: it.itemId,
            itemName: it.name,
            sku: it.sku,
            unit: item?.unit || 'PCS',
            warehouseId: whId,
            quantity: Math.max(1, Math.round(it.suggestedQty)),
            rate: it.unitCost || item?.costPrice || 0,
            taxRate: item?.taxRate ?? 18,
          };
        })
      );

      await createPurchaseOrder({
        orgId,
        userId: user.uid,
        userName: user.displayName || user.email || 'User',
        data: {
          vendorId: vendor.id,
          vendorName: vendor.name,
          date: formatDateISO(),
          warehouseId: whId,
          status: 'draft',
          lines: totals.lines,
          subtotal: totals.subtotal,
          discountType: 'percent',
          discountValue: 0,
          discountAmount: totals.discountAmount,
          taxTotal: totals.taxTotal,
          shippingCharges: 0,
          adjustment: 0,
          total: totals.total,
          notes: `AI Reorder Suggestion: ${group.rationale}`,
        },
      });
      showToast(`Draft Purchase Order created for ${vendor.name}`, 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to create Draft PO', 'error');
    } finally {
      setCreatingDraftPoFor(null);
    }
  };

  const columns: TableColumn<Item>[] = [
    {
      key: 'name',
      label: 'Item Name',
      sortable: true,
      sortValue: (r) => r.name,
      render: (r) => (
        <div className="flex items-center gap-2.5">
          {r.images?.[0] ? (
            <img
              src={r.images[0]}
              alt={r.name}
              referrerPolicy="no-referrer"
              className="w-8 h-8 rounded object-cover border border-slate-200 shrink-0"
            />
          ) : (
            <div className="w-8 h-8 rounded bg-slate-100 border border-slate-200 shrink-0" />
          )}
          <div className="min-w-0">
            <p className="font-medium text-[#408dfb] truncate max-w-[260px]">{r.name}</p>
            <p className="text-[11px] text-slate-500">
              {[r.brand, r.category].filter(Boolean).join(' · ') || 'Spare Part'}
            </p>
          </div>
        </div>
      ),
    },
    {
      key: 'sku',
      label: 'SKU',
      sortable: true,
      sortValue: (r) => r.sku,
      render: (r) => <span className="font-mono-num text-slate-700">{r.sku}</span>,
    },
    {
      key: 'unit',
      label: 'Unit',
      render: (r) => r.unit,
    },
    {
      key: 'sellingPrice',
      label: 'Selling Price',
      align: 'right',
      sortable: true,
      sortValue: (r) => r.sellingPrice,
      render: (r) => formatLKR(r.sellingPrice),
    },
    {
      key: 'costPrice',
      label: 'Cost Price',
      align: 'right',
      sortable: true,
      sortValue: (r) => r.costPrice,
      render: (r) => formatLKR(r.costPrice),
    },
    {
      key: 'available',
      label: 'Available Stock',
      align: 'right',
      sortable: true,
      sortValue: (r) => getAvailableStock(r).available,
      render: (r) => {
        const { available } = getAvailableStock(r);
        const low = r.totalStock <= r.reorderLevel;
        return (
          <span className={`font-semibold tabular-nums ${low ? 'text-amber-600' : 'text-slate-900'}`}>
            {available} {r.unit}
          </span>
        );
      },
    },
    {
      key: 'reorderLevel',
      label: 'Reorder Level',
      align: 'right',
      render: (r) => `${r.reorderLevel} ${r.unit}`,
    },
    {
      key: 'status',
      label: 'Status',
      render: (r) => <StatusBadge status={r.status} />,
    },
  ];

  return (
    <div className="space-y-4">
      <DataTable
        title="Items"
        subtitle="Motorcycle spare-parts catalog with real-time multi-warehouse stock"
        rows={rows}
        columns={columns}
        loading={loading}
        statusTabs={[
          { key: 'all', label: 'All Items' },
          { key: 'active', label: 'Active' },
          { key: 'inactive', label: 'Inactive' },
          { key: 'low_stock', label: 'Below Reorder Level' },
        ]}
        activeTab={activeTab}
        onTabChange={(tab) => {
          setActiveTab(tab);
          setSearchParams(tab === 'all' ? {} : { tab });
        }}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        searchPlaceholder="Search by item name, SKU, brand, category..."
        searchPredicate={(r, q) =>
          r.name.toLowerCase().includes(q) ||
          r.sku.toLowerCase().includes(q) ||
          (r.brand || '').toLowerCase().includes(q) ||
          (r.category || '').toLowerCase().includes(q)
        }
        onRowClick={(r) => navigate(`/items/${r.id}`)}
        canCreate={can('items', 'create')}
        newButtonLabel="New Item"
        onNewClick={openCreateModal}
        canDelete={can('items', 'delete')}
        onBulkDelete={async (ids) => {
          setDeleteTarget(ids);
        }}
        onExportCsv={(visible) => {
          exportToCsv(
            'items-catalog.csv',
            ['Name', 'SKU', 'Unit', 'Category', 'Brand', 'Selling Price', 'Cost Price', 'Stock', 'Reorder Level'],
            visible.map((i) => [
              i.name,
              i.sku,
              i.unit,
              i.category || '',
              i.brand || '',
              i.sellingPrice,
              i.costPrice,
              i.totalStock,
              i.reorderLevel,
            ])
          );
        }}
        onOpenCsvImport={() => setCsvOpen(true)}
        importButtonLabel="Import Excel / CSV"
        hasMore={hasMore}
        pageNumber={currentPageIdx + 1}
        onNextPage={() => void loadPage(currentPageIdx + 1)}
        onPrevPage={() => void loadPage(Math.max(0, currentPageIdx - 1))}
        extraToolbarActions={
          <div className="flex items-center gap-2">
            {can('items', 'delete') && rows.length > 0 && (
              <button
                type="button"
                onClick={() =>
                  setClearScope(rows.some((r) => DEMO_SKUS.has(r.sku)) ? 'demo' : 'all')
                }
                className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-amber-800 bg-amber-50 hover:bg-amber-100 border border-amber-200 rounded-lg whitespace-nowrap"
              >
                <Eraser className="w-3.5 h-3.5" />
                {rows.some((r) => DEMO_SKUS.has(r.sku)) ? 'Clear Demo Items' : 'Clear Catalog'}
              </button>
            )}
            {activeTab === 'low_stock' && can('purchaseOrders', 'create') && (
              <button
                type="button"
                onClick={handleGenerateReorder}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-white bg-[#1f2a44] hover:bg-[#2a3859] rounded-lg whitespace-nowrap"
              >
                <Sparkles className="w-3.5 h-3.5 text-[#408dfb]" />
                Generate reorder suggestions
              </button>
            )}
          </div>
        }
      />

      {/* Create / Edit Item Modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-900/50 p-4 overflow-y-auto">
          <div className="bg-white rounded-xl border border-slate-200 shadow-xl max-w-2xl w-full my-6">
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
              <h2 className="text-base font-semibold text-slate-900">
                {editingItem ? 'Edit Item' : 'New Spare-Part Item'}
              </h2>
              <button
                type="button"
                onClick={() => {
                  setModalOpen(false);
                  if (searchParams.get('new')) setSearchParams({});
                }}
                aria-label="Close item form"
                className="text-slate-400 hover:text-slate-700"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveItem} className="p-5 space-y-4 text-xs max-h-[75vh] overflow-y-auto">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="sm:col-span-2">
                  <label className="block font-medium text-slate-700 mb-1">Item Name *</label>
                  <input
                    type="text"
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="e.g. PETROL PIPE PULSAR/DISCOVER 270mm"
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:border-[#408dfb]"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">SKU (Unique) *</label>
                  <input
                    type="text"
                    required
                    value={sku}
                    onChange={(e) => setSku(e.target.value)}
                    placeholder="e.g. YYPP005"
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg font-mono-num focus:outline-none focus:border-[#408dfb]"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Unit *</label>
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
                  <label className="block font-medium text-slate-700 mb-1">Category</label>
                  <input
                    type="text"
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                    placeholder="Fuel System, Ignition, Brakes..."
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Brand</label>
                  <input
                    type="text"
                    value={brand}
                    onChange={(e) => setBrand(e.target.value)}
                    placeholder="Bajaj Genuine, Honda OEM, NGK..."
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Selling Price (LKR) *</label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    required
                    value={sellingPrice}
                    onChange={(e) => setSellingPrice(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg tabular-nums"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Cost Price (LKR) *</label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    required
                    value={costPrice}
                    onChange={(e) => setCostPrice(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg tabular-nums"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Tax Rate (%)</label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={taxRate}
                    onChange={(e) => setTaxRate(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg tabular-nums"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Preferred Vendor</label>
                  <select
                    value={preferredVendorId}
                    onChange={(e) => setPreferredVendorId(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white"
                  >
                    <option value="">Select vendor</option>
                    {vendors.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.name}
                      </option>
                    ))}
                  </select>
                </div>

                {!editingItem && (
                  <>
                    <div>
                      <label className="block font-medium text-slate-700 mb-1">Opening Stock</label>
                      <input
                        type="number"
                        min="0"
                        value={openingStock}
                        onChange={(e) => setOpeningStock(e.target.value)}
                        className="w-full px-3 py-2 border border-slate-300 rounded-lg tabular-nums"
                      />
                    </div>
                    <div>
                      <label className="block font-medium text-slate-700 mb-1">Opening Warehouse</label>
                      <select
                        value={warehouseId}
                        onChange={(e) => setWarehouseId(e.target.value)}
                        className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white"
                      >
                        {warehouses.map((w) => (
                          <option key={w.id} value={w.id}>
                            {w.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  </>
                )}

                <div>
                  <label className="block font-medium text-slate-700 mb-1">Reorder Level</label>
                  <input
                    type="number"
                    min="0"
                    value={reorderLevel}
                    onChange={(e) => setReorderLevel(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg tabular-nums"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Reorder Quantity</label>
                  <input
                    type="number"
                    min="0"
                    value={reorderQty}
                    onChange={(e) => setReorderQty(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg tabular-nums"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Barcode</label>
                  <input
                    type="text"
                    value={barcode}
                    onChange={(e) => setBarcode(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg font-mono-num"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Status</label>
                  <select
                    value={status}
                    onChange={(e) => setStatus(e.target.value as 'active' | 'inactive')}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white"
                  >
                    <option value="active">Active</option>
                    <option value="inactive">Inactive</option>
                  </select>
                </div>

                <div className="sm:col-span-2">
                  <label className="block font-medium text-slate-700 mb-1">Product Images (Firebase Storage)</label>
                  <div className="flex flex-wrap items-center gap-3">
                    {images.map((img, i) => (
                      <div key={i} className="relative w-16 h-16 border border-slate-200 rounded-lg overflow-hidden">
                        <img src={img} alt="Item" className="w-full h-full object-cover" />
                        <button
                          type="button"
                          onClick={() => setImages(images.filter((_, idx) => idx !== i))}
                          aria-label="Remove image"
                          className="absolute top-0.5 right-0.5 bg-white/90 rounded-full p-0.5 text-slate-700"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                    ))}
                    <label className="w-16 h-16 border border-dashed border-slate-300 rounded-lg flex flex-col items-center justify-center cursor-pointer hover:border-[#408dfb] text-slate-500">
                      <Upload className="w-4 h-4" />
                      <span className="text-[10px] mt-0.5">{uploadingImg ? '...' : 'Add'}</span>
                      <input
                        type="file"
                        accept="image/*"
                        disabled={uploadingImg}
                        onChange={handleImageUpload}
                        className="hidden"
                      />
                    </label>
                  </div>
                </div>
              </div>

              <div className="pt-4 border-t border-slate-200 flex flex-wrap justify-end gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setModalOpen(false);
                    if (searchParams.get('new')) setSearchParams({});
                  }}
                  className="px-4 py-2 text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50"
                >
                  Cancel
                </button>
                {!editingItem && (
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => void submitItemForm(true)}
                    className="px-4 py-2 text-[#408dfb] bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-lg font-medium disabled:opacity-50"
                  >
                    {saving ? 'Saving...' : 'Save & Add Another'}
                  </button>
                )}
                <button
                  type="submit"
                  disabled={saving}
                  className="px-4 py-2 text-white bg-[#408dfb] hover:bg-[#2f7ae5] rounded-lg font-medium disabled:opacity-50"
                >
                  {saving ? 'Saving...' : editingItem ? 'Update Item' : 'Save Item'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* AI Reorder Suggestions Modal */}
      {aiModalOpen && (
        <div className="fixed inset-0 z-[75] flex items-center justify-center bg-slate-900/50 p-4">
          <div className="bg-white rounded-xl border border-slate-200 shadow-xl max-w-2xl w-full max-h-[85vh] flex flex-col">
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-[#408dfb]" />
                <h3 className="text-sm font-semibold text-slate-900">
                  AI Reorder Suggestions (Grouped by Preferred Vendor)
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setAiModalOpen(false)}
                aria-label="Close reorder suggestions"
                className="text-slate-400 hover:text-slate-700"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-5 overflow-y-auto flex-1 space-y-4 text-xs">
              {aiLoading ? (
                <div className="py-12 text-center text-slate-500">
                  Analyzing low-stock parts and preferred vendors with Gemini...
                </div>
              ) : aiSuggestions ? (
                <>
                  <p className="text-slate-700 bg-blue-50/60 border border-blue-100 rounded-lg p-3">
                    {aiSuggestions.summary}
                  </p>
                  {aiSuggestions.groups.map((grp, idx) => (
                    <div key={idx} className="border border-slate-200 rounded-lg overflow-hidden">
                      <div className="bg-slate-50 px-4 py-2.5 border-b border-slate-200 flex items-center justify-between gap-2">
                        <div>
                          <p className="font-semibold text-slate-900">{grp.vendorName}</p>
                          <p className="text-[11px] text-slate-500">{grp.rationale}</p>
                        </div>
                        <button
                          type="button"
                          disabled={creatingDraftPoFor === (grp.vendorId || grp.vendorName)}
                          onClick={() => void handleCreateDraftPoFromAi(grp)}
                          className="px-3 py-1.5 bg-[#408dfb] hover:bg-[#2f7ae5] text-white font-medium rounded-lg whitespace-nowrap disabled:opacity-50"
                        >
                          {creatingDraftPoFor === (grp.vendorId || grp.vendorName)
                            ? 'Creating...'
                            : 'Draft Purchase Order'}
                        </button>
                      </div>
                      <table className="w-full text-xs">
                        <thead className="border-b border-slate-100 text-slate-500">
                          <tr>
                            <th className="py-2 px-3 text-left font-medium">SKU</th>
                            <th className="py-2 px-3 text-left font-medium">Item</th>
                            <th className="py-2 px-3 text-right font-medium">Suggested Qty</th>
                            <th className="py-2 px-3 text-right font-medium">Unit Cost</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {grp.items.map((it) => (
                            <tr key={it.sku}>
                              <td className="py-2 px-3 font-mono-num">{it.sku}</td>
                              <td className="py-2 px-3">{it.name}</td>
                              <td className="py-2 px-3 text-right tabular-nums font-medium">
                                {it.suggestedQty}
                              </td>
                              <td className="py-2 px-3 text-right tabular-nums">
                                {formatLKR(it.unitCost)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ))}
                </>
              ) : (
                <div className="flex items-center gap-2 text-amber-700">
                  <AlertTriangle className="w-4 h-4" />
                  <span>No suggestions available.</span>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      <CsvImportModal
        open={csvOpen}
        title="Import Spare-Part Items (Excel / CSV)"
        expectedColumns={[
          'name',
          'sku',
          'unit',
          'category',
          'brand',
          'sellingPrice',
          'costPrice',
          'openingStock',
          'reorderLevel',
          'taxRate',
          'barcode',
        ]}
        columnAliases={ITEM_COLUMN_ALIASES}
        templateFileName="ap-brothers-products-template"
        sampleRow={{
          name: 'PETROL PIPE PULSAR 270mm',
          sku: 'MYPART-001',
          unit: 'PCS',
          category: 'Fuel System',
          brand: 'Bajaj Genuine',
          sellingPrice: '450',
          costPrice: '280',
          openingStock: '50',
          reorderLevel: '15',
          taxRate: '18',
          barcode: '4790001000011',
        }}
        onClose={() => setCsvOpen(false)}
        onImport={async (sheetRows) => {
          if (!orgId || !user) return;
          const whId = warehouses.find((w) => w.isPrimary)?.id || warehouses[0]?.id || '';
          const userName = user.displayName || user.email || 'User';
          const allowedUnits = new Set(['PCS', 'SET', 'BOX', 'PAIR']);
          let created = 0;
          let skipped = 0;
          let firstError: string | null = null;

          for (const r of sheetRows) {
            const itemName = (r.name || '').trim();
            const itemSku = (r.sku || '').trim();
            if (!itemName || !itemSku) {
              skipped += 1;
              continue;
            }
            const rawUnit = (r.unit || 'PCS').trim().toUpperCase();
            const normalizedUnit = allowedUnits.has(rawUnit) ? rawUnit : 'PCS';
            const parseNum = (val: string | undefined, fallback: number) => {
              if (!val) return fallback;
              const cleaned = val.replace(/[^0-9.-]/g, '');
              const num = Number(cleaned);
              return Number.isFinite(num) && num >= 0 ? num : fallback;
            };

            try {
              await createItemWithOpeningStock({
                orgId,
                userId: user.uid,
                userName,
                warehouseId: whId,
                data: {
                  name: itemName,
                  sku: itemSku,
                  unit: normalizedUnit,
                  category: (r.category || '').trim(),
                  brand: (r.brand || '').trim(),
                  sellingPrice: parseNum(r.sellingPrice, 0),
                  costPrice: parseNum(r.costPrice, 0),
                  taxRate: parseNum(r.taxRate, 18),
                  openingStock: parseNum(r.openingStock, 0),
                  reorderLevel: parseNum(r.reorderLevel, 10),
                  reorderQty: 25,
                  barcode: (r.barcode || '').trim(),
                  images: [],
                  status: 'active',
                },
              });
              created += 1;
            } catch (err) {
              skipped += 1;
              if (!firstError) {
                firstError = err instanceof Error ? err.message : 'Row import error';
              }
            }
          }

          if (created === 0) {
            throw new Error(
              firstError || 'No valid items were imported. Check that Name and unique SKU columns are filled.'
            );
          }

          showToast(
            `Imported ${created} item(s)${skipped > 0 ? ` (${skipped} skipped)` : ''}`,
            'success'
          );
          await loadPage(0);
        }}
      />

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="Delete Selected Item(s)"
        message={`Soft-delete ${deleteTarget?.length ?? 0} selected item(s)? Historical ledger entries remain preserved.`}
        confirmLabel="Delete"
        danger
        onCancel={() => setDeleteTarget(null)}
        onConfirm={async () => {
          if (!orgId || !user || !deleteTarget) return;
          for (const id of deleteTarget) {
            await softDeleteOrgDoc(orgId, 'items', id, user.uid);
          }
          setDeleteTarget(null);
          showToast('Item(s) deleted', 'success');
          await loadPage(currentPageIdx);
        }}
      />

      <ConfirmDialog
        open={Boolean(clearScope)}
        title={clearScope === 'demo' ? 'Clear Demo Items' : 'Clear Item Catalog'}
        message={
          clearScope === 'demo'
            ? 'Remove all pre-loaded demo spare parts and their low-stock notifications so you can add your own products one by one or via Excel? Any custom items you added will be kept.'
            : 'Remove all active items from your catalog? Historical ledger records remain preserved.'
        }
        confirmLabel={clearScope === 'demo' ? 'Clear Demo Items' : 'Clear All Items'}
        danger
        loading={clearing}
        onCancel={() => setClearScope(null)}
        onConfirm={async () => {
          if (!orgId || !user || !clearScope) return;
          setClearing(true);
          try {
            const res = await clearDemoItems(
              orgId,
              user.uid,
              user.displayName || user.email || 'User',
              clearScope
            );
            setClearScope(null);
            showToast(
              `Cleared ${res.clearedItems} item(s) from catalog`,
              'success'
            );
            setPageStack([null]);
            await loadPage(0, [null]);
          } catch (err) {
            showToast(err instanceof Error ? err.message : 'Failed to clear items', 'error');
          } finally {
            setClearing(false);
          }
        }}
      />
    </div>
  );
}
