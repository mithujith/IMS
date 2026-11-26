import React, { useState } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import {
  BarChart3,
  Boxes,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  FolderOpen,
  Home,
  Package,
  ShoppingBag,
  ShoppingCart,
  Sparkles,
  X,
} from 'lucide-react';
import { useOrg } from '../hooks/useOrg';
import { ModuleKey } from '../lib/permissions';

interface NavSubItem {
  label: string;
  to: string;
  module: ModuleKey;
}

interface NavGroup {
  key: string;
  label: string;
  icon: React.ReactNode;
  children: NavSubItem[];
}

const NAV_GROUPS: NavGroup[] = [
  {
    key: 'items',
    label: 'Items',
    icon: <Package className="w-4 h-4 shrink-0" />,
    children: [
      { label: 'Items', to: '/items', module: 'items' },
      { label: 'Item Groups', to: '/item-groups', module: 'itemGroups' },
      { label: 'Composite Items', to: '/composite-items', module: 'compositeItems' },
      { label: 'Price Lists', to: '/price-lists', module: 'priceLists' },
    ],
  },
  {
    key: 'inventory',
    label: 'Inventory',
    icon: <Boxes className="w-4 h-4 shrink-0" />,
    children: [
      { label: 'Adjustments', to: '/adjustments', module: 'adjustments' },
      { label: 'Transfer Orders', to: '/transfer-orders', module: 'transferOrders' },
      { label: 'Warehouses', to: '/warehouses', module: 'warehouses' },
      { label: 'Stock Ledger', to: '/stock-ledger', module: 'stockLedger' },
    ],
  },
  {
    key: 'sales',
    label: 'Sales',
    icon: <ShoppingCart className="w-4 h-4 shrink-0" />,
    children: [
      { label: 'Customers', to: '/customers', module: 'customers' },
      { label: 'Sales Orders', to: '/sales-orders', module: 'salesOrders' },
      { label: 'Packages', to: '/packages', module: 'packages' },
      { label: 'Shipments', to: '/shipments', module: 'shipments' },
      { label: 'Invoices', to: '/invoices', module: 'invoices' },
      { label: 'Payments Received', to: '/payments-received', module: 'paymentsReceived' },
      { label: 'Sales Returns', to: '/sales-returns', module: 'salesReturns' },
      { label: 'Credit Notes', to: '/credit-notes', module: 'creditNotes' },
    ],
  },
  {
    key: 'purchases',
    label: 'Purchases',
    icon: <ShoppingBag className="w-4 h-4 shrink-0" />,
    children: [
      { label: 'Vendors', to: '/vendors', module: 'vendors' },
      { label: 'Purchase Orders', to: '/purchase-orders', module: 'purchaseOrders' },
      { label: 'Purchase Receives', to: '/purchase-receives', module: 'purchaseReceives' },
      { label: 'Bills', to: '/bills', module: 'bills' },
      { label: 'Payments Made', to: '/payments-made', module: 'paymentsMade' },
      { label: 'Vendor Credits', to: '/vendor-credits', module: 'vendorCredits' },
    ],
  },
];

interface SidebarProps {
  collapsed: boolean;
  onToggleCollapse: () => void;
  mobileOpen: boolean;
  onCloseMobile: () => void;
}

