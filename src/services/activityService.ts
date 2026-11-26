import { doc, serverTimestamp, setDoc, Transaction, WriteBatch } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { generateId } from './firestoreList';

export interface LogActivityParams {
  orgId: string;
  userId: string;
  userName: string;
  module: string;
  action: string;
  entityId: string;
  entityName?: string;
  details?: string;
}

export function buildActivityDoc(params: LogActivityParams) {
  return {
    organizationId: params.orgId,
    userId: params.userId,
    userName: params.userName.slice(0, 120),
    module: params.module.slice(0, 60),
    action: params.action.slice(0, 60),
    entityId: params.entityId.slice(0, 128),
    entityName: params.entityName ? params.entityName.slice(0, 200) : '',
    details: params.details ? params.details.slice(0, 500) : '',
    createdBy: params.userId,
    updatedBy: params.userId,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
}

export function writeActivityInTx(tx: Transaction, params: LogActivityParams): void {
  const id = generateId();
  const ref = doc(db, `organizations/${params.orgId}/activityLog/${id}`);
  tx.set(ref, buildActivityDoc(params));
}

export function writeActivityInBatch(batch: WriteBatch, params: LogActivityParams): void {
  const id = generateId();
  const ref = doc(db, `organizations/${params.orgId}/activityLog/${id}`);
  batch.set(ref, buildActivityDoc(params));
}

export async function logActivity(params: LogActivityParams): Promise<void> {
  const id = generateId();
  const path = `organizations/${params.orgId}/activityLog/${id}`;
  try {
    await setDoc(doc(db, path), buildActivityDoc(params));
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, path);
  }
}

export async function createNotification(params: {
  orgId: string;
  userId: string;
  title: string;
  message: string;
  type: 'low_stock' | 'order' | 'payment' | 'system';
  entityId?: string;
  link?: string;
}): Promise<void> {
  const id = generateId();
  const path = `organizations/${params.orgId}/notifications/${id}`;
  try {
    await setDoc(doc(db, path), {
      organizationId: params.orgId,
      title: params.title,
      message: params.message,
      type: params.type,
      entityId: params.entityId ?? '',
      link: params.link ?? '',
      read: false,
      isDeleted: false,
      createdBy: params.userId,
      updatedBy: params.userId,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, path);
  }
}
