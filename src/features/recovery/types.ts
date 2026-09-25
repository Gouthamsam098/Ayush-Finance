import type { PayMode } from '@/mock/DataContext';

export type RecoverySubmissionType = 'COLLECTION_CLAIM' | 'PROMISE_TO_PAY';

export type CollectionClaimStatus = 'PENDING' | 'APPROVED' | 'REJECTED';
export type PromiseStatus = 'OPEN' | 'FULFILLED' | 'CANCELLED';

export interface RecoverySubmissionBase {
  id: string;
  loanId: number;
  agentUserId: number;
  agentName: string;
  customerName: string;
  loanNumber: string;
  type: RecoverySubmissionType;
  note?: string;
  createdAt: string;
  reviewedAt?: string;
  reviewNote?: string;
}

export interface CollectionClaimSubmission extends RecoverySubmissionBase {
  type: 'COLLECTION_CLAIM';
  status: CollectionClaimStatus;
  amount: number;
  mode: PayMode;
  receiptDate: string;
  collectionId?: number;
}

export interface PromiseSubmission extends RecoverySubmissionBase {
  type: 'PROMISE_TO_PAY';
  status: PromiseStatus;
  promiseDate: string;
  promisedAmount?: number;
}

export type RecoverySubmission = CollectionClaimSubmission | PromiseSubmission;
