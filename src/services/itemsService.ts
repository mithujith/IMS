import {
  collection,
  doc,
  getDocs,
  query,
  runTransaction,
  serverTimestamp,
  where,
} from 'firebase/firestore';
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import { db, storage, handleFirestoreError, OperationType } from '../firebase';
import { CompositeItem, Item, ItemGroup, PriceList, Warehouse } from '../types';
import { createOrgDoc, generateId, stripUndefined, updateOrgDoc } from './firestoreList';
import { applyStockMutationInTx } from './stockService';
import { writeActivityInTx } from './activityService';
import { formatDateISO } from '../lib/formatters';

export async function isSkuUnique(
  orgId: string,
  sku: string,
  excludeItemId?: string
): Promise<boolean> {
  const trimmed = sku.trim();
  if (!trimmed) return false;
  const path = `organizations/${orgId}/items`;
  try {
    const q = query(collection(db, path), where('sku', '==', trimmed));
    const snap = await getDocs(q);
    return snap.docs.every((d) => d.id === excludeItemId || d.data().isDeleted === true);
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, path);
  }
}

export async function uploadItemImage(
  orgId: string,
  itemId: string,
  file: File
): Promise<string> {
  if (file.size > 10 * 1024 * 1024) {
    throw new Error('Image must be under 10 MB.');
  }
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
  const storageRef = ref(storage, `organizations/${orgId}/items/${itemId}/${Date.now()}_${safeName}`);
  await uploadBytes(storageRef, file, { contentType: file.type });
  return getDownloadURL(storageRef);
}

