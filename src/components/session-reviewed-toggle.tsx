import { Eye, EyeOff } from "lucide-react";
import { useState } from "react";

function useRetryableAction(onAction: () => Promise<unknown>, failureMessage: string) {
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    setError(null);
    try {
      await onAction();
    } catch {
      setError(failureMessage);
    }
  };

  return { error, run };
}

export function SessionReviewedToggle({
  reviewed,
  onToggle,
}: {
  reviewed: boolean;
  onToggle: () => Promise<unknown>;
}) {
  const { error, run } = useRetryableAction(
    onToggle,
    `Failed to mark ${reviewed ? "unreviewed" : "reviewed"}`,
  );

  return (
    <button
      type="button"
      onClick={run}
      className={`shrink-0 cursor-pointer ${error ? "text-danger-000" : "text-text-500"} transition-colors hover:text-text-000`}
      title={error ?? `Mark ${reviewed ? "unreviewed" : "reviewed"}`}
    >
      {reviewed ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
    </button>
  );
}

export function SessionReviewAction({ onReview }: { onReview: () => Promise<unknown> }) {
  const { error, run } = useRetryableAction(onReview, "Failed to mark reviewed");

  return (
    <div className="mr-3 flex shrink-0 items-center gap-2">
      {error && (
        <span role="alert" className="text-xs text-danger-000">
          {error}
        </span>
      )}
      <button
        type="button"
        onClick={run}
        className={`cursor-pointer rounded-md border px-2 py-1 text-xs font-medium transition-colors ${
          error
            ? "border-danger-000/30 text-danger-000 hover:bg-danger-000/10"
            : "border-warning-000/30 text-warning-000 hover:bg-warning-100/10"
        }`}
      >
        {error ? "Retry mark reviewed" : "Mark reviewed"}
      </button>
    </div>
  );
}
