import {Fragment, type ReactNode, useLayoutEffect, useRef, useState} from "react";
import {Folder} from "lucide-react";

import {type MentionOption, type MentionPendingBlock, mentionMenuWidth} from "../lib/mention-options";
import {fileMentionOptionId, mentionPopupId} from "./file-mention-option-id";
import {type FileTypeIconModule, useFileTypeIcons} from "./file-type-icons-loader";
import {Icon} from "./ui/icon";
import {MENU_HEADER_CLASS} from "./ui/menu";
import {Skeleton, SkeletonGroup} from "./ui/skeleton";
import {Tooltip} from "./ui/tooltip";

const POPUP_CLASS =
	"absolute z-[130] flex max-h-[min(24rem,calc(100svh-2rem))] max-w-[calc(100vw-2rem)] flex-col overflow-y-auto rounded-r7 bg-[var(--menu-bg)] text-body text-primary shadow-[var(--menu-shadow)] select-none";

/** The cds menu gutter: on the listbox, or on the hint block while a hint shows. */
const GUTTER_CLASS = "p-1";

const ROW_CLASS =
	"flex h-6 w-full min-w-0 cursor-pointer items-center gap-1.5 rounded-r5 px-2 py-[2.5px] text-start text-body text-primary outline-none data-[highlighted]:bg-fill-ghost-hover";

/** Upstream `O4()`: the menu group-label base plus a flex row. */
const GROUP_LABEL_CLASS = `${MENU_HEADER_CLASS} flex items-center gap-1.5 select-none`;
/** Upstream `yq()`: the hint row is a group label at least one control tall. */
const HINT_CLASS = `${GROUP_LABEL_CLASS} min-h-6`;

const NO_PENDING: readonly MentionPendingBlock[] = [];

const SKELETON_ROW_CLASS = "flex h-6 items-center gap-1.5 px-2";
/** Upstream `LR`: the label bars' widths, cycled per row. */
const SKELETON_WIDTHS = [160, 128, 144] as const;

function OptionIcon({option, icons}: {option: MentionOption; icons: FileTypeIconModule | undefined})
{
	if (option.kind === "agent") return <Icon name="Agent" size="auto" className="text-ink-muted" />;
	if (option.kind === "session") return <Icon name="ChatSimple" size="sm" className="text-ink-muted" />;
	if (option.kind === "directory") return <Folder aria-hidden="true" className="size-4 shrink-0 text-ink-muted" />;
	if (icons === undefined) return <span aria-hidden="true" className="size-4 shrink-0" />;
	return <icons.FileTypeIcon fileName={option.label} size="sm" />;
}

/** Upstream `q3`: a pending provider's skeleton rows, with its category header when it names one. */
function PendingBlock({block, alone, times}: {block: MentionPendingBlock; alone: boolean; times: number})
{
	return (
		<div aria-hidden="true" data-pending-rows={block.rows}>
			{block.category !== undefined && (
				<div className={GROUP_LABEL_CLASS}>
					<span
						dir="auto"
						className="truncate [text-align:-webkit-match-parent] supports-[text-align:match-parent]:[text-align:match-parent]"
					>
						{block.category}
					</span>
				</div>
			)}
			<SkeletonGroup
				key={`pending-${block.providerId}-${times}`}
				hold={alone ? "none" : "delayed"}
				{...(alone
					?
						{
							holdReason: "overlay",
						}
					: {})}
			>
				{Array.from(
					{
						length: block.rows,
					},
					(_, row) => (
						<div
							key={row}
							aria-hidden={row === 0 ? undefined : "true"}
							data-skeleton-row=""
							className={SKELETON_ROW_CLASS}
						>
							<Skeleton
								decorative
								className="h-[1em]"
								style={
								{
									width: 20,
									height: 20,
								}}
							/>
							<span className="contents">
								<Skeleton
									decorative
									className="h-[1em]"
									style={
									{
										width: SKELETON_WIDTHS[row % SKELETON_WIDTHS.length],
										height: 16,
									}}
								/>
							</span>
						</div>
					),
				)}
			</SkeletonGroup>
		</div>
	);
}

/**
 * The claude.ai/code "@" popup (cds `MentionDropdown`): every provider's rows in provider order with no
 * category headers, left-aligned to the `@` glyph, 560px wide when any row has a caption and 420px otherwise.
 * A pending provider's skeleton block sits where its rows will land; with no rows and nothing pending, an
 * empty hint shows instead, and with neither the popup isn't drawn. Keyboard focus stays in the editor,
 * which drives `highlighted` and `onAccept`. Like upstream, hover and keyboard share that one index:
 * real pointer movement over a row commits it through `onHighlight`, it stays when the pointer leaves,
 * and only keyboard moves scroll the highlighted row into view.
 */
