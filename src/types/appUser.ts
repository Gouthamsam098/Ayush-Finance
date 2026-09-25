/** Frontend auth roles — RECOVERY_AGENT / CUSTOMER are mock/demo until backend adds them. */
export type AppUserRole = 'ADMIN' | 'VIEWER' | 'RECOVERY_AGENT' | 'CUSTOMER';

export function isRecoveryAgent(role?: string): boolean {
  return role === 'RECOVERY_AGENT';
}

export function isCustomerPortal(role?: string): boolean {
  return role === 'CUSTOMER';
}
