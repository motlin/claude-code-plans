import {useDirection} from "@base-ui/react/direction-provider";
import {PreviewCard} from "@base-ui/react/preview-card";
import {useEffect, useRef, useState, type ReactElement, type SyntheticEvent} from "react";

import {prEntryStateLine, type PrEntry, type PrEntryState} from "../../lib/pr-entries";
import {PrDiffStat} from "../diff-stat";
import {usePrCardContext} from "../pr-card-context";
import {COLLISION_PADDING, POPUP_CLASS} from "../session-hover-card-classes";
import {Icon, type IconName} from "../ui/icon";

/** Upstream `Xs`: each entry state's icon and git colour (approved reads as opened, changes requested as closed). */
const STATE_LOOKS =
{
	open:
	{
		icon: "GitPullRequest",
		textClass: "text-git-opened",
	},
	approved:
	{
		icon: "CheckCircle",
		textClass: "text-git-opened",
	},
	changesRequested:
	{
		icon: "XCircle",
		textClass: "text-git-closed",
	},
	conflicting:
	{
		icon: "GitMergeConflict",
		textClass: "text-git-conflicting",
	},
	draft:
	{
		icon: "GitPullRequestDraft",
		textClass: "text-git-draft",
	},
	queued:
	{
		icon: "GitMergeQueue",
		textClass: "text-git-queued",
	},
	merged:
	{
		icon: "GitMergedSimple",
		textClass: "text-git-merged",
	},
	closed:
	{
		icon: "GitPullRequestClosed",
		textClass: "text-git-closed",
	},
} as const satisfies Record<
	PrEntryState,
	{
		icon: IconName;
		textClass: string;
	}
>;

/** Upstream `hX` merged with `b1`'s py-1.5 (tailwind-merge keeps the later py). */
const ENTRY_CLASS =
	"flex min-w-0 flex-1 items-center gap-2 rounded-md px-1.5 py-1.5 text-body text-primary outline-none hover:bg-alpha-1 focus-visible:shadow-focus focus-visible:outline-hidden";

const TITLE_CLASS =
	"min-w-0 truncate text-body-medium [text-align:-webkit-match-parent] supports-[text-align:match-parent]:[text-align:match-parent]";

/**
 * Upstream's `EH` on the cds HoverCard shell with `padding:"none"` (the shell already breaks words). Its min width reads
 * --preview-card-min-w, so upstream's `min-w-[14rem]` sets that variable instead of competing with it.
 */
const CARD_CLASS = `${POPUP_CLASS} !p-0 [--preview-card-min-w:14rem] [--preview-card-max-w:22rem]`;

/** Upstream `YJo`: a press in the card or on an entry link never reaches the row link behind it. */
function stop(event: SyntheticEvent)
{
	event.stopPropagation();
}

