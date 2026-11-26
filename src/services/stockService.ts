import {
  collection,
  doc,
  getDocs,
  query,
  runTransaction,
  serverTimestamp,
  Transaction,
  where,
  writeBatch,
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';
import {
  InventoryAdjustment,
  Item,
  StockLedgerEntry,
  StockLedgerType,
  TransferOrder,
} from '../types';
import { generateId, stripUndefined } from './firestoreList';
import { getNextDocumentNumberInTx } from './counterService';
import { writeActivityInTx } from './activityService';
import { reconcileStockFromLedger } from '../lib/calculations';

export interface StockMovementInput {
  itemId: string;
  warehouseId: string;
  quantityChange: number;
  type: StockLedgerType;
  referenceType: string;
  referenceId: string;
  referenceNumber?: string;
  unitCost: number;
  date: string;
  notes?: string;
}

export function applyStockMutationInTx(
  tx: Transaction,
  orgId: string,
  userId: string,
  itemDoc: Item,
  movement: StockMovementInput,
  alsoReleaseCommitted = 0,
  newCostPrice?: number
): { newTotalStock: number; belowReorder: boolean } {
  const itemRef = doc(db, `organizations/${orgId}/items/${itemDoc.id}`);
  const ledgerId = generateId();
  const ledgerRef = doc(db, `organizations/${orgId}/stockLedger/${ledgerId}`);

  const stockByWarehouse: Record<string, number> = { ...(itemDoc.stockByWarehouse || {}) };
  const committedByWarehouse: Record<string, number> = { ...(itemDoc.committedByWarehouse || {}) };

  const prevWhStock = Number(stockByWarehouse[movement.warehouseId] ?? 0);
  const nextWhStock = prevWhStock + movement.quantityChange;
  if (nextWhStock < 0) {
    throw new Error(
      `Insufficient stock in selected warehouse for ${itemDoc.name} (${itemDoc.sku}). On hand: ${prevWhStock}, change: ${movement.quantityChange}.`
    );
  }
  stockByWarehouse[movement.warehouseId] = nextWhStock;

  if (alsoReleaseCommitted > 0) {
    const prevCommitted = Number(committedByWarehouse[movement.warehouseId] ?? 0);
    committedByWarehouse[movement.warehouseId] = Math.max(0, prevCommitted - alsoReleaseCommitted);
  }

  const totalStock = Object.values(stockByWarehouse).reduce((s, n) => s + Number(n || 0), 0);
  const totalCommitted = Object.values(committedByWarehouse).reduce((s, n) => s + Number(n || 0), 0);

  const itemPatch: Record<string, unknown> = {
    stockByWarehouse,
    committedByWarehouse,
    totalStock,
    totalCommitted,
    updatedAt: serverTimestamp(),
    updatedBy: userId,
  };
  if (typeof newCostPrice === 'number') {
    itemPatch.costPrice = Math.max(0, newCostPrice);
  }

  tx.update(itemRef, itemPatch);

  tx.set(ledgerRef, {
    organizationId: orgId,
    itemId: itemDoc.id,
    itemName: itemDoc.name.slice(0, 200),
    itemSku: itemDoc.sku.slice(0, 80),
    warehouseId: movement.warehouseId,
    quantityChange: movement.quantityChange,
    type: movement.type,
    referenceType: movement.referenceType,
    referenceId: movement.referenceId,
    referenceNumber: (movement.referenceNumber ?? '').slice(0, 80),
    unitCost: Math.max(0, Number(movement.unitCost) || 0),
    date: movement.date,
    userId,
    notes: (movement.notes ?? '').slice(0, 500),
    createdBy: userId,
    updatedBy: userId,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  return {
    newTotalStock: totalStock,
    belowReorder: totalStock <= Number(itemDoc.reorderLevel ?? 0),
  };
}

export async function createStockAdjustment(params: {
  orgId: string;
  userId: string;
  userName: string;
  date: string;
  mode: 'quantity' | 'value';
  warehouseId: string;
  reason: string;
  description?: string;
  lines: {
    itemId: string;
    newQuantity: number;
    unitCost?: number;
  }[];
  applyImmediately: boolean;
}): Promise<string> {
  const path = `organizations/${params.orgId}/adjustments`;
  try {
    return await runTransaction(db, async (tx) => {
      const itemSnaps = await Promise.all(
        params.lines.map((l) => tx.get(doc(db, `organizations/${params.orgId}/items/${l.itemId}`)))
      );

      const adjNumber = await getNextDocumentNumberInTx(tx, params.orgId, 'adjustments', params.userId);
      const adjId = generateId();
      const adjRef = doc(db, `${path}/${adjId}`);

      const builtLines: InventoryAdjustment['lines'] = [];

      for (let i = 0; i < params.lines.length; i += 1) {
        const snap = itemSnaps[i];
        if (!snap.exists()) throw new Error('Referenced item not found.');
        const item = { id: snap.id, ...(snap.data() as Omit<Item, 'id'>) } as Item;
        const onHand = Number(item.stockByWarehouse?.[params.warehouseId] ?? 0);
        const targetQty = Math.max(0, Number(params.lines[i].newQuantity));
        const delta = targetQty - onHand;
        const unitCost = Number(params.lines[i].unitCost ?? item.costPrice ?? 0);

        builtLines.push({
          itemId: item.id,
          itemName: item.name,
          sku: item.sku,
          quantityOnHand: onHand,
          newQuantity: targetQty,
          quantityAdjusted: delta,
          unitCost,
        });

        if (params.applyImmediately && delta !== 0) {
          applyStockMutationInTx(tx, params.orgId, params.userId, item, {
            itemId: item.id,
            warehouseId: params.warehouseId,
            quantityChange: delta,
            type: 'adjustment',
            referenceType: 'adjustment',
            referenceId: adjId,
            referenceNumber: adjNumber,
            unitCost,
            date: params.date,
            notes: params.reason,
          });
        }
      }

      tx.set(
        adjRef,
        stripUndefined({
          organizationId: params.orgId,
          adjustmentNumber: adjNumber,
          date: params.date,
          mode: params.mode,
          warehouseId: params.warehouseId,
          reason: params.reason,
          description: params.description ?? '',
          status: params.applyImmediately ? 'adjusted' : 'draft',
          lines: builtLines,
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
        module: 'Inventory',
        action: params.applyImmediately ? 'Adjusted Stock' : 'Drafted Adjustment',
        entityId: adjId,
        entityName: adjNumber,
        details: `${params.reason} (${builtLines.length} items)`,
      });

      return adjId;
    });
  } catch (err) {
    if (err instanceof Error && !err.message.startsWith('{')) throw err;
    handleFirestoreError(err, OperationType.WRITE, path);
  }
}

export async function createTransferOrder(params: {
  orgId: string;
  userId: string;
  userName: string;
  date: string;
  sourceWarehouseId: string;
  destinationWarehouseId: string;
  reason?: string;
  lines: { itemId: string; quantity: number }[];
  completeImmediately: boolean;
}): Promise<string> {
  if (params.sourceWarehouseId === params.destinationWarehouseId) {
    throw new Error('Source and destination warehouses must be different.');
  }
  const path = `organizations/${params.orgId}/transferOrders`;
  try {
    return await runTransaction(db, async (tx) => {
      const itemSnaps = await Promise.all(
        params.lines.map((l) => tx.get(doc(db, `organizations/${params.orgId}/items/${l.itemId}`)))
      );

      const transferNumber = await getNextDocumentNumberInTx(
        tx,
        params.orgId,
        'transferOrders',
        params.userId
      );
      const transferId = generateId();
      const transferRef = doc(db, `${path}/${transferId}`);

      const builtLines: TransferOrder['lines'] = [];

      for (let i = 0; i < params.lines.length; i += 1) {
        const snap = itemSnaps[i];
        if (!snap.exists()) throw new Error('Referenced item not found.');
        const item = { id: snap.id, ...(snap.data() as Omit<Item, 'id'>) } as Item;
        const qty = Math.max(1, Number(params.lines[i].quantity));

        builtLines.push({
          itemId: item.id,
          itemName: item.name,
          sku: item.sku,
          quantity: qty,
          unitCost: item.costPrice,
        });

        if (params.completeImmediately) {
          const outRes = applyStockMutationInTx(tx, params.orgId, params.userId, item, {
            itemId: item.id,
            warehouseId: params.sourceWarehouseId,
            quantityChange: -qty,
            type: 'transfer_out',
            referenceType: 'transferOrder',
            referenceId: transferId,
            referenceNumber: transferNumber,
            unitCost: item.costPrice,
            date: params.date,
            notes: params.reason ?? 'Inter-warehouse transfer out',
          });

          // Apply destination update using updated stockByWarehouse map
          const updatedItem: Item = {
            ...item,
            stockByWarehouse: {
              ...item.stockByWarehouse,
              [params.sourceWarehouseId]:
                Number(item.stockByWarehouse?.[params.sourceWarehouseId] ?? 0) - qty,
            },
            totalStock: outRes.newTotalStock,
          };

          applyStockMutationInTx(tx, params.orgId, params.userId, updatedItem, {
            itemId: item.id,
            warehouseId: params.destinationWarehouseId,
            quantityChange: qty,
            type: 'transfer_in',
            referenceType: 'transferOrder',
            referenceId: transferId,
            referenceNumber: transferNumber,
            unitCost: item.costPrice,
            date: params.date,
            notes: params.reason ?? 'Inter-warehouse transfer in',
          });
        }
      }

      tx.set(
        transferRef,
        stripUndefined({
          organizationId: params.orgId,
          transferNumber,
          date: params.date,
          sourceWarehouseId: params.sourceWarehouseId,
          destinationWarehouseId: params.destinationWarehouseId,
          reason: params.reason ?? '',
          status: params.completeImmediately ? 'transferred' : 'draft',
          lines: builtLines,
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
        module: 'Inventory',
        action: params.completeImmediately ? 'Transferred Stock' : 'Created Transfer Order',
        entityId: transferId,
        entityName: transferNumber,
        details: `${builtLines.length} line(s)`,
      });

      return transferId;
    });
  } catch (err) {
    if (err instanceof Error && !err.message.startsWith('{')) throw err;
    handleFirestoreError(err, OperationType.WRITE, path);
  }
}

export async function applyDraftAdjustment(params: {
  orgId: string;
  userId: string;
  userName: string;
  adjustmentId: string;
}): Promise<void> {
  const adjRef = doc(db, `organizations/${params.orgId}/adjustments/${params.adjustmentId}`);
  try {
    await runTransaction(db, async (tx) => {
      const adjSnap = await tx.get(adjRef);
      if (!adjSnap.exists()) throw new Error('Adjustment not found.');
      const adj = { id: adjSnap.id, ...(adjSnap.data() as Omit<InventoryAdjustment, 'id'>) } as InventoryAdjustment;
      if (adj.status === 'adjusted') throw new Error('Adjustment is already applied.');

      const itemSnaps = await Promise.all(
        adj.lines.map((l) => tx.get(doc(db, `organizations/${params.orgId}/items/${l.itemId}`)))
      );

      const updatedLines: InventoryAdjustment['lines'] = [];
      for (let i = 0; i < adj.lines.length; i += 1) {
        const snap = itemSnaps[i];
        if (!snap.exists()) throw new Error('Referenced item not found.');
        const item = { id: snap.id, ...(snap.data() as Omit<Item, 'id'>) } as Item;
        const onHand = Number(item.stockByWarehouse?.[adj.warehouseId] ?? 0);
        const targetQty = Math.max(0, Number(adj.lines[i].newQuantity));
        const delta = targetQty - onHand;
        const unitCost = Number(adj.lines[i].unitCost ?? item.costPrice ?? 0);

        updatedLines.push({
          ...adj.lines[i],
          quantityOnHand: onHand,
          quantityAdjusted: delta,
          unitCost,
        });

        if (delta !== 0) {
          applyStockMutationInTx(tx, params.orgId, params.userId, item, {
            itemId: item.id,
            warehouseId: adj.warehouseId,
            quantityChange: delta,
            type: 'adjustment',
            referenceType: 'adjustment',
            referenceId: adj.id,
            referenceNumber: adj.adjustmentNumber,
            unitCost,
            date: adj.date,
            notes: adj.reason,
          });
        }
      }

      tx.update(adjRef, {
        status: 'adjusted',
        lines: updatedLines,
        updatedBy: params.userId,
        updatedAt: serverTimestamp(),
      });

      writeActivityInTx(tx, {
        orgId: params.orgId,
        userId: params.userId,
        userName: params.userName,
        module: 'Inventory',
        action: 'Adjusted Stock',
        entityId: adj.id,
        entityName: adj.adjustmentNumber,
      });
    });
  } catch (err) {
    if (err instanceof Error && !err.message.startsWith('{')) throw err;
    handleFirestoreError(err, OperationType.UPDATE, adjRef.path);
  }
}

export async function completeDraftTransferOrder(params: {
  orgId: string;
  userId: string;
  userName: string;
  transferId: string;
}): Promise<void> {
  const trRef = doc(db, `organizations/${params.orgId}/transferOrders/${params.transferId}`);
  try {
    await runTransaction(db, async (tx) => {
      const trSnap = await tx.get(trRef);
      if (!trSnap.exists()) throw new Error('Transfer order not found.');
      const tr = { id: trSnap.id, ...(trSnap.data() as Omit<TransferOrder, 'id'>) } as TransferOrder;
      if (tr.status === 'transferred') throw new Error('Transfer is already completed.');

      const itemSnaps = await Promise.all(
        tr.lines.map((l) => tx.get(doc(db, `organizations/${params.orgId}/items/${l.itemId}`)))
      );

      for (let i = 0; i < tr.lines.length; i += 1) {
        const snap = itemSnaps[i];
        if (!snap.exists()) throw new Error('Referenced item not found.');
        const item = { id: snap.id, ...(snap.data() as Omit<Item, 'id'>) } as Item;
        const qty = Math.max(1, Number(tr.lines[i].quantity));

        const outRes = applyStockMutationInTx(tx, params.orgId, params.userId, item, {
          itemId: item.id,
          warehouseId: tr.sourceWarehouseId,
          quantityChange: -qty,
          type: 'transfer_out',
          referenceType: 'transferOrder',
          referenceId: tr.id,
          referenceNumber: tr.transferNumber,
          unitCost: item.costPrice,
          date: tr.date,
          notes: tr.reason ?? 'Inter-warehouse transfer out',
        });

        const updatedItem: Item = {
          ...item,
          stockByWarehouse: {
            ...item.stockByWarehouse,
            [tr.sourceWarehouseId]: Number(item.stockByWarehouse?.[tr.sourceWarehouseId] ?? 0) - qty,
          },
          totalStock: outRes.newTotalStock,
        };

        applyStockMutationInTx(tx, params.orgId, params.userId, updatedItem, {
          itemId: item.id,
          warehouseId: tr.destinationWarehouseId,
          quantityChange: qty,
          type: 'transfer_in',
          referenceType: 'transferOrder',
          referenceId: tr.id,
          referenceNumber: tr.transferNumber,
          unitCost: item.costPrice,
          date: tr.date,
          notes: tr.reason ?? 'Inter-warehouse transfer in',
        });
      }

      tx.update(trRef, {
        status: 'transferred',
        updatedBy: params.userId,
        updatedAt: serverTimestamp(),
      });

      writeActivityInTx(tx, {
        orgId: params.orgId,
        userId: params.userId,
        userName: params.userName,
        module: 'Inventory',
        action: 'Transferred Stock',
        entityId: tr.id,
        entityName: tr.transferNumber,
      });
    });
  } catch (err) {
    if (err instanceof Error && !err.message.startsWith('{')) throw err;
    handleFirestoreError(err, OperationType.UPDATE, trRef.path);
  }
}

export async function recalculateStockFromLedger(
  orgId: string,
  userId: string,
  userName: string
): Promise<{ updatedItems: number; ledgerEntriesScanned: number }> {
  const ledgerPath = `organizations/${orgId}/stockLedger`;
  const itemsPath = `organizations/${orgId}/items`;
  try {
    const ledgerSnap = await getDocs(collection(db, ledgerPath));
    const entries = ledgerSnap.docs.map((d) => d.data() as StockLedgerEntry);
    const reconciled = reconcileStockFromLedger(entries);

    const itemsSnap = await getDocs(
      query(collection(db, itemsPath), where('isDeleted', '==', false))
    );

    const batch = writeBatch(db);
    let updatedItems = 0;

    for (const itemDoc of itemsSnap.docs) {
      const target = reconciled[itemDoc.id] ?? { stockByWarehouse: {}, totalStock: 0 };
      batch.update(itemDoc.ref, {
        stockByWarehouse: target.stockByWarehouse,
        totalStock: target.totalStock,
        updatedAt: serverTimestamp(),
        updatedBy: userId,
      });
      updatedItems += 1;
    }

    const logRef = doc(db, `organizations/${orgId}/activityLog/${generateId()}`);
    batch.set(logRef, {
      organizationId: orgId,
      userId,
      userName,
      module: 'Settings',
      action: 'Recalculated Stock from Ledger',
      entityId: orgId,
      entityName: 'Stock Reconciliation',
      details: `Reconciled ${updatedItems} items across ${entries.length} ledger entries.`,
      createdBy: userId,
      updatedBy: userId,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    await batch.commit();
    return { updatedItems, ledgerEntriesScanned: entries.length };
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, ledgerPath);
  }
}
