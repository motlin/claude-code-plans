// Upstream claude.ai/code's external-link confirm helpers (shared-w-0 `MM`/`To`/`Kj`/`T6`/`Ud`/`HK`/`fg`/`ok`/`Xl`/`Vl`
// and shared-12 `hZ`/`lv`), behind the tool body's "confirm" link policy.

/** Upstream `MM`: the localStorage key of the domains whose links open without asking. */
const TRUSTED_DOMAINS_KEY = "external-nav-trusted-domains";
/** Upstream `HK` keeps the 200 most recently trusted domains. */
const MAX_TRUSTED_DOMAINS = 200;

/** Upstream `MP`: the page URL that relative links resolve against. */
function pageUrl(): string {
	return typeof window === "undefined" ? "http://localhost/" : window.location.href;
}

function parse(url: string): URL | null {
	try {
		return new URL(url, pageUrl());
	} catch {
		return null;
	}
}

/** Upstream `Kj`: the host a "Don't ask again" covers; https only, never this page's own origin. */
export function trustableDomain(url: string): string | null {
	const parsed = parse(url);
	if (parsed?.protocol !== "https:" || parsed.host === "") return null;
	return parsed.origin === new URL(pageUrl()).origin ? null : parsed.host;
}

/** Upstream `T6`. */
function trustedDomains(): string[] {
	try {
		const value: unknown = JSON.parse(localStorage.getItem(TRUSTED_DOMAINS_KEY) ?? "null");
		return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
	} catch {
		return [];
	}
}

/** Upstream `HK`: remember a link's domain, most recent last. */
export function trustDomain(url: string): void {
	const domain = trustableDomain(url);
	if (domain === null) return;
	const kept = trustedDomains().filter((entry) => entry !== domain);
	try {
		localStorage.setItem(TRUSTED_DOMAINS_KEY, JSON.stringify([...kept.slice(-(MAX_TRUSTED_DOMAINS - 1)), domain]));
	} catch {
		// Storage can be unavailable (private mode); the link still opened.
	}
}

/** Upstream `Dp` (`!Ma(e) && Ud(e)`): a link whose domain the viewer chose not to be asked about again. */
export function isTrustedDomainLink(url: string): boolean {
	if (isDeceptiveLink(url)) return false;
	const domain = trustableDomain(url);
	return domain !== null && trustedDomains().includes(domain);
}

/** Upstream `Vl`: not an http(s) link. */
export function isNonWebLink(url: string): boolean {
	const parsed = parse(url);
	return parsed !== null && parsed.protocol !== "http:" && parsed.protocol !== "https:";
}

/** Upstream `ok`: the real host of a link carrying a username or password, else null. */
export function embeddedCredentialsHost(url: string): string | null {
	const parsed = parse(url);
	return parsed !== null && (parsed.username !== "" || parsed.password !== "") ? parsed.host : null;
}

/** Upstream `fg`: a link whose host has an `xn--` label, with that host decoded for display. */
export function deceptiveHost(url: string): {punycode: string | null} {
	const parsed = parse(url);
	if (parsed === null || !parsed.hostname.split(".").some((label) => label.toLowerCase().startsWith("xn--"))) {
		return {punycode: null};
	}
	return {punycode: decodeHostname(parsed.hostname)};
}

/** Upstream `Xl`: the link as the dialog shows it, normalized. */
export function displayUrl(url: string): string {
	return parse(url)?.href ?? url;
}

/** Upstream `Ll` + `hZ` (the claude.ai half of `yo` has no local counterpart): links upstream opens without asking. */
const TRUSTED_EXTERNAL_HOSTS = new Set(["code.claude.com"]);

/** Upstream `hZ` / `lv`: a trusted external or same-origin link, which navigates itself. */
export function opensWithoutConfirm(url: string): boolean {
	const parsed = parse(url);
	if (parsed === null) return false;
	if (parsed.origin === new URL(pageUrl()).origin) return true;
	return parsed.protocol === "https:" && TRUSTED_EXTERNAL_HOSTS.has(parsed.hostname);
}

