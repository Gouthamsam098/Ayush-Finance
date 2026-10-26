import type { PaymentProofRecord } from '@/features/customer-portal/paymentProofStore';
import {
  acknowledgePaymentProofEvidence,
  getLatestPaymentProof,
  listPaymentProofs,
} from '@/features/customer-portal/paymentProofStore';
import { fmtDate, inr } from '@/lib/format';
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
  if (proof.status === 'verified') return 'Verified';
  return 'Rejected';
}

/** After Recovery queue Accept, clear matching agent proofs from admin review (evidence only). */
export function acknowledgeMatchingAgentProofsForClaim(claim: CollectionClaimSubmission): void {
  for (const p of listPaymentProofs()) {
    if (p.status !== 'pending') continue;
    if (p.loanId !== claim.loanId || p.amountRupees !== claim.amount) continue;
    const agent = Boolean(p.recoveryAgentName) || p.submittedByRole === 'RECOVERY_AGENT';
    if (!agent) continue;
    acknowledgePaymentProofEvidence(p.id);
  }
}

export function recoveryClaimStatusLine(
  claim: CollectionClaimSubmission,
  latestProof: PaymentProofRecord | null | undefined,
): { message: string; tone: ClaimStatusTone } {
  if (claim.status === 'REJECTED') {
    return { message: 'Rejected — resubmit from Collect', tone: 'danger' };
  }
  if (claim.status === 'PENDING') {
    const base = `Awaiting admin approval · ${inr(claim.amount)} · ${claim.mode}`;
    if (claim.mode === 'UPI' && latestProof?.status === 'pending') {
      return { message: `${base} · Screenshot submitted`, tone: 'pending' };
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
    return { message: 'Recorded · Screenshot verified', tone: 'success' };
  }
  return {
    message: `Recorded · ${inr(claim.amount)} · ${claim.mode} on ${fmtDate(claim.receiptDate)}`,
    tone: 'success',
  };
}

/** UI guard: agent proof Accept may double-book if recovery claim already approved for same loan + amount. */
export function proofConflictsWithApprovedClaim(
  proof: PaymentProofRecord,
  submissions: RecoverySubmission[],
): boolean {
  const agentProof =
    Boolean(proof.recoveryAgentName) || proof.submittedByRole === 'RECOVERY_AGENT';
  if (!agentProof || proof.status !== 'pending') return false;
  return submissions.some(
    (s) =>
      s.type === 'COLLECTION_CLAIM'
      && s.status === 'APPROVED'
      && s.loanId === proof.loanId
      && s.amount === proof.amountRupees,
  );
}

export function latestProofForLoan(loanId: number): PaymentProofRecord | null {
  return getLatestPaymentProof(loanId);
}
