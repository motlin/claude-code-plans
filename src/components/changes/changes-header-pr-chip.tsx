import {useRef} from "react";

import {prGlyph, type PrStatus} from "../../lib/pr-status";
import {PR_STATE_LABELS, type PullRequestSummary} from "../branch-strip-model";
import {openablePrUrl} from "../../lib/pr-url";
import {PrLinkContextMenu} from "../pr-link-context-menu";
import {cdsButtonClass} from "../ui/cds-button";
import {Icon, type IconName} from "../ui/icon";
import {Pulse} from "../ui/pulse";
import {CHIP_ROOM_CLASS, usePrChipRoom} from "./pr-chip-room";

type PrChecks = NonNullable<PrStatus["checks"]>;

/** Upstream `MY`: the PR state glyph. */
const PR_STATE_ICON_NAMES: Record<PrStatus["state"], IconName> =
{
	open: "GitPullRequest",
	draft: "GitPullRequestDraft",
	merged: "GitMergedSimple",
	closed: "GitPullRequestClosed",
};

/** Upstream `wr`'s CI labels and the Pulse colour for each. */
function ciStatus(checks: PrChecks):
{
	label: string;
	color: string;
}
{
	if (checks.failed > 0)
		return {
			label: "CI: checks failing",
			color: "var(--cds-fill-danger)",
		};
	if (checks.pending > 0)
		return {
			label: "CI: checks in progress",
			color: "var(--cds-fill-warning)",
		};
	return {
		label: "CI: all checks passed",
		color: "var(--cds-fill-success)",
	};
}

/** Upstream `RC`: the PR's CI glyph, none for a merged PR. */
function ChipCi({status}: {status: PrStatus | undefined})
{
	if (status?.checks === undefined || status.state === "merged") return null;
	const {label, color} = ciStatus(status.checks);
	return (
		<span className="-ms-1 flex">
			<span role="img" aria-label={label} className="inline-flex size-5 shrink-0 items-center justify-center">
				<span className="contents [--cds-page-bg:transparent]">
					<Pulse animate={false} color={color} />
				</span>
			</span>
		</span>
	);
}

function ChipParts({pr, url, afterBadge}: {pr: PullRequestSummary; url: string; afterBadge: boolean})
{
	const chipRef = useRef<HTMLSpanElement>(null);
	const partsRef = useRef<HTMLSpanElement>(null);
	const room = usePrChipRoom(
		{
			chipRef,
			partsRef,
			afterBadge,
		},
	);
	const status = pr.status;
	const label = status === undefined ? `#${pr.number}` : `#${pr.number} · ${PR_STATE_LABELS[status.state]}`;
	const iconOnly = room !== "number";
	return (
		<span
			ref={chipRef}
			data-chip-room={room}
			className={room === "none" ? `${CHIP_ROOM_CLASS} w-0` : CHIP_ROOM_CLASS}
		>
			<span className="h-full" />
			<span ref={partsRef} className={`${afterBadge ? "ps-3" : "ps-1"} flex h-full shrink-0 items-center`}>
				<PrLinkContextMenu prUrl={url} linkTooltip={label}>
					{/* Upstream's header is a roving toolbar, so its links sit out of the tab order. */}
					<a
						href={url}
						target="_blank"
						rel="noopener"
						tabIndex={-1}
						aria-label={label}
						className={`${cdsButtonClass("ghost")}${iconOnly ? " size-control px-0" : ""}`}
					>
						<span className="inline-flex min-w-0 items-center gap-1">
							<span className="-ms-1 inline-flex">
								<Icon
									name={status === undefined ? "GitPullRequest" : PR_STATE_ICON_NAMES[status.state]}
									customSize={14}
									bold
									style={
									{
										color:
											status === undefined
												? undefined
												: `var(--color-git-${prGlyph(status).state})`,
									}}
								/>
							</span>
							{!iconOnly && <bdi className="text-footnote text-muted-as-secondary">#{pr.number}</bdi>}
						</span>
					</a>
				</PrLinkContextMenu>
				<ChipCi status={status} />
			</span>
		</span>
	);
}

/**
 * Upstream `jC` → `FC` → `IC`: the Changes header's PR chip, a ghost link to the PR with its state glyph, `#N` while
 * there is room, and the CI glyph. Locally a click always opens the PR on its forge: there is no PR pane.
 * Keyed by session and PR, so a new PR starts from fresh fit state.
 */
export function ChangesHeaderPrChip({
	sessionId,
	pr,
	afterBadge = false,
}: {
	sessionId: string;
	pr: PullRequestSummary | null;
	/** A list note badge sits before the chip (changes-header-list-note-badges). */
	afterBadge?: boolean;
})
{
	const url = openablePrUrl(pr?.url);
	if (pr === null || url === undefined) return null;
	return <ChipParts key={`${sessionId}:${pr.number}`} pr={pr} url={url} afterBadge={afterBadge} />;
}
