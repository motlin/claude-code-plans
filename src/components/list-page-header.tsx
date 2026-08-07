import type { ReactNode } from "react";

interface ListPageHeaderProps {
  title: string;
  count: number;
  itemLabel: string;
  actions?: ReactNode;
}

export function ListPageHeader({ title, count, itemLabel, actions }: ListPageHeaderProps) {
  const countLabel = count === 1 ? itemLabel : `${itemLabel}s`;

  return (
    <header className="flex items-start justify-between gap-4">
      <div>
        <h1 className="text-lg font-semibold">{title}</h1>
        <p className="mt-1 text-sm text-text-500">
          {count} {countLabel}
        </p>
      </div>
      {actions}
    </header>
  );
}
