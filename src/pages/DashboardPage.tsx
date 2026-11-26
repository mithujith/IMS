import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { collection, limit, onSnapshot, orderBy, query } from 'firebase/firestore';
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  CheckCircle2,
  Circle,
  Database,
  Package,
  TrendingUp,
} from 'lucide-react';
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { useAuth } from '../hooks/useAuth';
import { useOrg } from '../hooks/useOrg';
import { useToast } from '../hooks/useToast';
import {
  ActivityLogEntry,
  Customer,
  InvoiceDoc,
  Item,
  PackageDoc,
  PurchaseOrder,
  SalesOrder,
  ShipmentDoc,
  Vendor,
} from '../types';
import { formatLKR, formatRelativeTime } from '../lib/formatters';
import { computePercentageDelta } from '../lib/calculations';
import { DashboardSkeleton } from '../components/LoadingSkeleton';
import { seedDemoData } from '../services/seedService';

type PeriodKey = 'today' | 'week' | 'month' | 'quarter' | 'year';

const CHANNEL_COLORS: Record<string, string> = {
  Direct: '#408dfb',
  Counter: '#10b981',
  Wholesale: '#f59e0b',
  Online: '#6366f1',
};

function getPeriodRange(period: PeriodKey): { start: Date; prevStart: Date; prevEnd: Date } {
  const now = new Date();
  const end = new Date(now);
  let days = 30;
  if (period === 'today') days = 1;
  else if (period === 'week') days = 7;
  else if (period === 'month') days = 30;
  else if (period === 'quarter') days = 90;
  else if (period === 'year') days = 365;

  const start = new Date(end.getTime() - days * 86400000);
  const prevEnd = new Date(start.getTime() - 1);
  const prevStart = new Date(prevEnd.getTime() - days * 86400000);
  return { start, prevStart, prevEnd };
}

