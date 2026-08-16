/**
 * Demo-mode (VITE_USE_API off) user directory — shared by Settings + Login so the
 * sidebar can show the real name/role for the email you signed in with.
 * Not used when the real backend is on.
 */
import type { Access, Permissions, UserRole } from '@/services/userApi';
import { todayISO } from '@/lib/format';

const USERS_KEY = 'anush.mock.users';
const SEQ_KEY = 'anush.mock.userSeq';
const PW_KEY = 'anush.mock.userPasswords';

export interface MockUser {
  id: number;
  email: string;
  fullName: string;
  role: UserRole;
  permissions: Permissions;
  isActive: boolean;
  createdAt: string;
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

export function findMockUserByEmail(email: string): MockUser | undefined {
  const key = email.trim().toLowerCase();
  return listMockUsers().find((u) => u.email.toLowerCase() === key && u.isActive);
}

/** Demo login — match Settings users. Password is not checked in demo mode. */
export function authenticateMock(email: string, _password: string): MockUser | null {
  return findMockUserByEmail(email) ?? null;
}

export function saveMockUser(input: {
  id?: number;
  email: string;
  fullName: string;
  role: UserRole;
  permissions: Permissions;
  password?: string;
  isActive?: boolean;
}): MockUser {
  const users = listMockUsers();
  const email = input.email.trim();
  if (input.id != null) {
    const next = users.map((u) => (u.id === input.id
      ? {
        ...u,
        email,
        fullName: input.fullName.trim(),
        role: input.role,
        permissions: input.permissions,
        isActive: input.isActive ?? u.isActive,
      }
      : u));
    writeUsers(next);
    if (input.password) {
      const pw = readPasswords();
      pw[email.toLowerCase()] = input.password;
      writePasswords(pw);
    }
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
  };
  writeUsers([created, ...users]);
  if (input.password) {
    const pw = readPasswords();
    pw[email.toLowerCase()] = input.password;
    writePasswords(pw);
  }
  return created;
}

export function setMockUserActive(id: number, isActive: boolean): void {
  writeUsers(listMockUsers().map((u) => (u.id === id ? { ...u, isActive } : u)));
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
}

export type { Access };
