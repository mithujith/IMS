import {
  doc,
  getDoc,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';
import {
  CreditNote,
  Customer,
  DocumentLine,
  InvoiceDoc,
  Item,
  Organization,
  PackageDoc,
  PaymentReceived,
  SalesOrder,
  SalesReturn,
  ShipmentDoc,
} from '../types';
import { createOrgDoc, generateId, stripUndefined, updateOrgDoc } from './firestoreList';
import { getNextDocumentNumberInTx } from './counterService';
import { createNotification, writeActivityInTx } from './activityService';
import { applyStockMutationInTx } from './stockService';
import { validateNoOverSelling } from '../lib/calculations';
import { roundCurrency } from '../lib/formatters';

export async function createCustomer(
  orgId: string,
  userId: string,
  userName: string,
  data: Omit<Customer, 'id' | 'organizationId' | 'createdBy' | 'createdAt' | 'updatedAt' | 'updatedBy'>
): Promise<string> {
  const id = await createOrgDoc(orgId, 'customers', userId, data as Record<string, unknown>);
  return id;
}

export async function createSalesOrder(params: {
  orgId: string;
  userId: string;
  userName: string;
  data: Omit<
    SalesOrder,
    'id' | 'orderNumber' | 'organizationId' | 'createdBy' | 'createdAt' | 'updatedAt' | 'updatedBy'
  >;
  confirmImmediately?: boolean;
}): Promise<string> {
  const path = `organizations/${params.orgId}/salesOrders`;
  try {
    return await runTransaction(db, async (tx) => {
      const itemSnaps = await Promise.all(
        params.data.lines.map((l) => tx.get(doc(db, `organizations/${params.orgId}/items/${l.itemId}`)))
      );
      const itemsById: Record<string, Item> = {};
      for (const s of itemSnaps) {
        if (s.exists()) {
          itemsById[s.id] = { id: s.id, ...(s.data() as Omit<Item, 'id'>) } as Item;
        }
      }

      if (params.confirmImmediately) {
        const check = validateNoOverSelling(itemsById, params.data.lines, params.data.warehouseId);
        if (!check.ok) {
          throw new Error(check.errors.join(' '));
        }

        for (const line of params.data.lines) {
          const item = itemsById[line.itemId];
          const wh = line.warehouseId || params.data.warehouseId;
          const committedMap = { ...(item.committedByWarehouse || {}) };
          committedMap[wh] = Number(committedMap[wh] ?? 0) + line.quantity;
          const totalCommitted = Object.values(committedMap).reduce((s, n) => s + Number(n || 0), 0);
          tx.update(doc(db, `organizations/${params.orgId}/items/${item.id}`), {
            committedByWarehouse: committedMap,
            totalCommitted,
            updatedBy: params.userId,
            updatedAt: serverTimestamp(),
          });
        }
      }

      const orderNumber = await getNextDocumentNumberInTx(
        tx,
        params.orgId,
        'salesOrders',
        params.userId
      );
      const orderId = generateId();
      tx.set(
        doc(db, `${path}/${orderId}`),
        stripUndefined({
          ...params.data,
          orderNumber,
          status: params.confirmImmediately ? 'confirmed' : params.data.status || 'draft',
          organizationId: params.orgId,
          isDeleted: false,
          createdBy: params.userId,
          updatedBy: params.userId,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        })
      );

      writeActivityInTx(tx, {
        orgId: params.orgId,
        userId: params.userId,
        userName: params.userName,
        module: 'Sales Orders',
        action: params.confirmImmediately ? 'Created & Confirmed SO' : 'Created Sales Order',
        entityId: orderId,
        entityName: orderNumber,
        details: `${params.data.customerName} — Rs. ${params.data.total.toFixed(2)}`,
      });

      return orderId;
    });
  } catch (err) {
    if (err instanceof Error && !err.message.startsWith('{')) throw err;
    handleFirestoreError(err, OperationType.CREATE, path);
  }
}

export async function confirmSalesOrder(params: {
  orgId: string;
  userId: string;
  userName: string;
  salesOrderId: string;
}): Promise<void> {
  const soRef = doc(db, `organizations/${params.orgId}/salesOrders/${params.salesOrderId}`);
  try {
    await runTransaction(db, async (tx) => {
      const soSnap = await tx.get(soRef);
      if (!soSnap.exists()) throw new Error('Sales Order not found.');
      const so = { id: soSnap.id, ...(soSnap.data() as Omit<SalesOrder, 'id'>) } as SalesOrder;
      if (so.status !== 'draft') {
        throw new Error(`Sales Order ${so.orderNumber} is already ${so.status}.`);
      }

      const itemSnaps = await Promise.all(
        so.lines.map((l) => tx.get(doc(db, `organizations/${params.orgId}/items/${l.itemId}`)))
      );
      const itemsById: Record<string, Item> = {};
      for (const s of itemSnaps) {
        if (s.exists()) {
          itemsById[s.id] = { id: s.id, ...(s.data() as Omit<Item, 'id'>) } as Item;
        }
      }

      const check = validateNoOverSelling(itemsById, so.lines, so.warehouseId);
      if (!check.ok) throw new Error(check.errors.join(' '));

      for (const line of so.lines) {
        const item = itemsById[line.itemId];
        const wh = line.warehouseId || so.warehouseId;
        const committedMap = { ...(item.committedByWarehouse || {}) };
        committedMap[wh] = Number(committedMap[wh] ?? 0) + line.quantity;
        const totalCommitted = Object.values(committedMap).reduce((s, n) => s + Number(n || 0), 0);
        tx.update(doc(db, `organizations/${params.orgId}/items/${item.id}`), {
          committedByWarehouse: committedMap,
          totalCommitted,
          updatedBy: params.userId,
          updatedAt: serverTimestamp(),
        });
      }

      tx.update(soRef, {
        status: 'confirmed',
        updatedBy: params.userId,
        updatedAt: serverTimestamp(),
      });

      writeActivityInTx(tx, {
        orgId: params.orgId,
        userId: params.userId,
        userName: params.userName,
        module: 'Sales Orders',
        action: 'Confirmed Sales Order',
        entityId: so.id,
        entityName: so.orderNumber,
      });
    });
  } catch (err) {
    if (err instanceof Error && !err.message.startsWith('{')) throw err;
    handleFirestoreError(err, OperationType.UPDATE, soRef.path);
  }
}

export async function voidSalesOrder(params: {
  orgId: string;
  userId: string;
  userName: string;
  salesOrderId: string;
}): Promise<void> {
  const soRef = doc(db, `organizations/${params.orgId}/salesOrders/${params.salesOrderId}`);
  try {
    await runTransaction(db, async (tx) => {
      const soSnap = await tx.get(soRef);
      if (!soSnap.exists()) throw new Error('Sales Order not found.');
      const so = { id: soSnap.id, ...(soSnap.data() as Omit<SalesOrder, 'id'>) } as SalesOrder;
      if (so.status === 'void') return;
      if (['shipped', 'delivered', 'invoiced'].includes(so.status)) {
        throw new Error(`Cannot void a sales order that is already ${so.status}.`);
      }

      if (['confirmed', 'packed'].includes(so.status)) {
        const itemSnaps = await Promise.all(
          so.lines.map((l) => tx.get(doc(db, `organizations/${params.orgId}/items/${l.itemId}`)))
        );
        for (let i = 0; i < so.lines.length; i += 1) {
          const snap = itemSnaps[i];
          if (!snap.exists()) continue;
          const item = { id: snap.id, ...(snap.data() as Omit<Item, 'id'>) } as Item;
          const wh = so.lines[i].warehouseId || so.warehouseId;
          const committedMap = { ...(item.committedByWarehouse || {}) };
          committedMap[wh] = Math.max(0, Number(committedMap[wh] ?? 0) - so.lines[i].quantity);
          const totalCommitted = Object.values(committedMap).reduce((s, n) => s + Number(n || 0), 0);
          tx.update(snap.ref, {
            committedByWarehouse: committedMap,
            totalCommitted,
            updatedBy: params.userId,
            updatedAt: serverTimestamp(),
          });
        }
      }

      tx.update(soRef, {
        status: 'void',
        updatedBy: params.userId,
        updatedAt: serverTimestamp(),
      });

      writeActivityInTx(tx, {
        orgId: params.orgId,
        userId: params.userId,
        userName: params.userName,
        module: 'Sales Orders',
        action: 'Voided Sales Order',
        entityId: so.id,
        entityName: so.orderNumber,
      });
    });
  } catch (err) {
    if (err instanceof Error && !err.message.startsWith('{')) throw err;
    handleFirestoreError(err, OperationType.UPDATE, soRef.path);
  }
}

export async function createPackageFromSO(params: {
  orgId: string;
  userId: string;
  userName: string;
  salesOrderId: string;
  date: string;
  notes?: string;
}): Promise<string> {
  const soRef = doc(db, `organizations/${params.orgId}/salesOrders/${params.salesOrderId}`);
  try {
    return await runTransaction(db, async (tx) => {
      const soSnap = await tx.get(soRef);
      if (!soSnap.exists()) throw new Error('Sales Order not found.');
      const so = { id: soSnap.id, ...(soSnap.data() as Omit<SalesOrder, 'id'>) } as SalesOrder;
      if (!['confirmed', 'packed'].includes(so.status)) {
        throw new Error('Sales Order must be confirmed before packing.');
      }

      const packageNumber = await getNextDocumentNumberInTx(
        tx,
        params.orgId,
        'packages',
        params.userId
      );
      const packageId = generateId();
      const pkgRef = doc(db, `organizations/${params.orgId}/packages/${packageId}`);

      tx.set(
        pkgRef,
        stripUndefined({
          organizationId: params.orgId,
          packageNumber,
          salesOrderId: so.id,
          salesOrderNumber: so.orderNumber,
          customerId: so.customerId,
          customerName: so.customerName,
          warehouseId: so.warehouseId,
          date: params.date,
          status: 'not_shipped',
          lines: so.lines.map((l) => ({
            itemId: l.itemId,
            itemName: l.itemName,
            sku: l.sku,
            quantity: l.quantity,
          })),
          notes: params.notes ?? '',
          isDeleted: false,
          createdBy: params.userId,
          updatedBy: params.userId,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        })
      );

      tx.update(soRef, {
        status: 'packed',
        updatedBy: params.userId,
        updatedAt: serverTimestamp(),
      });

      writeActivityInTx(tx, {
        orgId: params.orgId,
        userId: params.userId,
        userName: params.userName,
        module: 'Packages',
        action: 'Created Package',
        entityId: packageId,
        entityName: packageNumber,
        details: `For ${so.orderNumber}`,
      });

      return packageId;
    });
  } catch (err) {
    if (err instanceof Error && !err.message.startsWith('{')) throw err;
    handleFirestoreError(err, OperationType.WRITE, soRef.path);
  }
}

export async function createShipmentFromPackage(params: {
  orgId: string;
  userId: string;
  userName: string;
  packageId: string;
  date: string;
  carrier: string;
  trackingNumber?: string;
  shippingCost?: number;
  notes?: string;
}): Promise<string> {
  const pkgRef = doc(db, `organizations/${params.orgId}/packages/${params.packageId}`);
  const lowStockAlerts: { itemId: string; name: string; sku: string; stock: number; reorderLevel: number }[] = [];

  try {
    const shipmentId = await runTransaction(db, async (tx) => {
      const pkgSnap = await tx.get(pkgRef);
      if (!pkgSnap.exists()) throw new Error('Package not found.');
      const pkg = { id: pkgSnap.id, ...(pkgSnap.data() as Omit<PackageDoc, 'id'>) } as PackageDoc;
      if (pkg.status !== 'not_shipped') {
        throw new Error(`Package ${pkg.packageNumber} has already been shipped.`);
      }

      const soRef = doc(db, `organizations/${params.orgId}/salesOrders/${pkg.salesOrderId}`);
      const soSnap = await tx.get(soRef);
      const itemSnaps = await Promise.all(
        pkg.lines.map((l) => tx.get(doc(db, `organizations/${params.orgId}/items/${l.itemId}`)))
      );

      const itemsById: Record<string, Item> = {};
      for (const s of itemSnaps) {
        if (s.exists()) {
          itemsById[s.id] = { id: s.id, ...(s.data() as Omit<Item, 'id'>) } as Item;
        }
      }

      const check = validateNoOverSelling(itemsById, pkg.lines, pkg.warehouseId, true);
      if (!check.ok) throw new Error(check.errors.join(' '));

      const shipmentNumber = await getNextDocumentNumberInTx(
        tx,
        params.orgId,
        'shipments',
        params.userId
      );
      const shpId = generateId();
      const shpRef = doc(db, `organizations/${params.orgId}/shipments/${shpId}`);

      const shipmentLines: ShipmentDoc['lines'] = [];

      for (const line of pkg.lines) {
        const item = itemsById[line.itemId];
        const res = applyStockMutationInTx(
          tx,
          params.orgId,
          params.userId,
          item,
          {
            itemId: item.id,
            warehouseId: pkg.warehouseId,
            quantityChange: -line.quantity,
            type: 'sale_ship',
            referenceType: 'shipment',
            referenceId: shpId,
            referenceNumber: shipmentNumber,
            unitCost: item.costPrice,
            date: params.date,
            notes: `Shipped via ${params.carrier}`,
          },
          line.quantity
        );
        if (res.belowReorder) {
          lowStockAlerts.push({
            itemId: item.id,
            name: item.name,
            sku: item.sku,
            stock: res.newTotalStock,
            reorderLevel: item.reorderLevel,
          });
        }
        shipmentLines.push({
          itemId: item.id,
          itemName: item.name,
          sku: item.sku,
          quantity: line.quantity,
          unitCost: item.costPrice,
        });
      }

      tx.set(
        shpRef,
        stripUndefined({
          organizationId: params.orgId,
          shipmentNumber,
          salesOrderId: pkg.salesOrderId,
          salesOrderNumber: pkg.salesOrderNumber,
          packageId: pkg.id,
          packageNumber: pkg.packageNumber,
          customerId: pkg.customerId,
          customerName: pkg.customerName,
          warehouseId: pkg.warehouseId,
          date: params.date,
          carrier: params.carrier,
          trackingNumber: params.trackingNumber ?? '',
          shippingCost: Number(params.shippingCost ?? 0),
          status: 'shipped',
          lines: shipmentLines,
          notes: params.notes ?? '',
          isDeleted: false,
          createdBy: params.userId,
          updatedBy: params.userId,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        })
      );

      tx.update(pkgRef, {
        status: 'shipped',
        updatedBy: params.userId,
        updatedAt: serverTimestamp(),
      });

      if (soSnap.exists()) {
        tx.update(soRef, {
          status: 'shipped',
          updatedBy: params.userId,
          updatedAt: serverTimestamp(),
        });
      }

      writeActivityInTx(tx, {
        orgId: params.orgId,
        userId: params.userId,
        userName: params.userName,
        module: 'Shipments',
        action: 'Shipped Package',
        entityId: shpId,
        entityName: shipmentNumber,
        details: `${pkg.salesOrderNumber} via ${params.carrier}`,
      });

      return shpId;
    });

    for (const alert of lowStockAlerts) {
      await createNotification({
        orgId: params.orgId,
        userId: params.userId,
        title: `Low Stock Alert: ${alert.sku}`,
        message: `${alert.name} dropped to ${alert.stock} (reorder level: ${alert.reorderLevel}).`,
        type: 'low_stock',
        entityId: alert.itemId,
        link: `/items/${alert.itemId}`,
      });
    }

    return shipmentId;
  } catch (err) {
    if (err instanceof Error && !err.message.startsWith('{')) throw err;
    handleFirestoreError(err, OperationType.WRITE, pkgRef.path);
  }
}

export async function markShipmentDelivered(params: {
  orgId: string;
  userId: string;
  userName: string;
  shipmentId: string;
}): Promise<void> {
  const shpRef = doc(db, `organizations/${params.orgId}/shipments/${params.shipmentId}`);
  try {
    await runTransaction(db, async (tx) => {
      const shpSnap = await tx.get(shpRef);
      if (!shpSnap.exists()) throw new Error('Shipment not found.');
      const shp = { id: shpSnap.id, ...(shpSnap.data() as Omit<ShipmentDoc, 'id'>) } as ShipmentDoc;

      tx.update(shpRef, {
        status: 'delivered',
        updatedBy: params.userId,
        updatedAt: serverTimestamp(),
      });
      if (shp.packageId) {
        tx.update(doc(db, `organizations/${params.orgId}/packages/${shp.packageId}`), {
          status: 'delivered',
          updatedBy: params.userId,
          updatedAt: serverTimestamp(),
        });
      }
      if (shp.salesOrderId) {
        tx.update(doc(db, `organizations/${params.orgId}/salesOrders/${shp.salesOrderId}`), {
          status: 'delivered',
          updatedBy: params.userId,
          updatedAt: serverTimestamp(),
        });
      }

      writeActivityInTx(tx, {
        orgId: params.orgId,
        userId: params.userId,
        userName: params.userName,
        module: 'Shipments',
        action: 'Marked Delivered',
        entityId: shp.id,
        entityName: shp.shipmentNumber,
      });
    });
  } catch (err) {
    if (err instanceof Error && !err.message.startsWith('{')) throw err;
    handleFirestoreError(err, OperationType.UPDATE, shpRef.path);
  }
}

export async function createInvoice(params: {
  orgId: string;
  userId: string;
  userName: string;
  data: Omit<
    InvoiceDoc,
    'id' | 'invoiceNumber' | 'organizationId' | 'createdBy' | 'createdAt' | 'updatedAt' | 'updatedBy'
  >;
  fromSalesOrderId?: string;
}): Promise<string> {
  const path = `organizations/${params.orgId}/invoices`;
  try {
    return await runTransaction(db, async (tx) => {
      const invoiceNumber = await getNextDocumentNumberInTx(
        tx,
        params.orgId,
        'invoices',
        params.userId
      );
      const invoiceId = generateId();
      tx.set(
        doc(db, `${path}/${invoiceId}`),
        stripUndefined({
          ...params.data,
          invoiceNumber,
          amountPaid: 0,
          balanceDue: params.data.total,
          organizationId: params.orgId,
          isDeleted: false,
          createdBy: params.userId,
          updatedBy: params.userId,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        })
      );

      if (params.fromSalesOrderId) {
        tx.update(doc(db, `organizations/${params.orgId}/salesOrders/${params.fromSalesOrderId}`), {
          status: 'invoiced',
          updatedBy: params.userId,
          updatedAt: serverTimestamp(),
        });
      }

      writeActivityInTx(tx, {
        orgId: params.orgId,
        userId: params.userId,
        userName: params.userName,
        module: 'Invoices',
        action: 'Created Invoice',
        entityId: invoiceId,
        entityName: invoiceNumber,
        details: `${params.data.customerName} — Rs. ${params.data.total.toFixed(2)}`,
      });

      return invoiceId;
    });
  } catch (err) {
    if (err instanceof Error && !err.message.startsWith('{')) throw err;
    handleFirestoreError(err, OperationType.CREATE, path);
  }
}

export async function createInvoiceShareLink(params: {
  org: Organization;
  invoice: InvoiceDoc;
  userId: string;
}): Promise<string> {
  const token = params.invoice.shareToken || `${generateId()}${generateId().slice(0, 8)}`;
  try {
    await setDoc(
      doc(db, `shareLinks/${token}`),
      stripUndefined({
        token,
        orgId: params.org.id,
        orgName: params.org.name,
        orgAddress: [params.org.address, params.org.city, params.org.country].filter(Boolean).join(', '),
        orgPhone: params.org.phone ?? '',
        orgEmail: params.org.email ?? '',
        orgLogoUrl: params.org.logoUrl ?? '',
        invoiceId: params.invoice.id,
        invoiceNumber: params.invoice.invoiceNumber,
        invoiceData: {
          invoiceNumber: params.invoice.invoiceNumber,
          customerName: params.invoice.customerName,
          date: params.invoice.date,
          dueDate: params.invoice.dueDate,
          paymentTerms: params.invoice.paymentTerms,
          status: params.invoice.status,
          lines: params.invoice.lines,
          subtotal: params.invoice.subtotal,
          discountAmount: params.invoice.discountAmount,
          taxTotal: params.invoice.taxTotal,
          shippingCharges: params.invoice.shippingCharges,
          adjustment: params.invoice.adjustment,
          total: params.invoice.total,
          amountPaid: params.invoice.amountPaid,
          balanceDue: params.invoice.balanceDue,
          notes: params.invoice.notes ?? '',
          terms: params.invoice.terms ?? '',
        },
        createdBy: params.userId,
        createdAt: serverTimestamp(),
      })
    );
    await updateDoc(doc(db, `organizations/${params.org.id}/invoices/${params.invoice.id}`), {
      shareToken: token,
      updatedBy: params.userId,
      updatedAt: serverTimestamp(),
    });
    return token;
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `shareLinks/${token}`);
  }
}