export function Sidebar({
  collapsed,
  onToggleCollapse,
  mobileOpen,
  onCloseMobile,
}: SidebarProps) {
  const { can } = useOrg();
  const location = useLocation();
  const navigate = useNavigate();

  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({
    items: true,
    inventory: true,
    sales: true,
    purchases: true,
  });

  const toggleGroup = (key: string) => {
    setExpandedGroups((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const renderSidebarBody = (isMobile = false) => {
    const isNarrow = collapsed && !isMobile;

    return (
      <div className="flex flex-col h-full bg-white border-r border-slate-200">
        {isMobile && (
          <div className="h-14 px-4 border-b border-slate-200 flex items-center justify-between">
            <span className="font-semibold text-sm text-[#1f2a44]">A &amp; P Brothers</span>
            <button
              type="button"
              onClick={onCloseMobile}
              aria-label="Close sidebar"
              className="p-1.5 text-slate-500 hover:text-slate-900"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        <nav aria-label="Primary navigation" className="flex-1 overflow-y-auto px-2.5 py-3 space-y-1">
          <NavLink
            to="/"
            end
            onClick={isMobile ? onCloseMobile : undefined}
            className={({ isActive }) =>
              `flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-medium transition-colors whitespace-nowrap ${
                isActive
                  ? 'bg-[#408dfb] text-white shadow-sm'
                  : 'text-slate-700 hover:bg-slate-100'
              }`
            }
          >
            <Home className="w-4 h-4 shrink-0" />
            {!isNarrow && <span>Home</span>}
          </NavLink>

          {NAV_GROUPS.map((group) => {
            const visibleChildren = group.children.filter((c) => can(c.module, 'view'));
            if (visibleChildren.length === 0) return null;
            const groupActive = visibleChildren.some((c) =>
              location.pathname.startsWith(c.to)
            );
            const isOpen = expandedGroups[group.key];

            return (
              <div key={group.key} className="pt-1">
                <button
                  type="button"
                  onClick={() => {
                    if (isNarrow) {
                      navigate(visibleChildren[0].to);
                    } else {
                      toggleGroup(group.key);
                    }
                  }}
                  className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs font-medium transition-colors ${
                    groupActive
                      ? 'text-[#1f2a44] bg-slate-100'
                      : 'text-slate-700 hover:bg-slate-100'
                  }`}
                >
                  <span className="flex items-center gap-2.5 whitespace-nowrap">
                    {group.icon}
                    {!isNarrow && <span>{group.label}</span>}
                  </span>
                  {!isNarrow && (
                    <ChevronDown
                      className={`w-3.5 h-3.5 text-slate-400 transition-transform ${
                        isOpen ? 'rotate-0' : '-rotate-90'
                      }`}
                    />
                  )}
                </button>

                {!isNarrow && isOpen && (
                  <div className="mt-0.5 ml-4 pl-3 border-l border-slate-200 space-y-0.5">
                    {visibleChildren.map((child) => (
                      <NavLink
                        key={child.to}
                        to={child.to}
                        onClick={isMobile ? onCloseMobile : undefined}
                        className={({ isActive }) =>
                          `block px-2.5 py-1.5 rounded-md text-xs transition-colors whitespace-nowrap ${
                            isActive
                              ? 'bg-[#408dfb]/10 text-[#408dfb] font-semibold'
                              : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
                          }`
                        }
                      >
                        {child.label}
                      </NavLink>
                    ))}
                  </div>
                )}
              </div>
            );
          })}

          {can('reports', 'view') && (
            <NavLink
              to="/reports"
              onClick={isMobile ? onCloseMobile : undefined}
              className={({ isActive }) =>
                `flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-medium transition-colors whitespace-nowrap ${
                  isActive
                    ? 'bg-[#408dfb] text-white'
                    : 'text-slate-700 hover:bg-slate-100'
                }`
              }
            >
              <BarChart3 className="w-4 h-4 shrink-0" />
              {!isNarrow && <span>Reports</span>}
            </NavLink>
          )}

          {can('documents', 'view') && (
            <NavLink
              to="/documents"
              onClick={isMobile ? onCloseMobile : undefined}
              className={({ isActive }) =>
                `flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-medium transition-colors whitespace-nowrap ${
                  isActive
                    ? 'bg-[#408dfb] text-white'
                    : 'text-slate-700 hover:bg-slate-100'
                }`
              }
            >
              <FolderOpen className="w-4 h-4 shrink-0" />
              {!isNarrow && <span>Documents</span>}
            </NavLink>
          )}
        </nav>

        <div className="p-2.5 border-t border-slate-200 space-y-2">
          {!isNarrow && (
            <button
              type="button"
              onClick={() => {
                navigate('/?tab=getting-started');
                if (isMobile) onCloseMobile();
              }}
              className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-full bg-[#eef5ff] hover:bg-[#dcebff] text-[#2c6ed5] text-[11px] font-semibold tracking-wide transition-colors whitespace-nowrap"
            >
              <Sparkles className="w-3.5 h-3.5 shrink-0" />
              <span>LIVE GUIDED ONBOARDING</span>
            </button>
          )}

          {!isMobile && (
            <button
              type="button"
              onClick={onToggleCollapse}
              aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              className="w-full flex items-center justify-center py-1.5 text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded-md transition-colors"
            >
              {collapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
            </button>
          )}
        </div>
      </div>
    );
  };

  return (
    <>
      <aside
        className={`hidden lg:block shrink-0 transition-all duration-150 no-print ${
          collapsed ? 'w-[68px]' : 'w-[240px]'
        }`}
      >
        {renderSidebarBody(false)}
      </aside>

      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex no-print">
          <div className="w-[260px] h-full shadow-2xl">{renderSidebarBody(true)}</div>
          <button
            type="button"
            aria-label="Close navigation backdrop"
            onClick={onCloseMobile}
            className="flex-1 bg-slate-900/45"
          />
        </div>
      )}
    </>
  );
}
