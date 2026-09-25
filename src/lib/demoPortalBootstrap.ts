import type { Customer } from '@/mock/DataContext';
import {
  findMockUserByEmail,
  mockUserPasswordIsSet,
  saveMockUser,
} from '@/lib/mockUsers';

/**
 * Optional team bootstrap: same portal login on every browser when `.env.local`
 * defines these (share the file across machines — never commit real passwords).
 */
export function ensureDemoPortalUserFromEnv(customers: Customer[] = []): void {
  const email = (import.meta.env.VITE_DEMO_PORTAL_EMAIL as string | undefined)?.trim();
  const password = import.meta.env.VITE_DEMO_PORTAL_PASSWORD as string | undefined;
  const code = (import.meta.env.VITE_DEMO_PORTAL_CUSTOMER_CODE as string | undefined)?.trim();
  const idRaw = (import.meta.env.VITE_DEMO_PORTAL_CUSTOMER_ID as string | undefined)?.trim();
  if (!email || !password) return;

  const byCode = code ? customers.find((c) => c.code === code) : undefined;
  const idFromEnv = idRaw ? Number(idRaw) : NaN;
  const linkedCustomerId = byCode?.id ?? (!Number.isNaN(idFromEnv) ? idFromEnv : undefined);
  if (linkedCustomerId == null) return;

  const fullName = byCode?.name ?? email.split('@')[0] ?? 'Customer';

  const existing = findMockUserByEmail(email);
  if (existing && existing.linkedCustomerId === linkedCustomerId && mockUserPasswordIsSet(existing.id)) {
    return;
  }

  saveMockUser({
    id: existing?.id,
    email,
    fullName,
    role: 'CUSTOMER',
    permissions: {},
    password,
    linkedCustomerId,
    isActive: true,
  });
}
