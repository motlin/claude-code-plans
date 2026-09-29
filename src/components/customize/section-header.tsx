/** Upstream cds `Counter` (xs): 18px pill, 11px medium, neutral fill. */
function Counter({ count }: { count: number }) {
  return (
    <span
      data-testid="customize-counter"
      className="inline-flex h-[18px] min-w-[18px] shrink-0 items-center justify-center rounded-full bg-fill-ghost-hover px-[5.4px] text-[11px]/[17px] font-medium text-secondary tabular-nums"
    >
      {count}
    </span>
  );
}

interface SectionHeaderProps {
  id: string;
  title: string;
  count: number;
}

/** Upstream `yours-section-*-header`: 15/20 semibold H3 followed by a Counter. */
export function SectionHeader({ id, title, count }: SectionHeaderProps) {
  return (
    <div id={id} className="flex min-h-7 items-center gap-1">
      <h3 className="m-0 truncate text-[15px]/[20px] font-[580] text-primary">{title}</h3>
      <Counter count={count} />
    </div>
  );
}
