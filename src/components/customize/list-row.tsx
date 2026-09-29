import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { IconTile } from "./icon-tile";

interface ListRowProps {
  icon: LucideIcon;
  title: string;
  /** Leading source text, rendered as "<source> · <subtitle>". */
  source?: string;
  subtitle?: string;
  /** Trailing muted text, e.g. a `<time>`. */
  meta?: ReactNode;
  /** Trailing controls; they stay clickable above the overlay button. */
  actions?: ReactNode;
  /** When set, the whole row is an overlay button labelled "View <title>". */
  onView?: () => void;
}

/**
 * Upstream tabbed list row: 36px icon tile, 14px medium title over a 13px
 * secondary subtitle, trailing meta and actions. A 1px `::after` divider sits
 * under every row except the last and disappears on hover.
 */
export function ListRow({ icon, title, source, subtitle, meta, actions, onView }: ListRowProps) {
  return (
    <div
      data-testid="customize-list-row"
      className="relative -mx-3 flex items-center gap-3 self-stretch rounded-card p-3 after:pointer-events-none after:absolute after:inset-x-3 after:bottom-0 after:h-px after:bg-border last:after:hidden hover:bg-fill-ghost-hover hover:after:hidden"
    >
      {onView && (
        <button
          type="button"
          aria-label={`View ${title}`}
          onClick={onView}
          className="absolute inset-0 rounded-card focus-visible:outline-2 focus-visible:outline-accent-100"
        />
      )}
      <div className="pointer-events-none relative flex min-w-0 flex-1 items-center gap-3 [&_button]:pointer-events-auto">
        <IconTile icon={icon} />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="truncate text-body font-medium text-primary">{title}</span>
          {(source !== undefined || subtitle !== undefined) && (
            <span className="truncate text-footnote text-secondary">
              {source !== undefined && <span>{source}</span>}
              {source !== undefined && subtitle !== undefined && (
                <span aria-hidden="true" className="px-1.5">
                  ·
                </span>
              )}
              {subtitle}
            </span>
          )}
        </div>
      </div>
      {(meta !== undefined || actions !== undefined) && (
        <div className="pointer-events-none relative flex shrink-0 items-center gap-4 [&_button]:pointer-events-auto">
          {meta !== undefined && <span className="truncate text-footnote text-t6">{meta}</span>}
          {actions}
        </div>
      )}
    </div>
  );
}
