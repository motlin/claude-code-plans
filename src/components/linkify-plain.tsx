import type {ReactNode} from "react";

import {maskSecrets} from "../lib/secret-mask";
import {splitUrlTail} from "../lib/url-trim";
import {ConfirmExternalLink} from "./confirm-external-link";

/** Upstream c40ad8c1e `_`: http(s) URLs plus the bare status hosts. */
const PLAIN_URL_PATTERN = /\bhttps?:\/\/[^\s<>"`]+|\bstatus\.(?:claude|anthropic)\.com\b/g;

function count(text: string, char: string): number
{
	return text.split(char).length - 1;
}

/** Upstream `v`: drop trailing `]` / `}` with no opener inside the URL, and trailing `'`. */
function trimUnbalancedBrackets(url: string): string
{
	let squares = count(url, "]") - count(url, "[");
	let braces = count(url, "}") - count(url, "{");
	let end = url.length;
	for (; end > 0; end--)
	{
		const last = url[end - 1];
		if (last === "]" && squares > 0) squares--;
		else if (last === "}" && braces > 0) braces--;
		else if (last !== "'") break;
	}
	return url.slice(0, end);
}

const PERCENT_ESCAPE = /%([0-7][0-9a-f])/gi;
const BACKSLASH_ESCAPE = /\\([!-/:-@[-`{-~])/g;

/** Upstream `t_`: a URL that hides a secret, once its escapes are undone, is shown as words. */
function urlHidesSecret(url: string): boolean
{
	const decoded = url
		.replace(PERCENT_ESCAPE, (_, hex: string) => String.fromCharCode(Number.parseInt(hex, 16)))
		.replace(BACKSLASH_ESCAPE, "$1");
	return maskSecrets(decoded) !== decoded;
}

/**
 * Upstream's plain tool-body linkify (`eS` = c40ad8c1e `y(text, $x, 200)`): URLs become external TextLinks that
 * ask before leaving (`Zx` "confirm"), at most `maxLinks` of them; a URL hiding a secret renders as
 * `span[dir=ltr]` words (`Zx` "words").
 */
export function linkifyPlain(
	text: string,
	{
		maxLinks,
	}:
	{
		maxLinks: number;
	},
): ReactNode[]
{
	const nodes: ReactNode[] = [];
	let cursor = 0;
	let links = 0;
	for (const match of text.matchAll(PLAIN_URL_PATTERN))
	{
		if (links === maxLinks) break;
		const [shown] = splitUrlTail(trimUnbalancedBrackets(splitUrlTail(match[0])[0]));
		if (shown === "") continue;
		const href = /^https?:/.test(shown) ? shown : `https://${shown}`;
		links += 1;
		if (match.index > cursor) nodes.push(text.slice(cursor, match.index));
		nodes.push(
			urlHidesSecret(href) ? (
				<span key={match.index} dir="ltr">
					{shown}
				</span>
			) : (
				<ConfirmExternalLink key={match.index} href={href}>
					{shown}
				</ConfirmExternalLink>
			),
		);
		cursor = match.index + shown.length;
	}
	if (cursor < text.length) nodes.push(text.slice(cursor));
	return nodes;
}

/** Upstream's `Pv`: a tool body or param value links at most 200 URLs. */
const MAX_TOOL_LINKS = 200;

/** Upstream's `Iv` (cb6930dae): a tool body's or plain param value's run, its URLs linked by `Fv`, at most 200. */
export function linkifyToolText(text: string): ReactNode
{
	return linkifyPlain(
		text,
		{
			maxLinks: MAX_TOOL_LINKS,
		},
	);
}
