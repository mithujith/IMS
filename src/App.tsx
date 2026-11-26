import React from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { ErrorBoundary } from './components/ErrorBoundary';
import { ToastProvider } from './hooks/useToast';
import { AuthProvider, useAuth } from './hooks/useAuth';
import { OrgProvider, useOrg } from './hooks/useOrg';
import { ToastContainer } from './components/ToastContainer';
import { LayoutShell } from './components/LayoutShell';
import { OrganizationSetupModal } from './components/OrganizationSetupModal';
import { ModuleKey } from './lib/permissions';

import { AuthPage } from './pages/AuthPage';
import { ShareInvoicePage } from './pages/ShareInvoicePage';
import { DashboardPage } from './pages/DashboardPage';
import { ItemsPage } from './pages/ItemsPage';
import { ItemDetailPage } from './pages/ItemDetailPage';
import { ItemGroupsPage } from './pages/ItemGroupsPage';
import { CompositeItemsPage } from './pages/CompositeItemsPage';
import { PriceListsPage } from './pages/PriceListsPage';
import { AdjustmentsPage } from './pages/AdjustmentsPage';
import { TransferOrdersPage } from './pages/TransferOrdersPage';
import { WarehousesPage } from './pages/WarehousesPage';
import { StockLedgerPage } from './pages/StockLedgerPage';
import { CustomersPage } from './pages/CustomersPage';
import { SalesOrdersPage } from './pages/SalesOrdersPage';
import { PackagesPage } from './pages/PackagesPage';
import { ShipmentsPage } from './pages/ShipmentsPage';
import { InvoicesPage } from './pages/InvoicesPage';
import { PaymentsReceivedPage } from './pages/PaymentsReceivedPage';
import { SalesReturnsPage } from './pages/SalesReturnsPage';
import { CreditNotesPage } from './pages/CreditNotesPage';
import { VendorsPage } from './pages/VendorsPage';
import { PurchaseOrdersPage } from './pages/PurchaseOrdersPage';
import { PurchaseReceivesPage } from './pages/PurchaseReceivesPage';
import { BillsPage } from './pages/BillsPage';
import { PaymentsMadePage } from './pages/PaymentsMadePage';
import { VendorCreditsPage } from './pages/VendorCreditsPage';
import { ReportsPage } from './pages/ReportsPage';
import { DocumentsPage } from './pages/DocumentsPage';
import { SettingsPage } from './pages/SettingsPage';

function ModuleGuard({
  module,
  children,
}: {
  module: ModuleKey;
  children: React.ReactNode;
}) {
  const { can } = useOrg();
  if (!can(module, 'view')) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-8 text-center max-w-md mx-auto mt-10">
        <h2 className="text-base font-semibold text-slate-900">Access Restricted</h2>
        <p className="text-xs text-slate-500 mt-1">
          Your current organization role does not have permission to view this module.
        </p>
      </div>
    );
  }
  return <>{children}</>;
}

