import {PreviewCard} from "@base-ui/react/preview-card";
import {Link} from "@tanstack/react-router";
import
{
	Children,
	isValidElement,
	type KeyboardEvent,
	type MouseEvent,
	type ReactElement,
	type ReactNode,
	useState,
} from "react";

import {isSessionLinkText, renderChipTitleHtml, SESSION_CHIP_STATE_LABELS} from "../lib/session-chip-label";
import type {SessionLinkChipState, SessionLinkTarget} from "../lib/session-link-href";
import {CHIP_INTERACTIVE, CHIP_LABEL, CHIP_MUTED, CHIP_STATIC} from "./session-link-chip-classes";
import
{
	CHIP_CARD_WIDTH,
	CLOSE_DELAY_MS,
	COLLISION_PADDING,
	POPUP_CLASS,
	SESSION_HOVER_CARD,
} from "./session-hover-card-classes";
import {Spinner} from "./ui/spinner";

export type {SessionLinkChipState} from "../lib/session-link-href";

function nodeText(node: ReactNode): string
{
	let text = "";
	Children.forEach(node, (child) =>
	{
		if (typeof child === "string" || typeof child === "number") text += String(child);
		else if (
			isValidElement<
			{
				children?: ReactNode;
			}>(child)
		)
			text += nodeText(child.props.children);
	});
	return text;
}

/* Upstream `jn`/`An`: Space activates an anchor chip on keyup, once per press. */
function onAnchorKeyDown(event: KeyboardEvent<HTMLAnchorElement>): void
{
	const target = event.currentTarget;
	if (event.key !== " ")
	{
		delete target.dataset["spaceDown"];
		return;
	}
	event.preventDefault();
	if (!event.repeat) target.dataset["spaceDown"] = "";
}

function onAnchorKeyUp(event: KeyboardEvent<HTMLAnchorElement>): void
{
	const target = event.currentTarget;
	const spaceDown = target.dataset["spaceDown"] !== undefined;
	delete target.dataset["spaceDown"];
	if (spaceDown && event.key === " " && !event.defaultPrevented) target.click();
}

export interface SessionLinkChipProps
{
	sessionId: string;
	title?: string;
	state?: SessionLinkChipState;
	/** The chip's session is the one open in the main view. */
	isOpen?: boolean;
	/** An external link, opened in a new tab. */
	href?: string;
	/** An in-app route, followed with the router. */
	internalTo?: string;
	onClick?: (event: MouseEvent<HTMLButtonElement>) => void;
	onContextMenu?: (event: MouseEvent<HTMLElement>) => void;
	menuOpen?: boolean;
	/** The message holding the chip is still streaming: a muted span with no link. */
	writing?: boolean;
	/** Just the words: no link, status or current marker. */
	wordsOnly?: boolean;
	labelSource?: "title" | "children";
	/** The linked session as the index knows it, which the chip's hover card shows; absent shows no card. */
	card?: SessionLinkTarget;
	/** Upstream `hoverCardDisabled`: no card, e.g. while the chip's menu is open. */
	hoverCardDisabled?: boolean;
	children?: ReactNode;
}

/** Upstream cce2a382f `U`: the hover card's meta separator. */
const META_SEPARATOR = " · ";

/**
 * Upstream's chip hover card body (cce2a382f `W`): the title, then a footnote meta line with the session's
 * status word (a spinner while it works) and its pull request by state ("1 open").
 */
function ChipCardBody({target}: {target: SessionLinkTarget})
{
	const working = target.state === "running";
	return (
		<div className="flex max-w-full flex-col gap-0.5">
			{target.title !== "" && (
				<span data-chip-card-title="" className="line-clamp-2 break-words text-body-medium text-primary">
					{target.title}
				</span>
			)}
			<span
				data-thread-hover-meta=""
				className="flex flex-wrap items-center gap-x-1 gap-y-0.5 text-footnote text-muted-as-secondary"
			>
				{target.status !== undefined && (
					<span className="inline-flex min-w-0 items-center gap-xs whitespace-nowrap">
						{working && (
							<span aria-busy="true" className="flex size-3 shrink-0 items-center justify-center">
								<Spinner size="sm" />
							</span>
						)}
						<span className="truncate">{target.status}</span>
					</span>
				)}
				{target.pr !== undefined && (
					<span
						data-thread-pr={target.pr.state}
						className="inline-flex min-w-0 items-center gap-xs whitespace-nowrap"
					>
						{target.status !== undefined && META_SEPARATOR}
						<span className="sr-only">Pull requests: </span>
						<span className="truncate">1 {target.pr.state}</span>
					</span>
				)}
			</span>
		</div>
	);
}

