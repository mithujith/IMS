import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { collection, doc, limit, onSnapshot, orderBy, query, updateDoc, serverTimestamp } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { useAuth } from './useAuth';
import {
  acceptPendingInvitesForUser,
  createDefaultOrganization,
  CreateOrganizationOptions,
  fetchOrganizationSafe,
  fetchUserMembershipsSafe,
  removeStaleMembership,
  syncUserProfile,
} from '../services/orgService';
import { seedDemoData } from '../services/seedService';
import { NotificationItem, OrgMember, OrgSettingsDoc, Organization, UserMembership, UserRole } from '../types';
import { fetchOrgSettingsSafe } from '../services/settingsService';
import { ActionKey, canPerform, ModuleKey } from '../lib/permissions';
import {
  buildFallbackMember,
  buildFallbackOrganization,
  isMissingOrPermissionError,
  orderCandidateMemberships,
} from '../lib/orgWorkspace';

export interface CompleteOrgSetupInput extends CreateOrganizationOptions {
  name: string;
  loadDemo?: boolean;
}

interface OrgContextValue {
  orgId: string | null;
  org: Organization | null;
  role: UserRole | null;
  member: OrgMember | null;
  memberships: UserMembership[];
  settings: OrgSettingsDoc | null;
  notifications: NotificationItem[];
  unreadNotifications: number;
  orgLoading: boolean;
  orgError: string | null;
  orgWarning: string | null;
  needsOrgSetup: boolean;
  switchOrganization: (nextOrgId: string) => Promise<void>;
  createNewOrganization: (name: string) => Promise<void>;
  completeOrgSetup: (input: CompleteOrgSetupInput) => Promise<void>;
  refreshOrg: () => Promise<void>;
  markNotificationRead: (notificationId: string) => Promise<void>;
  can: (module: ModuleKey, action: ActionKey) => boolean;
}

const OrgContext = createContext<OrgContextValue | undefined>(undefined);

const ACTIVE_ORG_STORAGE_KEY = 'apb_active_org_id';

