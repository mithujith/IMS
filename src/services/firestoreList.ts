import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  QueryConstraint,
  QueryDocumentSnapshot,
  DocumentData,
  startAfter,
  where,
  serverTimestamp,
  updateDoc,
  setDoc,
  WhereFilterOp,
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';

export function generateId(): string {
  return doc(collection(db, '_ids')).id;
}

export function stripUndefined<T extends Record<string, unknown>>(obj: T): T {
  const clean: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(obj)) {
    if (val === undefined) continue;
    if (Array.isArray(val)) {
      clean[key] = val.map((v) =>
        v && typeof v === 'object' && !('toDate' in v)
          ? stripUndefined(v as Record<string, unknown>)
          : v
      );
    } else if (
      val !== null &&
      typeof val === 'object' &&
      !('toDate' in val) &&
      !('_methodName' in val)
    ) {
      clean[key] = stripUndefined(val as Record<string, unknown>);
    } else {
      clean[key] = val;
    }
  }
  return clean as T;
}

export interface PagedFilter {
  field: string;
  op: WhereFilterOp;
  value: unknown;
}

export interface PagedQueryOptions {
  orgId: string;
  subcollection: string;
  pageSize?: number;
  cursor?: QueryDocumentSnapshot<DocumentData> | null;
  sortField?: string;
  sortDirection?: 'asc' | 'desc';
  filters?: PagedFilter[];
  includeDeleted?: boolean;
}

export interface PagedResult<T> {
  items: T[];
  lastDoc: QueryDocumentSnapshot<DocumentData> | null;
  hasMore: boolean;
}

export async function fetchPagedCollection<T extends { id: string; isDeleted?: boolean }>(
  opts: PagedQueryOptions
): Promise<PagedResult<T>> {
  const pageSize = opts.pageSize ?? 25;
  const sortField = opts.sortField ?? 'createdAt';
  const sortDirection = opts.sortDirection ?? 'desc';
  const colPath = `organizations/${opts.orgId}/${opts.subcollection}`;
  const colRef = collection(db, colPath);

  const buildConstraints = (withFilters: boolean): QueryConstraint[] => {
    const constraints: QueryConstraint[] = [];
    if (withFilters && opts.filters) {
      for (const f of opts.filters) {
        constraints.push(where(f.field, f.op, f.value));
      }
    }
    constraints.push(orderBy(sortField, sortDirection));
    if (opts.cursor) {
      constraints.push(startAfter(opts.cursor));
    }
    constraints.push(limit(pageSize + 1));
    return constraints;
  };

  try {
    const q = query(colRef, ...buildConstraints(true));
    const snap = await getDocs(q);
    const docs = snap.docs;
    const hasMore = docs.length > pageSize;
    const slice = hasMore ? docs.slice(0, pageSize) : docs;
    const mapped = slice
      .map((d) => ({ id: d.id, ...(d.data() as Omit<T, 'id'>) }) as T)
      .filter((row) => (opts.includeDeleted ? true : row.isDeleted !== true));
    return {
      items: mapped,
      lastDoc: slice.length > 0 ? slice[slice.length - 1] : null,
      hasMore,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('requires an index') || msg.includes('failed-precondition')) {
      try {
        const fallbackQ = query(colRef, ...buildConstraints(false));
        const snap = await getDocs(fallbackQ);
        const docs = snap.docs;
        const hasMore = docs.length > pageSize;
        const slice = hasMore ? docs.slice(0, pageSize) : docs;
        let mapped = slice
          .map((d) => ({ id: d.id, ...(d.data() as Omit<T, 'id'>) }) as T)
          .filter((row) => (opts.includeDeleted ? true : row.isDeleted !== true));
        if (opts.filters && opts.filters.length > 0) {
          mapped = mapped.filter((row) =>
            opts.filters!.every((f) => {
              const v = (row as Record<string, unknown>)[f.field];
              if (f.op === '==') return v === f.value;
              if (f.op === '!=') return v !== f.value;
              return true;
            })
          );
        }
        return {
          items: mapped,
          lastDoc: slice.length > 0 ? slice[slice.length - 1] : null,
          hasMore,
        };
      } catch (fallbackErr) {
        handleFirestoreError(fallbackErr, OperationType.LIST, colPath);
      }
    }
    handleFirestoreError(err, OperationType.LIST, colPath);
  }
}

export async function fetchOrgDoc<T extends { id: string }>(
  orgId: string,
  subcollection: string,
  docId: string
): Promise<T | null> {
  const path = `organizations/${orgId}/${subcollection}/${docId}`;
  try {
    const snap = await getDoc(doc(db, path));
    if (!snap.exists()) return null;
    return { id: snap.id, ...(snap.data() as Omit<T, 'id'>) } as T;
  } catch (err) {
    handleFirestoreError(err, OperationType.GET, path);
  }
}

export async function createOrgDoc<T extends Record<string, unknown>>(
  orgId: string,
  subcollection: string,
  userId: string,
  payload: T,
  customId?: string
): Promise<string> {
  const id = customId || generateId();
  const path = `organizations/${orgId}/${subcollection}/${id}`;
  try {
    await setDoc(
      doc(db, path),
      stripUndefined({
        ...payload,
        organizationId: orgId,
        isDeleted: false,
        createdBy: userId,
        updatedBy: userId,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    );
    return id;
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, path);
  }
}

export async function updateOrgDoc(
  orgId: string,
  subcollection: string,
  docId: string,
  userId: string,
  patch: Record<string, unknown>
): Promise<void> {
  const path = `organizations/${orgId}/${subcollection}/${docId}`;
  try {
    await updateDoc(
      doc(db, path),
      stripUndefined({
        ...patch,
        updatedBy: userId,
        updatedAt: serverTimestamp(),
      })
    );
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

export async function softDeleteOrgDoc(
  orgId: string,
  subcollection: string,
  docId: string,
  userId: string
): Promise<void> {
  await updateOrgDoc(orgId, subcollection, docId, userId, { isDeleted: true });
}
