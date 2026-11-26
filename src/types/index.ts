export type UserRole =
  | 'Admin'
  | 'Manager'
  | 'Sales'
  | 'Warehouse'
  | 'Accountant'
  | 'Read-only';

export type ItemUnit = 'PCS' | 'SET' | 'BOX' | 'PAIR';

export interface AuditFields {
  organizationId: string;
  createdBy: string;
  createdAt: unknown;
  updatedAt: unknown;
  updatedBy: string;
  isDeleted?: boolean;
}

export interface Attachment {
  id: string;
  name: string;
  url: string;
  size: number;
  contentType: string;
  uploadedAt: string;
  uploadedBy: string;
}

export interface CommentItem {
  id: string;
  text: string;
  userId: string;
  userName: string;
  createdAt: string;
}

export interface UserProfile {
  uid: string;
  email: string;
  displayName: string;
  photoURL?: string;
  defaultOrgId?: string;
  createdAt: unknown;
  updatedAt: unknown;
}

export interface UserMembership {
  orgId: string;
  orgName: string;
  role: UserRole;
  status: 'active' | 'inactive';
  joinedAt: unknown;
}

export interface Organization extends Omit<AuditFields, 'organizationId' | 'isDeleted'> {
  id: string;
  name: string;
  legalName?: string;
  currency: string;
  address?: string;
  city?: string;
  country?: string;
  phone?: string;
  email?: string;
  taxId?: string;
  logoUrl?: string;
  ownerId: string;
}

export interface OrgMember extends AuditFields {
  id: string;
  uid: string;
  email: string;
  displayName: string;
  role: UserRole;
  status: 'active' | 'inactive';
  inviteId?: string;
}

export interface OrgInvite extends AuditFields {
  id: string;
  email: string;
  role: UserRole;
  status: 'pending' | 'accepted' | 'revoked';
  invitedByName?: string;
}

export interface Warehouse extends AuditFields {
  id: string;
  name: string;
  code: string;
  address?: string;
  city?: string;
  phone?: string;
  isPrimary?: boolean;
  status: 'active' | 'inactive';
}

export interface Item extends AuditFields {
  id: string;
  name: string;
  sku: string;
  unit: ItemUnit | string;
  category?: string;
  brand?: string;
  manufacturer?: string;
  description?: string;
  sellingPrice: number;
  costPrice: number;
  taxId?: string;
  taxRate?: number;
  taxInclusive?: boolean;
  preferredVendorId?: string;
  openingStock: number;
  reorderLevel: number;
  reorderQty: number;
  barcode?: string;
  images: string[];
  stockByWarehouse: Record<string, number>;
  committedByWarehouse?: Record<string, number>;
  totalStock: number;
  totalCommitted?: number;
  status: 'active' | 'inactive';
  comments?: CommentItem[];
  attachments?: Attachment[];
}

export interface ItemGroup extends AuditFields {
  id: string;
  name: string;
  description?: string;
  unit: string;
  attributes: { name: string; options: string[] }[];
  itemIds: string[];
  status: 'active' | 'inactive';
}

export interface CompositeComponent {
  itemId: string;
  itemName: string;
  sku: string;
  quantity: number;
  unitCost: number;
}

export interface CompositeItem extends AuditFields {
  id: string;
  name: string;
  sku: string;
  unit: string;
  sellingPrice: number;
  costPrice: number;
  warehouseId: string;
  components: CompositeComponent[];
  assembledQty: number;
  status: 'active' | 'inactive';
}

export interface PriceList extends AuditFields {
  id: string;
  name: string;
  description?: string;
  type: 'percentage' | 'custom';
  markupOrDiscount: 'markup' | 'discount';
  percentage: number;
  customRates?: Record<string, number>;
  status: 'active' | 'inactive';
}

export type StockLedgerType =
  | 'opening'
  | 'adjustment'
  | 'transfer_in'
  | 'transfer_out'
  | 'sale_ship'
  | 'sales_return'
  | 'purchase_receive'
  | 'assembly_consume'
  | 'assembly_produce'
  | 'recalculate';

