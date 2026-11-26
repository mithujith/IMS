# Security Specification — A & P Brothers Inventory

## 1. Data Invariants
1. **Strict Tenant Isolation**: Every organization document and subcollection document carries `organizationId == orgId`. Access is granted only if `organizations/{orgId}/members/{request.auth.uid}` exists and has `status == 'active'`.
2. **Role-Based Access Control (RBAC)**: Roles (`Admin`, `Manager`, `Sales`, `Warehouse`, `Accountant`, `Read-only`) are stored exclusively in `organizations/{orgId}/members/{uid}`. Users cannot self-assign or elevate roles unless accepting a verified Admin-created invite token.
3. **Append-Only Audit & Stock Ledgers**: `stockLedger` and `activityLog` allow `create` only; `update` and `delete` are unconditionally denied (`false`).
4. **Immutable Audit Columns**: On every update, `organizationId`, `createdBy`, and `createdAt` must remain unchanged (`== existing()`), and `updatedAt` must equal `request.time`.
5. **No Unauthenticated Tenant Reads**: Only `shareLinks/{shareToken}` supports unauthenticated `get` by exact unguessable token; `list` is forbidden (`false`) so shared links cannot be enumerated.
6. **Storage Hardening**: Only active organization members can read organization storage files; uploads are restricted to images (`image/*`) and PDFs (`application/pdf`) under 10 MB.

## 2. The "Dirty Dozen" Attack Payloads (Must Return PERMISSION_DENIED)
1. Unauthenticated read on `/organizations/org1/items/item1`.
2. Cross-tenant read by an active member of `org1` targeting `/organizations/org2/invoices/inv1`.
3. Self-role escalation: `Sales` user updating `/organizations/org1/members/{uid}` to set `role: 'Admin'`.
4. Read-only user attempting to create an item at `/organizations/org1/items/newItem`.
5. Warehouse user attempting to update `/organizations/org1/settings/general`.
6. Sales user attempting to delete or mutate `/organizations/org1/stockLedger/entry1`.
7. Any member attempting to update `/organizations/org1/activityLog/log1`.
8. Spoofed `createdBy` on item creation (`createdBy != request.auth.uid`).
9. Tenant spoofing on item creation (`organizationId: 'otherOrg'` inside `organizations/org1/items`).
10. Modifying immutable `createdAt` or `createdBy` during an item update.
11. Unauthenticated `list` query on `/shareLinks` to enumerate shared invoices.
12. Path ID poisoning (`1.5KB` document ID string) on `/organizations/org1/items/{poisonId}`.