function AuthenticatedApp() {
  const { user, loading: authLoading } = useAuth();
  const { orgLoading, orgError, needsOrgSetup, refreshOrg } = useOrg();

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#f7f8fa]">
        <div className="text-xs text-slate-500 font-medium">Loading A &amp; P Brothers Inventory...</div>
      </div>
    );
  }

  if (!user) {
    return <AuthPage />;
  }

  if (orgLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#f7f8fa]">
        <div className="text-xs text-slate-500 font-medium">Synchronizing organization workspace...</div>
      </div>
    );
  }

  if (needsOrgSetup) {
    return (
      <div className="min-h-screen bg-[#f7f8fa]">
        <OrganizationSetupModal />
      </div>
    );
  }

  if (orgError) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#f7f8fa] p-6">
        <div className="bg-white border border-slate-200 rounded-xl p-6 max-w-md w-full text-center shadow-sm">
          <h2 className="text-base font-semibold text-slate-900">Workspace Initialization Error</h2>
          <p className="text-xs text-slate-600 mt-2 mb-4 break-words">{orgError}</p>
          <button
            type="button"
            onClick={() => void refreshOrg()}
            className="px-4 py-2 text-xs font-medium bg-[#408dfb] text-white rounded-lg"
          >
            Retry Sync
          </button>
        </div>
      </div>
    );
  }

  return (
    <Routes>
      <Route element={<LayoutShell />}>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/items" element={<ModuleGuard module="items"><ItemsPage /></ModuleGuard>} />
        <Route path="/items/:id" element={<ModuleGuard module="items"><ItemDetailPage /></ModuleGuard>} />
        <Route path="/item-groups" element={<ModuleGuard module="itemGroups"><ItemGroupsPage /></ModuleGuard>} />
        <Route path="/composite-items" element={<ModuleGuard module="compositeItems"><CompositeItemsPage /></ModuleGuard>} />
        <Route path="/price-lists" element={<ModuleGuard module="priceLists"><PriceListsPage /></ModuleGuard>} />
        <Route path="/adjustments" element={<ModuleGuard module="adjustments"><AdjustmentsPage /></ModuleGuard>} />
        <Route path="/transfer-orders" element={<ModuleGuard module="transferOrders"><TransferOrdersPage /></ModuleGuard>} />
        <Route path="/warehouses" element={<ModuleGuard module="warehouses"><WarehousesPage /></ModuleGuard>} />
        <Route path="/stock-ledger" element={<ModuleGuard module="stockLedger"><StockLedgerPage /></ModuleGuard>} />
        <Route path="/customers" element={<ModuleGuard module="customers"><CustomersPage /></ModuleGuard>} />
        <Route path="/sales-orders" element={<ModuleGuard module="salesOrders"><SalesOrdersPage /></ModuleGuard>} />
        <Route path="/packages" element={<ModuleGuard module="packages"><PackagesPage /></ModuleGuard>} />
        <Route path="/shipments" element={<ModuleGuard module="shipments"><ShipmentsPage /></ModuleGuard>} />
        <Route path="/invoices" element={<ModuleGuard module="invoices"><InvoicesPage /></ModuleGuard>} />
        <Route path="/payments-received" element={<ModuleGuard module="paymentsReceived"><PaymentsReceivedPage /></ModuleGuard>} />
        <Route path="/sales-returns" element={<ModuleGuard module="salesReturns"><SalesReturnsPage /></ModuleGuard>} />
        <Route path="/credit-notes" element={<ModuleGuard module="creditNotes"><CreditNotesPage /></ModuleGuard>} />
        <Route path="/vendors" element={<ModuleGuard module="vendors"><VendorsPage /></ModuleGuard>} />
        <Route path="/purchase-orders" element={<ModuleGuard module="purchaseOrders"><PurchaseOrdersPage /></ModuleGuard>} />
        <Route path="/purchase-receives" element={<ModuleGuard module="purchaseReceives"><PurchaseReceivesPage /></ModuleGuard>} />
        <Route path="/bills" element={<ModuleGuard module="bills"><BillsPage /></ModuleGuard>} />
        <Route path="/payments-made" element={<ModuleGuard module="paymentsMade"><PaymentsMadePage /></ModuleGuard>} />
        <Route path="/vendor-credits" element={<ModuleGuard module="vendorCredits"><VendorCreditsPage /></ModuleGuard>} />
        <Route path="/reports" element={<ModuleGuard module="reports"><ReportsPage /></ModuleGuard>} />
        <Route path="/documents" element={<ModuleGuard module="documents"><DocumentsPage /></ModuleGuard>} />
        <Route path="/settings" element={<ModuleGuard module="settings"><SettingsPage /></ModuleGuard>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <ToastProvider>
        <AuthProvider>
          <OrgProvider>
            <BrowserRouter>
              <Routes>
                <Route path="/share/invoice/:token" element={<ShareInvoicePage />} />
                <Route path="/*" element={<AuthenticatedApp />} />
              </Routes>
              <ToastContainer />
            </BrowserRouter>
          </OrgProvider>
        </AuthProvider>
      </ToastProvider>
    </ErrorBoundary>
  );
}
