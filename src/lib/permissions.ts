import { UserRole } from '../types';

export type ModuleKey =
  | 'dashboard'
  | 'items'
  | 'itemGroups'
  | 'compositeItems'
  | 'priceLists'
  | 'adjustments'
  | 'transferOrders'
  | 'warehouses'
  | 'stockLedger'
  | 'customers'
  | 'salesOrders'
  | 'packages'
  | 'shipments'
  | 'invoices'
  | 'paymentsReceived'
  | 'salesReturns'
  | 'creditNotes'
  | 'vendors'
  | 'purchaseOrders'
  | 'purchaseReceives'
  | 'bills'
  | 'paymentsMade'
  | 'vendorCredits'
  | 'reports'
  | 'documents'
  | 'settings';

export type ActionKey = 'view' | 'create' | 'edit' | 'delete';

const WRITE_MODULES_BY_ROLE: Record<UserRole, Set<ModuleKey>> = {
  Admin: new Set([
    'dashboard', 'items', 'itemGroups', 'compositeItems', 'priceLists',
    'adjustments', 'transferOrders', 'warehouses', 'stockLedger',
    'customers', 'salesOrders', 'packages', 'shipments', 'invoices',
    'paymentsReceived', 'salesReturns', 'creditNotes',
    'vendors', 'purchaseOrders', 'purchaseReceives', 'bills',
    'paymentsMade', 'vendorCredits', 'reports', 'documents', 'settings',
  ]),
  Manager: new Set([
    'items', 'itemGroups', 'compositeItems', 'priceLists',
    'adjustments', 'transferOrders', 'warehouses', 'stockLedger',
    'customers', 'salesOrders', 'packages', 'shipments', 'invoices',
    'paymentsReceived', 'salesReturns', 'creditNotes',
    'vendors', 'purchaseOrders', 'purchaseReceives', 'bills',
    'paymentsMade', 'vendorCredits', 'documents',
  ]),
  Sales: new Set([
    'priceLists', 'customers', 'salesOrders', 'packages', 'shipments',
    'invoices', 'paymentsReceived', 'salesReturns', 'creditNotes', 'documents',
  ]),
  Warehouse: new Set([
    'items', 'itemGroups', 'compositeItems', 'adjustments', 'transferOrders',
    'warehouses', 'packages', 'shipments', 'salesReturns', 'vendors',
    'purchaseOrders', 'purchaseReceives', 'documents',
  ]),
  Accountant: new Set([
    'priceLists', 'customers', 'invoices', 'paymentsReceived', 'creditNotes',
    'vendors', 'purchaseOrders', 'bills', 'paymentsMade', 'vendorCredits', 'documents',
  ]),
  'Read-only': new Set([]),
};

const VISIBLE_MODULES_BY_ROLE: Record<UserRole, Set<ModuleKey>> = {
  Admin: WRITE_MODULES_BY_ROLE.Admin,
  Manager: new Set([
    'dashboard', 'items', 'itemGroups', 'compositeItems', 'priceLists',
    'adjustments', 'transferOrders', 'warehouses', 'stockLedger',
    'customers', 'salesOrders', 'packages', 'shipments', 'invoices',
    'paymentsReceived', 'salesReturns', 'creditNotes',
    'vendors', 'purchaseOrders', 'purchaseReceives', 'bills',
    'paymentsMade', 'vendorCredits', 'reports', 'documents',
  ]),
  Sales: new Set([
    'dashboard', 'items', 'priceLists', 'warehouses',
    'customers', 'salesOrders', 'packages', 'shipments', 'invoices',
    'paymentsReceived', 'salesReturns', 'creditNotes', 'reports', 'documents',
  ]),
  Warehouse: new Set([
    'dashboard', 'items', 'itemGroups', 'compositeItems',
    'adjustments', 'transferOrders', 'warehouses', 'stockLedger',
    'salesOrders', 'packages', 'shipments', 'salesReturns',
    'vendors', 'purchaseOrders', 'purchaseReceives', 'reports', 'documents',
  ]),
  Accountant: new Set([
    'dashboard', 'items', 'priceLists', 'customers', 'salesOrders',
    'invoices', 'paymentsReceived', 'creditNotes',
    'vendors', 'purchaseOrders', 'bills', 'paymentsMade', 'vendorCredits',
    'reports', 'documents',
  ]),
  'Read-only': new Set([
    'dashboard', 'items', 'itemGroups', 'compositeItems', 'priceLists',
    'adjustments', 'transferOrders', 'warehouses', 'stockLedger',
    'customers', 'salesOrders', 'packages', 'shipments', 'invoices',
    'paymentsReceived', 'salesReturns', 'creditNotes',
    'vendors', 'purchaseOrders', 'purchaseReceives', 'bills',
    'paymentsMade', 'vendorCredits', 'reports', 'documents',
  ]),
};

export function canPerform(
  role: UserRole | undefined | null,
  module: ModuleKey,
  action: ActionKey
): boolean {
  if (!role) return false;
  if (action === 'view') {
    return VISIBLE_MODULES_BY_ROLE[role]?.has(module) ?? false;
  }
  if (action === 'delete') {
    if (module === 'settings') return role === 'Admin';
    return role === 'Admin' || role === 'Manager';
  }
  return WRITE_MODULES_BY_ROLE[role]?.has(module) ?? false;
}
