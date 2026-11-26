import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildFallbackMember,
  buildFallbackOrganization,
  isMissingOrPermissionError,
  orderCandidateMemberships,
} from './orgWorkspace';
import { UserMembership } from '../types';

test('orderCandidateMemberships prioritizes saved active org, then active, then inactive', () => {
  const memberships: UserMembership[] = [
    { orgId: 'org-inactive', orgName: 'Old Co', role: 'Sales', status: 'inactive', joinedAt: '2026-01-01' },
    { orgId: 'org-1', orgName: 'Main Co', role: 'Admin', status: 'active', joinedAt: '2026-01-02' },
    { orgId: 'org-2', orgName: 'Branch Co', role: 'Manager', status: 'active', joinedAt: '2026-01-03' },
  ];

  const ordered = orderCandidateMemberships(memberships, 'org-2');
  assert.deepEqual(
    ordered.map((m) => m.orgId),
    ['org-2', 'org-1', 'org-inactive']
  );

  const withoutSaved = orderCandidateMemberships(memberships, 'non-existent');
  assert.deepEqual(
    withoutSaved.map((m) => m.orgId),
    ['org-1', 'org-2', 'org-inactive']
  );
});

test('isMissingOrPermissionError detects Firestore permission and missing doc errors', () => {
  const permErr = new Error(
    JSON.stringify({
      error: 'Missing or insufficient permissions.',
      operationType: 'get',
      path: 'organizations/abc',
    })
  );
  assert.deepEqual(isMissingOrPermissionError(permErr), {
    isPermissionDenied: true,
    isNotFound: false,
  });

  const codeErr = Object.assign(new Error('Document not found'), { code: 'not-found' });
  assert.deepEqual(isMissingOrPermissionError(codeErr), {
    isPermissionDenied: false,
    isNotFound: true,
  });

  const networkErr = new Error('network timeout');
  assert.deepEqual(isMissingOrPermissionError(networkErr), {
    isPermissionDenied: false,
    isNotFound: false,
  });
});

test('buildFallbackOrganization and buildFallbackMember construct valid defaults', () => {
  const org = buildFallbackOrganization('fallback-1', {
    uid: 'user-1',
    email: 'owner@apbrothers.lk',
  });
  assert.equal(org.id, 'fallback-1');
  assert.equal(org.name, 'A & P Brothers (Pvt) Ltd');
  assert.equal(org.currency, 'LKR');
  assert.equal(org.ownerId, 'user-1');

  const member = buildFallbackMember('fallback-1', {
    uid: 'user-1',
    email: 'owner@apbrothers.lk',
    displayName: '  ',
  });
  assert.equal(member.uid, 'user-1');
  assert.equal(member.displayName, 'owner');
  assert.equal(member.role, 'Admin');
});
