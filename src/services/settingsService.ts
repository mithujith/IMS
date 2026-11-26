import { collection, doc, getDoc, getDocs, serverTimestamp, setDoc } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { OrgSettingsDoc, TaxRate } from '../types';
import { createOrgDoc, stripUndefined, updateOrgDoc } from './firestoreList';
import { logActivity } from './activityService';

export async function fetchOrgSettings(orgId: string): Promise<OrgSettingsDoc | null> {
  const path = `organizations/${orgId}/settings/general`;
  try {
    const snap = await getDoc(doc(db, path));
    if (!snap.exists()) return null;
    return { id: snap.id, ...(snap.data() as Omit<OrgSettingsDoc, 'id'>) };
  } catch (err) {
    handleFirestoreError(err, OperationType.GET, path);
  }
}

export async function fetchOrgSettingsSafe(orgId: string): Promise<OrgSettingsDoc | null> {
  const path = `organizations/${orgId}/settings/general`;
  try {
    const snap = await getDoc(doc(db, path));
    if (!snap.exists()) return null;
    return { id: snap.id, ...(snap.data() as Omit<OrgSettingsDoc, 'id'>) };
  } catch (err) {
    console.warn(`Could not fetch org settings at ${path}:`, err);
    return null;
  }
}

export async function saveOrgSettings(
  orgId: string,
  userId: string,
  userName: string,
  patch: Partial<OrgSettingsDoc>
): Promise<void> {
  const path = `organizations/${orgId}/settings/general`;
  try {
    const snap = await getDoc(doc(db, path));
    if (!snap.exists()) {
      await setDoc(
        doc(db, path),
        stripUndefined({
          ...patch,
          organizationId: orgId,
          isDeleted: false,
          createdBy: userId,
          updatedBy: userId,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        })
      );
    } else {
      await updateOrgDoc(orgId, 'settings', 'general', userId, patch as Record<string, unknown>);
    }

    await logActivity({
      orgId,
      userId,
      userName,
      module: 'Settings',
      action: 'Updated Organization Settings',
      entityId: 'general',
      entityName: 'Preferences & Templates',
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, path);
  }
}

export async function fetchTaxes(orgId: string): Promise<TaxRate[]> {
  const path = `organizations/${orgId}/taxes`;
  try {
    const snap = await getDocs(collection(db, path));
    return snap.docs
      .map((d) => ({ id: d.id, ...(d.data() as Omit<TaxRate, 'id'>) }))
      .filter((t) => !t.isDeleted);
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, path);
  }
}

export async function createTaxRate(
  orgId: string,
  userId: string,
  data: Omit<TaxRate, 'id' | 'organizationId' | 'createdBy' | 'createdAt' | 'updatedAt' | 'updatedBy'>
): Promise<string> {
  return createOrgDoc(orgId, 'taxes', userId, data as Record<string, unknown>);
}

export async function exportOrganizationJsonBackup(orgId: string): Promise<Record<string, unknown[]>> {
  const subcollections = [
    'items',
    'itemGroups',
    'compositeItems',
    'priceLists',
    'warehouses',
    'stockLedger',
    'adjustments',
    'transferOrders',
    'customers',
    'vendors',
    'salesOrders',
    'packages',
    'shipments',
    'invoices',
    'paymentsReceived',
    'salesReturns',
    'creditNotes',
    'purchaseOrders',
    'purchaseReceives',
    'bills',
    'paymentsMade',
    'vendorCredits',
    'taxes',
    'documents',
    'settings',
  ];

  const backup: Record<string, unknown[]> = {};
  for (const col of subcollections) {
    const snap = await getDocs(collection(db, `organizations/${orgId}/${col}`));
    backup[col] = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  }
  return backup;
}