export interface StockLedgerEntry extends AuditFields {
  id: string;
  itemId: string;
  itemName?: string;
  itemSku?: string;
  warehouseId: string;
  quantityChange: number;
  type: StockLedgerType;
  referenceType: string;
  referenceId: string;
  referenceNumber?: string;
  unitCost: number;
  date: string;
  userId: string;
  notes?: string;
}

export interface InventoryAdjustment extends AuditFields {
  id: string;
  adjustmentNumber: string;
  date: string;
  mode: 'quantity' | 'value';
  warehouseId: string;
  reason: string;
  description?: string;
  status: 'draft' | 'adjusted';
  lines: {
    itemId: string;
    itemName: string;
    sku: string;
    quantityOnHand: number;
    newQuantity: number;
    quantityAdjusted: number;
    unitCost: number;
  }[];
  comments?: CommentItem[];
  attachments?: Attachment[];
}

export interface TransferOrder extends AuditFields {
  id: string;
  transferNumber: string;
  date: string;
  sourceWarehouseId: string;
  destinationWarehouseId: string;
  reason?: string;
  status: 'draft' | 'in_transit' | 'transferred';
  lines: {
    itemId: string;
    itemName: string;
    sku: string;
    quantity: number;
    unitCost: number;
  }[];
  comments?: CommentItem[];
  attachments?: Attachment[];
}

export interface Address {
  attention?: string;
  street: string;
  city: string;
  state?: string;
  zip?: string;
  country: string;
  phone?: string;
}

export interface Customer extends AuditFields {
  id: string;
  name: string;
  companyName?: string;
  email?: string;
  phone?: string;
  mobile?: string;
  paymentTerms: string;
  creditLimit: number;
  priceListId?: string;
  taxNumber?: string;
  billingAddress: Address;
  shippingAddress: Address;
  outstandingReceivables?: number;
  unusedCredits?: number;
  status: 'active' | 'inactive';
  notes?: string;
  comments?: CommentItem[];
  attachments?: Attachment[];
}

export interface Vendor extends AuditFields {
  id: string;
  name: string;
  companyName?: string;
  email?: string;
  phone?: string;
  paymentTerms: string;
  taxNumber?: string;
  billingAddress: Address;
  outstandingPayables?: number;
  unusedCredits?: number;
  status: 'active' | 'inactive';
  notes?: string;
  comments?: CommentItem[];
  attachments?: Attachment[];
}

export interface DocumentLine {
  itemId: string;
  itemName: string;
  sku: string;
  unit: string;
  warehouseId?: string;
  quantity: number;
  rate: number;
  discountType: 'percent' | 'amount';
  discountValue: number;
  taxRate: number;
  taxInclusive?: boolean;
  lineSubtotal: number;
  lineDiscount: number;
  lineTax: number;
  lineTotal: number;
}

export type SalesOrderStatus =
  | 'draft'
  | 'confirmed'
  | 'packed'
  | 'shipped'
  | 'delivered'
  | 'invoiced'
  | 'closed'
  | 'void';

export interface SalesOrder extends AuditFields {
  id: string;
  orderNumber: string;
  customerId: string;
  customerName: string;
  date: string;
  expectedShipmentDate?: string;
  referenceNumber?: string;
  channel: 'Direct' | 'Counter' | 'Wholesale' | 'Online';
  warehouseId: string;
  salesperson?: string;
  paymentTerms?: string;
  status: SalesOrderStatus;
  lines: DocumentLine[];
  subtotal: number;
  discountType: 'percent' | 'amount';
  discountValue: number;
  discountAmount: number;
  taxTotal: number;
  shippingCharges: number;
  adjustment: number;
  total: number;
  notes?: string;
  terms?: string;
  comments?: CommentItem[];
  attachments?: Attachment[];
}

