import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Bell,
  Building2,
  ChevronDown,
  Clock,
  Grid3X3,
  LogOut,
  Menu,
  Plus,
  Search,
  Settings,
  User as UserIcon,
} from 'lucide-react';
import { collection, getDocs, limit, orderBy, query } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../hooks/useAuth';
import { useOrg } from '../hooks/useOrg';
import { useToast } from '../hooks/useToast';
import { formatRelativeTime } from '../lib/formatters';

export interface HistoryItem {
  label: string;
  path: string;
  visitedAt: string;
}

interface SearchResult {
  id: string;
  title: string;
  subtitle: string;
  module: string;
  path: string;
}

const SEARCH_MODULES = [
  'All',
  'Items',
  'Customers',
  'Vendors',
  'Sales Orders',
  'Invoices',
  'Purchase Orders',
  'Bills',
] as const;

interface TopBarProps {
  onOpenMobileSidebar: () => void;
  searchInputRef: React.RefObject<HTMLInputElement | null>;
  recentHistory: HistoryItem[];
}

export function TopBar({
  onOpenMobileSidebar,
  searchInputRef,
  recentHistory,
}: TopBarProps) {
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const {
    orgId,
    org,
    role,
    memberships,
    notifications,
    unreadNotifications,
    switchOrganization,
    createNewOrganization,
    markNotificationRead,
    can,
  } = useOrg();
  const { showToast } = useToast();

  const [searchModule, setSearchModule] = useState<(typeof SEARCH_MODULES)[number]>('Customers');
  const [searchText, setSearchText] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);

  const [openMenu, setOpenMenu] = useState<
    null | 'history' | 'org' | 'quickCreate' | 'notifications' | 'apps' | 'avatar'
  >(null);
  const [newOrgName, setNewOrgName] = useState('');
  const [creatingOrg, setCreatingOrg] = useState(false);

  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpenMenu(null);
        setSearchOpen(false);
      }
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  useEffect(() => {
    const qText = searchText.trim().toLowerCase();
    if (!qText || !orgId) {
      setSearchResults([]);
      return;
    }

    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        const targets: { key: string; col: string; titleField: string; subField: string; route: (id: string) => string }[] = [
          { key: 'Items', col: 'items', titleField: 'name', subField: 'sku', route: (id) => `/items/${id}` },
          { key: 'Customers', col: 'customers', titleField: 'name', subField: 'phone', route: () => '/customers' },
          { key: 'Vendors', col: 'vendors', titleField: 'name', subField: 'phone', route: () => '/vendors' },
          { key: 'Sales Orders', col: 'salesOrders', titleField: 'orderNumber', subField: 'customerName', route: () => '/sales-orders' },
          { key: 'Invoices', col: 'invoices', titleField: 'invoiceNumber', subField: 'customerName', route: () => '/invoices' },
          { key: 'Purchase Orders', col: 'purchaseOrders', titleField: 'poNumber', subField: 'vendorName', route: () => '/purchase-orders' },
          { key: 'Bills', col: 'bills', titleField: 'billNumber', subField: 'vendorName', route: () => '/bills' },
        ];

        const activeTargets =
          searchModule === 'All' ? targets : targets.filter((t) => t.key === searchModule);

        const found: SearchResult[] = [];
        await Promise.all(
          activeTargets.map(async (t) => {
            const snap = await getDocs(
              query(collection(db, `organizations/${orgId}/${t.col}`), orderBy('createdAt', 'desc'), limit(40))
            );
            for (const d of snap.docs) {
              const data = d.data() as Record<string, unknown>;
              if (data.isDeleted === true) continue;
              const title = String(data[t.titleField] ?? '');
              const sub = String(data[t.subField] ?? '');
              if (
                title.toLowerCase().includes(qText) ||
                sub.toLowerCase().includes(qText)
              ) {
                found.push({
                  id: d.id,
                  title,
                  subtitle: sub,
                  module: t.key,
                  path: t.route(d.id),
                });
              }
            }
          })
        );
        setSearchResults(found.slice(0, 12));
        setSearchOpen(true);
      } catch {
        setSearchResults([]);
      } finally {
        setSearching(false);
      }
    }, 250);

    return () => clearTimeout(timer);
  }, [searchText, searchModule, orgId]);

  const quickCreateOptions = [
    { label: 'Item', path: '/items?new=1', module: 'items' as const },
    { label: 'Sales Order', path: '/sales-orders?new=1', module: 'salesOrders' as const },
    { label: 'Invoice', path: '/invoices?new=1', module: 'invoices' as const },
    { label: 'Purchase Order', path: '/purchase-orders?new=1', module: 'purchaseOrders' as const },
    { label: 'Bill', path: '/bills?new=1', module: 'bills' as const },
    { label: 'Customer', path: '/customers?new=1', module: 'customers' as const },
    { label: 'Vendor', path: '/vendors?new=1', module: 'vendors' as const },
  ].filter((opt) => can(opt.module, 'create'));

  const orgDisplay = (org?.name || 'A & P BROTHERS (PVT) LTD').toUpperCase();
  const userInitial = (user?.displayName || user?.email || 'U').slice(0, 1).toUpperCase();

  return (
    <header
      ref={containerRef}
      className="h-16 bg-[#1f2a44] text-white flex items-center justify-between px-3 sm:px-4 gap-3 shrink-0 z-40 relative no-print"
    >
      {/* Left: Hamburger + Brand + History */}
      <div className="flex items-center gap-2.5 shrink-0">
        <button
          type="button"
          onClick={onOpenMobileSidebar}
          aria-label="Toggle navigation menu"
          className="lg:hidden p-2 rounded-lg text-slate-200 hover:bg-white/10"
        >
          <Menu className="w-5 h-5" />
        </button>

        <button
          type="button"
          onClick={() => navigate('/')}
          className="flex items-center gap-2 text-left whitespace-nowrap shrink-0"
        >
          <img
            src="/src/assets/images/ap_brothers_logo_1795689650195.jpg"
            alt="A & P Brothers Logo"
            className="w-8 h-8 rounded object-cover bg-white p-0.5"
          />
          <span className="font-semibold text-base tracking-tight text-white">Inventory</span>
        </button>

        <div className="relative hidden sm:block">
          <button
            type="button"
            onClick={() => setOpenMenu(openMenu === 'history' ? null : 'history')}
            aria-label="Recent history"
            className="p-2 rounded-lg text-slate-300 hover:text-white hover:bg-white/10 transition-colors"
          >
            <Clock className="w-4 h-4" />
          </button>
          {openMenu === 'history' && (
            <div className="absolute left-0 mt-2 w-72 bg-white text-slate-800 rounded-lg shadow-xl border border-slate-200 py-2 z-50">
              <p className="px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                Recent History
              </p>
              {recentHistory.length === 0 ? (
                <p className="px-3 py-3 text-xs text-slate-500">No pages visited yet.</p>
              ) : (
                recentHistory.slice(0, 8).map((item, idx) => (
                  <button
                    key={`${item.path}_${idx}`}
                    type="button"
                    onClick={() => {
                      navigate(item.path);
                      setOpenMenu(null);
                    }}
                    className="w-full text-left px-3 py-2 text-xs hover:bg-slate-50 flex items-center justify-between"
                  >
                    <span className="font-medium text-slate-800 truncate">{item.label}</span>
                    <span className="text-[11px] text-slate-400 ml-2 shrink-0">
                      {formatRelativeTime(item.visitedAt)}
                    </span>
                  </button>
                ))
              )}
            </div>
          )}
        </div>
      </div>

      {/* Center: Global Search */}
      <div className="hidden md:flex items-center flex-1 max-w-xl relative">
        <div className="flex items-center w-full bg-[#2a3859] border border-white/10 rounded-lg focus-within:border-[#408dfb] focus-within:bg-white focus-within:text-slate-900 transition-colors">
          <div className="relative border-r border-white/15">
            <select
              aria-label="Search module"
              value={searchModule}
              onChange={(e) => setSearchModule(e.target.value as (typeof SEARCH_MODULES)[number])}
              className="bg-transparent text-xs font-medium pl-3 pr-2 py-2 focus:outline-none cursor-pointer text-inherit"
            >
              {SEARCH_MODULES.map((m) => (
                <option key={m} value={m} className="text-slate-900 bg-white">
                  {m}
                </option>
              ))}
            </select>
          </div>
          <div className="relative flex-1 flex items-center">
            <Search className="w-3.5 h-3.5 text-slate-400 ml-2.5 shrink-0" />
            <input
              ref={searchInputRef}
              type="text"
              value={searchText}
              onFocus={() => searchText.trim() && setSearchOpen(true)}
              onChange={(e) => setSearchText(e.target.value)}
              placeholder={`Search in ${searchModule} ( / )`}
              aria-label="Global search"
              className="w-full bg-transparent px-2.5 py-2 text-xs placeholder:text-slate-300 focus:placeholder:text-slate-400 focus:outline-none"
            />
          </div>
        </div>

        {searchOpen && (
          <div className="absolute top-full left-0 right-0 mt-1.5 bg-white text-slate-800 rounded-lg shadow-xl border border-slate-200 max-h-80 overflow-y-auto z-50">
            {searching ? (
              <p className="px-4 py-3 text-xs text-slate-500">Searching records...</p>
            ) : searchResults.length === 0 ? (
              <p className="px-4 py-3 text-xs text-slate-500">No matching records found.</p>
            ) : (
              searchResults.map((res) => (
                <button
                  key={`${res.module}_${res.id}`}
                  type="button"
                  onClick={() => {
                    navigate(res.path);
                    setSearchOpen(false);
                    setSearchText('');
                  }}
                  className="w-full text-left px-4 py-2.5 hover:bg-blue-50/60 border-b border-slate-100 last:border-0 flex items-center justify-between"
                >
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-slate-900 truncate">{res.title}</p>
                    <p className="text-[11px] text-slate-500 truncate">{res.subtitle}</p>
                  </div>
                  <span className="text-[11px] font-medium text-[#408dfb] bg-blue-50 px-2 py-0.5 rounded ml-3 shrink-0">
                    {res.module}
                  </span>
                </button>
              ))
            )}
          </div>
        )}
      </div>

      {/* Right: Org Switcher, +, Bell, Settings, Avatar, Apps */}
      <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
        {/* Org Switcher */}
        <div className="relative">
          <button
            type="button"
            onClick={() => setOpenMenu(openMenu === 'org' ? null : 'org')}
            className="hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-slate-100 bg-white/10 hover:bg-white/15 rounded-lg max-w-[180px]"
          >
            <Building2 className="w-3.5 h-3.5 shrink-0 text-blue-300" />
            <span className="truncate">{orgDisplay}</span>
            <ChevronDown className="w-3.5 h-3.5 shrink-0" />
          </button>
          {openMenu === 'org' && (
            <div className="absolute right-0 mt-2 w-72 bg-white text-slate-800 rounded-lg shadow-xl border border-slate-200 p-2 z-50">
              <p className="px-2 py-1 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                Organizations
              </p>
              <div className="space-y-1 max-h-48 overflow-y-auto">
                {memberships.map((m) => (
                  <button
                    key={m.orgId}
                    type="button"
                    onClick={async () => {
                      await switchOrganization(m.orgId);
                      setOpenMenu(null);
                      showToast(`Switched to ${m.orgName}`, 'info');
                    }}
                    className={`w-full text-left px-2.5 py-2 rounded-md text-xs flex items-center justify-between ${
                      m.orgId === orgId
                        ? 'bg-blue-50 text-[#408dfb] font-semibold'
                        : 'hover:bg-slate-50 text-slate-700'
                    }`}
                  >
                    <span className="truncate">{m.orgName}</span>
                    <span className="text-[11px] text-slate-400 ml-2">{m.role}</span>
                  </button>
                ))}
              </div>
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  if (!newOrgName.trim()) return;
                  setCreatingOrg(true);
                  try {
                    await createNewOrganization(newOrgName.trim());
                    setNewOrgName('');
                    setOpenMenu(null);
                    showToast('New organization created', 'success');
                  } catch (err) {
                    showToast(err instanceof Error ? err.message : 'Failed to create org', 'error');
                  } finally {
                    setCreatingOrg(false);
                  }
                }}
                className="mt-2 pt-2 border-t border-slate-100 flex gap-1.5"
              >
                <input
                  type="text"
                  value={newOrgName}
                  onChange={(e) => setNewOrgName(e.target.value)}
                  placeholder="Create another organization..."
                  className="flex-1 px-2 py-1.5 text-xs border border-slate-300 rounded focus:outline-none focus:border-[#408dfb]"
                />
                <button
                  type="submit"
                  disabled={creatingOrg || !newOrgName.trim()}
                  className="px-2.5 py-1.5 text-xs font-medium bg-[#408dfb] text-white rounded disabled:opacity-50"
                >
                  Add
                </button>
              </form>
            </div>
          )}
        </div>

        {/* Quick Create + */}
        {quickCreateOptions.length > 0 && (
          <div className="relative">
            <button
              type="button"
              onClick={() => setOpenMenu(openMenu === 'quickCreate' ? null : 'quickCreate')}
              aria-label="Quick create"
              className="w-8 h-8 rounded-full bg-[#408dfb] hover:bg-[#2f7ae5] text-white flex items-center justify-center transition-colors"
            >
              <Plus className="w-4 h-4" />
            </button>
            {openMenu === 'quickCreate' && (
              <div className="absolute right-0 mt-2 w-48 bg-white text-slate-800 rounded-lg shadow-xl border border-slate-200 py-1.5 z-50">
                <p className="px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                  Quick Create
                </p>
                {quickCreateOptions.map((opt) => (
                  <button
                    key={opt.label}
                    type="button"
                    onClick={() => {
                      navigate(opt.path);
                      setOpenMenu(null);
                    }}
                    className="w-full text-left px-3 py-2 text-xs text-slate-700 hover:bg-blue-50 hover:text-[#408dfb] flex items-center gap-2"
                  >
                    <Plus className="w-3.5 h-3.5 text-[#408dfb]" />
                    <span>{opt.label}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Notifications Bell */}
        <div className="relative">
          <button
            type="button"
            onClick={() => setOpenMenu(openMenu === 'notifications' ? null : 'notifications')}
            aria-label="Notifications"
            className="p-2 rounded-lg text-slate-200 hover:text-white hover:bg-white/10 relative"
          >
            <Bell className="w-4 h-4" />
            {unreadNotifications > 0 && (
              <span className="absolute top-1 right-1 min-w-[16px] h-4 px-1 rounded-full bg-red-500 text-[10px] font-semibold text-white flex items-center justify-center tabular-nums">
                {unreadNotifications > 9 ? '9+' : unreadNotifications}
              </span>
            )}
          </button>
          {openMenu === 'notifications' && (
            <div className="absolute right-0 mt-2 w-80 bg-white text-slate-800 rounded-lg shadow-xl border border-slate-200 py-2 z-50">
              <div className="px-3 py-1.5 border-b border-slate-100 flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-900">Alerts &amp; Notifications</span>
                <span className="text-[11px] text-slate-500">{unreadNotifications} unread</span>
              </div>
              <div className="max-h-72 overflow-y-auto divide-y divide-slate-100">
                {notifications.length === 0 ? (
                  <p className="px-3 py-5 text-xs text-center text-slate-500">
                    All caught up! No alerts right now.
                  </p>
                ) : (
                  notifications.map((n) => (
                    <button
                      key={n.id}
                      type="button"
                      onClick={async () => {
                        await markNotificationRead(n.id);
                        if (n.link) navigate(n.link);
                        setOpenMenu(null);
                      }}
                      className={`w-full text-left px-3 py-2.5 hover:bg-slate-50 ${
                        n.read ? 'opacity-70' : 'bg-blue-50/30'
                      }`}
                    >
                      <p className="text-xs font-medium text-slate-900">{n.title}</p>
                      <p className="text-[11px] text-slate-600 mt-0.5">{n.message}</p>
                      <p className="text-[10px] text-slate-400 mt-1">
                        {formatRelativeTime(n.createdAt)}
                      </p>
                    </button>
                  ))
                )}
              </div>
            </div>
          )}
        </div>

        {/* Settings Gear */}
        {can('settings', 'view') && (
          <button
            type="button"
            onClick={() => navigate('/settings')}
            aria-label="Organization settings"
            className="p-2 rounded-lg text-slate-200 hover:text-white hover:bg-white/10"
          >
            <Settings className="w-4 h-4" />
          </button>
        )}

        {/* Apps Grid */}
        <div className="relative hidden sm:block">
          <button
            type="button"
            onClick={() => setOpenMenu(openMenu === 'apps' ? null : 'apps')}
            aria-label="Module switcher"
            className="p-2 rounded-lg text-slate-200 hover:text-white hover:bg-white/10"
          >
            <Grid3X3 className="w-4 h-4" />
          </button>
          {openMenu === 'apps' && (
            <div className="absolute right-0 mt-2 w-60 bg-white text-slate-800 rounded-lg shadow-xl border border-slate-200 p-3 z-50">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-2">
                Workspaces
              </p>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <button
                  type="button"
                  onClick={() => { navigate('/items'); setOpenMenu(null); }}
                  className="p-2 rounded-lg border border-slate-200 hover:border-[#408dfb] hover:bg-blue-50/40 text-left font-medium"
                >
                  Inventory
                </button>
                <button
                  type="button"
                  onClick={() => { navigate('/invoices'); setOpenMenu(null); }}
                  className="p-2 rounded-lg border border-slate-200 hover:border-[#408dfb] hover:bg-blue-50/40 text-left font-medium"
                >
                  Books / Billing
                </button>
                <button
                  type="button"
                  onClick={() => { navigate('/reports'); setOpenMenu(null); }}
                  className="p-2 rounded-lg border border-slate-200 hover:border-[#408dfb] hover:bg-blue-50/40 text-left font-medium"
                >
                  Reports
                </button>
                <button
                  type="button"
                  onClick={() => { navigate('/documents'); setOpenMenu(null); }}
                  className="p-2 rounded-lg border border-slate-200 hover:border-[#408dfb] hover:bg-blue-50/40 text-left font-medium"
                >
                  Documents
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Avatar Menu */}
        <div className="relative">
          <button
            type="button"
            onClick={() => setOpenMenu(openMenu === 'avatar' ? null : 'avatar')}
            aria-label="Account menu"
            className="w-8 h-8 rounded-full bg-slate-600 hover:bg-slate-500 text-white text-xs font-semibold flex items-center justify-center"
          >
            {userInitial}
          </button>
          {openMenu === 'avatar' && (
            <div className="absolute right-0 mt-2 w-64 bg-white text-slate-800 rounded-lg shadow-xl border border-slate-200 py-2 z-50">
              <div className="px-4 py-2.5 border-b border-slate-100">
                <p className="text-xs font-semibold text-slate-900 truncate">
                  {user?.displayName || 'User'}
                </p>
                <p className="text-[11px] text-slate-500 truncate">{user?.email}</p>
                <p className="text-[11px] text-[#408dfb] font-medium mt-1">
                  Role: {role || 'Member'}
                </p>
              </div>
              {can('settings', 'view') && (
                <button
                  type="button"
                  onClick={() => {
                    navigate('/settings');
                    setOpenMenu(null);
                  }}
                  className="w-full text-left px-4 py-2 text-xs text-slate-700 hover:bg-slate-50 flex items-center gap-2"
                >
                  <UserIcon className="w-3.5 h-3.5" />
                  Profile &amp; Organization
                </button>
              )}
              <button
                type="button"
                onClick={async () => {
                  setOpenMenu(null);
                  await logout();
                }}
                className="w-full text-left px-4 py-2 text-xs text-red-600 hover:bg-red-50 flex items-center gap-2"
              >
                <LogOut className="w-3.5 h-3.5" />
                Sign Out
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
