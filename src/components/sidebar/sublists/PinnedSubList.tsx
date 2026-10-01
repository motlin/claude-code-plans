import {Pin} from "lucide-react";
import {useCallback, useState} from "react";

import type {SidebarDragRowProps} from "../../../hooks/use-sidebar-drag";
import {closeDragPinHint, useDragPinHintRequested} from "../../../lib/drag-pin-hint";
import {PINNED_GROUP_KEY, pinnedGroup} from "../../../lib/session-groups";
import {useSidebarState} from "../../../lib/sidebar-store";
import {CoachMark} from "../../coach-mark";
import {useSettings} from "../../settings-provider";
import {GroupSection, ROW_CLASS, type SidebarSessionRow} from "../session-group-section";

/** Drop row states: idle (revealed without a drag), a drag in progress, or the pointer over it. */
type PinDropRowState = "idle" | "dragging" | "hot";

const DROP_ROW_LABELS: Record<PinDropRowState, string> = {
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
	expanded,
	activeItemId,
	dragging = false,
	dropRowHot = false,
	listRef,
	dropRowRef,
	dragRowProps,
}: {
	/** Pinned sessions, already in display order. */
	rows: SidebarSessionRow[];
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
}) {
	const [uncapped, setUncapped] = useState<ReadonlySet<string>>(() => new Set());
	const [section, setSection] = useState<HTMLElement | null>(null);
	const sectionRef = useCallback(
		(element: HTMLElement | null) => {
			setSection(element);
			listRef?.(element);
		},
		[listRef],
	);
	const hint = useDragPinHint();
	const empty = rows.length === 0;
	const stub = empty && !dragging && !hint.open;
	const pinnedIds = rows.map((row) => row.id);

	return (
		<div
			ref={sectionRef}
			data-testid="sidebar-pinned"
			data-pinned-list=""
			data-stub={stub ? "" : undefined}
			inert={stub}
			className={`group/section flex shrink-0 flex-col gap-px ${empty ? "df-pin-section-reveal" : ""}`}
		>
			<GroupSection
				group={pinnedGroup(rows, uncapped)}
				expanded={expanded}
				activeItemId={activeItemId}
				filterSlot={null}
				onShowMore={() => setUncapped(new Set([PINNED_GROUP_KEY]))}
				onShowLess={() => setUncapped(new Set())}
				pinnedIds={pinnedIds}
				{...(dragRowProps === undefined ? {} : {dragRowProps})}
			/>
			{dragging ? (
				<PinDropRow ref={dropRowRef} state={dropRowHot ? "hot" : "dragging"} />
			) : (
				hint.open && <PinDropRow ref={dropRowRef} state="idle" />
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
function useDragPinHint() {
	const requested = useDragPinHintRequested();
	const {collapsed} = useSidebarState();
	const {settings, loaded, setSetting} = useSettings();
	return {
		open: requested && loaded && !settings.seenDragPinHint && !collapsed,
		dismiss: () => {
			setSetting("seenDragPinHint", true);
			closeDragPinHint();
		},
	};
}

function PinDropRow({ref, state}: {ref: ((element: HTMLElement | null) => void) | undefined; state: PinDropRowState}) {
	return (
		<div
			ref={ref}
			data-pin-drop-row
			data-hot={state === "hot" ? "" : undefined}
			className={`${ROW_CLASS} ${state === "hot" ? "bg-[var(--sb-hover)] text-secondary" : "text-ink-muted opacity-80"}`}
		>
			<span className="df-leading-slot">
				<Pin
					aria-hidden="true"
					className={`transition-transform ${state === "idle" ? "" : "rotate-6 scale-105"}`}
				/>
			</span>
			{DROP_ROW_LABELS[state]}
		</div>
	);
}
