import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const rulesPath = path.resolve(process.cwd(), 'firestore.rules');
const rulesText = fs.readFileSync(rulesPath, 'utf8');

test('firestore.rules enforces default deny and rules_version 2', () => {
  assert.match(rulesText, /rules_version\s*=\s*'2';/);
  assert.match(rulesText, /match \/\{document=\*\*\}\s*\{\s*allow read, write: if false;\s*\}/);
});

test('stockLedger and activityLog are strictly append-only', () => {
  assert.match(rulesText, /match \/stockLedger\/\{entryId\}[\s\S]*?allow update, delete: if false;/);
  assert.match(rulesText, /match \/activityLog\/\{logId\}[\s\S]*?allow update, delete: if false;/);
});

test('shareLinks forbids list enumeration', () => {
  assert.match(rulesText, /match \/shareLinks\/\{shareToken\}[\s\S]*?allow list: if false;/);
});

test('email-based invite checks enforce email_verified == true', () => {
  assert.match(rulesText, /request\.auth\.token\.email_verified == true/);
});

test('all requested subcollections have explicit match blocks', () => {
  const required = [
    'items', 'itemGroups', 'compositeItems', 'priceLists', 'warehouses',
    'stockLedger', 'adjustments', 'transferOrders', 'customers', 'vendors',
    'salesOrders', 'packages', 'shipments', 'invoices', 'paymentsReceived',
    'salesReturns', 'creditNotes', 'purchaseOrders', 'purchaseReceives',
    'bills', 'paymentsMade', 'vendorCredits', 'taxes', 'documents',
    'activityLog', 'notifications', 'counters', 'members', 'invites', 'settings'
  ];
  for (const col of required) {
    assert.ok(rulesText.includes(`match /${col}/`), `Missing match block for ${col}`);
  }
});