export async function recordPaymentReceived(params: {
  orgId: string;
  userId: string;
  userName: string;
  customerId: string;
  customerName: string;
  date: string;
  mode: PaymentReceived['mode'];
  referenceNumber?: string;
  allocations: { invoiceId: string; amountApplied: number }[];
  notes?: string;
}): Promise<string> {
  const path = `organizations/${params.orgId}/paymentsReceived`;
  try {
    return await runTransaction(db, async (tx) => {
      const invSnaps = await Promise.all(
        params.allocations.map((a) =>
          tx.get(doc(db, `organizations/${params.orgId}/invoices/${a.invoiceId}`))
        )
      );

      const paymentNumber = await getNextDocumentNumberInTx(
        tx,
        params.orgId,
        'paymentsReceived',
        params.userId
      );
      const paymentId = generateId();
      const builtAllocations: PaymentReceived['allocations'] = [];
      let totalAmount = 0;

      for (let i = 0; i < params.allocations.length; i += 1) {
        const snap = invSnaps[i];
        if (!snap.exists()) throw new Error('Invoice not found.');
        const inv = { id: snap.id, ...(snap.data() as Omit<InvoiceDoc, 'id'>) } as InvoiceDoc;
        const applied = roundCurrency(
          Math.min(Number(params.allocations[i].amountApplied) || 0, Number(inv.balanceDue ?? 0))
        );
        if (applied <= 0) continue;

        const nextPaid = roundCurrency(Number(inv.amountPaid ?? 0) + applied);
        const nextBalance = roundCurrency(Math.max(0, Number(inv.total) - nextPaid));
        const nextStatus = nextBalance <= 0.01 ? 'paid' : 'partially_paid';

        tx.update(snap.ref, {
          amountPaid: nextPaid,
          balanceDue: nextBalance,
          status: nextStatus,
          updatedBy: params.userId,
          updatedAt: serverTimestamp(),
        });

        builtAllocations.push({
          invoiceId: inv.id,
          invoiceNumber: inv.invoiceNumber,
          amountApplied: applied,
        });
        totalAmount = roundCurrency(totalAmount + applied);
      }

      if (totalAmount <= 0) {
        throw new Error('Payment amount must be greater than zero.');
      }

      tx.set(
        doc(db, `${path}/${paymentId}`),
        stripUndefined({
          organizationId: params.orgId,
          paymentNumber,
          customerId: params.customerId,
          customerName: params.customerName,
          date: params.date,
          mode: params.mode,
          referenceNumber: params.referenceNumber ?? '',
          amount: totalAmount,
          allocations: builtAllocations,
          notes: params.notes ?? '',
          isDeleted: false,
          createdBy: params.userId,
          updatedBy: params.userId,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        })
      );

      writeActivityInTx(tx, {
        orgId: params.orgId,
        userId: params.userId,
        userName: params.userName,
        module: 'Payments Received',
        action: 'Recorded Payment',
        entityId: paymentId,
        entityName: paymentNumber,
        details: `${params.customerName} — Rs. ${totalAmount.toFixed(2)}`,
      });

      return paymentId;
    });
  } catch (err) {
    if (err instanceof Error && !err.message.startsWith('{')) throw err;
    handleFirestoreError(err, OperationType.CREATE, path);
  }
}

