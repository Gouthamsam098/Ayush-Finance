import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { LoanType } from '@/mock/DataContext';
import {
  isLoanTypeUpiComplete,
  upiForLoanType,
  type LoanTypeUpiRow,
} from '@/lib/loanTypeUpi';
import type { LoanTypeUpiMap } from '@/lib/loanTypeUpi';
import { LOAN_TYPE_UPI_CHANGED, readLoanTypeUpiMap } from '@/lib/loanTypeUpiStore';

interface LoanTypeUpiContextValue {
  map: LoanTypeUpiMap;
  complete: boolean;
  refresh: () => void;
  credentialsFor: (loanType: LoanType) => LoanTypeUpiRow | null;
}

const LoanTypeUpiCtx = createContext<LoanTypeUpiContextValue | null>(null);

export function LoanTypeUpiProvider({ children }: { children: React.ReactNode }) {
  const [map, setMap] = useState<LoanTypeUpiMap>(() => readLoanTypeUpiMap());

  const refresh = useCallback(() => {
    setMap(readLoanTypeUpiMap());
  }, []);

  useEffect(() => {
    const onChange = () => refresh();
    const onStorage = (e: StorageEvent) => {
      if (e.key === 'anush.settings.loanTypeUpi' || e.key === null) refresh();
    };
    window.addEventListener(LOAN_TYPE_UPI_CHANGED, onChange);
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener(LOAN_TYPE_UPI_CHANGED, onChange);
      window.removeEventListener('storage', onStorage);
    };
  }, [refresh]);

  const complete = useMemo(() => isLoanTypeUpiComplete(map), [map]);

  const credentialsFor = useCallback(
    (loanType: LoanType) => upiForLoanType(map, loanType),
    [map],
  );

  const value = useMemo(
    () => ({ map, complete, refresh, credentialsFor }),
    [map, complete, refresh, credentialsFor],
  );

  return <LoanTypeUpiCtx.Provider value={value}>{children}</LoanTypeUpiCtx.Provider>;
}

export function useLoanTypeUpi(): LoanTypeUpiContextValue {
  const ctx = useContext(LoanTypeUpiCtx);
  if (!ctx) {
    throw new Error('useLoanTypeUpi must be used within LoanTypeUpiProvider');
  }
  return ctx;
}

/** Safe when provider may be absent (e.g. Storybook). */
export function useLoanTypeUpiOptional(): LoanTypeUpiContextValue | null {
  return useContext(LoanTypeUpiCtx);
}
