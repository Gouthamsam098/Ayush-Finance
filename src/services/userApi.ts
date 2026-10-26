/**
 * Managed-user (Settings) API — admin-only endpoints under /api/v1/users.
 * The backend enforces RBAC + last-admin/self guards; the UI mirrors the same
 * intent for a good UX but the server is the authority.
 */

import { api } from '@/lib/api';

export type UserRole = 'ADMIN' | 'VIEWER' | 'RECOVERY_AGENT' | 'CUSTOMER';
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
  /** CUSTOMER portal login: the customer record it belongs to. */
  customerId?: number;
  /** RECOVERY_AGENT: the loans assigned to them. */
  assignedLoanIds?: number[];
  /** Two-factor authentication is on for this account (server-enforced). */
  mfaEnabled?: boolean;
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
  customer_id?: number;
  assigned_loan_ids?: number[];
  mfa_enabled?: boolean;
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
    customerId: w.customer_id,
    assignedLoanIds: w.assigned_loan_ids,
    mfaEnabled: w.mfa_enabled ?? false,
  };
}

/** Role-specific fields: a customer's linked record, an agent's loans. */
function roleFields(input: { role: UserRole; customerId?: number | null; assignedLoanIds?: number[] }): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (input.role === 'CUSTOMER') out.customer_id = input.customerId ?? null;
  if (input.role === 'RECOVERY_AGENT' && input.assignedLoanIds) out.assigned_loan_ids = input.assignedLoanIds;
  return out;
}

export interface UserCreateInput {
  email: string;
  fullName: string;
  password: string;
  role: UserRole;
  permissions: Permissions;
  customerId?: number | null;
  assignedLoanIds?: number[];
}

export interface UserUpdateInput {
  email: string;
  fullName: string;
  role: UserRole;
  permissions: Permissions;
  isActive: boolean;
  password?: string; // blank/omitted = keep existing
  customerId?: number | null;
  assignedLoanIds?: number[];
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
      ...roleFields(input),
    }));
  },

  async update(id: number, input: UserUpdateInput): Promise<ManagedUser> {
    const body: Record<string, unknown> = {
      email: input.email,
      full_name: input.fullName,
      role: input.role,
      permissions: input.permissions,
      is_active: input.isActive,
      ...roleFields(input),
    };
    if (input.password) body.password = input.password;
    return toUser(await api.patch<UserWire>(`/users/${id}`, body));
  },

  async setActive(id: number, u: ManagedUser, isActive: boolean): Promise<ManagedUser> {
    // Update reuses the same endpoint; send current fields with the new flag.
    // Agent loans are left unchanged (omitted); a customer keeps its link.
    return this.update(id, { email: u.email, fullName: u.fullName, role: u.role, permissions: u.permissions, isActive, customerId: u.customerId });
  },

  async remove(id: number): Promise<void> {
    await api.delete(`/users/${id}`);
  },

  /** Open "Forgot password?" requests. Setting the user's new password via
   *  update() closes theirs automatically on the server. */
  async passwordResetRequests(): Promise<PasswordResetRequest[]> {
    const rows = (await api.get<PasswordResetRequestWire[]>('/users/password-reset-requests')) ?? [];
    return rows.map((w) => ({
      id: w.id, userId: w.user_id, email: w.email, fullName: w.full_name, role: w.role,
      requestCount: w.request_count, requestedAt: w.requested_at, lastRequestedAt: w.last_requested_at,
    }));
  },

  /** Close a request without resetting (it was not them, or handled otherwise). */
  async dismissPasswordResetRequest(id: number): Promise<void> {
    await api.post(`/users/password-reset-requests/${id}/dismiss`, {});
  },

  /** Lost phone: turn another user's two-factor off so they can set it up again. */
  async resetMfa(id: number): Promise<void> {
    await api.post(`/users/${id}/mfa/reset`, {});
  },
};

export interface PasswordResetRequest {
  id: number;
  userId: number;
  email: string;
  fullName: string;
  role: UserRole;
  requestCount: number;
  requestedAt: string;
  lastRequestedAt: string;
}

interface PasswordResetRequestWire {
  id: number;
  user_id: number;
  email: string;
  full_name: string;
  role: UserRole;
  request_count: number;
  requested_at: string;
  last_requested_at: string;
}
