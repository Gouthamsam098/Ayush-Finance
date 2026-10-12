import type { Collection, Customer, Loan } from '@/mock/DataContext';
import { listMockUsers } from '@/lib/mockUsers';
import { resolveCollector } from '@/lib/collectionCollector';
import { fmtDate, inr } from '@/lib/format';

export interface AgentCollectionSummary {
  /** Stable group key (user id or normalized name). */
  key: string;
  agentId: number | null;
  name: string;
  inactive: boolean;
  unattributed: boolean;
  payments: number;
  totalCollected: number;
  loansTouched: number;
  lastDate: string;
  receipts: Collection[];
}

function agentGroupKey(c: Collection): string | null {
  const who = resolveCollector(c);
  if (who.type !== 'RECOVERY_AGENT') return null;
  if (c.postedByUserId != null) return `id:${c.postedByUserId}`;
  const name = (c.collectorName?.trim() || who.name).trim();
  if (!name || name === '—') return 'unattributed';
  return `name:${name.toLowerCase()}`;
}

/** Recovery-agent receipts in period, optional search on agent / receipt / loan / customer. */
export function filterAgentCollections(
  collections: Collection[],
  loans: Loan[],
  customers: Customer[],
  since: string,
  q: string,
): Collection[] {
  const loanById = new Map(loans.map((l) => [l.id, l] as const));
  const nameById = new Map(customers.map((c) => [c.id, c.name] as const));
  const needle = q.trim().toLowerCase();

  let rows = collections.filter((c) => resolveCollector(c).type === 'RECOVERY_AGENT');
  if (since) rows = rows.filter((c) => c.date >= since);
  if (!needle) return rows;

  return rows.filter((c) => {
    const who = resolveCollector(c);
    const loan = loanById.get(c.loanId);
    const customer = loan ? nameById.get(loan.customerId) ?? '' : '';
    return who.name.toLowerCase().includes(needle)
      || c.receiptNo.toLowerCase().includes(needle)
      || (loan?.loanNumber.toLowerCase().includes(needle) ?? false)
      || customer.toLowerCase().includes(needle);
  });
}

export function summarizeAgentsByCollections(
  receipts: Collection[],
): AgentCollectionSummary[] {
  const users = listMockUsers().filter((u) => u.role === 'RECOVERY_AGENT');
  const userById = new Map(users.map((u) => [u.id, u] as const));

  const buckets = new Map<string, Collection[]>();

  for (const c of receipts) {
    const key = agentGroupKey(c);
    if (!key) continue;
    const list = buckets.get(key) ?? [];
    list.push(c);
    buckets.set(key, list);
  }

  const out: AgentCollectionSummary[] = [];

  for (const [key, list] of buckets) {
    const sorted = [...list].sort((a, b) => a.date.localeCompare(b.date));
    const totalCollected = list.reduce((s, c) => s + c.amount, 0);
    const loanIds = new Set(list.map((c) => c.loanId));
    const lastDate = sorted[sorted.length - 1]?.date ?? '';

    let agentId: number | null = null;
    let name = 'Unattributed';
    let inactive = false;
    let unattributed = key === 'unattributed';

    if (key.startsWith('id:')) {
      agentId = Number(key.slice(3));
      const u = userById.get(agentId);
      name = u?.fullName ?? list[0]?.collectorName?.trim() ?? resolveCollector(list[0]).name;
      inactive = u ? !u.isActive : false;
      if (name === '—' || !name) name = u?.fullName ?? 'Recovery agent';
    } else if (key.startsWith('name:')) {
      const slug = key.slice(5);
      const u = users.find((x) => x.fullName.trim().toLowerCase() === slug);
      if (u) {
        agentId = u.id;
        name = u.fullName;
        inactive = !u.isActive;
      } else {
        name = list[0]?.collectorName?.trim() || resolveCollector(list[0]).name;
        unattributed = true;
      }
    }

    out.push({
      key,
      agentId,
      name,
      inactive,
      unattributed,
      payments: list.length,
      totalCollected,
      loansTouched: loanIds.size,
      lastDate,
      receipts: [...list].sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id),
    });
  }

  return out.sort((a, b) => b.totalCollected - a.totalCollected || a.name.localeCompare(b.name));
}

export interface AgentBuiltReport {
  summaries: AgentCollectionSummary[];
  head: string[];
  body: (string | number)[][];
  rightAlignCols: number[];
  kpis: { label: string; value: string }[];
}

export function buildAgentCollectionReport(
  collections: Collection[],
  loans: Loan[],
  customers: Customer[],
  since: string,
  q: string,
): AgentBuiltReport {
  const receipts = filterAgentCollections(collections, loans, customers, since, q);
  const summaries = summarizeAgentsByCollections(receipts);
  const grandTotal = receipts.reduce((s, c) => s + c.amount, 0);
  const top = summaries[0];

  const body = summaries.map((a) => [
    a.name,
    a.unattributed ? 'Unattributed' : a.inactive ? 'Inactive' : 'Active',
    String(a.payments),
    inr(a.totalCollected),
    String(a.loansTouched),
    a.lastDate ? fmtDate(a.lastDate) : '—',
    a.payments ? inr(Math.round(a.totalCollected / a.payments)) : '—',
  ]);

  return {
    summaries,
    head: ['Agent', 'Status', 'Payments', 'Total collected', 'Loans', 'Last collection', 'Avg receipt'],
    body,
    rightAlignCols: [2, 3, 4, 6],
    kpis: [
      { label: 'Agents', value: String(summaries.length) },
      { label: 'Payments', value: String(receipts.length) },
      { label: 'Total collected', value: inr(grandTotal) },
      ...(top ? [{ label: 'Top collector', value: `${top.name} · ${inr(top.totalCollected)}` }] : []),
    ],
  };
}
