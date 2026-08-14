interface TaskMetadataProps {
  metadata: Record<string, unknown>;
}

function isMetadataObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function MetadataValue({ value }: { value: unknown }) {
  if (isMetadataObject(value)) {
    if (Object.keys(value).length === 0) {
      return <span className="text-t6">{"{}"}</span>;
    }
    return <MetadataEntries metadata={value} nested />;
  }

  const formatted = typeof value === "string" ? value : JSON.stringify(value);
  return <span className="break-all text-secondary">{formatted}</span>;
}

function MetadataEntries({
  metadata,
  nested = false,
}: {
  metadata: Record<string, unknown>;
  nested?: boolean;
}) {
  return (
    <dl
      className={
        nested
          ? "space-y-1 border-l border-strong pl-2"
          : "mt-1.5 space-y-1.5 border-t border-border pt-1.5"
      }
    >
      {Object.entries(metadata).map(([key, value]) => (
        <div key={key} className="grid grid-cols-[minmax(7rem,auto)_1fr] gap-x-3">
          <dt className="font-mono text-t6">{key}</dt>
          <dd className="min-w-0">
            <MetadataValue value={value} />
          </dd>
        </div>
      ))}
    </dl>
  );
}

export function TaskMetadata({ metadata }: TaskMetadataProps) {
  const fieldCount = Object.keys(metadata).length;
  if (fieldCount === 0) return null;

  return (
    <details className="mt-2 max-w-2xl rounded-md border border-border bg-surface-0/30 px-2 py-1 text-[11px]">
      <summary className="cursor-pointer select-none text-t6">Metadata ({fieldCount})</summary>
      <MetadataEntries metadata={metadata} />
    </details>
  );
}
