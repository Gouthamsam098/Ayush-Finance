/**
 * Managed-user (Settings) API — admin-only endpoints under /api/v1/users.
 * The backend enforces RBAC + last-admin/self guards; the UI mirrors the same
 * intent for a good UX but the server is the authority.
 */

import { api } from '@/lib/api';

export type UserRole = 'ADMIN' | 'VIEWER';
export type Access = 'none' | 'view' | 'edit';
export type Permissions = Record<string, Access>;

/** App modules a Viewer's access can be scoped to.
 *  Includes UI-only `Reports` (not in backend Modules — see `uiModuleAccess.ts`). */
export const MODULES = ['Dashboard', 'Customers', 'Loans', 'Collections', 'Expenses', 'Documents', 'Reports', 'Settings'] as const;

export interface ManagedUser {
  id: number;
  email: string;
  fullName: string;
  role: UserRole;
  permissions: Permissions;
  isActive: boolean;
  lastLoginAt?: string;
  createdAt: string;
}

interface UserWire {
  id: number;
  email: string;
  full_name: string;
  role: UserRole;
  permissions: Permissions;
  is_active: boolean;
  last_login_at?: string;
  created_at: string;
}

function toUser(w: UserWire): ManagedUser {
  return {
    id: w.id,
    email: w.email,
    fullName: w.full_name,
    role: w.role,
    permissions: w.permissions ?? {},
    isActive: w.is_active,
    lastLoginAt: w.last_login_at,
    createdAt: w.created_at,
  };
}

export interface UserCreateInput {
  email: string;
  fullName: string;
  password: string;
  role: UserRole;
  permissions: Permissions;
}

export interface UserUpdateInput {
  email: string;
  fullName: string;
  role: UserRole;
  permissions: Permissions;
  isActive: boolean;
  password?: string; // blank/omitted = keep existing
}

export const userApi = {
  async list(): Promise<ManagedUser[]> {
    return ((await api.get<UserWire[]>('/users')) ?? []).map(toUser);
  },

  async create(input: UserCreateInput): Promise<ManagedUser> {
    return toUser(await api.post<UserWire>('/users', {
      email: input.email,
      full_name: input.fullName,
      password: input.password,
      role: input.role,
      permissions: input.permissions,
    }));
  },

  async update(id: number, input: UserUpdateInput): Promise<ManagedUser> {
    const body: Record<string, unknown> = {
      email: input.email,
      full_name: input.fullName,
      role: input.role,
      permissions: input.permissions,
      is_active: input.isActive,
    };
    if (input.password) body.password = input.password;
    return toUser(await api.patch<UserWire>(`/users/${id}`, body));
  },

  async setActive(id: number, u: ManagedUser, isActive: boolean): Promise<ManagedUser> {
    // Update reuses the same endpoint; send current fields with the new flag.
    return this.update(id, { email: u.email, fullName: u.fullName, role: u.role, permissions: u.permissions, isActive });
  },

  async remove(id: number): Promise<void> {
    await api.delete(`/users/${id}`);
  },
};
