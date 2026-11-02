import {Link} from "@tanstack/react-router";
import MarkdownIt from "markdown-it";
import {Children, isValidElement, type KeyboardEvent, type MouseEvent, type ReactNode} from "react";

import type {SessionStateKind} from "../lib/session-state";
import {CHIP_INTERACTIVE, CHIP_LABEL, CHIP_MUTED, CHIP_STATIC} from "./session-link-chip-classes";

export type SessionLinkChipState = SessionStateKind | "archived";

/** Upstream `bt`'s screen-reader status words; idle has none. */
const STATE_LABELS =
{
	running: "Running",
	awaiting: "Awaiting permission",
	ready: "Ready",
	error: "Error",
	archived: "Archived",
	idle: null,
} as const satisfies Record<SessionLinkChipState, string | null>;

/** Upstream `He`'s session-link grammar (c4aef5f87 `D`): a claude.ai session URL or a `#session_…` fragment. */
const SESSION_LINK_TEXT =
	/^(?:https?:\/\/claude\.ai\/code\/(?:session\/)?(?:session|ses|cse)_\w{6,}(?:[?#]\S*)?|#(?:session|ses|cse)_\w{6,})$/;

/*
 * Upstream `Bt`: a tiny inline markdown for chip titles that allows only strong, em, code and
 * (double-tilde) del, with code as `font-mono-ui`. Raw HTML is escaped.
 */
const titleMarkdown = new MarkdownIt("zero").enable(["emphasis", "backticks", "strikethrough", "escape", "entity"]);
titleMarkdown.renderer.rules.code_inline = (tokens, idx) =>
	`<code class="font-mono-ui">${titleMarkdown.utils.escapeHtml(tokens[idx]?.content ?? "")}</code>`;

function renderChipTitleHtml(title: string): string
{
	return titleMarkdown.renderInline(title);
}

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
	children?: ReactNode;
}

/**
 * Upstream claude.ai/code's shared session link chip (`kn` in cb8c5a88f), default face. A session
 * chip in Code shows no leading mark (no Code chunk provides the kind icon), so it never takes upstream's `ln` (`gap-0.75 ps-1`).
 */
export function SessionLinkChip({
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
}: SessionLinkChipProps)
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
	else if (labelSource === "title" && SESSION_LINK_TEXT.test(nodeText(children).trim()))
	{
		label = <span>session</span>;
	}
	else
	{
		label = <span>{children}</span>;
	}
	const statusLabel = status === undefined ? null : STATE_LABELS[status];
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
