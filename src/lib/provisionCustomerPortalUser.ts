/**
 * Customer portal logins live in the demo user directory (Settings + Login) until
 * the backend exposes a CUSTOMER role. Used when an admin adds a borrower email
 * and sets a portal password on the customer form.
 */
import {
  findPortalUserForCustomer,
  listMockUsers,
  saveMockUser,
} from '@/lib/mockUsers';

export function portalCredentialErrors(
  email: string,
  password: string,
  confirm: string,
  customerId?: number,
): Record<string, string> {
  const trimmed = email.trim();
  if (!trimmed) return {};

  const errors: Record<string, string> = {};
  if (!password) {
    errors.portalPassword = 'Portal password is required';
  } else if (password.length < 8) {
    errors.portalPassword = 'Use at least 8 characters';
  }
  if (!confirm) {
    errors.portalConfirm = 'Confirm the portal password';
  } else if (password && password !== confirm) {
    errors.portalConfirm = 'Passwords do not match';
  }

  const key = trimmed.toLowerCase();
  if (listMockUsers().some((u) => u.email.toLowerCase() === key)) {
    errors.email = 'This email is already used for a login';
  }
  if (customerId != null && findPortalUserForCustomer(customerId)) {
    errors.portalPassword = 'This customer already has a portal login';
  }
  return errors;
}

export function provisionCustomerPortalUser(input: {
  customerId: number;
  email: string;
  fullName: string;
  password: string;
}): void {
  const email = input.email.trim();
  const existing = findPortalUserForCustomer(input.customerId);
  if (existing) {
    throw new Error('This customer already has a portal login');
  }
  if (listMockUsers().some((u) => u.email.toLowerCase() === email.toLowerCase())) {
    throw new Error('This email is already used for a login');
  }
  saveMockUser({
    email,
    fullName: input.fullName.trim(),
    role: 'CUSTOMER',
    permissions: {},
    password: input.password,
    linkedCustomerId: input.customerId,
  });
}
