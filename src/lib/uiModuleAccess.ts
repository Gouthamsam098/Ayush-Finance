import type { Access, Permissions, UserRole } from '@/services/userApi';

/**
 * Backend `domain.Modules` has no "Reports" entry — Normalize() drops it on
 * save/load. The UI still needs a Reports toggle in Module Access, so VIEWER
 * Reports access is stored in localStorage and merged into permissions for
 * nav / guards. Admins ignore this (full access via role).
 */
const REPORTS_KEY = 'anush.ui.reportsAccess';

type ReportsMap = Record<string, Access>;

function readMap(): ReportsMap {
  try {
    const raw = localStorage.getItem(REPORTS_KEY);
    return raw ? (JSON.parse(raw) as ReportsMap) : {};
  } catch {
    return {};
  }
}

function writeMap(map: ReportsMap) {
  localStorage.setItem(REPORTS_KEY, JSON.stringify(map));
}

export function getUiReportsAccess(userId: number): Access {
  const a = readMap()[String(userId)];
  return a === 'view' || a === 'edit' || a === 'none' ? a : 'none';
}

export function setUiReportsAccess(userId: number, access: Access) {
  const map = readMap();
  map[String(userId)] = access === 'view' || access === 'edit' ? access : 'none';
  writeMap(map);
}

export function clearUiReportsAccess(userId: number) {
  const map = readMap();
  delete map[String(userId)];
  writeMap(map);
}

/** Merge UI-only Reports access into a permission map for display / RBAC. */
export function withUiModuleAccess(
  userId: number,
  role: UserRole | undefined,
  permissions: Permissions,
): Permissions {
  if (role === 'ADMIN') return permissions;
  return { ...permissions, Reports: getUiReportsAccess(userId) };
}
