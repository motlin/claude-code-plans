import {Collapsible as BaseCollapsible} from "@base-ui/react/collapsible";
import {type ReactNode, useId} from "react";

import {useStepCollapseFocusReturn} from "../hooks/use-step-collapse-focus-return";
import {useRestInk} from "../lib/fizzy-lake";
import {thinkingStepLabel, thinkingSummary} from "../lib/thinking-summary";
import {ProseMarkdown} from "./file-refs";
import {ShimmerText} from "./shimmer-text";
import {ChevronIcon} from "./tool-renderers/shared";
import {TURN_STATUS_ROW_GEOMETRY, TURN_STATUS_ROW_STYLE} from "./turn-status-row-geometry";

/*
 * Upstream's thinking step on the Code engine path: shared-80 `Tw` props on the shared-9 TurnStatusStep `wr`.
 * Local spellings: `duration-[60ms]` is upstream's `duration-fast` and the panel ease its `ease-out`. The panel
 * class is upstream's tailwind-merged `kT.Panel` (`Ma` + `wr`'s overrides), so the height animation is gone.
 */

const ROW_CLASS = `group/step flex min-w-0 gap-xs text-start font-sans text-body font-normal py-[calc((var(--cds-h-control)_-_1lh)_/_2)] ${TURN_STATUS_ROW_GEOMETRY}`;

const LABEL_CLIP = "min-w-0 overflow-x-clip text-ellipsis whitespace-nowrap py-[0.125em] -my-[0.125em]";

const LABEL_HOVER_INK =
	"group-hover/step:text-secondary group-has-[:focus-visible]/step:text-secondary group-focus-visible/step:text-secondary";

const TOGGLE_BASE =
	"cds-reset -ms-1 inline-flex h-[1lh] shrink-0 items-center self-start border-0 bg-transparent p-0 outline-none focus-visible:outline-hidden";

/** Upstream `Gd` with `stretch`: the toggle's `::after` covers the `relative isolate rounded` row. */
const TOGGLE_STRETCHED = `${TOGGLE_BASE} static justify-center after:absolute after:inset-0 after:rounded after:content-[''] after:transition-shadow after:duration-[60ms] focus-visible:after:[box-shadow:inset_0_0_0_1px_var(--cds-fill-accent)]`;

const TOGGLE_UNSTRETCHED = `${TOGGLE_BASE} min-w-[1lh] justify-end rounded transition-shadow duration-[60ms] focus-visible:shadow-focus`;

const PANEL_CLASS =
	"break-words ease-[cubic-bezier(0.165,0.84,0.44,1)] motion-reduce:transition-none data-[starting-style]:[clip-path:inset(-8px_-100vw_0_-100vw)] data-[ending-style]:[clip-path:inset(-8px_-100vw_0_-100vw)] data-[animating]:[clip-path:inset(-8px_-100vw_0_-100vw)] data-[starting-style]:contain-layout data-[ending-style]:contain-layout data-[animating]:contain-layout [--cds-disclosure-panel-height:var(--collapsible-panel-height)] h-auto overflow-visible transition-none duration-0 data-[ending-style]:h-auto data-[starting-style]:h-auto";

/** Upstream `HS`'s body scope; spacing "line" (in place) adds nothing, "row" (below) adds `pt-xs`. */
const SCOPE_BASE = "flex min-w-0 items-start gap-xs font-sans text-body font-normal text-secondary not-italic";
const SCOPE_RESET = "[--cds-assistant-message-text-inset:0px] [--cds-assistant-message-text-stop:0px]";

export interface ThinkingStepProps {
	text: string;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	/** The block is still streaming: the row is busy and opens below, never in place. */
	live?: boolean;
	/** The row's tooltip (local: how long the model thought). */
	title?: string | undefined;
	/** The "Thinking actions" toolbar's buttons. */
	actions: ReactNode;
}

/**
 * A thinking block as upstream claude.ai/code draws it in the Thinking and Verbose views: one step row labelled
 * with the thinking's summary line. A settled block with a summary opens in place, its markdown body replacing
 * the label inside the row; a live block, or one with no content line ("Thinking…"), opens below its row.
 */
