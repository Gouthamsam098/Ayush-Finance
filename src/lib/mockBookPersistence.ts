/**
 * Demo mode (VITE_USE_API off): persist the in-memory book to localStorage so a
 * refresh does not wipe customers, loans, collections, or expenses.
 * API mode never reads or writes this snapshot.
 */
import { config } from '@/lib/config';
import type { Collection, Customer, DocItem, Expense, Loan } from '@/mock/DataContext';
export interface MockAuthBookSlice {
  mockUsers: unknown[];
  mockPasswords: Record<string, string>;
  mockUserSeq: number;
}

const KEY = 'anush.mock.book';
const VERSION = 1;

export interface MockBookSnapshot {
  v: number;
  customers: Customer[];
  loans: Loan[];
  collections: Collection[];
  expenses: Expense[];
  documents: DocItem[];
  codeSeq: number;
  loanSeq: number;
  rcptSeq: number;
  /** Monotonic id allocator for mock entities (customers, loans, …). */
  uidSeq: number;
  /** Demo portal logins — synced so auth survives refresh and can be copied across browsers. */
  mockUsers?: unknown[];
  mockPasswords?: Record<string, string>;
  mockUserSeq?: number;
}

export function readMockBookRaw(): MockBookSnapshot | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as MockBookSnapshot;
    if (parsed.v !== VERSION) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** Merge portal user directory into the mock book blob (works in API mode too). */
export function mergeMockAuthIntoBook(auth: MockAuthBookSlice): void {
  try {
    const existing = readMockBookRaw();
    const base: MockBookSnapshot = existing ?? {
      v: VERSION,
      customers: [],
      loans: [],
      collections: [],
      expenses: [],
      documents: [],
      codeSeq: 1001,
      loanSeq: 4001,
      rcptSeq: 100001,
      uidSeq: 1000,
    };
    localStorage.setItem(KEY, JSON.stringify({
      ...base,
      mockUsers: auth.mockUsers,
      mockPasswords: auth.mockPasswords,
      mockUserSeq: auth.mockUserSeq,
    }));
  } catch {
    /* ignore quota */
  }
}

/** Highest id in the snapshot so new records never reuse a deleted customer's id. */
export function mockUidFloor(snap: MockBookSnapshot | null): number {
  let m = snap?.uidSeq ?? 1000;
  const bump = (id: number) => { if (id > m) m = id; };
  snap?.customers.forEach((c) => bump(c.id));
  snap?.loans.forEach((l) => bump(l.id));
  snap?.collections.forEach((c) => bump(c.id));
  snap?.expenses.forEach((e) => bump(e.id));
  snap?.documents.forEach((d) => bump(d.id));
  return m;
}

/** Reassign ids when legacy demo data reused the same numeric id for two customers. */
export function repairDuplicateCustomerIds(snap: MockBookSnapshot): MockBookSnapshot {
  const seen = new Set<number>();
  let uid = mockUidFloor(snap);
  let changed = false;
  const customers = snap.customers.map((c) => {
    if (!seen.has(c.id)) {
      seen.add(c.id);
      return c;
    }
    changed = true;
    uid += 1;
    return { ...c, id: uid };
  });
  if (!changed) return snap;
  return { ...snap, customers, uidSeq: Math.max(snap.uidSeq ?? 1000, uid) };
}

export function loadMockBook(): MockBookSnapshot | null {
  if (config.useApi) return null;
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as MockBookSnapshot;
    if (parsed.v !== VERSION || !Array.isArray(parsed.customers)) return null;
    return repairDuplicateCustomerIds(parsed);
  } catch {
    return null;
  }
}

export function saveMockBook(snap: Omit<MockBookSnapshot, 'v'>) {
  if (config.useApi) return;
  try {
    localStorage.setItem(KEY, JSON.stringify({ v: VERSION, ...snap }));
  } catch {
    // Quota exceeded (e.g. large document data URLs) — persist without documents.
    try {
      localStorage.setItem(KEY, JSON.stringify({
        v: VERSION,
        ...snap,
        documents: [],
      }));
    } catch {
      /* ignore */
    }
  }
}
