import type { ReactNode } from "react";
import { formatCount } from "../lib/pluralize";

interface ListPageHeaderProps {
  title: string;
  count: number;
  itemLabel: string;
  actions?: ReactNode;
}

export function ListPageHeader({ title, count, itemLabel, actions }: ListPageHeaderProps) {
  return (
    <header className="flex items-start justify-between gap-4">
      <div>
        <h1 className="text-lg font-semibold">{title}</h1>
        <p className="mt-1 text-sm text-t6">{formatCount(count, itemLabel)}</p>
      </div>
      {actions}
    </header>
  );
}