export function ThinkingStep({text, open, onOpenChange, live = false, title, actions}: ThinkingStepProps) {
	const id = useId();
	const restInk = useRestInk();
	const {rootRef} = useStepCollapseFocusReturn(open);
	const label = thinkingStepLabel(text);
	const inPlace = !live && thinkingSummary(text) !== undefined;
	const openInPlace = inPlace && open;
	const labelId = `${id}-label`;
	const busyId = `${id}-busy`;
	const labelledBy = live ? `${labelId} ${busyId}` : labelId;
	const stretched = !openInPlace;

	const labelText = live ? (
		<ShimmerText variant="secondary" dir="auto" className={LABEL_CLIP}>
			{label}
		</ShimmerText>
	) : (
		<span dir="auto" className={`${LABEL_CLIP} ${restInk} ${LABEL_HOVER_INK}`}>
			{label}
		</span>
	);

	const panel = (
		<BaseCollapsible.Panel
			data-cds-row-panel=""
			className={`${PANEL_CLASS} ${inPlace ? "order-first min-w-0 flex-1" : "ps-[var(--cds-assistant-message-text-inset,0px)]"}`}
		>
			<div data-cds-actions-scope="" className={`${SCOPE_BASE}${inPlace ? "" : " pt-xs"} ${SCOPE_RESET}`}>
				<div className="min-w-0 flex-1" data-prose-size="inherit">
					<ProseMarkdown markdown={text} />
				</div>
				<div className="flex h-[1lh] shrink-0 items-center">
					<div
						data-cds="MessageActions"
						data-reveal="fade"
						role="toolbar"
						aria-label="Thinking actions"
						data-size="xs"
						tabIndex={-1}
						className="flex items-center select-none"
					>
						{actions}
					</div>
				</div>
			</div>
		</BaseCollapsible.Panel>
	);

	return (
		<BaseCollapsible.Root
			ref={rootRef}
			open={open}
			onOpenChange={onOpenChange}
			data-cds="TurnStatusStep"
			data-state={live ? "busy" : "done"}
			className="group/body flex w-full min-w-0 flex-col"
		>
			<div
				data-cds-row=""
				{...(openInPlace ? {"data-cds-open-text": ""} : {"data-cds-row-title": label})}
				{...(title === undefined ? {} : {title})}
				className={`${ROW_CLASS} ${openInPlace ? "items-start" : "items-center"} relative isolate rounded${openInPlace ? "" : " select-none"}`}
				style={TURN_STATUS_ROW_STYLE}
			>
				<span
					id={`${id}-text`}
					className={openInPlace ? "min-w-0 gap-xs items-start hidden" : "flex min-w-0 gap-xs items-center"}
				>
					<span id={labelId} className="min-w-0 max-w-full">
						{labelText}
					</span>
				</span>
				{live && (
					<span id={busyId} className="sr-only">
						running
					</span>
				)}
				<BaseCollapsible.Trigger
					data-cds-row-toggle=""
					{...(stretched ? {"data-cds-row-toggle-stretched": "", "aria-owns": labelledBy} : {})}
					aria-labelledby={labelledBy}
					className={`${stretched ? TOGGLE_STRETCHED : TOGGLE_UNSTRETCHED}${inPlace ? " order-last" : ""}`}
				>
					<span
						aria-hidden="true"
						className={`inline-flex h-[1lh] items-center justify-center ${open ? "text-secondary" : `${restInk} group-hover/step:text-secondary group-has-[:focus-visible]/step:text-secondary`}`}
					>
						<span
							data-step-chevron=""
							{...(open ? {"data-open": ""} : {})}
							className={`inline-flex transition-transform duration-[60ms] motion-reduce:transition-none${open ? "" : " -rotate-90 page-rtl:rotate-90"}`}
						>
							<ChevronIcon expanded size={12} />
						</span>
					</span>
				</BaseCollapsible.Trigger>
				{inPlace && panel}
			</div>
			{!inPlace && panel}
		</BaseCollapsible.Root>
	);
}
