/* The session link chip's label pieces, shared by the React chip and the markdown renderer's HTML chip. */
import MarkdownIt from "markdown-it";

import {parseSessionLinkHref, type SessionLinkChipState} from "./session-link-href";

/** Upstream `bt`'s screen-reader status words; idle has none. */
export const SESSION_CHIP_STATE_LABELS =
{
	running: "Running",
	awaiting: "Awaiting permission",
	ready: "Ready",
	error: "Error",
	archived: "Archived",
	idle: null,
} as const satisfies Record<SessionLinkChipState, string | null>;

/*
 * Upstream `Bt`: a tiny inline markdown for chip titles that allows only strong, em, code and
 * (double-tilde) del, with code as `font-mono-ui`. Raw HTML is escaped.
 */
const titleMarkdown = new MarkdownIt("zero").enable(["emphasis", "backticks", "strikethrough", "escape", "entity"]);
titleMarkdown.renderer.rules.code_inline = (tokens, idx) =>
	`<code class="font-mono-ui">${titleMarkdown.utils.escapeHtml(tokens[idx]?.content ?? "")}</code>`;

export function renderChipTitleHtml(title: string): string
{
	return titleMarkdown.renderInline(title);
}

/** Upstream `He`: link text that is itself a claude.ai session link, which an untitled chip reads as "session". */
export function isSessionLinkText(text: string): boolean
{
	return parseSessionLinkHref(text.trim())?.kind === "session";
}
