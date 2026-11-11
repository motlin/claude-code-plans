// Upstream claude.ai/code's href normalisers for a drawn link (cbb72cde9 `mr`'s `L(re(t))`): shared-l-p-m-w-2
// `_0` drops the desktop app's `open_in_browser` flag, then cf6507c5a `cs` sanitises what is left.

import {
	isAccountLinkingLink,
	isApiRoute,
	isDesktopDownload,
	isOwnAppLink,
	isOwnAppOrApiLink,
	isSignOutLink,
} from "./claude-hosts";

/** Upstream `y8`. */
const OPEN_IN_BROWSER = "open_in_browser";
/** Upstream's longest href (`TQ`). */
const MAX_HREF = 16_384;
/** Upstream `zl`: the origin a server-side render resolves against. */
const FALLBACK_ORIGIN = "https://claude.ai";

/** Upstream `qc` (`rm`): the href with tabs and newlines dropped and its ends trimmed of spaces and controls. */
function trimHref(href: string): string {
	const text = href.replace(/[\t\n\r]/g, "");
	let start = 0;
	let end = text.length;
	while (start < end && text.charCodeAt(start) <= 32) start++;
	while (end > start && text.charCodeAt(end - 1) <= 32) end--;
	return text.slice(start, end);
}

/**
 * Upstream `ng` (through `KF`) with `_0`'s one key: the query without `open_in_browser`. An href without the key
 * comes back exactly as written.
 */
function stripOpenInBrowser(href: string): string {
	const text = trimHref(href);
	const hashAt = text.indexOf("#");
	const hash = hashAt === -1 ? "" : text.slice(hashAt);
	const beforeHash = hashAt === -1 ? text : text.slice(0, hashAt);
	const queryAt = beforeHash.indexOf("?");
	if (queryAt === -1) return href;
	const params = new URLSearchParams(beforeHash.slice(queryAt + 1));
	if (!params.has(OPEN_IN_BROWSER)) return href;
	params.delete(OPEN_IN_BROWSER);
	const query = params.toString();
	return beforeHash.slice(0, queryAt) + (query === "" ? "" : `?${query}`) + hash;
}

/** Upstream `Eh` (`KG`): characters a reader cannot see. */
const INVISIBLE =
	/[\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}\p{Default_Ignorable_Code_Point}⠀￼\u{1D159}\u{13441}\u{13442}\u{16910}\u{16FE4}﷐-﷯￾￿\u{1FFFE}\u{1FFFF}\u{2FFFE}\u{2FFFF}\u{3FFFE}\u{3FFFF}\u{4FFFE}\u{4FFFF}\u{5FFFE}\u{5FFFF}\u{6FFFE}\u{6FFFF}\u{7FFFE}\u{7FFFF}\u{8FFFE}\u{8FFFF}\u{9FFFE}\u{9FFFF}\u{AFFFE}\u{AFFFF}\u{BFFFE}\u{BFFFF}\u{CFFFE}\u{CFFFF}\u{DFFFE}\u{DFFFF}\u{EFFFE}\u{EFFFF}\u{FFFFE}\u{FFFFF}\u{10FFFE}\u{10FFFF}]/u;
/** Upstream `F_`. */
const HIDDEN_LEAD = new RegExp(String.raw`^(?:\s|\p{M}|${INVISIBLE.source})`, "u");
/** Upstream `L6`. */
const ENCODED_LEAD = new RegExp(String.raw`^(?:%[0-9a-f]{2}|(?:\s|${INVISIBLE.source}))*`, "iu");
const UNSEEN_LEAD = new RegExp(String.raw`^(?:\s|${INVISIBLE.source})+`, "u");

/** Upstream `n4`: an http(s) scheme without `//`. */
function lacksSlashes(href: string): boolean {
	return /^https?:(?![/\\]{2})/i.test(trimHref(href));
}

/** Upstream `RT`: the href starts with whitespace, a combining mark or an invisible character, encoded or not. */
function hasHiddenLead(href: string): boolean {
	const text = trimHref(href);
	const encoded = /^(?:%[0-9a-f]{2}){1,4}/i.exec(text)?.[0];
	if (encoded === undefined) return HIDDEN_LEAD.test(text);
	for (let end = 3; end <= encoded.length; end += 3) {
		try {
			return HIDDEN_LEAD.test(decodeURIComponent(encoded.slice(0, end)));
		} catch {
			// A partial UTF-8 sequence: try a longer prefix.
		}
	}
	return false;
}

/** Upstream `l9`: the href's encoded lead decodes to a backslash. */
function hasBackslashLead(href: string): boolean {
	const lead = ENCODED_LEAD.exec(trimHref(href))?.[0] ?? "";
	if (!/%5c/i.test(lead)) return false;
	try {
		return decodeURIComponent(lead).replace(UNSEEN_LEAD, "").startsWith("\\");
	} catch {
		return true;
	}
}

/** Upstream `T7`: this page's origin. */
function pageOrigin(): string {
	return typeof window === "undefined" ? FALLBACK_ORIGIN : window.location.origin;
}

/** Upstream `UY` with one host rule: the href resolved against this page, kept when `onSite` accepts it. */
function resolvedOnSite(href: string, onSite: (url: URL, page: URL) => boolean): URL[] {
	const page = new URL(pageOrigin());
	try {
		const url = new URL(trimHref(href), page);
		return onSite(url, page) ? [url] : [];
	} catch {
		return [];
	}
}

/** Upstream `xm`: claude.com's OAuth authorize page, which a link may open. */
function isClaudeComAuthorize(url: URL): boolean {
	return (
		(url.hostname === "claude.com" || url.hostname === "www.claude.com") && url.pathname === "/cai/oauth/authorize"
	);
}

/**
 * Upstream `pv`: an href a link never carries — too long, a scheme without `//`, a hidden or backslash lead, or
 * (on this site or a Claude app host) an API, sign-out or account-linking route. Not ported: `cB`, claude.ai's own
 * chat and task session routes (`G5`), which this app never links to.
 */
function isUnsafeHref(href: string): boolean {
	return (
		href.length > MAX_HREF ||
		lacksSlashes(href) ||
		hasHiddenLead(href) ||
		hasBackslashLead(href) ||
		resolvedOnSite(href, isOwnAppOrApiLink).some(
			(url) => isApiRoute(url.href) && !isDesktopDownload(url.pathname) && !isClaudeComAuthorize(url),
		) ||
		resolvedOnSite(href, isOwnAppLink).some((url) => isSignOutLink(url.href) || isAccountLinkingLink(url.href))
	);
}

/**
 * Upstream `cs` (via `hs` and `XR`): the href a link may carry, or null. Not ported: `XR`'s `$A`, which strips
 * claude.ai's own sign-in and checkout query keys from links back to claude.ai.
 */
export function sanitizeHref(href: string): string | null {
	if (href.length > MAX_HREF) return null;
	if (/^https?:(?!\/\/)/i.test(href)) return null;
	return isUnsafeHref(href) ? null : href;
}

/** Upstream `mr`'s `L(re(t))`: the href with `open_in_browser` dropped, then sanitised. */
export function linkHref(href: string): string | null {
	return sanitizeHref(stripOpenInBrowser(href));
}
