import type { Collection } from '@/mock/DataContext';
import { listMockUsers } from '@/lib/mockUsers';

/** Who is credited for receiving the money (reporting), not only who clicked Save. */
export type CollectorType = 'ADMIN' | 'STAFF' | 'RECOVERY_AGENT' | 'CUSTOMER' | 'UNKNOWN';

export type CollectorFilter = 'ALL' | CollectorType;

export interface ResolvedCollector {
  type: CollectorType;
  /** Display name — agent, staff member, or borrower label. */
  name: string;
  roleLabel: string;
}

const ROLE_LABEL: Record<CollectorType, string> = {
  ADMIN: 'Admin',
  STAFF: 'Staff',
  RECOVERY_AGENT: 'Recovery agent',
  CUSTOMER: 'Customer',
  UNKNOWN: 'Unknown',
};

function effectiveCollectorType(c: Collection): CollectorType {
  if (c.collectorType === 'ADMIN') return 'ADMIN';
  if (c.collectorType === 'STAFF') {
    if (c.postedByUserId != null) {
      const u = listMockUsers().find((m) => m.id === c.postedByUserId);
      if (u?.role === 'ADMIN') return 'ADMIN';
      // Bootstrap admin is typically user id 1 when collections come from the API.
      if (c.postedByUserId === 1) return 'ADMIN';
    }
  }
  if (c.collectorType) return c.collectorType;
  return 'UNKNOWN';
}

/** Best-effort attribution for UI reports until backend stores collector fields. */
export function resolveCollector(c: Collection): ResolvedCollector {
  if (c.collectorType) {
    const type = effectiveCollectorType(c);
    return {
      type,
      name: c.collectorName?.trim() || ROLE_LABEL[type],
      roleLabel: ROLE_LABEL[type],
    };
  }

  const remarks = (c.remarks ?? '').toLowerCase();
  if (remarks.includes('recovery agent') || remarks.startsWith('recovery:') || remarks.includes('recovery:')) {
    const fromNote = c.remarks?.match(/Recovery:\s*(.+)/i)?.[1]?.trim();
    return {
      type: 'RECOVERY_AGENT',
      name: fromNote?.split('—')[0]?.trim() || '—',
      roleLabel: ROLE_LABEL.RECOVERY_AGENT,
    };
  }
  if (remarks.includes('customer portal') || remarks.includes('portal payment')) {
    return {
      type: 'CUSTOMER',
      name: c.collectorName?.trim() || '—',
      roleLabel: ROLE_LABEL.CUSTOMER,
    };
  }

  return { type: 'UNKNOWN', name: '—', roleLabel: ROLE_LABEL.UNKNOWN };
}

export function collectorMatchesFilter(c: Collection, filter: CollectorFilter): boolean {
  if (filter === 'ALL') return true;
  const type = resolveCollector(c).type;
  if (filter === 'STAFF') return type === 'STAFF' || type === 'ADMIN';
  return type === filter;
}

const ROLE_BY_LINE: Record<CollectorType, string> = {
  ADMIN: 'By admin',
  STAFF: 'By office staff',
  RECOVERY_AGENT: 'By recovery agent',
  CUSTOMER: 'By customer',
  UNKNOWN: 'Not recorded',
};

export interface LoanCollectorDisplay {
  name: string;
  roleLine: string;
  mixed: boolean;
}

/** Primary collector for a loan row in Reports (newest receipt wins on ties). */
export function loanCollectorDisplay(receipts: Collection[]): LoanCollectorDisplay | null {
  if (receipts.length === 0) return null;

  const resolved = receipts.map((r) => ({ receipt: r, who: resolveCollector(r) }));
  const keys = new Set(resolved.map(({ who }) => `${who.type}:${who.name}`));

  if (keys.size > 1) {
    const types = new Set(resolved.map(({ who }) => who.type));
    const label = types.has('RECOVERY_AGENT') ? 'Multiple agents' : 'Multiple collectors';
    return { name: label, roleLine: 'Several payments in this period', mixed: true };
  }

  const latest = [...receipts].sort((a, b) => b.date.localeCompare(a.date))[0];
  const who = resolveCollector(latest);
  const name = who.name !== '—' ? who.name : who.roleLabel;
  return {
    name,
    roleLine: ROLE_BY_LINE[who.type],
    mixed: false,
  };
}

/** One-line fallback (exports / screen readers). */
export function summarizeCollectors(receipts: Collection[]): string {
  const cell = loanCollectorDisplay(receipts);
  if (!cell) return '—';
  return `${cell.name} (${cell.roleLine})`;
}

export function collectorBadgeTone(type: CollectorType): 'neutral' | 'info' | 'ok' | 'warn' {
  switch (type) {
    case 'RECOVERY_AGENT': return 'ok';
    case 'ADMIN':
    case 'STAFF': return 'info';
    case 'CUSTOMER': return 'warn';
    default: return 'neutral';
  }
}

export function staffCollectorFields(user: { id: number; fullName: string; role: string }): Pick<Collection, 'collectorType' | 'collectorName' | 'postedByUserId'> {
  if (user.role === 'RECOVERY_AGENT') {
    return {
      collectorType: 'RECOVERY_AGENT',
      collectorName: user.fullName,
      postedByUserId: user.id,
    };
  }
  if (user.role === 'CUSTOMER') {
    return {
      collectorType: 'CUSTOMER',
      collectorName: user.fullName,
      postedByUserId: user.id,
    };
  }
  if (user.role === 'ADMIN') {
    return {
      collectorType: 'ADMIN',
      collectorName: user.fullName,
      postedByUserId: user.id,
    };
  }
  return {
    collectorType: 'STAFF',
    collectorName: user.fullName,
    postedByUserId: user.id,
  };
}