/** Upstream's cds hover card around the chip (`Wl`): 500ms in, 200ms out, 0-320px wide. */
function ChipHoverCard({
	root,
	target,
	disabled,
}: {
	root: ReactElement<Record<string, unknown>>;
	target: SessionLinkTarget;
	disabled: boolean;
})
{
	const [open, setOpen] = useState(false);
	return (
		<PreviewCard.Root open={open && !disabled} onOpenChange={setOpen}>
			<PreviewCard.Trigger render={root} delay={SESSION_HOVER_CARD.other.delay} closeDelay={CLOSE_DELAY_MS} />
			<PreviewCard.Portal>
				<PreviewCard.Positioner collisionPadding={COLLISION_PADDING} data-cds-portal="" className="z-[100]">
					<PreviewCard.Popup data-session-chip-card="" className={`${POPUP_CLASS} ${CHIP_CARD_WIDTH}`}>
						<ChipCardBody target={target} />
					</PreviewCard.Popup>
				</PreviewCard.Positioner>
			</PreviewCard.Portal>
		</PreviewCard.Root>
	);
}

/**
 * Upstream claude.ai/code's shared session link chip (`kn` in cb8c5a88f), default face. A session
 * chip in Code shows no leading mark (no Code chunk provides the kind icon), so it never takes upstream's `ln` (`gap-0.75 ps-1`).
 */
export function SessionLinkChip({
	sessionId: _sessionId,
	card,
	hoverCardDisabled = false,
	...props
}: SessionLinkChipProps)
{
	const root = chipRoot(props);
	return card === undefined || props.wordsOnly === true ? (
		root
	) : (
		<ChipHoverCard root={root} target={card} disabled={hoverCardDisabled} />
	);
}

function chipRoot({
	title,
	state,
	isOpen = false,
	href,
	internalTo,
	onClick,
	onContextMenu,
	menuOpen = false,
	writing = false,
	wordsOnly = false,
	labelSource = "title",
	children,
}: Omit<SessionLinkChipProps, "sessionId" | "card" | "hoverCardDisabled">): ReactElement<Record<string, unknown>>
{
	const status = wordsOnly ? undefined : state;
	const trimmedTitle = title?.trim() ?? "";
	let label: ReactNode;
	if (labelSource === "title" && trimmedTitle !== "")
	{
		label = (
			<span
				dangerouslySetInnerHTML={
				{
					__html: renderChipTitleHtml(trimmedTitle),
				}}
			/>
		);
	}
	else if (labelSource === "title" && isSessionLinkText(nodeText(children)))
	{
		label = <span>session</span>;
	}
	else
	{
		label = <span>{children}</span>;
	}
	const statusLabel = status === undefined ? null : SESSION_CHIP_STATE_LABELS[status];
	const body = (
		<span className={CHIP_LABEL}>
			{label}
			{statusLabel !== null && (
				<span className="contents">
					<span className="sr-only select-none"> — {statusLabel}</span>
				</span>
			)}
		</span>
	);

	const shared =
	{
		"aria-current": !wordsOnly && isOpen ? ("true" as const) : undefined,
		"aria-busy": status === "running" ? true : undefined,
		...(menuOpen &&
		{
			"data-menu-open": "",
		}),
		className: CHIP_INTERACTIVE,
		onContextMenu,
	};
	const linked = !wordsOnly && !writing;

	if (linked && internalTo !== undefined)
	{
		return (
			<Link to={internalTo} activeProps={{}} onKeyDown={onAnchorKeyDown} onKeyUp={onAnchorKeyUp} {...shared}>
				{body}
			</Link>
		);
	}
	if (linked && onClick !== undefined)
	{
		return (
			<button type="button" onClick={onClick} {...shared}>
				{body}
			</button>
		);
	}
	if (linked && href !== undefined)
	{
		return (
			<a
				href={href}
				target="_blank"
				rel="noreferrer"
				onKeyDown={onAnchorKeyDown}
				onKeyUp={onAnchorKeyUp}
				{...shared}
			>
				{body}
			</a>
		);
	}
	return (
		<span {...shared} className={writing ? CHIP_MUTED : CHIP_STATIC} data-chip-muted={writing ? "" : undefined}>
			{body}
		</span>
	);
}