export async function createItemWithOpeningStock(params: {
  orgId: string;
  userId: string;
  userName: string;
  warehouseId: string;
  data: Omit<
    Item,
    'id' | 'organizationId' | 'createdBy' | 'createdAt' | 'updatedAt' | 'updatedBy' | 'stockByWarehouse' | 'totalStock' | 'committedByWarehouse' | 'totalCommitted'
  >;
}): Promise<string> {
  const unique = await isSkuUnique(params.orgId, params.data.sku);
  if (!unique) {
    throw new Error(`SKU "${params.data.sku}" already exists in this organization.`);
  }

  const itemId = generateId();
  const path = `organizations/${params.orgId}/items/${itemId}`;
  const openingQty = Math.max(0, Number(params.data.openingStock) || 0);
  const stockByWarehouse: Record<string, number> =
    openingQty > 0 && params.warehouseId ? { [params.warehouseId]: openingQty } : {};

  try {
    await runTransaction(db, async (tx) => {
      const itemRef = doc(db, path);
      tx.set(
        itemRef,
        stripUndefined({
          ...params.data,
          sku: params.data.sku.trim(),
          openingStock: openingQty,
          stockByWarehouse,
          committedByWarehouse: {},
          totalStock: openingQty,
          totalCommitted: 0,
          organizationId: params.orgId,
          isDeleted: false,
          createdBy: params.userId,
          updatedBy: params.userId,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        })
      );

      if (openingQty > 0 && params.warehouseId) {
        const ledgerRef = doc(db, `organizations/${params.orgId}/stockLedger/${generateId()}`);
        tx.set(ledgerRef, {
          organizationId: params.orgId,
          itemId,
          itemName: params.data.name.slice(0, 200),
          itemSku: params.data.sku.trim().slice(0, 80),
          warehouseId: params.warehouseId,
          quantityChange: openingQty,
          type: 'opening',
          referenceType: 'item',
          referenceId: itemId,
          referenceNumber: params.data.sku.trim(),
          unitCost: Math.max(0, Number(params.data.costPrice) || 0),
          date: formatDateISO(),
          userId: params.userId,
          notes: 'Opening stock on item creation',
          createdBy: params.userId,
          updatedBy: params.userId,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }

      writeActivityInTx(tx, {
        orgId: params.orgId,
        userId: params.userId,
        userName: params.userName,
        module: 'Items',
        action: 'Created Item',
        entityId: itemId,
        entityName: `${params.data.name} (${params.data.sku})`,
        details: `Opening stock: ${openingQty} ${params.data.unit}`,
      });
    });

    return itemId;
  } catch (err) {
    if (err instanceof Error && !err.message.startsWith('{')) throw err;
    handleFirestoreError(err, OperationType.CREATE, path);
  }
}

export async function updateItemRecord(params: {
  orgId: string;
  userId: string;
  userName: string;
  itemId: string;
  patch: Partial<Item>;
}): Promise<void> {
  if (params.patch.sku) {
    const unique = await isSkuUnique(params.orgId, params.patch.sku, params.itemId);
    if (!unique) {
      throw new Error(`SKU "${params.patch.sku}" already exists in this organization.`);
    }
  }
  await updateOrgDoc(params.orgId, 'items', params.itemId, params.userId, params.patch as Record<string, unknown>);
}

export async function createWarehouse(
  orgId: string,
  userId: string,
  data: Omit<Warehouse, 'id' | 'organizationId' | 'createdBy' | 'createdAt' | 'updatedAt' | 'updatedBy'>
): Promise<string> {
  return createOrgDoc(orgId, 'warehouses', userId, data as Record<string, unknown>);
}

export async function createItemGroup(
  orgId: string,
  userId: string,
  data: Omit<ItemGroup, 'id' | 'organizationId' | 'createdBy' | 'createdAt' | 'updatedAt' | 'updatedBy'>
): Promise<string> {
  return createOrgDoc(orgId, 'itemGroups', userId, data as Record<string, unknown>);
}

export async function createPriceList(
  orgId: string,
  userId: string,
  data: Omit<PriceList, 'id' | 'organizationId' | 'createdBy' | 'createdAt' | 'updatedAt' | 'updatedBy'>
): Promise<string> {
  return createOrgDoc(orgId, 'priceLists', userId, data as Record<string, unknown>);
}

export async function createCompositeItem(
  orgId: string,
  userId: string,
  data: Omit<CompositeItem, 'id' | 'organizationId' | 'createdBy' | 'createdAt' | 'updatedAt' | 'updatedBy'>
): Promise<string> {
  return createOrgDoc(orgId, 'compositeItems', userId, data as Record<string, unknown>);
}

export async function assembleCompositeItem(params: {
  orgId: string;
  userId: string;
  userName: string;
  compositeId: string;
  quantityToAssemble: number;
  warehouseId: string;
}): Promise<void> {
  const qty = Math.max(1, Math.floor(params.quantityToAssemble));
  const compRef = doc(db, `organizations/${params.orgId}/compositeItems/${params.compositeId}`);

  try {
    await runTransaction(db, async (tx) => {
      const compSnap = await tx.get(compRef);
      if (!compSnap.exists()) throw new Error('Composite item not found.');
      const composite = { id: compSnap.id, ...(compSnap.data() as Omit<CompositeItem, 'id'>) } as CompositeItem;

      const compItemSnaps = await Promise.all(
        composite.components.map((c) => tx.get(doc(db, `organizations/${params.orgId}/items/${c.itemId}`)))
      );

      for (let i = 0; i < composite.components.length; i += 1) {
        const snap = compItemSnaps[i];
        if (!snap.exists()) {
          throw new Error(`Component item "${composite.components[i].itemName}" not found.`);
        }
        const compItem = { id: snap.id, ...(snap.data() as Omit<Item, 'id'>) } as Item;
        const needed = composite.components[i].quantity * qty;
        applyStockMutationInTx(tx, params.orgId, params.userId, compItem, {
          itemId: compItem.id,
          warehouseId: params.warehouseId,
          quantityChange: -needed,
          type: 'assembly_consume',
          referenceType: 'compositeItem',
          referenceId: composite.id,
          referenceNumber: composite.sku,
          unitCost: compItem.costPrice,
          date: formatDateISO(),
          notes: `Consumed for assembling ${qty} x ${composite.name}`,
        });
      }

      tx.update(compRef, {
        assembledQty: Number(composite.assembledQty || 0) + qty,
        updatedBy: params.userId,
        updatedAt: serverTimestamp(),
      });

      writeActivityInTx(tx, {
        orgId: params.orgId,
        userId: params.userId,
        userName: params.userName,
        module: 'Items',
        action: 'Assembled Composite Item',
        entityId: composite.id,
        entityName: composite.name,
        details: `Assembled ${qty} ${composite.unit}`,
      });
    });
  } catch (err) {
    if (err instanceof Error && !err.message.startsWith('{')) throw err;
    handleFirestoreError(err, OperationType.WRITE, compRef.path);
  }
}
