import { OrgMember, Organization, UserMembership, UserRole } from '../types';

export interface MinimalAuthUser {
  uid: string;
  email?: string | null;
  displayName?: string | null;
}

export function orderCandidateMemberships(
  memberships: UserMembership[],
  savedOrgId: string | null
): UserMembership[] {
  if (memberships.length === 0) return [];

  const active = memberships.filter((m) => m.status === 'active');
  const inactive = memberships.filter((m) => m.status !== 'active');

  const savedActive = savedOrgId
    ? active.filter((m) => m.orgId === savedOrgId)
    : [];
  const otherActive = savedOrgId
    ? active.filter((m) => m.orgId !== savedOrgId)
    : active;

  return [...savedActive, ...otherActive, ...inactive];
}

export function isMissingOrPermissionError(err: unknown): {
  isPermissionDenied: boolean;
  isNotFound: boolean;
} {
  const raw =
    err instanceof Error
      ? err.message
      : typeof err === 'string'
        ? err
        : JSON.stringify(err ?? '');
  const code =
    typeof err === 'object' && err !== null && 'code' in err
      ? String((err as { code?: unknown }).code ?? '')
      : '';
  const combined = `${code} ${raw}`.toLowerCase();

  const isPermissionDenied =
    combined.includes('permission-denied') ||
    combined.includes('missing or insufficient permissions');
  const isNotFound =
    combined.includes('not-found') || combined.includes('no document to update');

  return { isPermissionDenied, isNotFound };
}

export function buildFallbackOrganization(
  orgId: string,
  user: MinimalAuthUser,
  orgName = 'A & P Brothers (Pvt) Ltd'
): Organization {
  const now = new Date().toISOString();
  const safeName = (orgName || 'A & P Brothers (Pvt) Ltd').trim().slice(0, 160);
  return {
    id: orgId,
    name: safeName,
    legalName: 'A & P Brothers (Pvt) Ltd',
    currency: 'LKR',
    address: 'No. 142, Panchikawatta Road',
    city: 'Colombo 10',
    country: 'Sri Lanka',
    phone: '+94 11 243 8890',
    email: (user.email || 'sales@apbrothers.lk').slice(0, 200),
    taxId: 'VAT-114892034-7000',
    logoUrl: '/src/assets/images/ap_brothers_logo_1795689650195.jpg',
    ownerId: user.uid,
    createdBy: user.uid,
    updatedBy: user.uid,
    createdAt: now,
    updatedAt: now,
  };
}

export function buildFallbackMember(
  orgId: string,
  user: MinimalAuthUser,
  role: UserRole = 'Admin'
): OrgMember {
  const now = new Date().toISOString();
  const fallbackName =
    (user.displayName && user.displayName.trim()) ||
    (user.email ? user.email.split('@')[0] : '') ||
    'Admin';

  return {
    id: user.uid,
    organizationId: orgId,
    uid: user.uid,
    email: (user.email || 'user@apbrothers.lk').slice(0, 200),
    displayName: fallbackName.slice(0, 120),
    role,
    status: 'active',
    createdBy: user.uid,
    updatedBy: user.uid,
    createdAt: now,
    updatedAt: now,
  };
}