export function OrgProvider({ children }: { children: React.ReactNode }) {
  const { user, loading: authLoading } = useAuth();
  const [orgId, setOrgId] = useState<string | null>(null);
  const [org, setOrg] = useState<Organization | null>(null);
  const [role, setRole] = useState<UserRole | null>(null);
  const [member, setMember] = useState<OrgMember | null>(null);
  const [memberships, setMemberships] = useState<UserMembership[]>([]);
  const [settings, setSettings] = useState<OrgSettingsDoc | null>(null);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [orgLoading, setOrgLoading] = useState(true);
  const [orgError, setOrgError] = useState<string | null>(null);
  const [orgWarning, setOrgWarning] = useState<string | null>(null);
  const [needsOrgSetup, setNeedsOrgSetup] = useState(false);

  const loadWorkspace = useCallback(async () => {
    if (!user) {
      setOrgId(null);
      setOrg(null);
      setRole(null);
      setMember(null);
      setMemberships([]);
      setSettings(null);
      setNotifications([]);
      setOrgError(null);
      setOrgWarning(null);
      setNeedsOrgSetup(false);
      setOrgLoading(false);
      return;
    }

    setOrgLoading(true);
    setOrgError(null);
    setOrgWarning(null);

    try {
      await syncUserProfile(user);
      await acceptPendingInvitesForUser(user);

      const membershipRes = await fetchUserMembershipsSafe(user.uid);
      let list = membershipRes.memberships;

      const savedId = localStorage.getItem(ACTIVE_ORG_STORAGE_KEY);
      const candidates = orderCandidateMemberships(list, savedId);

      let resolvedOrg: Organization | null = null;
      let resolvedSelected: UserMembership | null = null;
      const staleOrgIds: string[] = [];

      for (const candidate of candidates) {
        const { org: candidateOrg, reason } = await fetchOrganizationSafe(candidate.orgId);
        if (candidateOrg) {
          resolvedOrg = candidateOrg;
          resolvedSelected = candidate;
          break;
        }
        if (reason === 'not-found' || reason === 'permission-denied') {
          staleOrgIds.push(candidate.orgId);
        }
      }

      if (staleOrgIds.length > 0) {
        await Promise.all(staleOrgIds.map((badId) => removeStaleMembership(user.uid, badId)));
        list = list.filter((m) => !staleOrgIds.includes(m.orgId));
        if (savedId && staleOrgIds.includes(savedId)) {
          localStorage.removeItem(ACTIVE_ORG_STORAGE_KEY);
        }
      }

      // When the user has no linked active organization (or previous links were stale/deleted),
      // trigger the guided Organization Setup modal instead of silently auto-creating one.
      if (resolvedOrg && resolvedSelected) {
        setNeedsOrgSetup(false);
        setMemberships(list);
        localStorage.setItem(ACTIVE_ORG_STORAGE_KEY, resolvedSelected.orgId);
        setOrgId(resolvedSelected.orgId);
        setRole(resolvedSelected.role);
        setOrg(resolvedOrg);
        const settingsDoc = await fetchOrgSettingsSafe(resolvedSelected.orgId);
        setSettings(settingsDoc);
      } else if (list.length === 0 && !membershipRes.error) {
        setNeedsOrgSetup(true);
        setMemberships([]);
        setOrgId(null);
        setRole(null);
        setOrg(null);
        setMember(null);
        setSettings(null);
      } else {
        // Graceful missing-document fallback when memberships exist but doc could not be read (e.g. offline)
        const fallbackCandidate = list[0] ?? candidates[0] ?? null;
        const fallbackId = fallbackCandidate?.orgId || savedId || `fallback_${user.uid}`;
        const fallbackRole: UserRole = fallbackCandidate?.role || 'Admin';
        setNeedsOrgSetup(false);
        setMemberships(list);
        setOrgId(null);
        setRole(fallbackRole);
        setOrg(
          buildFallbackOrganization(
            fallbackId,
            user,
            fallbackCandidate?.orgName || 'A & P Brothers (Pvt) Ltd'
          )
        );
        setMember(buildFallbackMember(fallbackId, user, fallbackRole));
        setSettings(null);
        setOrgWarning(
          'Organization document is currently missing or inaccessible. Running in fallback workspace mode.'
        );
      }
    } catch (err) {
      console.warn('Unexpected workspace sync issue, applying graceful fallback:', err);
      const fallbackId = `fallback_${user.uid}`;
      setNeedsOrgSetup(false);
      setOrgId(null);
      setRole('Admin');
      setOrg(buildFallbackOrganization(fallbackId, user, 'A & P Brothers (Pvt) Ltd'));
      setMember(buildFallbackMember(fallbackId, user, 'Admin'));
      setSettings(null);
      setOrgWarning(
        err instanceof Error
          ? `Workspace sync warning: ${err.message}`
          : 'Organization document could not be loaded. Running in fallback workspace mode.'
      );
    } finally {
      setOrgLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (!authLoading) {
      void loadWorkspace();
    }
  }, [authLoading, loadWorkspace]);

  // Real-time listeners for active org, current member role, and notifications
  useEffect(() => {
    if (!user || !orgId) return;

    const unsubOrg = onSnapshot(
      doc(db, `organizations/${orgId}`),
      (snap) => {
        if (snap.exists()) {
          setOrg({ id: snap.id, ...(snap.data() as Omit<Organization, 'id'>) });
          setOrgWarning(null);
        } else {
          setOrg((prev) => prev ?? buildFallbackOrganization(orgId, user, 'A & P Brothers (Pvt) Ltd'));
          setOrgWarning(
            'Active organization document was not found in Firestore. Using fallback workspace details.'
          );
        }
      },
      (err) => {
        const { isPermissionDenied, isNotFound } = isMissingOrPermissionError(err);
        console.warn(`Organization listener warning for organizations/${orgId}:`, err);
        if (isPermissionDenied || isNotFound) {
          setOrg((prev) => prev ?? buildFallbackOrganization(orgId, user, 'A & P Brothers (Pvt) Ltd'));
          setOrgWarning(
            'Unable to sync active organization document due to missing record or permissions.'
          );
        }
      }
    );

    const unsubMember = onSnapshot(
      doc(db, `organizations/${orgId}/members/${user.uid}`),
      (snap) => {
        if (snap.exists()) {
          const m = { id: snap.id, ...(snap.data() as Omit<OrgMember, 'id'>) };
          setMember(m);
          setRole(m.role);
        } else {
          setMember((prev) => prev ?? buildFallbackMember(orgId, user, role || 'Admin'));
        }
      },
      (err) => {
        console.warn(`Member listener warning for organizations/${orgId}/members/${user.uid}:`, err);
      }
    );

    const notifQuery = query(
      collection(db, `organizations/${orgId}/notifications`),
      orderBy('createdAt', 'desc'),
      limit(20)
    );
    const unsubNotifs = onSnapshot(
      notifQuery,
      (snap) => {
        const list = snap.docs
          .map((d) => ({ id: d.id, ...(d.data() as Omit<NotificationItem, 'id'>) }))
          .filter((n) => !n.isDeleted);
        setNotifications(list);
      },
      (err) => {
        console.warn(`Notifications listener warning for organizations/${orgId}/notifications:`, err);
        setNotifications([]);
      }
    );

    return () => {
      unsubOrg();
      unsubMember();
      unsubNotifs();
    };
  }, [user, orgId]);

  const switchOrganization = useCallback(
    async (nextOrgId: string) => {
      if (!user) return;
      localStorage.setItem(ACTIVE_ORG_STORAGE_KEY, nextOrgId);
      setOrgWarning(null);
      const target = memberships.find((m) => m.orgId === nextOrgId);
      if (target) setRole(target.role);

      const { org: orgDoc } = await fetchOrganizationSafe(nextOrgId);
      const settingsDoc = orgDoc ? await fetchOrgSettingsSafe(nextOrgId) : null;

      if (orgDoc) {
        setOrgId(nextOrgId);
        setOrg(orgDoc);
        setSettings(settingsDoc);
      } else {
        setOrgId(null);
        setOrg(
          buildFallbackOrganization(
            nextOrgId,
            user,
            target?.orgName || 'A & P Brothers (Pvt) Ltd'
          )
        );
        setMember(buildFallbackMember(nextOrgId, user, target?.role || 'Admin'));
        setSettings(null);
        setOrgWarning(
          'Selected organization document could not be found or accessed. Using fallback workspace details.'
        );
      }
    },
    [user, memberships]
  );

  const createNewOrganization = useCallback(
    async (name: string) => {
      if (!user) return;
      const newId = await createDefaultOrganization(user, name.trim() || 'New Organization');
      localStorage.setItem(ACTIVE_ORG_STORAGE_KEY, newId);
      setNeedsOrgSetup(false);
      await loadWorkspace();
    },
    [user, loadWorkspace]
  );

  const completeOrgSetup = useCallback(
    async (input: CompleteOrgSetupInput) => {
      if (!user) return;
      const newId = await createDefaultOrganization(user, input.name, input);
      localStorage.setItem(ACTIVE_ORG_STORAGE_KEY, newId);
      if (input.loadDemo) {
        const displayName =
          user.displayName?.trim() || (user.email ? user.email.split('@')[0] : 'Admin') || 'Admin';
        await seedDemoData(newId, user.uid, displayName);
      }
      setNeedsOrgSetup(false);
      await loadWorkspace();
    },
    [user, loadWorkspace]
  );

  const markNotificationRead = useCallback(
    async (notificationId: string) => {
      if (!orgId || !user) return;
      const path = `organizations/${orgId}/notifications/${notificationId}`;
      try {
        await updateDoc(doc(db, path), {
          read: true,
          updatedBy: user.uid,
          updatedAt: serverTimestamp(),
        });
      } catch (err) {
        handleFirestoreError(err, OperationType.UPDATE, path);
      }
    },
    [orgId, user]
  );

  const can = useCallback(
    (module: ModuleKey, action: ActionKey) => canPerform(role, module, action),
    [role]
  );

  const unreadNotifications = notifications.filter((n) => !n.read).length;

  return (
    <OrgContext.Provider
      value={{
        orgId,
        org,
        role,
        member,
        memberships,
        settings,
        notifications,
        unreadNotifications,
        orgLoading,
        orgError,
        orgWarning,
        needsOrgSetup,
        switchOrganization,
        createNewOrganization,
        completeOrgSetup,
        refreshOrg: loadWorkspace,
        markNotificationRead,
        can,
      }}
    >
      {children}
    </OrgContext.Provider>
  );
}

export function useOrg(): OrgContextValue {
  const ctx = useContext(OrgContext);
  if (!ctx) throw new Error('useOrg must be used within OrgProvider');
  return ctx;
}
