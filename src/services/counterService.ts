import { doc, runTransaction, serverTimestamp, Transaction } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';

export type CounterType =
  | 'salesOrders'
  | 'packages'
  | 'shipments'
  | 'invoices'
  | 'paymentsReceived'
  | 'salesReturns'
  | 'creditNotes'
  | 'purchaseOrders'
  | 'purchaseReceives'
  | 'bills'
  | 'paymentsMade'
  | 'vendorCredits'
  | 'adjustments'
  | 'transferOrders';

export const DEFAULT_COUNTER_CONFIG: Record<CounterType, { prefix: string; padding: number }> = {
  salesOrders: { prefix: 'SO-', padding: 5 },
  packages: { prefix: 'PKG-', padding: 5 },
  shipments: { prefix: 'SHP-', padding: 5 },
  invoices: { prefix: 'INV-', padding: 6 },
  paymentsReceived: { prefix: 'PAY-', padding: 5 },
  salesReturns: { prefix: 'SR-', padding: 5 },
  creditNotes: { prefix: 'CN-', padding: 5 },
  purchaseOrders: { prefix: 'PO-', padding: 5 },
  purchaseReceives: { prefix: 'PR-', padding: 5 },
  bills: { prefix: 'BILL-', padding: 5 },
  paymentsMade: { prefix: 'PM-', padding: 5 },
  vendorCredits: { prefix: 'VC-', padding: 5 },
  adjustments: { prefix: 'ADJ-', padding: 5 },
  transferOrders: { prefix: 'TO-', padding: 5 },
};

export async function getNextDocumentNumberInTx(
  tx: Transaction,
  orgId: string,
  counterType: CounterType,
  userId: string,
  customPrefixes?: Record<string, string>
): Promise<string> {
  const ref = doc(db, `organizations/${orgId}/counters/${counterType}`);
  const snap = await tx.get(ref);
  const defaults = DEFAULT_COUNTER_CONFIG[counterType];
  const prefixOverride = customPrefixes?.[counterType];

  let prefix = prefixOverride || defaults.prefix;
  let padding = defaults.padding;
  let currentNumber = 1;

  if (snap.exists()) {
    const data = snap.data() as { prefix?: string; nextNumber?: number; padding?: number };
    prefix = prefixOverride || data.prefix || defaults.prefix;
    padding = data.padding || defaults.padding;
    currentNumber = Number(data.nextNumber ?? 1);
  }

  const formatted = `${prefix}${String(currentNumber).padStart(padding, '0')}`;

  tx.set(ref, {
    organizationId: orgId,
    prefix,
    nextNumber: currentNumber + 1,
    padding,
    updatedAt: serverTimestamp(),
    updatedBy: userId,
  });

  return formatted;
}

export async function allocateDocumentNumber(
  orgId: string,
  counterType: CounterType,
  userId: string,
  customPrefixes?: Record<string, string>
): Promise<string> {
  const path = `organizations/${orgId}/counters/${counterType}`;
  try {
    return await runTransaction(db, (tx) =>
      getNextDocumentNumberInTx(tx, orgId, counterType, userId, customPrefixes)
    );
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, path);
  }
}