/** Upstream `Lz` → `xo` → `lO twoLine`: one PR, as a new-tab link when it has an http(s) url. */
function PrEntryRow({entry, rtl}: {entry: PrEntry; rtl: boolean})
{
	const look = STATE_LOOKS[entry.state];
	const stateLine = prEntryStateLine(entry);
	const hasTitle = entry.title !== undefined;
	const repoOrNumber = entry.repo !== undefined || hasTitle;
	const body = (
		<span className="flex min-w-0 flex-1 flex-col gap-0.5">
			<bdi className={hasTitle ? TITLE_CLASS : `${TITLE_CLASS} tabular-nums`}>
				{entry.title ?? `#${entry.number}`}
			</bdi>
			<span className="flex min-w-0 items-center text-footnote text-muted-as-secondary">
				<span className={`flex min-w-0 items-center gap-1 ${look.textClass}`}>
					<Icon name={look.icon} size="xs" className="shrink-0" />
					<span className="min-w-0 truncate">{stateLine}</span>
				</span>
				{repoOrNumber && (
					<span aria-hidden="true" className="shrink-0 px-1.5">
						·
					</span>
				)}
				{entry.repo !== undefined && (
					<span className="min-w-0 shrink-[9999] truncate">
						{rtl ? <bdi dir="ltr">{entry.repo}</bdi> : entry.repo}
					</span>
				)}
				{hasTitle && <span className="shrink-0 tabular-nums ps-1">#{entry.number}</span>}
				{entry.additions !== undefined && entry.deletions !== undefined && (
					<span className="ms-auto shrink-0 whitespace-nowrap ps-2 tabular-nums">
						<PrDiffStat additions={entry.additions} deletions={entry.deletions} />
					</span>
				)}
			</span>
		</span>
	);
	if (entry.url === undefined)
		return (
			<li>
				<span className={ENTRY_CLASS}>{body}</span>
			</li>
		);
	return (
		<li title={entry.url}>
			<a href={entry.url} target="_blank" rel="noopener noreferrer" onClick={stop} className={ENTRY_CLASS}>
				{body}
			</a>
		</li>
	);
}

interface PrListCardProps
{
	entries: readonly PrEntry[];
	/** Upstream `bV`: the kebab's card, for keyboard users only; the pointer never opens it. */
	keyboardOnly?: boolean;
	/** Upstream's title-tail card: offset past the square trailing slot beside the glyph. */
	pastTheSlot?: boolean;
	children: ReactElement<Record<string, unknown>>;
}

/**
 * Upstream's "Pull requests" card (`$F`): after 250ms a hover or keyboard focus on its trigger lists
 * the row's PRs beside it. It stays closed while the session card or the row menu is open.
 */
export function PrListCard({entries, keyboardOnly = false, pastTheSlot = false, children}: PrListCardProps)
{
	const {rowCardOpen, menuOpen, onPrCardOpenChange} = usePrCardContext();
	const rtl = useDirection() === "rtl";
	const [open, setOpen] = useState(false);
	const [pointerInside, setPointerInside] = useState(false);
	const triggerRef = useRef<HTMLElement>(null);
	const popupRef = useRef<HTMLDivElement>(null);
	const disabled = (keyboardOnly && pointerInside) || rowCardOpen || menuOpen;
	const shown = open && !disabled;

	useEffect(() =>
	{
		if (disabled) setOpen(false);
	}, [disabled]);
	useEffect(() =>
	{
		onPrCardOpenChange(shown);
	}, [shown, onPrCardOpenChange]);
	useEffect(
		() => () =>
		{
			onPrCardOpenChange(false);
		},
		[onPrCardOpenChange],
	);

	const side = rtl ? "left" : "right";
	return (
		<PreviewCard.Root
			open={shown}
			onOpenChange={(next, details) =>
			{
				if (next && disabled) return;
				setOpen(next);
				// Upstream's Escape hands focus back to the trigger when it was inside the card.
				if (
					!next &&
					details.reason === "escape-key" &&
					popupRef.current?.contains(document.activeElement) === true
				)
				{
					const trigger = triggerRef.current;
					const target =
						trigger?.matches("a[href], button, [tabindex]") === true
							? trigger
							: trigger?.querySelector<HTMLElement>("a[href], button, [tabindex]");
					target?.focus();
				}
			}}
		>
			<PreviewCard.Trigger
				ref={(node: HTMLElement | null) =>
				{
					triggerRef.current = node;
				}}
				render={children}
				delay={250}
				onPointerOver={(event) =>
				{
					setPointerInside(event.target instanceof Node && event.currentTarget.contains(event.target));
				}}
				onPointerLeave={() =>
				{
					setPointerInside(false);
				}}
			/>
			<PreviewCard.Portal>
				<PreviewCard.Positioner
					side={side}
					align="start"
					collisionPadding={COLLISION_PADDING}
					{...(pastTheSlot
						?
							{
								sideOffset: (data: {
									side: string;
									anchor:
									{
										height: number;
									};
								}) => (data.side === side ? data.anchor.height + 6 : 6),
							}
						: {})}
					data-cds-portal=""
					className="z-[100]"
				>
					<PreviewCard.Popup
						ref={popupRef}
						aria-label="Pull requests"
						className={CARD_CLASS}
						onClick={stop}
						onDoubleClick={stop}
						onPointerDown={stop}
					>
						<ul
							role="list"
							className="scroll-fade-y flex max-h-[24rem] flex-col overflow-y-auto rounded-[inherit] p-xs"
						>
							{entries.map((entry) => (
								<PrEntryRow
									key={`${entry.repo?.toLowerCase() ?? ""}#${entry.number}`}
									entry={entry}
									rtl={rtl}
								/>
							))}
						</ul>
					</PreviewCard.Popup>
				</PreviewCard.Positioner>
			</PreviewCard.Portal>
		</PreviewCard.Root>
	);
}
