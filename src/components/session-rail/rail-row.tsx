import type {ReactNode} from "react";

/* Upstream's session rail card and row primitives, kept apart from the rail so pages reuse them without its dnd-kit chunk. */

const ROW_CLASS = "flex min-h-6.5 w-full min-w-0 items-center gap-2 rounded px-1 text-left text-[13px]/[19px]";

/** Rows that act get upstream's ghost hover, alpha press and focus ring. */
export const RAIL_ROW_ACTION_CLASS = `${ROW_CLASS} cursor-pointer hover:bg-fill-ghost-hover active:bg-alpha-2 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent-100`;

/** A row's slots: a 20px icon in text-secondary, the label, and a muted 12px trailing hint. */
export function RailRowContent({icon, label, hint}: {icon: ReactNode; label: ReactNode; hint?: ReactNode}) {
	return (
		<>
			<span className="flex size-5 shrink-0 items-center justify-center text-secondary [&_svg]:size-4">
				{icon}
			</span>
			<span data-rail-row-label="" className="min-w-0 flex-1 truncate text-primary">
				{label}
			</span>
			{hint !== undefined && (
				<span data-rail-row-hint="" className="shrink-0 text-[12px]/[15px] text-ink-muted tabular-nums">
					{hint}
				</span>
			)}
		</>
	);
}

/** A row with nothing to do. */
export function RailRow(props: {icon: ReactNode; label: ReactNode; hint?: ReactNode; title?: string}) {
	return (
		<div className={ROW_CLASS} title={props.title}>
			<RailRowContent {...props} />
		</div>
	);
}

/** Upstream's card ring: outset in light, inset in dark. */
export const RAIL_CARD_CLASS =
	"group/railcard flex shrink-0 flex-col rounded-r7 py-2 shadow-[0_0_0_1px_var(--color-border)] dark:shadow-[inset_0_0_0_1px_var(--color-border)]";
