export interface SeedWarehouseDef {
  name: string;
  code: string;
  address: string;
  city: string;
  phone: string;
  isPrimary: boolean;
}

export const SEED_WAREHOUSES: SeedWarehouseDef[] = [
  {
    name: 'Main Store',
    code: 'WH-MAIN',
    address: 'No. 142, Panchikawatta Road',
    city: 'Colombo 10',
    phone: '+94 11 243 8890',
    isPrimary: true,
  },
  {
    name: 'Showroom',
    code: 'WH-SHOW',
    address: 'No. 88, Galle Road, Dehiwala',
    city: 'Colombo',
    phone: '+94 11 271 4412',
    isPrimary: false,
  },
];

export function filterMissingByKey<T>(
  candidates: T[],
  existingKeys: Iterable<string>,
  keySelector: (item: T) => string
): T[] {
  const existingSet = new Set(
    Array.from(existingKeys, (k) => k.trim().toLowerCase()).filter(Boolean)
  );
  const missing: T[] = [];
  for (const item of candidates) {
    const key = keySelector(item).trim().toLowerCase();
    if (!key || existingSet.has(key)) continue;
    existingSet.add(key);
    missing.push(item);
  }
  return missing;
}

export function mergeCounterNextNumber(
  existingNextNumber: number | undefined,
  seededNextNumber: number
): number {
  const existing = Number(existingNextNumber ?? 0);
  if (!Number.isFinite(existing) || existing < 1) return seededNextNumber;
  return Math.max(existing, seededNextNumber);
}