export interface PackageDoc extends AuditFields {
  id: string;
  packageNumber: string;
  salesOrderId: string;
  salesOrderNumber: string;
  customerId: string;
  customerName: string;
  warehouseId: string;
  date: string;
  status: 'not_shipped' | 'shipped' | 'delivered';
  lines: {
    itemId: string;
    itemName: string;
    sku: string;
    quantity: number;
  }[];
  notes?: string;
  comments?: CommentItem[];
  attachments?: Attachment[];
}

export interface ShipmentDoc extends AuditFields {
  id: string;
  shipmentNumber: string;
  salesOrderId: string;
  salesOrderNumber: string;
  packageId: string;
  packageNumber: string;
  customerId: string;
  customerName: string;
  warehouseId: string;
  date: string;
  carrier: string;
  trackingNumber?: string;
  shippingCost?: number;
  status: 'shipped' | 'delivered';
  lines: {
    itemId: string;
    itemName: string;
    sku: string;
    quantity: number;
    unitCost: number;
  }[];
  notes?: string;
  comments?: CommentItem[];
  attachments?: Attachment[];
}

export type InvoiceStatus =
  | 'draft'
  | 'sent'
  | 'partially_paid'
  | 'paid'
  | 'overdue'
  | 'void';

export interface InvoiceDoc extends AuditFields {
  id: string;
  invoiceNumber: string;
  salesOrderId?: string;
  salesOrderNumber?: string;
  customerId: string;
  customerName: string;
  date: string;
  dueDate: string;
  paymentTerms: string;
  warehouseId: string;
  channel?: 'Direct' | 'Counter' | 'Wholesale' | 'Online';
  status: InvoiceStatus;
  lines: DocumentLine[];
  subtotal: number;
  discountType: 'percent' | 'amount';
  discountValue: number;
  discountAmount: number;
  taxTotal: number;
  shippingCharges: number;
  adjustment: number;
  total: number;
  amountPaid: number;
  balanceDue: number;
  shareToken?: string;
  notes?: string;
  terms?: string;
  comments?: CommentItem[];
  attachments?: Attachment[];
}

export interface PaymentReceived extends AuditFields {
  id: string;
  paymentNumber: string;
  customerId: string;
  customerName: string;
  date: string;
  mode: 'Cash' | 'Bank Transfer' | 'Cheque' | 'Card';
  referenceNumber?: string;
  amount: number;
  allocations: {
    invoiceId: string;
    invoiceNumber: string;
    amountApplied: number;
  }[];
  notes?: string;
  comments?: CommentItem[];
  attachments?: Attachment[];
}

export interface SalesReturn extends AuditFields {
  id: string;
  returnNumber: string;
  salesOrderId?: string;
  invoiceId?: string;
  customerId: string;
  customerName: string;
  warehouseId: string;
  date: string;
  reason: string;
  status: 'pending' | 'approved' | 'received';
  lines: {
    itemId: string;
    itemName: string;
    sku: string;
    quantity: number;
    rate: number;
    unitCost: number;
  }[];
  total: number;
  comments?: CommentItem[];
  attachments?: Attachment[];
}

export interface CreditNote extends AuditFields {
  id: string;
  creditNoteNumber: string;
  customerId: string;
  customerName: string;
  invoiceId?: string;
  salesReturnId?: string;
  warehouseId: string;
  date: string;
  status: 'open' | 'closed' | 'void';
  lines: DocumentLine[];
  subtotal: number;
  taxTotal: number;
  total: number;
  remainingCredits: number;
  restockItems: boolean;
  notes?: string;
  comments?: CommentItem[];
  attachments?: Attachment[];
}

export type PurchaseOrderStatus =
  | 'draft'
  | 'issued'
  | 'partially_received'
  | 'received'
  | 'billed'
  | 'closed'
  | 'cancelled';

