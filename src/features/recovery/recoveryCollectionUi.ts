import type { PaymentProofRecord } from '@/features/customer-portal/paymentProofStore';
import { fmtDate, inr, isoLocal } from '@/lib/format';
import type { CollectionClaimSubmission, RecoverySubmission } from './types';

export type PaymentProofFile = {
  fileName: string;
  mimeType: string;
  dataUrl: string;
};

export type ClaimStatusTone = 'pending' | 'success' | 'danger' | 'muted';

export function screenshotStatusLabel(proof: PaymentProofRecord | null | undefined): string {
  if (!proof) return 'Not submitted';
  if (proof.status === 'pending') return 'Pending review';
  if (proof.status === 'verified') return 'Accepted';
  return 'Rejected';
}

/** `latestProof` is the screenshot attached to this claim (latestProofForClaim). */
export function recoveryClaimStatusLine(
  claim: CollectionClaimSubmission,
  latestProof: PaymentProofRecord | null | undefined,
): { message: string; tone: ClaimStatusTone } {
  if (claim.status === 'REJECTED') {
    return { message: 'Rejected — resubmit from Collect', tone: 'danger' };
  }
  if (claim.status === 'PENDING') {
    const base = `Awaiting admin approval · ${inr(claim.amount)} · ${claim.mode}`;
    if (latestProof?.status === 'pending') {
      return { message: `${base} · Screenshot attached`, tone: 'pending' };
    }
    if (latestProof?.status === 'rejected') {
      return { message: `${base} · Screenshot rejected — upload again below`, tone: 'pending' };
    }
    return { message: base, tone: 'pending' };
  }
  if (latestProof?.status === 'rejected') {
    return { message: 'Recorded · Screenshot rejected — upload again below', tone: 'danger' };
  }
  if (latestProof?.status === 'pending') {
    return { message: 'Recorded · Screenshot under review', tone: 'pending' };
  }
  if (latestProof?.status === 'verified') {
    return { message: 'Recorded · Screenshot accepted', tone: 'success' };
  }
  return {
    message: `Recorded · ${inr(claim.amount)} · ${claim.mode} on ${fmtDate(claim.receiptDate)}`,
    tone: 'success',
  };
}

// ── possible duplicates the server cannot link ───────────────────────────────
//
// An agent's own screenshot is attached to their claim, so the server records
// that payment once. But a BORROWER may also upload a screenshot of the same
// payment from the portal; nothing ties the two together, and accepting both
// would book it twice. Same loan + same amount within a few days is flagged
// for the reviewer — a warning, never a block (equal instalments are normal).

const NEAR_DAYS = 3;

function dayNumber(iso: string): number {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return Math.round(new Date(y, m - 1, d).getTime() / 86_400_000);
}

const proofDay = (p: PaymentProofRecord) => isoLocal(new Date(p.submittedAt));

/** Agent collections (pending or accepted) that may be the same payment as this borrower screenshot. */
export function agentClaimsMatchingProof(
  proof: PaymentProofRecord,
  submissions: RecoverySubmission[],
): CollectionClaimSubmission[] {
  if (proof.claimId || proof.status === 'rejected') return [];
  const day = dayNumber(proofDay(proof));
  return submissions.filter((s): s is CollectionClaimSubmission =>
    s.type === 'COLLECTION_CLAIM'
    && (s.status === 'PENDING' || s.status === 'APPROVED')
    && s.loanId === proof.loanId
    && s.amount === proof.amountRupees
    && Math.abs(dayNumber(s.receiptDate) - day) <= NEAR_DAYS);
}

/** Borrower screenshots (pending or accepted) that may be the same payment as this agent claim. */
export function borrowerProofsMatchingClaim(
  claim: CollectionClaimSubmission,
  proofs: PaymentProofRecord[],
): PaymentProofRecord[] {
  const day = dayNumber(claim.receiptDate);
  return proofs.filter((p) =>
    !p.claimId
    && (p.status === 'pending' || p.status === 'verified')
    && p.loanId === claim.loanId
    && p.amountRupees === claim.amount
    && Math.abs(dayNumber(proofDay(p)) - day) <= NEAR_DAYS);
}
