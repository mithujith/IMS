import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import { User } from 'firebase/auth';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { isMissingOrPermissionError } from '../lib/orgWorkspace';
import { OrgInvite, OrgMember, Organization, UserMembership, UserRole } from '../types';
import { generateId, stripUndefined } from './firestoreList';

export async function syncUserProfile(user: User): Promise<void> {
  const path = `users/${user.uid}`;
  try {
    const ref = doc(db, path);
    const snap = await getDoc(ref);
    const rawDisplayName =
      user.displayName?.trim() ||
      (user.email ? user.email.split('@')[0]?.trim() : '') ||
      'User';
    const safeDisplayName = rawDisplayName.slice(0, 120) || 'User';
    const safeEmail = (user.email?.trim() || 'user@apbrothers.lk').slice(0, 200);
    const safePhoto = (user.photoURL || '').slice(0, 500);

    if (!snap.exists()) {
      await setDoc(ref, {
        uid: user.uid,
        email: safeEmail,
        displayName: safeDisplayName,
        photoURL: safePhoto,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else {
      const existingData = snap.data();
      await updateDoc(ref, {
        email: (user.email?.trim() || String(existingData.email || '') || 'user@apbrothers.lk').slice(0, 200),
        displayName: (
          user.displayName?.trim() ||
          String(existingData.displayName || '').trim() ||
          safeDisplayName
        ).slice(0, 120),
        photoURL: (user.photoURL || String(existingData.photoURL || '')).slice(0, 500),
        updatedAt: serverTimestamp(),
      });
    }
  } catch (err) {
    console.warn(`User profile sync skipped for ${path}:`, err);
  }
}

export async function fetchUserMemberships(uid: string): Promise<UserMembership[]> {
  const path = `users/${uid}/memberships`;
  try {
    const snap = await getDocs(collection(db, path));
    return snap.docs.map((d) => d.data() as UserMembership);
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, path);
  }
}

export async function fetchUserMembershipsSafe(uid: string): Promise<{
  memberships: UserMembership[];
  error?: unknown;
}> {
  const path = `users/${uid}/memberships`;
  try {
    const snap = await getDocs(collection(db, path));
    return {
      memberships: snap.docs.map((d) => d.data() as UserMembership),
    };
  } catch (error) {
    console.warn(`Could not list memberships at ${path}:`, error);
    return { memberships: [], error };
  }
}

export async function removeStaleMembership(uid: string, orgId: string): Promise<void> {
  try {
    await deleteDoc(doc(db, `users/${uid}/memberships/${orgId}`));
  } catch (err) {
    console.warn(`Could not remove stale membership ${orgId}:`, err);
  }
}

export async function acceptPendingInvitesForUser(user: User): Promise<number> {
  if (!user.email || !user.emailVerified) return 0;
  try {
    const q = query(
      collection(db, 'inviteTokens'),
      where('email', '==', user.email.toLowerCase()),
      where('status', '==', 'pending')
    );
    const snap = await getDocs(q);
    if (snap.empty) return 0;

    let acceptedCount = 0;
    const displayName = user.displayName || user.email.split('@')[0] || 'Member';

    for (const tokenDoc of snap.docs) {
      const data = tokenDoc.data() as {
        inviteId: string;
        orgId: string;
        orgName: string;
        email: string;
        role: UserRole;
      };
      const batch = writeBatch(db);
      const memberRef = doc(db, `organizations/${data.orgId}/members/${user.uid}`);
      batch.set(memberRef, {
        organizationId: data.orgId,
        uid: user.uid,
        email: user.email,
        displayName: displayName.slice(0, 120),
        role: data.role,
        status: 'active',
        inviteId: data.inviteId,
        createdBy: user.uid,
        updatedBy: user.uid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      const membershipRef = doc(db, `users/${user.uid}/memberships/${data.orgId}`);
      batch.set(membershipRef, {
        orgId: data.orgId,
        orgName: data.orgName,
        role: data.role,
        status: 'active',
        joinedAt: serverTimestamp(),
      });

      batch.update(tokenDoc.ref, {
        status: 'accepted',
        updatedAt: serverTimestamp(),
      });

      await batch.commit();

      const orgInviteRef = doc(db, `organizations/${data.orgId}/invites/${data.inviteId}`);
      await updateDoc(orgInviteRef, {
        status: 'accepted',
        updatedBy: user.uid,
        updatedAt: serverTimestamp(),
      });

      acceptedCount += 1;
    }

    return acceptedCount;
  } catch (err) {
    console.warn('Invite check skipped or failed:', err);
    return 0;
  }
}

export interface CreateOrganizationOptions {
  legalName?: string;
  currency?: string;
  address?: string;
  city?: string;
  country?: string;
  phone?: string;
  email?: string;
  taxId?: string;
  primaryWarehouseName?: string;
  primaryWarehouseCode?: string;
  includeShowroom?: boolean;
}

export async function createDefaultOrganization(
  user: User,
  orgName = 'A & P Brothers (Pvt) Ltd',
  options?: CreateOrganizationOptions
): Promise<string> {
  const orgId = generateId();
  const path = `organizations/${orgId}`;
  const rawDisplayName =
    user.displayName?.trim() ||
    (user.email ? user.email.split('@')[0]?.trim() : '') ||
    'Admin';
  const safeDisplayName = rawDisplayName.slice(0, 120) || 'Admin';
  const safeEmail = (user.email?.trim() || 'user@apbrothers.lk').slice(0, 200);
  const safeOrgName = (orgName.trim() || 'A & P Brothers (Pvt) Ltd').slice(0, 160);
  const safeLegalName = (options?.legalName?.trim() || safeOrgName).slice(0, 200);
  const safeCurrency = (options?.currency?.trim() || 'LKR').slice(0, 10);
  const safeAddress = (options?.address?.trim() || 'No. 142, Panchikawatta Road').slice(0, 400);
  const safeCity = (options?.city?.trim() || 'Colombo 10').slice(0, 100);
  const safeCountry = (options?.country?.trim() || 'Sri Lanka').slice(0, 100);
  const safePhone = (options?.phone?.trim() || '+94 11 243 8890').slice(0, 60);
  const safeOrgEmail = (options?.email?.trim() || user.email?.trim() || 'sales@apbrothers.lk').slice(0, 200);
  const safeTaxId = (options?.taxId?.trim() || 'VAT-114892034-7000').slice(0, 80);
  const primaryWhName = (options?.primaryWarehouseName?.trim() || 'Main Store').slice(0, 120);
  const primaryWhCode = (options?.primaryWarehouseCode?.trim() || 'WH-MAIN').slice(0, 40);
  const includeShowroom = options?.includeShowroom ?? true;

  try {
    const batch1 = writeBatch(db);
    const orgRef = doc(db, path);
    batch1.set(orgRef, {
      name: safeOrgName,
      legalName: safeLegalName,
      currency: safeCurrency,
      address: safeAddress,
      city: safeCity,
      country: safeCountry,
      phone: safePhone,
      email: safeOrgEmail,
      taxId: safeTaxId,
      logoUrl: '/src/assets/images/ap_brothers_logo_1795689650195.jpg',
      ownerId: user.uid,
      createdBy: user.uid,
      updatedBy: user.uid,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    const memberRef = doc(db, `${path}/members/${user.uid}`);
    batch1.set(memberRef, {
      organizationId: orgId,
      uid: user.uid,
      email: safeEmail,
      displayName: safeDisplayName,
      role: 'Admin',
      status: 'active',
      createdBy: user.uid,
      updatedBy: user.uid,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    const membershipRef = doc(db, `users/${user.uid}/memberships/${orgId}`);
    batch1.set(membershipRef, {
      orgId,
      orgName: safeOrgName,
      role: 'Admin',
      status: 'active',
      joinedAt: serverTimestamp(),
    });

    await batch1.commit();

    // Update user's defaultOrgId best-effort so profile edge cases never block org creation
    try {
      const userRef = doc(db, `users/${user.uid}`);
      const userSnap = await getDoc(userRef);
      if (userSnap.exists()) {
        await updateDoc(userRef, {
          defaultOrgId: orgId,
          updatedAt: serverTimestamp(),
        });
      } else {
        await setDoc(userRef, {
          uid: user.uid,
          email: safeEmail,
          displayName: safeDisplayName,
          photoURL: (user.photoURL || '').slice(0, 500),
          defaultOrgId: orgId,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }
    } catch (profileErr) {
      console.warn('Could not update user defaultOrgId:', profileErr);
    }

    const batch2 = writeBatch(db);
    const whMainId = generateId();
    batch2.set(doc(db, `${path}/warehouses/${whMainId}`), {
      organizationId: orgId,
      name: primaryWhName,
      code: primaryWhCode,
      address: safeAddress,
      city: safeCity,
      phone: safePhone,
      isPrimary: true,
      status: 'active',
      isDeleted: false,
      createdBy: user.uid,
      updatedBy: user.uid,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    if (includeShowroom) {
      const whShowroomId = generateId();
      batch2.set(doc(db, `${path}/warehouses/${whShowroomId}`), {
        organizationId: orgId,
        name: 'Showroom',
        code: 'WH-SHOW',
        address: 'No. 88, Galle Road, Dehiwala',
        city: safeCity,
        phone: '+94 11 271 4412',
        isPrimary: false,
        status: 'active',
        isDeleted: false,
        createdBy: user.uid,
        updatedBy: user.uid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }

    const vatId = generateId();
    batch2.set(doc(db, `${path}/taxes/${vatId}`), {
      organizationId: orgId,
      name: 'VAT (18%)',
      rate: 18,
      type: 'standard',
      isDefault: true,
      status: 'active',
      isDeleted: false,
      createdBy: user.uid,
      updatedBy: user.uid,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    const zeroTaxId = generateId();
    batch2.set(doc(db, `${path}/taxes/${zeroTaxId}`), {
      organizationId: orgId,
      name: 'Zero Rated (0%)',
      rate: 0,
      type: 'standard',
      isDefault: false,
      status: 'active',
      isDeleted: false,
      createdBy: user.uid,
      updatedBy: user.uid,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    batch2.set(doc(db, `${path}/settings/general`), {
      organizationId: orgId,
      paymentTerms: [
        { name: 'Due on Receipt', days: 0 },
        { name: 'Net 15', days: 15 },
        { name: 'Net 30', days: 30 },
        { name: 'Net 45', days: 45 },
        { name: 'Net 60', days: 60 },
      ],
      units: ['PCS', 'SET', 'BOX', 'PAIR'],
      prefixes: {
        salesOrders: 'SO-',
        packages: 'PKG-',
        shipments: 'SHP-',
        invoices: 'INV-',
        paymentsReceived: 'PAY-',
        salesReturns: 'SR-',
        creditNotes: 'CN-',
        purchaseOrders: 'PO-',
        purchaseReceives: 'PR-',
        bills: 'BILL-',
        paymentsMade: 'PM-',
        vendorCredits: 'VC-',
        adjustments: 'ADJ-',
        transferOrders: 'TO-',
      },
      emailTemplateSubject: 'Invoice {{invoiceNumber}} from A & P Brothers (Pvt) Ltd',
      emailTemplateBody:
        'Dear {{customerName}},\n\nPlease find attached invoice {{invoiceNumber}} for {{totalAmount}}.\n\nThank you for your business!\nA & P Brothers (Pvt) Ltd',
      pdfTermsAndConditions:
        '1. Goods sold are genuine/OEM motorcycle spare parts and checked prior to dispatch.\n2. Returns accepted within 7 days in original unopened packaging.\n3. Please quote the invoice number on all bank transfers.',
      pdfFooterNote: 'Thank you for choosing A & P Brothers (Pvt) Ltd — Panchikawatta, Colombo 10.',
      lowStockAlertsEnabled: true,
      dailyDigestEnabled: false,
      isDeleted: false,
      createdBy: user.uid,
      updatedBy: user.uid,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    batch2.set(doc(db, `${path}/activityLog/${generateId()}`), {
      organizationId: orgId,
      userId: user.uid,
      userName: safeDisplayName,
      module: 'Organization',
      action: 'Created Organization',
      entityId: orgId,
      entityName: safeOrgName.slice(0, 200),
      details: 'Initialized workspace with Main Store & Showroom warehouses.',
      createdBy: user.uid,
      updatedBy: user.uid,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    try {
      await batch2.commit();
    } catch (secondaryErr) {
      console.warn(`Default subcollection setup partial failure for ${path}:`, secondaryErr);
    }
    return orgId;
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, path);
  }
}

export async function fetchOrganization(orgId: string): Promise<Organization | null> {
  const path = `organizations/${orgId}`;
  try {
    const snap = await getDoc(doc(db, path));
    if (!snap.exists()) return null;
    return { id: snap.id, ...(snap.data() as Omit<Organization, 'id'>) };
  } catch (err) {
    handleFirestoreError(err, OperationType.GET, path);
  }
}

export async function fetchOrganizationSafe(orgId: string): Promise<{
  org: Organization | null;
  reason?: 'not-found' | 'permission-denied' | 'error';
}> {
  const path = `organizations/${orgId}`;
  try {
    const snap = await getDoc(doc(db, path));
    if (!snap.exists()) {
      return { org: null, reason: 'not-found' };
    }
    return { org: { id: snap.id, ...(snap.data() as Omit<Organization, 'id'>) } };
  } catch (err) {
    const { isPermissionDenied, isNotFound } = isMissingOrPermissionError(err);
    console.warn(`Could not fetch organization at ${path}:`, err);
    return {
      org: null,
      reason: isPermissionDenied ? 'permission-denied' : isNotFound ? 'not-found' : 'error',
    };
  }
}

export async function updateOrganizationProfile(
  orgId: string,
  userId: string,
  patch: Partial<Organization>
): Promise<void> {
  const path = `organizations/${orgId}`;
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

export async function fetchOrgMembers(orgId: string): Promise<OrgMember[]> {
  const path = `organizations/${orgId}/members`;
  try {
    const snap = await getDocs(collection(db, path));
    return snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<OrgMember, 'id'>) }));
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, path);
  }
}

export async function fetchOrgInvites(orgId: string): Promise<OrgInvite[]> {
  const path = `organizations/${orgId}/invites`;
  try {
    const snap = await getDocs(collection(db, path));
    return snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<OrgInvite, 'id'>) }));
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, path);
  }
}

export async function inviteOrgMember(params: {
  orgId: string;
  orgName: string;
  email: string;
  role: UserRole;
  invitedByUid: string;
  invitedByName: string;
}): Promise<string> {
  const inviteId = generateId();
  const normalizedEmail = params.email.trim().toLowerCase();
  const batch = writeBatch(db);

  batch.set(doc(db, `organizations/${params.orgId}/invites/${inviteId}`), {
    organizationId: params.orgId,
    email: normalizedEmail,
    role: params.role,
    status: 'pending',
    invitedByName: params.invitedByName,
    isDeleted: false,
    createdBy: params.invitedByUid,
    updatedBy: params.invitedByUid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  batch.set(doc(db, `inviteTokens/${inviteId}`), {
    inviteId,
    orgId: params.orgId,
    orgName: params.orgName,
    email: normalizedEmail,
    role: params.role,
    status: 'pending',
    invitedBy: params.invitedByUid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  try {
    await batch.commit();
    return inviteId;
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, `organizations/${params.orgId}/invites/${inviteId}`);
  }
}

export async function updateMemberRole(
  orgId: string,
  targetUid: string,
  role: UserRole,
  status: 'active' | 'inactive',
  adminUid: string
): Promise<void> {
  const path = `organizations/${orgId}/members/${targetUid}`;
  try {
    await updateDoc(doc(db, path), {
      role,
      status,
      updatedBy: adminUid,
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

export async function revokeOrgInvite(
  orgId: string,
  inviteId: string,
  adminUid: string
): Promise<void> {
  const batch = writeBatch(db);
  batch.update(doc(db, `organizations/${orgId}/invites/${inviteId}`), {
    status: 'revoked',
    updatedBy: adminUid,
    updatedAt: serverTimestamp(),
  });
  batch.update(doc(db, `inviteTokens/${inviteId}`), {
    status: 'revoked',
    updatedAt: serverTimestamp(),
  });
  try {
    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `organizations/${orgId}/invites/${inviteId}`);
  }
}
