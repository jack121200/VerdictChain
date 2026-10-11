/**
 * The two checks a printed document states, recomputed in the browser (plan R5): the evidence bundle's SHA-256 over
 * its canonical JSON, and every audit entry of the case plus the case digest. They are what a reader can verify
 * again without trusting the server's word for it.
 */
import { useEffect, useState } from 'react';
import type { CaseAuditChain, EvidenceBundleResponse } from '../../api/types';
import { verifyEvidenceBundleHash } from '../../lib/derive/hash';
import { recomputeCaseChain, type CaseChainCheck } from '../investigations/case-chain';

export type BundleCheck = 'none' | 'checking' | 'match' | 'mismatch' | 'error';
export type ChainCheck = { state: 'none' } | { state: 'checking' } | { state: 'error' } | { state: 'done'; check: CaseChainCheck };

export interface Verification {
  bundle: BundleCheck;
  chain: ChainCheck;
  /** True once neither check is still running. */
  settled: boolean;
}

export function useVerification(bundle: EvidenceBundleResponse | undefined, chain: CaseAuditChain | undefined, enabled: boolean): Verification {
  const [bundleCheck, setBundleCheck] = useState<BundleCheck>('none');
  const [chainCheck, setChainCheck] = useState<ChainCheck>({ state: 'none' });

  useEffect(() => {
    if (!enabled || bundle === undefined) {
      setBundleCheck('none');
      return undefined;
    }
    let cancelled = false;
    setBundleCheck('checking');
    verifyEvidenceBundleHash(bundle.bundle, bundle.bundle_sha256).then(
      (matches) => !cancelled && setBundleCheck(matches ? 'match' : 'mismatch'),
      () => !cancelled && setBundleCheck('error'),
    );
    return () => {
      cancelled = true;
    };
  }, [bundle, enabled]);

  useEffect(() => {
    if (!enabled || chain === undefined) {
      setChainCheck({ state: 'none' });
      return undefined;
    }
    let cancelled = false;
    setChainCheck({ state: 'checking' });
    recomputeCaseChain(chain).then(
      (check) => !cancelled && setChainCheck({ state: 'done', check }),
      () => !cancelled && setChainCheck({ state: 'error' }),
    );
    return () => {
      cancelled = true;
    };
  }, [chain, enabled]);

  // 'none' with something to check means the effect has not started yet, so that is still waiting too.
  const bundleDone = bundle === undefined || (bundleCheck !== 'none' && bundleCheck !== 'checking');
  const chainDone = chain === undefined || (chainCheck.state !== 'none' && chainCheck.state !== 'checking');
  return { bundle: bundleCheck, chain: chainCheck, settled: !enabled || (bundleDone && chainDone) };
}
