import {ChevronRight} from "lucide-react";
import {useId, type MouseEvent, type ReactNode} from "react";

import {
	isRailSectionOpen,
	RAIL_SECTION_TITLES,
	setRailSectionsOpen,
	toggleRailSection,
	useRailSectionsState,
	type RailSectionId,
} from "../../lib/session-rail-store";

/** One card with content; a section with nothing to show passes no card at all. */
export interface RailCard {
	id: RailSectionId;
	/** Right-aligned header text, e.g. `1 of 3`. */
	summary?: string | undefined;
	body: ReactNode;
}

const ROW_CLASS = "flex min-h-6.5 w-full min-w-0 items-center gap-1.5 rounded px-1 text-left text-[13px]/[19px]";

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
const CARD_CLASS =
	"group/railcard flex shrink-0 flex-col rounded-r7 py-2 shadow-[0_0_0_1px_var(--color-border)] dark:shadow-[inset_0_0_0_1px_var(--color-border)]";

const HEAD_CLASS =
	"group/railhead flex min-h-6.5 w-full min-w-0 cursor-pointer items-center gap-1 rounded-r5 px-1 text-left text-[12px]/[15px] font-medium text-primary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent-100";

function RailSection({
	card,
	open,
	onToggle,
}: {
	card: RailCard;
	open: boolean;
	onToggle: (event: MouseEvent<HTMLButtonElement>) => void;
}) {
	const headingId = useId();
	return (
		<section
			data-rail-section={card.id}
			{...(open ? {"data-open": ""} : {})}
			aria-labelledby={headingId}
			className={CARD_CLASS}
		>
			<div className="group/railtop relative flex min-h-6.5 min-w-0 items-center gap-1 px-2">
				<h3 id={headingId} className="flex min-w-0 flex-1 rounded">
					<button type="button" aria-expanded={open} onClick={onToggle} className={HEAD_CLASS}>
						<span className="shrink-0">{RAIL_SECTION_TITLES[card.id]}</span>
						<ChevronRight
							aria-hidden
							className={`size-3 shrink-0 text-ink-muted transition-transform ${open ? "rotate-90" : ""}`}
						/>
						{card.summary !== undefined && (
							<span className="ms-auto truncate ps-1.5 text-[12px]/[15px] font-normal text-ink-muted">
								{card.summary}
							</span>
						)}
					</button>
				</h3>
			</div>
			{open && (
				<div data-rail-body="" className="px-2">
					{card.body}
				</div>
			)}
		</section>
	);
}

/**
 * Upstream's session rail: `<aside aria-label="Session details">` holding
 * collapsible cards, each folded per session. Alt-click on a header sets every
 * card to that card's new state.
 */
export function SessionRail({sessionId, cards}: {sessionId: string; cards: readonly RailCard[]}) {
	const sections = useRailSectionsState();
	return (
		<aside
			aria-label="Session details"
			tabIndex={-1}
			className="flex h-full min-h-0 w-[var(--session-rail-w,17.5rem)] flex-col font-sans outline-none"
		>
			<div className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto overscroll-contain p-px [scrollbar-width:none]">
				{cards.map((card) => {
					const open = isRailSectionOpen(sections, sessionId, card.id);
					return (
						<RailSection
							key={card.id}
							card={card}
							open={open}
							onToggle={(event) => {
								if (event.altKey) {
									setRailSectionsOpen(
										sessionId,
										cards.map((each) => each.id),
										!open,
									);
								} else {
									toggleRailSection(sessionId, card.id);
								}
							}}
						/>
					);
				})}
			</div>
		</aside>
	);
}
