import { Loader2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { apiFetch } from "../lib/api/client";
import { IndexingStatusResponse } from "../lib/api/indexing";

export function IndexingBannerView({ onDismiss }: { onDismiss: () => void }) {
  return (
    <div className="mx-6 mt-4 flex items-center gap-3 rounded-md border border-blue-200 bg-blue-50 px-4 py-2.5 text-sm text-blue-800 dark:border-blue-800 dark:bg-blue-950/30 dark:text-blue-300">
      <Loader2 className="h-4 w-4 animate-spin shrink-0" />
      <span>Building search index... This is a one-time operation.</span>
      <button
        type="button"
        onClick={onDismiss}
        className="ml-auto text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-200"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}

export function IndexingBanner() {
  const [isIndexing, setIsIndexing] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function poll() {
      try {
        const result = await apiFetch("/api/indexing-status", IndexingStatusResponse);
        if (!cancelled) setIsIndexing(result.isIndexing);
      } catch {
        // Server function unavailable during HMR
      }
    }

    void poll();
    const interval = setInterval(() => void poll(), 3000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  if (!isIndexing || dismissed) return null;

  return <IndexingBannerView onDismiss={() => setDismissed(true)} />;
}
