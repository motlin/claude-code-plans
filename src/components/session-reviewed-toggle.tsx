import { Eye, EyeOff } from "lucide-react";
import { useState } from "react";

export function SessionReviewedToggle({
  reviewed,
  onToggle,
}: {
  reviewed: boolean;
  onToggle: () => Promise<unknown>;
}) {
  const [error, setError] = useState<string | null>(null);

  const handleToggle = async () => {
    setError(null);
    try {
      await onToggle();
    } catch {
      setError(`Failed to mark ${reviewed ? "unreviewed" : "reviewed"}`);
    }
  };

  return (
    <button
      type="button"
      onClick={handleToggle}
      className={`shrink-0 cursor-pointer ${error ? "text-danger-000" : "text-text-500"} transition-colors hover:text-text-000`}
      title={error ?? `Mark ${reviewed ? "unreviewed" : "reviewed"}`}
    >
      {reviewed ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
    </button>
  );
}
