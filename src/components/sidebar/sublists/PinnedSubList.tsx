import {Pin} from "lucide-react";
import {useCallback, useState} from "react";

import type {SidebarDragRowProps} from "../../../hooks/use-sidebar-drag";
import {closeDragPinHint, useDragPinHintRequested} from "../../../lib/drag-pin-hint";
import {pinnedGroup, type RevealedRows} from "../../../lib/session-groups";
import {useSidebarState} from "../../../lib/sidebar-store";
import {CoachMark} from "../../coach-mark";
import {useSettings} from "../../settings-context";
import {GroupSection, ROW_CLASS} from "../session-group-section";
import type {SidebarSessionRow} from "../sidebar-session-row";

/** Drop row states: idle (revealed without a drag), a drag in progress, or the pointer over it. */
type PinDropRowState = "idle" | "dragging" | "hot";

const DROP_ROW_LABELS: Record<PinDropRowState, string> =
{
	idle: "Drag to pin",
	dragging: "Drop here",
	hot: "Let go",
};

/**
 * The sidebar Pinned section above the session groups, like claude.ai/code. With no
 * pins and no drag in progress it collapses to an inert zero-height stub that
 * animates open (`df-pin-section-reveal`) once a drag starts, showing a drop row.
 * After the first menu pin it also opens to anchor the one-time "drag to pin" tip.
 */
export function PinnedSubList({
	rows,
	nested,
	expanded,
	activeItemId,
	dragging = false,
	dropRowHot = false,
	listRef,
	dropRowRef,
	dragRowProps,
}: {
	/** Pinned slots, already in display order. */
	rows: SidebarSessionRow[];
	/** A pinned family head → the family nested under it. */
	nested: ReadonlyMap<string, SidebarSessionRow[]>;
	expanded: boolean;
	activeItemId: string | null;
	/** A row drag is in progress, so the section shows a drop row even when empty. */
	dragging?: boolean;
	/** The dragged row is over the drop row. */
	dropRowHot?: boolean;
	/** Registers the section as the pinned drag list; its rows are the slots. */
	listRef?: (element: HTMLElement | null) => void;
	/** Registers the drop row as a drag zone. */
	dropRowRef?: (element: HTMLElement | null) => void;
	dragRowProps?: (id: string) => SidebarDragRowProps;
})
{
	const [revealed, setRevealed] = useState<RevealedRows>({});
	const [section, setSection] = useState<HTMLElement | null>(null);
	const sectionRef = useCallback(
		(element: HTMLElement | null) =>
		{
			setSection(element);
			listRef?.(element);
		},
		[listRef],
	);
	const hint = useDragPinHint();
	const empty = rows.length === 0;
	const stub = empty && !dragging && !hint.open;
	const pinnedIds = rows.map((row) => row.id);
	const onReveal = useCallback((key: string, extraRevealed: number) =>
	{
		setRevealed(
			{
				[key]: extraRevealed,
			},
		);
	}, []);

	return (
		<div
			ref={sectionRef}
			data-testid="sidebar-pinned"
			data-pinned-list=""
			data-tab-section=""
			data-perf-region="sidebar_pinned"
			data-stub={stub ? "" : undefined}
			inert={stub}
			// Upstream's `group/section relative flex flex-col gap-px`, whose gap the code list zeroes (each row's margin spaces it).
			className={`group/section relative flex shrink-0 flex-col gap-0 ${empty ? "df-pin-section-reveal" : ""}`}
		>
			<GroupSection
				group={pinnedGroup(rows, revealed, nested)}
				expanded={expanded}
				activeItemId={activeItemId}
				filterSlot={null}
				onReveal={onReveal}
				pinnedIds={pinnedIds}
				{...(dragRowProps === undefined
					? {}
					:
						{
							dragRowProps,
						})}
			/>
			{dragging ? (
				<PinDropRow ref={dropRowRef} state={dropRowHot ? "hot" : "dragging"} stacked={!empty} />
			) : (
				hint.open && <PinDropRow ref={dropRowRef} state="idle" stacked={!empty} />
			)}
			<CoachMark
				open={hint.open && section !== null}
				anchor={section?.querySelector("[data-sidebar-group-label]") ?? section}
				message="Tip: you can drag sessions here to pin them"
				onDismiss={hint.dismiss}
				onClose={closeDragPinHint}
			/>
		</div>
	);
}

/** The drag-to-pin tip: requested by a menu pin, shown once while the sidebar is expanded. */
function useDragPinHint()
{
	const requested = useDragPinHintRequested();
	const {collapsed} = useSidebarState();
	const {settings, loaded, setSetting} = useSettings();
	return {
		open: requested && loaded && !settings.seenDragPinHint && !collapsed,
		dismiss: () =>
		{
			setSetting("seenDragPinHint", true);
			closeDragPinHint();
		},
	};
}

/** `stacked`: pinned rows precede it, so it sits upstream's 2px row stack below the last one. */
function PinDropRow({
	ref,
	state,
	stacked,
}: {
	ref: ((element: HTMLElement | null) => void) | undefined;
	state: PinDropRowState;
	stacked: boolean;
})
{
	return (
		<div
			ref={ref}
			data-pin-drop-row
			data-hot={state === "hot" ? "" : undefined}
			className={`${ROW_CLASS} ${stacked ? "mt-[var(--sb-row-stack-gap)]" : ""} [--sb-icon-rest:currentColor] ${state === "hot" ? "bg-[var(--sb-hover)] text-primary" : "text-muted-as-secondary"}`}
		>
			<span className="df-leading-slot">
				<Pin
					aria-hidden="true"
					className={`transition-transform motion-reduce:transition-none ${state === "idle" ? "" : "rotate-6 scale-105"}`}
				/>
			</span>
			{DROP_ROW_LABELS[state]}
		</div>
	);
}