export async function createSalesReturnAndRestock(params: {
  orgId: string;
  userId: string;
  userName: string;
  customerId: string;
  customerName: string;
  warehouseId: string;
  date: string;
  reason: string;
  salesOrderId?: string;
  invoiceId?: string;
  lines: { itemId: string; quantity: number; rate: number }[];
}): Promise<string> {
  const path = `organizations/${params.orgId}/salesReturns`;
  try {
    return await runTransaction(db, async (tx) => {
      const itemSnaps = await Promise.all(
        params.lines.map((l) => tx.get(doc(db, `organizations/${params.orgId}/items/${l.itemId}`)))
      );

      const returnNumber = await getNextDocumentNumberInTx(
        tx,
        params.orgId,
        'salesReturns',
        params.userId
      );
      const returnId = generateId();
      const builtLines: SalesReturn['lines'] = [];
      let total = 0;

      for (let i = 0; i < params.lines.length; i += 1) {
        const snap = itemSnaps[i];
        if (!snap.exists()) throw new Error('Item not found.');
        const item = { id: snap.id, ...(snap.data() as Omit<Item, 'id'>) } as Item;
        const qty = Math.max(1, Number(params.lines[i].quantity));
        const rate = Number(params.lines[i].rate);
        total = roundCurrency(total + qty * rate);

        builtLines.push({
          itemId: item.id,
          itemName: item.name,
          sku: item.sku,
          quantity: qty,
          rate,
          unitCost: item.costPrice,
        });

        applyStockMutationInTx(tx, params.orgId, params.userId, item, {
          itemId: item.id,
          warehouseId: params.warehouseId,
          quantityChange: qty,
          type: 'sales_return',
          referenceType: 'salesReturn',
          referenceId: returnId,
          referenceNumber: returnNumber,
          unitCost: item.costPrice,
          date: params.date,
          notes: params.reason,
        });
      }

      tx.set(
        doc(db, `${path}/${returnId}`),
        stripUndefined({
          organizationId: params.orgId,
          returnNumber,
          salesOrderId: params.salesOrderId ?? '',
          invoiceId: params.invoiceId ?? '',
          customerId: params.customerId,
          customerName: params.customerName,
          warehouseId: params.warehouseId,
          date: params.date,
          reason: params.reason,
          status: 'received',
          lines: builtLines,
          total,
          isDeleted: false,
          createdBy: params.userId,
          updatedBy: params.userId,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        })
      );

      writeActivityInTx(tx, {
        orgId: params.orgId,
        userId: params.userId,
        userName: params.userName,
        module: 'Sales Returns',
        action: 'Processed Sales Return',
        entityId: returnId,
        entityName: returnNumber,
        details: `Restocked ${builtLines.length} item(s)`,
      });

      return returnId;
    });
  } catch (err) {
    if (err instanceof Error && !err.message.startsWith('{')) throw err;
    handleFirestoreError(err, OperationType.CREATE, path);
  }
}