export interface PurchaseOrder extends AuditFields {
  id: string;
  poNumber: string;
  vendorId: string;
  vendorName: string;
  date: string;
  expectedDeliveryDate?: string;
  warehouseId: string;
  referenceNumber?: string;
  status: PurchaseOrderStatus;
  lines: (DocumentLine & { receivedQty?: number })[];
  subtotal: number;
  discountType: 'percent' | 'amount';
  discountValue: number;
  discountAmount: number;
  taxTotal: number;
  shippingCharges: number;
  adjustment: number;
  total: number;
  notes?: string;
  terms?: string;
  comments?: CommentItem[];
  attachments?: Attachment[];
}

export interface PurchaseReceive extends AuditFields {
  id: string;
  receiveNumber: string;
  purchaseOrderId: string;
  poNumber: string;
  vendorId: string;
  vendorName: string;
  warehouseId: string;
  date: string;
  status: 'in_progress' | 'received';
  lines: {
    itemId: string;
    itemName: string;
    sku: string;
    orderedQty: number;
    receivedQty: number;
    unitCost: number;
  }[];
  notes?: string;
  comments?: CommentItem[];
  attachments?: Attachment[];
}

export type BillStatus =
  | 'draft'
  | 'open'
  | 'partially_paid'
  | 'paid'
  | 'overdue'
  | 'void';

export interface BillDoc extends AuditFields {
  id: string;
  billNumber: string;
  purchaseOrderId?: string;
  poNumber?: string;
  vendorId: string;
  vendorName: string;
  date: string;
  dueDate: string;
  paymentTerms: string;
  warehouseId: string;
  status: BillStatus;
  lines: DocumentLine[];
  subtotal: number;
  discountType: 'percent' | 'amount';
  discountValue: number;
  discountAmount: number;
  taxTotal: number;
  shippingCharges: number;
  adjustment: number;
  total: number;
  amountPaid: number;
  balanceDue: number;
  notes?: string;
  comments?: CommentItem[];
  attachments?: Attachment[];
}

export interface PaymentMade extends AuditFields {
  id: string;
  paymentNumber: string;
  vendorId: string;
  vendorName: string;
  date: string;
  mode: 'Cash' | 'Bank Transfer' | 'Cheque' | 'Card';
  referenceNumber?: string;
  amount: number;
  allocations: {
    billId: string;
    billNumber: string;
    amountApplied: number;
  }[];
  notes?: string;
  comments?: CommentItem[];
  attachments?: Attachment[];
}

export interface VendorCredit extends AuditFields {
  id: string;
  creditNumber: string;
  vendorId: string;
  vendorName: string;
  billId?: string;
  date: string;
  status: 'open' | 'closed' | 'void';
  lines: DocumentLine[];
  subtotal: number;
  taxTotal: number;
  total: number;
  remainingCredits: number;
  notes?: string;
  comments?: CommentItem[];
  attachments?: Attachment[];
}

export interface TaxRate extends AuditFields {
  id: string;
  name: string;
  rate: number;
  type: 'standard' | 'compound';
  isDefault?: boolean;
  status: 'active' | 'inactive';
}

export interface StoredDocument extends AuditFields {
  id: string;
  name: string;
  folder: string;
  url: string;
  storagePath: string;
  contentType: string;
  size: number;
  uploadedByName: string;
  tags?: string[];
}

export interface ActivityLogEntry extends AuditFields {
  id: string;
  userId: string;
  userName: string;
  module: string;
  action: string;
  entityId: string;
  entityName?: string;
  details?: string;
}

export interface NotificationItem extends AuditFields {
  id: string;
  title: string;
  message: string;
  type: 'low_stock' | 'order' | 'payment' | 'system';
  entityId?: string;
  link?: string;
  read: boolean;
}

export interface OrgSettingsDoc extends AuditFields {
  id: string;
  paymentTerms: { name: string; days: number }[];
  units: string[];
  prefixes: Record<string, string>;
  emailTemplateSubject: string;
  emailTemplateBody: string;
  pdfTermsAndConditions: string;
  pdfFooterNote: string;
  lowStockAlertsEnabled: boolean;
  dailyDigestEnabled: boolean;
}
