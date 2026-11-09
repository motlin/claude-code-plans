import {Popover} from "@base-ui/react/popover";
import {useRef} from "react";

import {STALE_COMPACT_COPY, staleCompactLine, staleCompactWhy} from "../lib/stale-compact";
import {INFO_TIP_POPUP_CLASS} from "./ui/info-tip";

export interface StaleCompactBandProps {
	ageMinutes: number;
	contextTokens: number;
	tokensInLine: boolean;
	compacting: boolean;
	onCompact: () => void;
	focusComposer: () => void;
}

/** Upstream's trigger less `cds-reset` (Tailwind preflight already resets a button), `rounded` as the cds radius. */
const TRIGGER_CLASS = "rounded-r5 text-start outline-none focus-visible:outline-hidden focus-visible:shadow-focus";

/** Upstream `Ql` with `max-w-60` replacing the InfoTip's own 240px cap (the same width). */
const POPUP_CLASS = INFO_TIP_POPUP_CLASS.replace("max-w-[240px]", "max-w-60");

/**
 * The stale-session compact line (upstream `bTe` / `STe`, cbb2d9547 crawl 2026-11-06): a footnote under the
 * last assistant reply, before its actions toolbar, saying the next message re-reads the whole context and
 * offering Compact session. Hovering the sentence explains why after 300ms.
 */
export function StaleCompactBand({
	ageMinutes,
	contextTokens,
	tokensInLine,
	compacting,
	onCompact,
	focusComposer,
}: StaleCompactBandProps) {
	const rootRef = useRef<HTMLDivElement>(null);
	return (
		<div
			ref={rootRef}
			data-transcript-keeps-pin=""
			data-find-omitted=""
			className="epitaxy-hint-fade-in flex min-w-0 flex-wrap items-baseline gap-x-1.5 text-footnote"
		>
			<span role="status" aria-live="polite" aria-atomic="true" className="min-w-0 text-secondary">
				<Popover.Root>
					<Popover.Trigger type="button" openOnHover delay={300} className={TRIGGER_CLASS}>
						{staleCompactLine({tokensInLine, contextTokens})}
					</Popover.Trigger>
					<Popover.Portal>
						<Popover.Positioner side="top" align="center" sideOffset={6} className="z-[120]">
							<Popover.Popup aria-label={STALE_COMPACT_COPY.whyLabel} className={POPUP_CLASS}>
								<div className="px-2 py-1.5 min-w-0 break-words">
									<p className="text-footnote">{staleCompactWhy({ageMinutes, contextTokens})}</p>
								</div>
							</Popover.Popup>
						</Popover.Positioner>
					</Popover.Portal>
				</Popover.Root>
			</span>
			<button
				type="button"
				data-cds="TextLink"
				disabled={compacting}
				aria-busy={compacting ? true : undefined}
				className={`text-link inline ${compacting ? "cursor-default opacity-disabled" : "cursor-pointer"} shrink-0`}
				onClick={() => {
					// Upstream moves focus first so it isn't stranded when the line unmounts.
					if (rootRef.current?.contains(document.activeElement) === true) focusComposer();
					onCompact();
				}}
			>
				{compacting ? STALE_COMPACT_COPY.compacting : STALE_COMPACT_COPY.compact}
			</button>
		</div>
	);
}
