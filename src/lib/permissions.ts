import { useSelector } from 'react-redux';
import type { RootState } from '@/store';

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
  const perms = user?.permissions ?? {};

  const access = (module: string): Access => (isAdmin ? 'edit' : (perms[module] as Access) ?? 'none');
  const canView = (module: string) => isAdmin || access(module) === 'view' || access(module) === 'edit';
  const canEdit = (module: string) => isAdmin || access(module) === 'edit';

  return { isAdmin, access, canView, canEdit };
}
