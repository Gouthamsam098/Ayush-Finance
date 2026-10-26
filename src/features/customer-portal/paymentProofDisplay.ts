import type { PaymentProofRecord } from '@/features/customer-portal/paymentProofStore';

export interface PaymentProofSubmissionMeta {
  /** Primary headline on the proof card */
  titleName: string;
  /** e.g. "Submitted by Ramesh" */
  submitterLine: string;
  roleLabel: 'Recovery agent' | 'Borrower';
  showBorrower: boolean;
  avatarName: string;
}

export function paymentProofSubmissionMeta(
  proof: PaymentProofRecord,
  borrowerName: string,
): PaymentProofSubmissionMeta {
  const role = proof.submittedByRole ?? (proof.recoveryAgentName ? 'RECOVERY_AGENT' : null);
  const submitter =
    proof.recoveryAgentName?.trim()
    || proof.submittedByName?.trim()
    || null;

  if (role === 'RECOVERY_AGENT' && submitter) {
    return {
      titleName: submitter,
      submitterLine: `Submitted by ${submitter}`,
      roleLabel: 'Recovery agent',
      showBorrower: true,
      avatarName: submitter,
    };
  }

  const who = submitter || borrowerName;
  return {
    titleName: borrowerName,
    submitterLine: `Submitted by ${who}`,
    roleLabel: 'Borrower',
    showBorrower: false,
    avatarName: borrowerName,
  };
}