export function DashboardPage() {
  const { user } = useAuth();
  const { orgId, org, role, can } = useOrg();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const initialTab =
    searchParams.get('tab') === 'getting-started'
      ? 'getting-started'
      : searchParams.get('tab') === 'updates'
        ? 'updates'
        : 'dashboard';

  const [mainTab, setMainTab] = useState<'dashboard' | 'getting-started' | 'updates'>(initialTab);
  const [rightTab, setRightTab] = useState<'pending' | 'activities'>('pending');
  const [sellingPeriod, setSellingPeriod] = useState<PeriodKey>('month');
  const [stockAsOf, setStockAsOf] = useState<'today' | 'month' | 'quarter'>('today');
  const [stockMetric, setStockMetric] = useState<'quantity' | 'value'>('quantity');

  const [items, setItems] = useState<Item[]>([]);
  const [salesOrders, setSalesOrders] = useState<SalesOrder[]>([]);
  const [packages, setPackages] = useState<PackageDoc[]>([]);
  const [shipments, setShipments] = useState<ShipmentDoc[]>([]);
  const [invoices, setInvoices] = useState<InvoiceDoc[]>([]);
  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrder[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [activities, setActivities] = useState<ActivityLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [seeding, setSeeding] = useState(false);

  useEffect(() => {
    const param = searchParams.get('tab');
    if (param === 'getting-started') setMainTab('getting-started');
    else if (param === 'updates') setMainTab('updates');
  }, [searchParams]);

  useEffect(() => {
    if (!orgId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    const unsubs: Array<() => void> = [];

    const listen = <T extends { id: string; isDeleted?: boolean }>(
      subcol: string,
      setter: React.Dispatch<React.SetStateAction<T[]>>,
      maxRows = 150
    ) => {
      const path = `organizations/${orgId}/${subcol}`;
      const q = query(collection(db, path), orderBy('createdAt', 'desc'), limit(maxRows));
      const u = onSnapshot(
        q,
        (snap) => {
          setter(
            snap.docs
              .map((d) => ({ id: d.id, ...(d.data() as Omit<T, 'id'>) }) as T)
              .filter((r) => r.isDeleted !== true)
          );
          setLoading(false);
        },
        (err) => {
          handleFirestoreError(err, OperationType.LIST, path);
        }
      );
      unsubs.push(u);
    };

    listen<Item>('items', setItems, 200);
    listen<SalesOrder>('salesOrders', setSalesOrders, 200);
    listen<PackageDoc>('packages', setPackages, 150);
    listen<ShipmentDoc>('shipments', setShipments, 150);
    listen<InvoiceDoc>('invoices', setInvoices, 200);
    listen<PurchaseOrder>('purchaseOrders', setPurchaseOrders, 150);
    listen<Customer>('customers', setCustomers, 50);
    listen<Vendor>('vendors', setVendors, 50);
    listen<ActivityLogEntry>('activityLog', setActivities, 30);

    return () => {
      unsubs.forEach((u) => u());
    };
  }, [orgId]);

  const topSellingItems = useMemo(() => {
    const { start, prevStart, prevEnd } = getPeriodRange(sellingPeriod);
    const currentQty: Record<string, { qty: number; item?: Item }> = {};
    const prevQty: Record<string, number> = {};

    const itemById = Object.fromEntries(items.map((i) => [i.id, i]));

    for (const so of salesOrders) {
      if (so.status === 'void') continue;
      const d = new Date(so.date);
      if (Number.isNaN(d.getTime())) continue;
      if (d >= start) {
        for (const l of so.lines || []) {
          if (!currentQty[l.itemId]) currentQty[l.itemId] = { qty: 0, item: itemById[l.itemId] };
          currentQty[l.itemId].qty += Number(l.quantity || 0);
        }
      } else if (d >= prevStart && d <= prevEnd) {
        for (const l of so.lines || []) {
          prevQty[l.itemId] = (prevQty[l.itemId] ?? 0) + Number(l.quantity || 0);
        }
      }
    }

    return Object.entries(currentQty)
      .map(([itemId, info]) => {
        const item = info.item;
        const previous = prevQty[itemId] ?? 0;
        const delta = computePercentageDelta(info.qty, previous);
        return {
          itemId,
          name: item?.name || salesOrders.flatMap((s) => s.lines).find((l) => l.itemId === itemId)?.itemName || 'Item',
          sku: item?.sku || '',
          unit: item?.unit || 'PCS',
          image: item?.images?.[0] || '',
          qty: info.qty,
          delta,
        };
      })
      .sort((a, b) => b.qty - a.qty)
      .slice(0, 5);
  }, [items, salesOrders, sellingPeriod]);

  const topStockedItems = useMemo(() => {
    return [...items]
      .sort((a, b) =>
        stockMetric === 'quantity'
          ? b.totalStock - a.totalStock
          : b.totalStock * b.costPrice - a.totalStock * a.costPrice
      )
      .slice(0, 6);
  }, [items, stockMetric]);

  const salesByChannelData = useMemo(() => {
    const { start } = getPeriodRange(sellingPeriod);
    const sums: Record<string, number> = {};
    for (const so of salesOrders) {
      if (so.status === 'void') continue;
      const d = new Date(so.date);
      if (Number.isNaN(d.getTime()) || d < start) continue;
      const ch = so.channel || 'Direct';
      sums[ch] = (sums[ch] ?? 0) + Number(so.total || 0);
    }
    return Object.entries(sums)
      .map(([name, value]) => ({ name, value }))
      .filter((d) => d.value > 0);
  }, [salesOrders, sellingPeriod]);

  const pendingCounts = useMemo(() => {
    const toBePacked = salesOrders.filter((s) => s.status === 'confirmed').length;
    const toBeShipped =
      packages.filter((p) => p.status === 'not_shipped').length ||
      salesOrders.filter((s) => s.status === 'packed').length;
    const toBeDelivered = shipments.filter((s) => s.status === 'shipped').length;
    const toBeInvoiced = salesOrders.filter((s) =>
      ['confirmed', 'packed', 'shipped', 'delivered'].includes(s.status)
    ).length;
    const toBeReceived = purchaseOrders.filter((p) => p.status === 'issued').length;
    const receiveInProgress = purchaseOrders.filter((p) => p.status === 'partially_received').length;
    const belowReorder = items.filter((i) => i.totalStock <= i.reorderLevel).length;

    return {
      toBePacked,
      toBeShipped,
      toBeDelivered,
      toBeInvoiced,
      toBeReceived,
      receiveInProgress,
      belowReorder,
    };
  }, [salesOrders, packages, shipments, purchaseOrders, items]);

  const checklist = [
    {
      label: 'Create items in your spare-parts catalog',
      done: items.length > 0,
      to: '/items',
    },
    {
      label: 'Add customers & workshops',
      done: customers.length > 0,
      to: '/customers',
    },
    {
      label: 'Add spare-parts vendors & suppliers',
      done: vendors.length > 0,
      to: '/vendors',
    },
    {
      label: 'Record your first Sales Order',
      done: salesOrders.length > 0,
      to: '/sales-orders',
    },
    {
      label: 'Issue your first Customer Invoice',
      done: invoices.length > 0,
      to: '/invoices',
    },
  ];
  const completedChecklist = checklist.filter((c) => c.done).length;

  const handleLoadDemo = async () => {
    if (!orgId || !user) return;
    setSeeding(true);
    try {
      const res = await seedDemoData(
        orgId,
        user.uid,
        user.displayName || user.email || 'Admin'
      );
      if (res.alreadyLoaded) {
        showToast(
          'Demo data already loaded',
          'info',
          'Demo motorcycle parts, warehouses, and vendor records already exist in this organization.'
        );
      } else {
        showToast(
          'Demo data loaded',
          'success',
          `Added ${res.items} parts, ${res.warehouses} warehouse(s), ${res.vendors} vendors, ${res.customers} customers, and ${res.orders} orders.`
        );
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to load demo data', 'error');
    } finally {
      setSeeding(false);
    }
  };

  const username = user?.displayName || user?.email?.split('@')[0] || 'User';

  return (
    <div className="space-y-5 max-w-[1400px] mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Hello, {username}</h1>
          <p className="text-xs text-slate-500 mt-0.5">
            {org?.name || 'A & P Brothers (Pvt) Ltd'} · {org?.currency || 'LKR'}
          </p>
        </div>

        {role === 'Admin' && items.length === 0 && (
          <button
            type="button"
            disabled={seeding}
            onClick={handleLoadDemo}
            className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium text-white bg-[#408dfb] hover:bg-[#2f7ae5] rounded-lg transition-colors self-start sm:self-auto"
          >
            <Database className="w-3.5 h-3.5" />
            {seeding ? 'Loading Spare-Parts Demo...' : 'Load Demo Data (40 Parts)'}
          </button>
        )}
      </div>

      {/* Main Tabs */}
      <div className="flex items-center gap-6 border-b border-slate-200">
        {[
          { key: 'dashboard', label: 'Dashboard' },
          { key: 'getting-started', label: 'Getting Started' },
          { key: 'updates', label: 'Recent Updates' },
        ].map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => {
              setMainTab(t.key as typeof mainTab);
              setSearchParams(t.key === 'dashboard' ? {} : { tab: t.key });
            }}
            className={`pb-2.5 text-xs font-medium border-b-2 transition-colors ${
              mainTab === t.key
                ? 'border-[#408dfb] text-[#408dfb]'
                : 'border-transparent text-slate-600 hover:text-slate-900'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {loading ? (
        <DashboardSkeleton />
      ) : mainTab === 'getting-started' ? (
        <div className="bg-white border border-slate-200 rounded-lg p-6 max-w-3xl space-y-5">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-base font-semibold text-slate-900">
                Guided Onboarding — A &amp; P Brothers (Pvt) Ltd
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Complete these steps to launch your motorcycle spare-parts operations.
              </p>
            </div>
            <span className="text-xs font-semibold text-[#408dfb] tabular-nums">
              {completedChecklist}/{checklist.length} Completed
            </span>
          </div>

          <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
            <div
              className="h-full bg-[#408dfb] transition-all"
              style={{ width: `${(completedChecklist / checklist.length) * 100}%` }}
            />
          </div>

          <div className="divide-y divide-slate-100 border border-slate-200 rounded-lg">
            {checklist.map((step) => (
              <div key={step.label} className="px-4 py-3 flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  {step.done ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                  ) : (
                    <Circle className="w-4 h-4 text-slate-300 shrink-0" />
                  )}
                  <span
                    className={`text-xs ${
                      step.done ? 'line-through text-slate-400' : 'font-medium text-slate-800'
                    }`}
                  >
                    {step.label}
                  </span>
                </div>
                <Link
                  to={step.to}
                  className="text-xs font-medium text-[#408dfb] hover:underline whitespace-nowrap"
                >
                  {step.done ? 'View' : 'Start'}
                </Link>
              </div>
            ))}
          </div>

          {can('settings', 'edit') && (
            <div className="pt-2 flex items-center justify-between bg-slate-50 border border-slate-200 rounded-lg p-4">
              <div>
                <p className="text-xs font-semibold text-slate-900">
                  Want to explore with realistic Sri Lankan spare-parts data?
                </p>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  Seeds 40 items (YYPP005, YYPP001, YYP002, YYIC002...), 10 customers, 6 vendors, and 90 days of orders.
                </p>
              </div>
              <button
                type="button"
                disabled={seeding}
                onClick={handleLoadDemo}
                className="px-3.5 py-2 text-xs font-medium text-white bg-[#408dfb] hover:bg-[#2f7ae5] rounded-lg whitespace-nowrap disabled:opacity-50"
              >
                {seeding ? 'Seeding...' : 'Load Demo Data'}
              </button>
            </div>
          )}
        </div>
      ) : mainTab === 'updates' ? (
        <div className="bg-white border border-slate-200 rounded-lg p-6 max-w-3xl space-y-4">
          <h2 className="text-base font-semibold text-slate-900">Recent Organization Updates</h2>
          {activities.length === 0 ? (
            <p className="text-xs text-slate-500">No updates recorded yet.</p>
          ) : (
            <div className="divide-y divide-slate-100">
              {activities.map((act) => (
                <div key={act.id} className="py-3 flex items-start justify-between gap-4 text-xs">
                  <div>
                    <p className="font-medium text-slate-900">
                      {act.action} {act.entityName ? `— ${act.entityName}` : ''}
                    </p>
                    <p className="text-slate-500 mt-0.5">
                      {act.module} · by {act.userName} {act.details ? `· ${act.details}` : ''}
                    </p>
                  </div>
                  <span className="text-[11px] text-slate-400 whitespace-nowrap">
                    {formatRelativeTime(act.createdAt)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
          {/* Left Column */}
          <div className="lg:col-span-8 space-y-5">
            {/* Top Selling Items */}
            <section className="bg-white border border-slate-200 rounded-lg p-4">
              <div className="flex items-center justify-between gap-2 mb-4">
                <h2 className="text-sm font-semibold text-slate-900">Top Selling Items</h2>
                <select
                  aria-label="Top selling items period"
                  value={sellingPeriod}
                  onChange={(e) => setSellingPeriod(e.target.value as PeriodKey)}
                  className="text-xs border border-slate-300 rounded-md px-2.5 py-1 bg-white text-slate-700 focus:outline-none focus:border-[#408dfb]"
                >
                  <option value="today">Today</option>
                  <option value="week">This Week</option>
                  <option value="month">This Month</option>
                  <option value="quarter">This Quarter</option>
                  <option value="year">This Year</option>
                </select>
              </div>

              {topSellingItems.length === 0 ? (
                <div className="py-10 text-center text-xs text-slate-500">
                  No sales recorded in this period.
                </div>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
                  {topSellingItems.map((item) => {
                    const isUp = item.delta > 0;
                    const isDown = item.delta < 0;
                    return (
                      <button
                        key={item.itemId}
                        type="button"
                        onClick={() => navigate(`/items/${item.itemId}`)}
                        className="text-left border border-slate-200 rounded-lg p-3 hover:border-[#408dfb] transition-colors flex flex-col justify-between bg-white"
                      >
                        <div>
                          <div className="w-full aspect-square rounded bg-slate-50 border border-slate-100 flex items-center justify-center overflow-hidden mb-2">
                            {item.image ? (
                              <img
                                src={item.image}
                                alt={item.name}
                                referrerPolicy="no-referrer"
                                className="w-full h-full object-cover"
                              />
                            ) : (
                              <Package className="w-7 h-7 text-slate-300" />
                            )}
                          </div>
                          <p
                            title={item.name}
                            className="text-xs font-medium text-slate-800 line-clamp-2 min-h-[32px]"
                          >
                            {item.name}
                          </p>
                        </div>

                        <div className="mt-2 pt-2 border-t border-slate-100">
                          <p className="text-sm font-semibold text-slate-900 tabular-nums">
                            {item.qty}{' '}
                            <span className="text-[11px] font-normal text-slate-500">
                              {item.unit}
                            </span>
                          </p>
                          <p
                            className={`inline-flex items-center gap-0.5 text-[11px] font-medium mt-0.5 tabular-nums ${
                              isUp
                                ? 'text-emerald-600'
                                : isDown
                                  ? 'text-red-600'
                                  : 'text-slate-500'
                            }`}
                          >
                            {isUp && <ArrowUpRight className="w-3 h-3" />}
                            {isDown && <ArrowDownRight className="w-3 h-3" />}
                            {Math.abs(item.delta).toFixed(2)}%
                          </p>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </section>

            {/* Top Stocked Items */}
            <section className="bg-white border border-slate-200 rounded-lg p-4">
              <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                <h2 className="text-sm font-semibold text-slate-900">Top Stocked Items</h2>
                <div className="flex items-center gap-2">
                  <div className="flex items-center gap-1.5 text-xs text-slate-600">
                    <span>As of:</span>
                    <select
                      aria-label="Stock as of date"
                      value={stockAsOf}
                      onChange={(e) => setStockAsOf(e.target.value as typeof stockAsOf)}
                      className="text-xs border border-slate-300 rounded-md px-2 py-1 bg-white"
                    >
                      <option value="today">Today</option>
                      <option value="month">End of Last Month</option>
                      <option value="quarter">End of Last Quarter</option>
                    </select>
                  </div>

                  <div className="inline-flex bg-slate-100 p-0.5 rounded-md text-xs">
                    <button
                      type="button"
                      onClick={() => setStockMetric('quantity')}
                      className={`px-2.5 py-1 rounded font-medium transition-colors ${
                        stockMetric === 'quantity'
                          ? 'bg-white text-[#408dfb] shadow-sm'
                          : 'text-slate-600'
                      }`}
                    >
                      By Quantity
                    </button>
                    <button
                      type="button"
                      onClick={() => setStockMetric('value')}
                      className={`px-2.5 py-1 rounded font-medium transition-colors ${
                        stockMetric === 'value'
                          ? 'bg-white text-[#408dfb] shadow-sm'
                          : 'text-slate-600'
                      }`}
                    >
                      By Value
                    </button>
                  </div>
                </div>
              </div>

              {topStockedItems.length === 0 ? (
                <p className="py-8 text-center text-xs text-slate-500">
                  No stocked items yet.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-slate-50 border-y border-slate-200 text-slate-500">
                      <tr>
                        <th className="py-2 px-3 text-left font-medium">Item</th>
                        <th className="py-2 px-3 text-left font-medium">SKU</th>
                        <th className="py-2 px-3 text-right font-medium">Stock on Hand</th>
                        <th className="py-2 px-3 text-right font-medium">Stock Value</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {topStockedItems.map((it) => (
                        <tr key={it.id} className="hover:bg-slate-50/70">
                          <td className="py-2 px-3">
                            <Link
                              to={`/items/${it.id}`}
                              className="text-[#408dfb] hover:underline font-medium"
                            >
                              {it.name}
                            </Link>
                          </td>
                          <td className="py-2 px-3 font-mono-num text-slate-600">{it.sku}</td>
                          <td className="py-2 px-3 text-right tabular-nums text-slate-800">
                            {it.totalStock} {it.unit}
                          </td>
                          <td className="py-2 px-3 text-right tabular-nums font-medium text-slate-900">
                            {formatLKR(it.totalStock * it.costPrice)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            {/* Sales By Channel */}
            <section className="bg-white border border-slate-200 rounded-lg p-4">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-semibold text-slate-900">Sales By Channel</h2>
                <span className="text-[11px] text-slate-500 capitalize">{sellingPeriod}</span>
              </div>
              {salesByChannelData.length === 0 ? (
                <div className="h-52 flex flex-col items-center justify-center text-xs text-slate-500">
                  <TrendingUp className="w-7 h-7 text-slate-300 mb-2" />
                  <p>No sales data found during this period.</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-center">
                  <div className="h-52 w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={salesByChannelData}
                          dataKey="value"
                          nameKey="name"
                          innerRadius={52}
                          outerRadius={80}
                          paddingAngle={2}
                        >
                          {salesByChannelData.map((entry) => (
                            <Cell
                              key={entry.name}
                              fill={CHANNEL_COLORS[entry.name] || '#64748b'}
                            />
                          ))}
                        </Pie>
                        <Tooltip formatter={(val) => formatLKR(Number(val ?? 0))} />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="space-y-2.5 text-xs">
                    {salesByChannelData.map((ch) => (
                      <div key={ch.name} className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span
                            className="w-2.5 h-2.5 rounded-sm shrink-0"
                            style={{ backgroundColor: CHANNEL_COLORS[ch.name] || '#64748b' }}
                          />
                          <span className="text-slate-700 font-medium">{ch.name}</span>
                        </div>
                        <span className="font-semibold text-slate-900 tabular-nums">
                          {formatLKR(ch.value)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </section>
          </div>

          {/* Right Column */}
          <div className="lg:col-span-4 bg-white border border-slate-200 rounded-lg overflow-hidden">
            <div className="flex border-b border-slate-200">
              <button
                type="button"
                onClick={() => setRightTab('pending')}
                className={`flex-1 py-3 text-xs font-semibold border-b-2 transition-colors ${
                  rightTab === 'pending'
                    ? 'border-[#408dfb] text-[#408dfb] bg-blue-50/20'
                    : 'border-transparent text-slate-600 hover:text-slate-900'
                }`}
              >
                Pending Actions
              </button>
              <button
                type="button"
                onClick={() => setRightTab('activities')}
                className={`flex-1 py-3 text-xs font-semibold border-b-2 transition-colors ${
                  rightTab === 'activities'
                    ? 'border-[#408dfb] text-[#408dfb] bg-blue-50/20'
                    : 'border-transparent text-slate-600 hover:text-slate-900'
                }`}
              >
                Recent Activities
              </button>
            </div>

            {rightTab === 'pending' ? (
              <div className="p-4 space-y-5 text-xs">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-2">
                    Sales
                  </p>
                  <div className="divide-y divide-slate-100 border border-slate-200 rounded-lg">
                    {[
                      { label: 'To Be Packed', count: pendingCounts.toBePacked, to: '/sales-orders?status=confirmed' },
                      { label: 'To Be Shipped', count: pendingCounts.toBeShipped, to: '/packages?status=not_shipped' },
                      { label: 'To Be Delivered', count: pendingCounts.toBeDelivered, to: '/shipments?status=shipped' },
                      { label: 'To Be Invoiced', count: pendingCounts.toBeInvoiced, to: '/sales-orders?status=delivered' },
                    ].map((row) => (
                      <Link
                        key={row.label}
                        to={row.to}
                        className="px-3 py-2.5 flex items-center justify-between hover:bg-blue-50/40 transition-colors"
                      >
                        <span className="text-slate-700">{row.label}</span>
                        <span className="font-semibold text-[#408dfb] tabular-nums">
                          {row.count}
                        </span>
                      </Link>
                    ))}
                  </div>
                </div>

                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-2">
                    Purchases
                  </p>
                  <div className="divide-y divide-slate-100 border border-slate-200 rounded-lg">
                    {[
                      { label: 'To Be Received', count: pendingCounts.toBeReceived, to: '/purchase-orders?status=issued' },
                      { label: 'Receive In Progress', count: pendingCounts.receiveInProgress, to: '/purchase-orders?status=partially_received' },
                    ].map((row) => (
                      <Link
                        key={row.label}
                        to={row.to}
                        className="px-3 py-2.5 flex items-center justify-between hover:bg-blue-50/40 transition-colors"
                      >
                        <span className="text-slate-700">{row.label}</span>
                        <span className="font-semibold text-[#408dfb] tabular-nums">
                          {row.count}
                        </span>
                      </Link>
                    ))}
                  </div>
                </div>

                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-2">
                    Inventory
                  </p>
                  <Link
                    to="/items?tab=low_stock"
                    className="px-3 py-3 border border-slate-200 rounded-lg flex items-center justify-between hover:bg-amber-50/40 transition-colors"
                  >
                    <span className="flex items-center gap-2 text-slate-700 font-medium">
                      <AlertTriangle className="w-4 h-4 text-amber-500" />
                      Below Reorder Level
                    </span>
                    <span
                      className={`font-semibold tabular-nums ${
                        pendingCounts.belowReorder > 0 ? 'text-amber-600' : 'text-slate-500'
                      }`}
                    >
                      {pendingCounts.belowReorder}
                    </span>
                  </Link>
                </div>
              </div>
            ) : (
              <div className="p-4 max-h-[540px] overflow-y-auto divide-y divide-slate-100 text-xs">
                {activities.length === 0 ? (
                  <p className="py-10 text-center text-slate-500">No recent activity yet.</p>
                ) : (
                  activities.map((act) => (
                    <div key={act.id} className="py-2.5">
                      <p className="font-medium text-slate-900">
                        {act.action}
                        {act.entityName ? ` · ${act.entityName}` : ''}
                      </p>
                      <p className="text-[11px] text-slate-500 mt-0.5">
                        {act.userName} · {formatRelativeTime(act.createdAt)}
                      </p>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