export async function createCreditNote(params: {
  orgId: string;
  userId: string;
  userName: string;
  customerId: string;
  customerName: string;
  warehouseId: string;
  date: string;
  lines: DocumentLine[];
  subtotal: number;
  taxTotal: number;
  total: number;
  restockItems: boolean;
  notes?: string;
}): Promise<string> {
  const path = `organizations/${params.orgId}/creditNotes`;
  try {
    return await runTransaction(db, async (tx) => {
      const itemSnaps = params.restockItems
        ? await Promise.all(
            params.lines.map((l) => tx.get(doc(db, `organizations/${params.orgId}/items/${l.itemId}`)))
          )
        : [];

      const creditNoteNumber = await getNextDocumentNumberInTx(
        tx,
        params.orgId,
        'creditNotes',
        params.userId
      );
      const cnId = generateId();

      if (params.restockItems) {
        for (let i = 0; i < params.lines.length; i += 1) {
          const snap = itemSnaps[i];
          if (!snap?.exists()) continue;
          const item = { id: snap.id, ...(snap.data() as Omit<Item, 'id'>) } as Item;
          applyStockMutationInTx(tx, params.orgId, params.userId, item, {
            itemId: item.id,
            warehouseId: params.warehouseId,
            quantityChange: params.lines[i].quantity,
            type: 'sales_return',
            referenceType: 'creditNote',
            referenceId: cnId,
            referenceNumber: creditNoteNumber,
            unitCost: item.costPrice,
            date: params.date,
            notes: 'Restocked via Credit Note',
          });
        }
      }

      tx.set(
        doc(db, `${path}/${cnId}`),
        stripUndefined({
          organizationId: params.orgId,
          creditNoteNumber,
          customerId: params.customerId,
          customerName: params.customerName,
          warehouseId: params.warehouseId,
          date: params.date,
          status: 'open',
          lines: params.lines,
          subtotal: params.subtotal,
          taxTotal: params.taxTotal,
          total: params.total,
          remainingCredits: params.total,
          restockItems: params.restockItems,
          notes: params.notes ?? '',
          isDeleted: false,
          createdBy: params.userId,
          updatedBy: params.userId,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        })
      );

      writeActivityInTx(tx, {
        orgId: params.orgId,
        userId: params.userId,
        userName: params.userName,
        module: 'Credit Notes',
        action: 'Created Credit Note',
        entityId: cnId,
        entityName: creditNoteNumber,
      });

      return cnId;
    });
  } catch (err) {
    if (err instanceof Error && !err.message.startsWith('{')) throw err;
    handleFirestoreError(err, OperationType.CREATE, path);
  }
}

export async function updateInvoiceStatus(
  orgId: string,
  invoiceId: string,
  userId: string,
  status: InvoiceDoc['status']
): Promise<void> {
  await updateOrgDoc(orgId, 'invoices', invoiceId, userId, { status });
}

export async function fetchShareLink(token: string): Promise<Record<string, unknown> | null> {
  try {
    const snap = await getDoc(doc(db, `shareLinks/${token}`));
    if (!snap.exists()) return null;
    return snap.data() as Record<string, unknown>;
  } catch (err) {
    handleFirestoreError(err, OperationType.GET, `shareLinks/${token}`);
  }
}
