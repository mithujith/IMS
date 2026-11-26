import { useEffect, useRef, useState } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { AlertTriangle, MailCheck } from 'lucide-react';
import { TopBar, HistoryItem } from './TopBar';
import { Sidebar } from './Sidebar';
import { RightUtilityRail } from './RightUtilityRail';
import { AiAssistantDrawer } from './AiAssistantDrawer';
import { useKeyboardShortcuts } from '../hooks/useKeyboardShortcuts';
import { useAuth } from '../hooks/useAuth';
import { useOrg } from '../hooks/useOrg';
import { useToast } from '../hooks/useToast';

const ROUTE_LABELS: Record<string, string> = {
  '/': 'Home Dashboard',
  '/items': 'Items',
  '/item-groups': 'Item Groups',
  '/composite-items': 'Composite Items',
  '/price-lists': 'Price Lists',
  '/adjustments': 'Inventory Adjustments',
  '/transfer-orders': 'Transfer Orders',
  '/warehouses': 'Warehouses',
  '/stock-ledger': 'Stock Ledger',
  '/customers': 'Customers',
  '/sales-orders': 'Sales Orders',
  '/packages': 'Packages',
  '/shipments': 'Shipments',
  '/invoices': 'Invoices',
  '/payments-received': 'Payments Received',
  '/sales-returns': 'Sales Returns',
  '/credit-notes': 'Credit Notes',
  '/vendors': 'Vendors',
  '/purchase-orders': 'Purchase Orders',
  '/purchase-receives': 'Purchase Receives',
  '/bills': 'Bills',
  '/payments-made': 'Payments Made',
  '/vendor-credits': 'Vendor Credits',
  '/reports': 'Reports',
  '/documents': 'Documents',
  '/settings': 'Settings',
};

export function LayoutShell() {
  const { user, resendVerification } = useAuth();
  const { orgWarning, refreshOrg } = useOrg();
  const { showToast } = useToast();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [recentHistory, setRecentHistory] = useState<HistoryItem[]>([]);
  const [sendingVerify, setSendingVerify] = useState(false);
  const [retryingOrg, setRetryingOrg] = useState(false);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    const label = ROUTE_LABELS[location.pathname] || location.pathname;
    setRecentHistory((prev) => {
      const filtered = prev.filter((p) => p.path !== location.pathname);
      return [{ label, path: location.pathname, visitedAt: new Date().toISOString() }, ...filtered].slice(
        0,
        10
      );
    });
  }, [location.pathname]);

  useKeyboardShortcuts({
    onSearch: () => searchInputRef.current?.focus(),
    onNew: () => {
      if (location.pathname === '/') {
        navigate('/items?new=1');
      } else {
        navigate(`${location.pathname}?new=1`);
      }
    },
    onEscape: () => {
      setMobileSidebarOpen(false);
    },
  });

  return (
    <div className="min-h-screen flex flex-col bg-[#f7f8fa] app-shell">
      <TopBar
        onOpenMobileSidebar={() => setMobileSidebarOpen(true)}
        searchInputRef={searchInputRef}
        recentHistory={recentHistory}
      />
      <div className="flex flex-1 min-h-0 app-shell-body">
        <Sidebar
          collapsed={sidebarCollapsed}
          onToggleCollapse={() => setSidebarCollapsed((c) => !c)}
          mobileOpen={mobileSidebarOpen}
          onCloseMobile={() => setMobileSidebarOpen(false)}
        />
        <main className="flex-1 min-w-0 p-4 sm:p-6 overflow-y-auto app-shell-main">
          {user && !user.emailVerified && (
            <div className="mb-4 bg-amber-50 border border-amber-200 rounded-lg px-4 py-2.5 flex flex-wrap items-center justify-between gap-2 text-xs text-amber-900 no-print">
              <span className="flex items-center gap-2">
                <MailCheck className="w-4 h-4 text-amber-600 shrink-0" />
                Verify your email address to automatically claim any pending organization team invites.
              </span>
              <button
                type="button"
                disabled={sendingVerify}
                onClick={async () => {
                  setSendingVerify(true);
                  try {
                    await resendVerification();
                    showToast('Verification email sent', 'success');
                  } catch {
                    showToast('Verification email recently sent. Check your inbox.', 'info');
                  } finally {
                    setSendingVerify(false);
                  }
                }}
                className="px-2.5 py-1 bg-white border border-amber-300 rounded font-medium hover:bg-amber-100"
              >
                {sendingVerify ? 'Sending...' : 'Resend Verification'}
              </button>
            </div>
          )}
          {orgWarning && (
            <div className="mb-4 bg-amber-50 border border-amber-200 rounded-lg px-4 py-2.5 flex flex-wrap items-center justify-between gap-2 text-xs text-amber-900 no-print">
              <span className="flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                <span>{orgWarning}</span>
              </span>
              <button
                type="button"
                disabled={retryingOrg}
                onClick={async () => {
                  setRetryingOrg(true);
                  try {
                    await refreshOrg();
                  } finally {
                    setRetryingOrg(false);
                  }
                }}
                className="px-2.5 py-1 bg-white border border-amber-300 rounded font-medium hover:bg-amber-100 disabled:opacity-60"
              >
                {retryingOrg ? 'Syncing...' : 'Retry Sync'}
              </button>
            </div>
          )}
          <Outlet />
        </main>
        <RightUtilityRail />
      </div>
      <AiAssistantDrawer />
    </div>
  );
}
