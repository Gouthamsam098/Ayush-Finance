import { useSelector } from 'react-redux';
import type { RootState } from '@/store';
import { withUiModuleAccess } from '@/lib/uiModuleAccess';

export type Access = 'none' | 'view' | 'edit';

/**
 * RBAC helper for the UI. The BACKEND is the authority (it rejects unauthorized
 * writes with 403); this only hides/disables controls so a view-only user
 * doesn't see actions they can't perform. Admins can do everything.
 *
 *   const { canEdit } = usePermissions();
 *   {canEdit('Customers') && <Button>Add customer</Button>}
 */
export function usePermissions() {
  const user = useSelector((s: RootState) => s.auth.user);
  const isAdmin = user?.role === 'ADMIN';
  const isRecoveryAgent = user?.role === 'RECOVERY_AGENT';
  const isCustomer = user?.role === 'CUSTOMER';
  const perms = withUiModuleAccess(user?.id ?? 0, user?.role as import('@/services/userApi').UserRole | undefined, user?.permissions ?? {});

  const access = (module: string): Access => {
    if (isAdmin) return 'edit';
    if (isCustomer) return 'none';
    if (isRecoveryAgent) return module === 'Collections' ? 'edit' : 'none';
    return (perms[module] as Access) ?? 'none';
  };
  const canView = (module: string) => !isCustomer && (isAdmin
    || (isRecoveryAgent && module === 'Collections')
    || access(module) === 'view'
    || access(module) === 'edit');
  const canEdit = (module: string) => !isCustomer && (isAdmin
    || (isRecoveryAgent && module === 'Collections')
    || access(module) === 'edit');

  return { isAdmin, isRecoveryAgent, isCustomer, access, canView, canEdit };
}
