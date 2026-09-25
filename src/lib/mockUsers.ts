/**
 * Demo-mode (VITE_USE_API off) user directory — shared by Settings + Login so the
 * sidebar can show the real name/role for the email you signed in with.
 * Not used when the real backend is on.
 */
import type { Access, Permissions } from '@/services/userApi';
import type { AppUserRole } from '@/types/appUser';
import { todayISO } from '@/lib/format';
import { mergeMockAuthIntoBook, readMockBookRaw, type MockAuthBookSlice as BookAuthSlice } from '@/lib/mockBookPersistence';

const USERS_KEY = 'anush.mock.users';
const SEQ_KEY = 'anush.mock.userSeq';
const PW_KEY = 'anush.mock.userPasswords';

export interface MockUser {
  id: number;
  email: string;
  fullName: string;
  role: AppUserRole;
  permissions: Permissions;
  isActive: boolean;
  createdAt: string;
  /** Portal login: exactly one customer record (demo CUSTOMER role). */
  linkedCustomerId?: number;
}

function readUsers(): MockUser[] {
  try {
    const raw = localStorage.getItem(USERS_KEY);
    return raw ? (JSON.parse(raw) as MockUser[]) : [];
  } catch {
    return [];
  }
}

function writeUsers(users: MockUser[]) {
  localStorage.setItem(USERS_KEY, JSON.stringify(users));
}

function readPasswords(): Record<string, string> {
  try {
    const raw = localStorage.getItem(PW_KEY);
    return raw ? (JSON.parse(raw) as Record<string, string>) : {};
  } catch {
    return {};
  }
}

function writePasswords(map: Record<string, string>) {
  localStorage.setItem(PW_KEY, JSON.stringify(map));
}

function nextId(): number {
  const n = Number(localStorage.getItem(SEQ_KEY) || '100') + 1;
  localStorage.setItem(SEQ_KEY, String(n));
  return n;
}

/** Ensure a bootstrap admin exists so Settings/Login always have one account. */
export function ensureMockUsers(): MockUser[] {
  const users = readUsers();
  if (users.length > 0) return users;
  const admin: MockUser = {
    id: 1,
    email: 'admin@demo.local',
    fullName: 'Administrator',
    role: 'ADMIN',
    permissions: {},
    isActive: true,
    createdAt: todayISO(),
  };
  writeUsers([admin]);
  writePasswords({ [admin.email.toLowerCase()]: 'admin123' });
  localStorage.setItem(SEQ_KEY, '100');
  return [admin];
}

export function listMockUsers(): MockUser[] {
  return ensureMockUsers();
}

export function getMockAuthBookSlice(): BookAuthSlice {
  return {
    mockUsers: readUsers(),
    mockPasswords: readPasswords(),
    mockUserSeq: Number(localStorage.getItem(SEQ_KEY) || '100'),
  };
}

/** Restore demo users/passwords from the mock book (e.g. new browser profile). */
export function applyMockAuthBookSlice(slice: Partial<BookAuthSlice>): void {
  if (slice.mockUserSeq != null) localStorage.setItem(SEQ_KEY, String(slice.mockUserSeq));
  if (slice.mockUsers?.length) {
    const byId = new Map(listMockUsers().map((u) => [u.id, u]));
    for (const u of slice.mockUsers as MockUser[]) byId.set(u.id, u);
    writeUsers([...byId.values()]);
  }
  if (slice.mockPasswords && Object.keys(slice.mockPasswords).length > 0) {
    writePasswords({ ...readPasswords(), ...slice.mockPasswords });
  }
}

export function hydrateMockUsersFromBook(): void {
  const book = readMockBookRaw();
  if (!book?.mockUsers?.length && !book?.mockPasswords) return;
  applyMockAuthBookSlice({
    mockUsers: book.mockUsers,
    mockPasswords: book.mockPasswords,
    mockUserSeq: book.mockUserSeq,
  });
}

function syncAuthToBook(): void {
  mergeMockAuthIntoBook(getMockAuthBookSlice());
}

export function findMockUserByEmail(email: string): MockUser | undefined {
  const key = email.trim().toLowerCase();
  return listMockUsers().find((u) => u.email.toLowerCase() === key && u.isActive);
}

/** Demo login — email + password must match Settings (passwords keyed by user email). */
export function authenticateMock(email: string, password: string): MockUser | null {
  const u = findMockUserByEmail(email);
  if (!u) return null;
  const key = u.email.trim().toLowerCase();
  const expected = readPasswords()[key];
  if (!expected || expected !== password) return null;
  return u;
}

export function findPortalUserForCustomer(customerId: number, excludeUserId?: number): MockUser | undefined {
  return listMockUsers().find(
    (u) => u.role === 'CUSTOMER' && u.isActive && u.linkedCustomerId === customerId && u.id !== excludeUserId,
  );
}

export function getMockUserLinkedCustomerId(userId: number): number | undefined {
  return listMockUsers().find((u) => u.id === userId)?.linkedCustomerId;
}

export function mockUserPasswordIsSet(userId: number): boolean {
  const u = listMockUsers().find((x) => x.id === userId);
  if (!u) return false;
  return Boolean(readPasswords()[u.email.trim().toLowerCase()]);
}

export function saveMockUser(input: {
  id?: number;
  email: string;
  fullName: string;
  role: AppUserRole;
  permissions: Permissions;
  password?: string;
  isActive?: boolean;
  linkedCustomerId?: number | null;
}): MockUser {
  const users = listMockUsers();
  const email = input.email.trim();
  if (input.id != null) {
    const existing = users.find((u) => u.id === input.id);
    const next = users.map((u) => (u.id === input.id
      ? {
        ...u,
        email,
        fullName: input.fullName.trim(),
        role: input.role,
        permissions: input.permissions,
        isActive: input.isActive ?? u.isActive,
        linkedCustomerId: input.role === 'CUSTOMER'
          ? (input.linkedCustomerId ?? existing?.linkedCustomerId)
          : undefined,
      }
      : u));
    writeUsers(next);
    const pw = readPasswords();
    if (existing && existing.email.trim().toLowerCase() !== email.toLowerCase()) {
      const oldKey = existing.email.trim().toLowerCase();
      if (pw[oldKey] && !input.password) {
        pw[email.toLowerCase()] = pw[oldKey];
        delete pw[oldKey];
      }
    }
    if (input.password) {
      pw[email.toLowerCase()] = input.password;
    }
    writePasswords(pw);
    syncAuthToBook();
    return next.find((u) => u.id === input.id)!;
  }
  const created: MockUser = {
    id: nextId(),
    email,
    fullName: input.fullName.trim(),
    role: input.role,
    permissions: input.permissions,
    isActive: true,
    createdAt: todayISO(),
    linkedCustomerId: input.role === 'CUSTOMER' ? input.linkedCustomerId ?? undefined : undefined,
  };
  writeUsers([created, ...users]);
  const pw = readPasswords();
  if (input.password) {
    pw[email.toLowerCase()] = input.password;
  }
  writePasswords(pw);
  syncAuthToBook();
  return created;
}

export function setMockUserActive(id: number, isActive: boolean): void {
  writeUsers(listMockUsers().map((u) => (u.id === id ? { ...u, isActive } : u)));
  syncAuthToBook();
}

export function removeMockUser(id: number): void {
  const users = listMockUsers();
  const gone = users.find((u) => u.id === id);
  writeUsers(users.filter((u) => u.id !== id));
  if (gone) {
    const pw = readPasswords();
    delete pw[gone.email.toLowerCase()];
    writePasswords(pw);
  }
  syncAuthToBook();
}

export type { Access };