export function MentionMenu({
	id,
	options,
	highlighted,
	onHighlight,
	onAccept,
	pending = NO_PENDING,
	emptyHint,
}: {
	id: string;
	options: readonly MentionOption[];
	highlighted: number;
	onHighlight: (index: number) => void;
	onAccept: (option: MentionOption) => void;
	pending?: readonly MentionPendingBlock[];
	emptyHint?: ReactNode;
})
{
	const listRef = useRef<HTMLDivElement>(null);
	const icons = useFileTypeIcons();
	// Upstream's `k.current`: a highlight set by hover must not scroll the list under the pointer.
	const hoverHighlightRef = useRef(false);
	const alone = options.length === 0;
	// Upstream counts the transitions into an empty popup so each one remounts the skeleton and restarts its reveal.
	const [phase, setPhase] = useState(
		{
			alone,
			times: alone ? 1 : 0,
		},
	);
	if (phase.alone !== alone)
		setPhase(
			{
				alone,
				times: alone ? phase.times + 1 : phase.times,
			},
		);

	useLayoutEffect(() =>
	{
		if (hoverHighlightRef.current)
		{
			hoverHighlightRef.current = false;
			return;
		}
		listRef.current?.querySelector<HTMLElement>("[data-highlighted]")?.scrollIntoView(
			{
				block: "nearest",
			},
		);
	}, [highlighted, options]);

	const blocks = pending.filter((block) => block.rows > 0 && (alone || block.onlyWhenEmpty !== true));
	const hint = alone && blocks.length === 0 ? emptyHint : undefined;
	if (alone && blocks.length === 0 && hint === undefined) return null;
	const status = hint ?? (alone && blocks.length > 0 ? "Loading" : undefined);

	// Upstream `mQ`: each block goes before the first option whose index reaches its `before`; leftovers go last.
	const placed = new Set<MentionPendingBlock>();
	const blocksBefore = (index: number) =>
		blocks.filter((block) =>
		{
			if (placed.has(block) || block.before > index) return false;
			placed.add(block);
			return true;
		});
	const pendingBlock = (block: MentionPendingBlock) => (
		<PendingBlock key={`pending-${block.providerId}`} block={block} alone={alone} times={phase.times} />
	);

	return (
		// oxlint-disable-next-line jsx-a11y/no-static-element-interactions -- a press inside the popup keeps focus in the composer textarea
		<div
			id={mentionPopupId(id)}
			className={POPUP_CLASS}
			style={
			{
				width: mentionMenuWidth(options),
			}}
			onMouseDown={(e) =>
			{
				e.preventDefault();
			}}
		>
			{/* oxlint-disable-next-line jsx-a11y/interactive-supports-focus -- the composer textarea keeps focus and drives the list through aria-activedescendant */}
			<div
				ref={listRef}
				id={id}
				{...(alone
					? {}
					:
						{
							role: "listbox",
							"aria-label": "Mention suggestions",
						})}
				aria-busy={blocks.length > 0 ? "true" : undefined}
				data-cds="MentionDropdown"
				tabIndex={-1}
				className={hint === undefined ? GUTTER_CLASS : undefined}
			>
				{hint !== undefined && (
					<div aria-hidden="true" className={GUTTER_CLASS}>
						<div className={HINT_CLASS}>{hint}</div>
					</div>
				)}
				{options.map((option, index) =>
				{
					const before = blocksBefore(index);
					return (
						<Fragment key={`${option.providerId}:${option.id}`}>
							{before.map(pendingBlock)}
							<OptionRow
								menuId={id}
								option={option}
								index={index}
								highlighted={index === highlighted}
								icons={icons}
								onHover={() =>
								{
									hoverHighlightRef.current = true;
									onHighlight(index);
								}}
								onAccept={onAccept}
							/>
						</Fragment>
					);
				})}
				{blocksBefore(Number.POSITIVE_INFINITY).map(pendingBlock)}
			</div>
			{status !== undefined && (
				<div role="status" aria-label="Mention suggestions" className="sr-only">
					{status}
				</div>
			)}
		</div>
	);
}

function OptionRow({
	menuId,
	option,
	index,
	highlighted,
	icons,
	onHover,
	onAccept,
}: {
	menuId: string;
	option: MentionOption;
	index: number;
	highlighted: boolean;
	icons: FileTypeIconModule | undefined;
	onHover: () => void;
	onAccept: (option: MentionOption) => void;
})
{
	const caption = option.description;
	const row = (
		<button
			type="button"
			tabIndex={-1}
			id={fileMentionOptionId(menuId, index)}
			role="option"
			data-option-index={index}
			data-provider={option.providerId}
			aria-selected={highlighted}
			data-highlighted={highlighted ? "" : undefined}
			className={ROW_CLASS}
			onMouseMove={(e) =>
			{
				// Skip the zero-movement move a browser fires when the list scrolls under a still pointer.
				if (highlighted || (e.movementX === 0 && e.movementY === 0)) return;
				onHover();
			}}
			onClick={() =>
			{
				onAccept(option);
			}}
		>
			<OptionIcon option={option} icons={icons} />
			<span className="flex min-w-0 flex-1 items-baseline gap-1.5 text-start">
				<span
					className={
						caption === undefined ? "truncate text-primary" : "truncate text-primary max-w-full shrink-0"
					}
				>
					<bdi>{option.label}</bdi>
				</span>
				{caption !== undefined && (
					<span className="truncate text-[11px]/[17px] text-ink-muted">
						<bdi>{caption}</bdi>
					</span>
				)}
			</span>
		</button>
	);
	if (option.tooltip === undefined) return row;
	return (
		<Tooltip
			content={option.tooltip}
			side="right"
			delay={200}
			sideOffset={8}
			multiline={caption !== undefined}
			maxWidth={caption === undefined ? undefined : "max-w-[360px]"}
			portal
			className="w-full min-w-0"
		>
			{row}
		</Tooltip>
	);
}