/** Upstream `bD`: a claude.ai or claude.com host. */
function isClaudeHost(hostname: string): boolean {
	return ["claude.ai", "claude.com"].some((root) => hostname === root || hostname.endsWith(`.${root}`));
}

/** Upstream `Ma`: a link whose host is punycode or which carries a username or password. */
function isDeceptiveLink(url: string): boolean {
	return deceptiveHost(url).punycode !== null || embeddedCredentialsHost(url) !== null;
}

/**
 * Upstream c5e04cdc6 `n` (as `ft` checks a "confirm" link): an http(s) link the external-link confirm may open —
 * not trusted or same-origin, no username or password, not a Claude host.
 */
function confirmable(url: string): boolean {
	if (!/^https?:\/\//i.test(url) || opensWithoutConfirm(url)) return false;
	const parsed = parse(url);
	return parsed !== null && embeddedCredentialsHost(url) === null && !isClaudeHost(parsed.hostname);
}

/** How upstream's `pr` draws a link: a live link, through the external-link confirm, or as words. */
export type LinkTreatment = "live" | "confirm" | "words";

/**
 * Upstream `fr` under the session transcript's link policy (cc3bf7b05 `bc`, no outer policy): links are live,
 * except deceptive ones, which ask first when the confirm can open them and are words otherwise.
 */
export function transcriptLinkTreatment(url: string): LinkTreatment {
	if (!isDeceptiveLink(url)) return "live";
	return confirmable(url) ? "confirm" : "words";
}

// RFC 3492 punycode decoding, for upstream `s8`'s display of an internationalized host.
const BASE = 36;
const T_MIN = 1;
const T_MAX = 26;
const SKEW = 38;
const DAMP = 700;
const INITIAL_BIAS = 72;
const INITIAL_N = 128;

function adapt(delta: number, points: number, first: boolean): number {
	let scaled = first ? Math.floor(delta / DAMP) : delta >> 1;
	scaled += Math.floor(scaled / points);
	let k = 0;
	while (scaled > ((BASE - T_MIN) * T_MAX) >> 1) {
		scaled = Math.floor(scaled / (BASE - T_MIN));
		k += BASE;
	}
	return k + Math.floor(((BASE - T_MIN + 1) * scaled) / (scaled + SKEW));
}

function digitOf(code: number): number {
	if (code >= 48 && code <= 57) return code - 22;
	if (code >= 65 && code <= 90) return code - 65;
	if (code >= 97 && code <= 122) return code - 97;
	return BASE;
}

function decodeLabel(input: string): string {
	const output: number[] = [];
	const basicEnd = input.lastIndexOf("-");
	for (let i = 0; i < Math.max(basicEnd, 0); i++) output.push(input.charCodeAt(i));
	let n = INITIAL_N;
	let bias = INITIAL_BIAS;
	let i = 0;
	for (let index = basicEnd > 0 ? basicEnd + 1 : 0; index < input.length;) {
		const oldI = i;
		for (let w = 1, k = BASE; ; k += BASE) {
			if (index >= input.length) throw new RangeError("punycode: truncated");
			const digit = digitOf(input.charCodeAt(index++));
			if (digit >= BASE) throw new RangeError("punycode: bad digit");
			i += digit * w;
			const t = k <= bias ? T_MIN : k >= bias + T_MAX ? T_MAX : k - bias;
			if (digit < t) break;
			w *= BASE - t;
		}
		const points = output.length + 1;
		bias = adapt(i - oldI, points, oldI === 0);
		n += Math.floor(i / points);
		i %= points;
		output.splice(i++, 0, n);
	}
	return String.fromCodePoint(...output);
}

/** Upstream `s8`: the host with its `xn--` labels decoded; the raw host when decoding fails. */
function decodeHostname(hostname: string): string {
	try {
		const decoded = hostname
			.split(".")
			.map((label) => (label.toLowerCase().startsWith("xn--") ? decodeLabel(label.slice(4)) : label))
			.join(".");
		// Enclosing marks could draw over the rest of the host.
		return /\p{Me}/u.test(decoded) ? hostname : decoded;
	} catch {
		return hostname;
	}
}
