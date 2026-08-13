// lib/useSweep.ts
//
// Shared state for "Sweep this deal", so the two places it appears (search and
// tracking) behave identically rather than drifting into two slightly different
// features.
//
// The quota is fetched once on mount so the button can render "1 left today"
// without spending one to find out, and is updated from whatever the sweep
// response reports rather than being decremented locally — the server is the
// only thing that actually knows.

import { useCallback, useEffect, useState } from "react";
import {
  ApiError,
  type SweepQuota,
  type SweepResult,
  getSweepQuota,
  sweepDeal,
} from "@/lib/api";

type Target = { productId: string } | { url: string } | { retailer: string; retailerId: string };

export function useSweep() {
  const [quota, setQuota] = useState<SweepQuota | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<SweepResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refreshQuota = useCallback(async () => {
    try {
      const { quota } = await getSweepQuota();
      setQuota(quota);
    } catch {
      // A missing quota just hides the button; not worth an error banner.
      setQuota(null);
    }
  }, []);

  useEffect(() => {
    void refreshQuota();
  }, [refreshQuota]);

  const sweep = useCallback(async (target: Target) => {
    setOpen(true);
    setBusy(true);
    setResult(null);
    setError(null);
    try {
      const response = await sweepDeal(target);
      setResult(response.result);
      setQuota(response.quota);
    } catch (err) {
      setError((err as ApiError).message);
      // A refusal often carries the reason the count changed (or didn't).
      void refreshQuota();
    } finally {
      setBusy(false);
    }
  }, [refreshQuota]);

  return {
    quota,
    /** Whether to show the button at all — false on tiers without the feature. */
    available: quota?.available ?? false,
    open,
    busy,
    result,
    error,
    sweep,
    close: () => setOpen(false),
  };
}
