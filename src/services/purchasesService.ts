import { doc, runTransaction, serverTimestamp } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';
import {
  BillDoc,
  DocumentLine,
  Item,
  PaymentMade,
  PurchaseOrder,
  PurchaseReceive,
  Vendor,
} from '../types';
import { createOrgDoc, generateId, stripUndefined, updateOrgDoc } from './firestoreList';
import { getNextDocumentNumberInTx } from './counterService';
import { writeActivityInTx } from './activityService';
import { applyStockMutationInTx } from './stockService';
import { computeWeightedAverageCost } from '../lib/calculations';
import { roundCurrency } from '../lib/formatters';

export async function createVendor(
  orgId: string,
  userId: string,
  data: Omit<Vendor, 'id' | 'organizationId' | 'createdBy' | 'createdAt' | 'updatedAt' | 'updatedBy'>
): Promise<string> {
  return createOrgDoc(orgId, 'vendors', userId, data as Record<string, unknown>);
}

export async function createPurchaseOrder(params: {
  orgId: string;
  userId: string;
  userName: string;
  data: Omit<
    PurchaseOrder,
    'id' | 'poNumber' | 'organizationId' | 'createdBy' | 'createdAt' | 'updatedAt' | 'updatedBy'
  >;
}): Promise<string> {
  const path = `organizations/${params.orgId}/purchaseOrders`;
  try {
    return await runTransaction(db, async (tx) => {
      const poNumber = await getNextDocumentNumberInTx(
        tx,
        params.orgId,
        'purchaseOrders',
        params.userId
      );
      const poId = generateId();
      tx.set(
        doc(db, `${path}/${poId}`),
        stripUndefined({
          ...params.data,
          poNumber,
          lines: params.data.lines.map((l) => ({ ...l, receivedQty: l.receivedQty ?? 0 })),
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
        module: 'Purchase Orders',
        action: 'Created Purchase Order',
        entityId: poId,
        entityName: poNumber,
        details: `${params.data.vendorName} — Rs. ${params.data.total.toFixed(2)}`,
      });

      return poId;
    });
  } catch (err) {
    if (err instanceof Error && !err.message.startsWith('{')) throw err;
    handleFirestoreError(err, OperationType.CREATE, path);
  }
}

export async function updatePOStatus(
  orgId: string,
  poId: string,
  userId: string,
  status: PurchaseOrder['status']
): Promise<void> {
  await updateOrgDoc(orgId, 'purchaseOrders', poId, userId, { status });
}

export async function receivePurchaseOrder(params: {
  orgId: string;
  userId: string;
  userName: string;
  purchaseOrderId: string;
  date: string;
  linesToReceive: { itemId: string; qtyReceived: number }[];
  notes?: string;
}): Promise<string> {
  const poRef = doc(db, `organizations/${params.orgId}/purchaseOrders/${params.purchaseOrderId}`);
  try {
    return await runTransaction(db, async (tx) => {
      const poSnap = await tx.get(poRef);
      if (!poSnap.exists()) throw new Error('Purchase Order not found.');
      const po = { id: poSnap.id, ...(poSnap.data() as Omit<PurchaseOrder, 'id'>) } as PurchaseOrder;

      const activeLines = params.linesToReceive.filter((l) => Number(l.qtyReceived) > 0);
      if (activeLines.length === 0) {
        throw new Error('Specify at least one quantity greater than zero to receive.');
      }

      const itemSnaps = await Promise.all(
        activeLines.map((l) => tx.get(doc(db, `organizations/${params.orgId}/items/${l.itemId}`)))
      );

      const receiveNumber = await getNextDocumentNumberInTx(
        tx,
        params.orgId,
        'purchaseReceives',
        params.userId
      );
      const receiveId = generateId();
      const receiveRef = doc(db, `organizations/${params.orgId}/purchaseReceives/${receiveId}`);

      const receivedMap: Record<string, number> = {};
      for (const l of activeLines) {
        receivedMap[l.itemId] = (receivedMap[l.itemId] ?? 0) + Number(l.qtyReceived);
      }

      const receiveDocLines: PurchaseReceive['lines'] = [];

      for (let i = 0; i < activeLines.length; i += 1) {
        const snap = itemSnaps[i];
        if (!snap.exists()) throw new Error('Referenced item not found.');
        const item = { id: snap.id, ...(snap.data() as Omit<Item, 'id'>) } as Item;
        const poLine = po.lines.find((pl) => pl.itemId === item.id);
        const unitCost = Number(poLine?.rate ?? item.costPrice ?? 0);
        const qty = Number(activeLines[i].qtyReceived);

        const nextWeightedCost = computeWeightedAverageCost(
          item.totalStock,
          item.costPrice,
          qty,
          unitCost
        );

        applyStockMutationInTx(
          tx,
          params.orgId,
          params.userId,
          item,
          {
            itemId: item.id,
            warehouseId: po.warehouseId,
            quantityChange: qty,
            type: 'purchase_receive',
            referenceType: 'purchaseReceive',
            referenceId: receiveId,
            referenceNumber: receiveNumber,
            unitCost,
            date: params.date,
            notes: `Received against ${po.poNumber}`,
          },
          0,
          nextWeightedCost
        );

        receiveDocLines.push({
          itemId: item.id,
          itemName: item.name,
          sku: item.sku,
          orderedQty: Number(poLine?.quantity ?? qty),
          receivedQty: qty,
          unitCost,
        });
      }

      const updatedPoLines = po.lines.map((pl) => {
        const add = receivedMap[pl.itemId] ?? 0;
        return {
          ...pl,
          receivedQty: Number(pl.receivedQty ?? 0) + add,
        };
      });

      const allReceived = updatedPoLines.every(
        (pl) => Number(pl.receivedQty ?? 0) >= Number(pl.quantity)
      );

      tx.set(
        receiveRef,
        stripUndefined({
          organizationId: params.orgId,
          receiveNumber,
          purchaseOrderId: po.id,
          poNumber: po.poNumber,
          vendorId: po.vendorId,
          vendorName: po.vendorName,
          warehouseId: po.warehouseId,
          date: params.date,
          status: 'received',
          lines: receiveDocLines,
          notes: params.notes ?? '',
          isDeleted: false,
          createdBy: params.userId,
          updatedBy: params.userId,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        })
      );

      tx.update(poRef, {
        lines: updatedPoLines,
        status: allReceived ? 'received' : 'partially_received',
        updatedBy: params.userId,
        updatedAt: serverTimestamp(),
      });

      writeActivityInTx(tx, {
        orgId: params.orgId,
        userId: params.userId,
        userName: params.userName,
        module: 'Purchase Receives',
        action: 'Received Stock',
        entityId: receiveId,
        entityName: receiveNumber,
        details: `${po.poNumber} (${receiveDocLines.length} item(s))`,
      });

      return receiveId;
    });
  } catch (err) {
    if (err instanceof Error && !err.message.startsWith('{')) throw err;
    handleFirestoreError(err, OperationType.WRITE, poRef.path);
  }
}

export async function createBill(params: {
  orgId: string;
  userId: string;
  userName: string;
  data: Omit<
    BillDoc,
    'id' | 'billNumber' | 'organizationId' | 'createdBy' | 'createdAt' | 'updatedAt' | 'updatedBy'
  >;
  fromPurchaseOrderId?: string;
}): Promise<string> {
  const path = `organizations/${params.orgId}/bills`;
  try {
    return await runTransaction(db, async (tx) => {
      const billNumber = await getNextDocumentNumberInTx(
        tx,
        params.orgId,
        'bills',
        params.userId
      );
      const billId = generateId();
      tx.set(
        doc(db, `${path}/${billId}`),
        stripUndefined({
          ...params.data,
          billNumber,
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

      if (params.fromPurchaseOrderId) {
        tx.update(doc(db, `organizations/${params.orgId}/purchaseOrders/${params.fromPurchaseOrderId}`), {
          status: 'billed',
          updatedBy: params.userId,
          updatedAt: serverTimestamp(),
        });
      }

      writeActivityInTx(tx, {
        orgId: params.orgId,
        userId: params.userId,
        userName: params.userName,
        module: 'Bills',
        action: 'Created Bill',
        entityId: billId,
        entityName: billNumber,
        details: `${params.data.vendorName} — Rs. ${params.data.total.toFixed(2)}`,
      });

      return billId;
    });
  } catch (err) {
    if (err instanceof Error && !err.message.startsWith('{')) throw err;
    handleFirestoreError(err, OperationType.CREATE, path);
  }
}

export async function recordPaymentMade(params: {
  orgId: string;
  userId: string;
  userName: string;
  vendorId: string;
  vendorName: string;
  date: string;
  mode: PaymentMade['mode'];
  referenceNumber?: string;
  allocations: { billId: string; amountApplied: number }[];
  notes?: string;
}): Promise<string> {
  const path = `organizations/${params.orgId}/paymentsMade`;
  try {
    return await runTransaction(db, async (tx) => {
      const billSnaps = await Promise.all(
        params.allocations.map((a) =>
          tx.get(doc(db, `organizations/${params.orgId}/bills/${a.billId}`))
        )
      );

      const paymentNumber = await getNextDocumentNumberInTx(
        tx,
        params.orgId,
        'paymentsMade',
        params.userId
      );
      const paymentId = generateId();
      const builtAllocations: PaymentMade['allocations'] = [];
      let totalAmount = 0;

      for (let i = 0; i < params.allocations.length; i += 1) {
        const snap = billSnaps[i];
        if (!snap.exists()) throw new Error('Bill not found.');
        const bill = { id: snap.id, ...(snap.data() as Omit<BillDoc, 'id'>) } as BillDoc;
        const applied = roundCurrency(
          Math.min(Number(params.allocations[i].amountApplied) || 0, Number(bill.balanceDue ?? 0))
        );
        if (applied <= 0) continue;

        const nextPaid = roundCurrency(Number(bill.amountPaid ?? 0) + applied);
        const nextBalance = roundCurrency(Math.max(0, Number(bill.total) - nextPaid));
        const nextStatus = nextBalance <= 0.01 ? 'paid' : 'partially_paid';

        tx.update(snap.ref, {
          amountPaid: nextPaid,
          balanceDue: nextBalance,
          status: nextStatus,
          updatedBy: params.userId,
          updatedAt: serverTimestamp(),
        });

        builtAllocations.push({
          billId: bill.id,
          billNumber: bill.billNumber,
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
          vendorId: params.vendorId,
          vendorName: params.vendorName,
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
        module: 'Payments Made',
        action: 'Recorded Vendor Payment',
        entityId: paymentId,
        entityName: paymentNumber,
        details: `${params.vendorName} — Rs. ${totalAmount.toFixed(2)}`,
      });

      return paymentId;
    });
  } catch (err) {
    if (err instanceof Error && !err.message.startsWith('{')) throw err;
    handleFirestoreError(err, OperationType.CREATE, path);
  }
}

export async function createVendorCredit(params: {
  orgId: string;
  userId: string;
  userName: string;
  vendorId: string;
  vendorName: string;
  date: string;
  lines: DocumentLine[];
  subtotal: number;
  taxTotal: number;
  total: number;
  notes?: string;
}): Promise<string> {
  const path = `organizations/${params.orgId}/vendorCredits`;
  try {
    return await runTransaction(db, async (tx) => {
      const creditNumber = await getNextDocumentNumberInTx(
        tx,
        params.orgId,
        'vendorCredits',
        params.userId
      );
      const id = generateId();
      tx.set(
        doc(db, `${path}/${id}`),
        stripUndefined({
          organizationId: params.orgId,
          creditNumber,
          vendorId: params.vendorId,
          vendorName: params.vendorName,
          date: params.date,
          status: 'open',
          lines: params.lines,
          subtotal: params.subtotal,
          taxTotal: params.taxTotal,
          total: params.total,
          remainingCredits: params.total,
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
        module: 'Vendor Credits',
        action: 'Created Vendor Credit',
        entityId: id,
        entityName: creditNumber,
      });

      return id;
    });
  } catch (err) {
    if (err instanceof Error && !err.message.startsWith('{')) throw err;
    handleFirestoreError(err, OperationType.CREATE, path);
  }
}
