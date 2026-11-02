// Upstream claude.ai/code's Claude host and credential-route rules (shared-l-p-m-w-0 `wa`/`bD`/`D6`/`sk` and the
// route tables behind them), as its link policy and href sanitiser consult them.

/** Upstream `xq`: the app's own hosts. */
const APP_HOSTS = new Set([
	"claude.ai",
	"www.claude.ai",
	"preview.claude.ai",
	"claude.com",
	"www.claude.com",
	"preview.claude.com",
]);
const OTHER_FIRST_PARTY_HOSTS = new Set([
	"code.claude.com",
	"platform.claude.com",
	"console.claude.com",
	"auth.claude.com",
	"admin.claude.com",
	"staging.claude.ai",
	"staging.claude.com",
	"claude.app",
	"www.claude.app",
	"website.claude.com",
	"claudestudio.com",
	"www.claudestudio.com",
]);
/** Upstream `DA`. */
const PORTAL_HOSTS = new Set(["portal.anthropic.com", "www.portal.anthropic.com"]);
/** Upstream `e8`. */
const ANTHROPIC_CONSOLE_HOSTS = new Set(["console.anthropic.com", "console-staging.anthropic.com", "anthropic.com"]);

/** Upstream `x4` / `To`: the host without trailing dots, lowercased. */
function trimHost(hostname: string): string
{
	return hostname.replace(/\.+$/, "").toLowerCase();
}

/** Upstream `XV`: the `.ai` host's `.com` twin and back. */
function twinHost(host: string): string | null
{
	if (host.endsWith(".ai")) return `${host.slice(0, -2)}com`;
	if (host.endsWith(".com")) return `${host.slice(0, -3)}ai`;
	return null;
}

/** Upstream `Q$`. */
function isFirstPartyHost(host: string): boolean
{
	return APP_HOSTS.has(host) || OTHER_FIRST_PARTY_HOSTS.has(host);
}

/** Upstream `wa`: a first-party Claude host, its `.ai`/`.com` twin, or the Anthropic portal. */
function isClaudeFamilyHost(hostname: string): boolean
{
	const host = trimHost(hostname);
	const twin = twinHost(host);
	return isFirstPartyHost(host) || (twin !== null && isFirstPartyHost(twin)) || PORTAL_HOSTS.has(host);
}

/** Upstream `bD`: claude.ai, claude.com, a subdomain of either, or a `wa` host. */
export function isClaudeHost(hostname: string): boolean
{
	const host = trimHost(hostname);
	return (
		host === "claude.ai" ||
		host.endsWith(".claude.ai") ||
		host === "claude.com" ||
		host.endsWith(".claude.com") ||
		isClaudeFamilyHost(host)
	);
}

/** Upstream `f8`: a loopback host. */
function isLoopbackHost(hostname: string): boolean
{
	const host = trimHost(hostname);
	return (
		host === "localhost" ||
		host.endsWith(".localhost") ||
		host === "::1" ||
		host === "[::1]" ||
		/^127\.\d+\.\d+\.\d+$/.test(host)
	);
}

/** Upstream `lw`: a `www.` prefix dropped from a host of three or more labels. */
function withoutWww(host: string): string
{
	return host.startsWith("www.") && host.split(".").length >= 3 ? host.slice(4) : host;
}

/**
 * Upstream `D6`: how closely a link's host is held — "strict" for a `wa` host or this page's own site (unless the
 * page is loopback), "canonical" for another Claude host, else null.
 */
function hostStrictness(hostname: string, pageHostname: string | null): "strict" | "canonical" | null
{
	const host = trimHost(hostname);
	if (isClaudeFamilyHost(host)) return "strict";
	if (pageHostname !== null && !isLoopbackHost(pageHostname))
	{
		const page = trimHost(pageHostname);
		const twin = twinHost(page);
		if (
			host === page ||
			(twin !== null && host === twin) ||
			(page !== "claude.ai" &&
				page !== "claude.com" &&
				(host.endsWith(`.${page}`) || (twin !== null && host.endsWith(`.${twin}`))))
		)
		{
			return "strict";
		}
	}
	return isClaudeHost(host) ? "canonical" : null;
}

/** Upstream `Ln`: sign-in and redirect routes. */
const AUTH_ROUTES = [
	"/login",
	"/logout",
	"/oauth",
	"/magic-link",
	"/sso-callback",
	"/partner-callback",
	"/partner-onboarding",
	"/partner-setup",
	"/cai",
	"/redirect",
	"/health",
	"/lti",
	"/api/lti",
	"/edge-api/preview-redirect",
	"/onboarding",
	"/connect",
];
/** Upstream `vA`: routes that act on a return destination. */
const DESTINATION_ROUTES = [
	"/upgrade",
	"/invites",
	"/join",
	"/setup-2fa",
	"/age-verification",
	"/create/team/invites",
	"/create/team/billing",
	"/create/enterprise/review",
	"/labs-verification/email",
	"/create/team/pending",
	"/settings/billing",
	"/admin-settings/billing",
	"/settings/connectors",
	"/customize",
	"/plugins",
	"/settings/mcp/auth_mismatch",
];
/** Upstream `Ch` and `eP`: the query keys that carry a return destination. */
const DESTINATION_KEYS = new Set(["returnTo", "freeReturnTo", "state", "retryPath", "redirect_url", "origin"]);
const STRICT_DESTINATION_KEYS = new Set([...DESTINATION_KEYS, "redirectTo", "returnUrl"]);
/** Upstream `vd`. */
const DESTINATION_FLAGS = ["auth_start", "open_outline_auth", "redirect_status", "max_payment_success", "redirect_url"];
/** Upstream `UO` and `dg`. */
const MAX_PATH = 4096;
const MAX_HOPS = 20;

function underRoute(path: string, routes: readonly string[]): boolean
{
	const lower = path.toLowerCase();
	return routes.some((route) => lower === route || lower.startsWith(`${route}/`));
}

/**
 * Upstream `C_`: a path matching `matches`, failing closed on a long path or one holding `?`/`#`. Upstream also
 * tries each of its decoding transforms (`gO`); this tries the path as written, percent-decoded, and with
 * backslashes and doubled slashes folded.
 */
function pathMatches(path: string, matches: (path: string) => boolean): boolean
{
	if (path.length > MAX_PATH || path.includes("?") || path.includes("#")) return true;
	let decoded: string;
	try
	{
		decoded = decodeURIComponent(path);
	}
	catch
	{
		return true;
	}
	return [path, decoded].some(
		(variant) => matches(variant) || matches(variant.replace(/\\/g, "/").replace(/\/{2,}/g, "/")),
	);
}

/** Upstream `$T`. */
function isLoginRoute(path: string): boolean
{
	return path === "/login" || path.startsWith("/login/");
}

/** Upstream `FR`: a sign-in or redirect route. */
function isAuthRoute(path: string): boolean
{
	return pathMatches(path, (variant) => underRoute(variant, AUTH_ROUTES));
}

/** Upstream `FW`: a `#settings` or `#customize` hash. */
function isSettingsHash(hash: string): boolean
{
	const forms = [hash.toLowerCase()];
	try
	{
		forms.push(decodeURIComponent(hash).toLowerCase());
	}
	catch
	{
		// Upstream keeps the forms it could read.
	}
	return forms.some((form) =>
		["#settings", "#customize"].some((root) => form === root || form.startsWith(`${root}/`)),
	);
}

/** Upstream `Em`. */
function opensSettingsDirectory(url: URL): boolean
{
	const directory = url.searchParams.get("directory")?.toLowerCase();
	return directory !== undefined && (directory.startsWith("settings") || directory.startsWith("customize"));
}

/** Upstream `gS`: a page that acts on a return destination. */
function consumesDestination(url: URL): boolean
{
	return (
		pathMatches(url.pathname, (variant) => underRoute(variant, DESTINATION_ROUTES)) ||
		isSettingsHash(url.hash) ||
		opensSettingsDirectory(url) ||
		DESTINATION_FLAGS.some((flag) => url.searchParams.has(flag))
	);
}

/** Upstream `eB`: any strict destination key with a value also counts. */
function strictlyConsumesDestination(url: URL): boolean
{
	if (url.search.length > MAX_PATH) return true;
	for (const [key, value] of url.searchParams) if (STRICT_DESTINATION_KEYS.has(key) && value !== "") return true;
	return consumesDestination(url);
}

interface DestinationRule
{
	consumes: (url: URL) => boolean;
	keys: ReadonlySet<string>;
}

/** Upstream `T1` and `_k`. */
const DESTINATION_RULE: DestinationRule =
{
	consumes: consumesDestination,
	keys: DESTINATION_KEYS,
};
const STRICT_DESTINATION_RULE: DestinationRule =
{
	consumes: strictlyConsumesDestination,
	keys: STRICT_DESTINATION_KEYS,
};

/** Upstream's JSON-wrapped destination values, unwrapped one level. */
function destinationValues(value: string): string[]
{
	const values = [value];
	try
	{
		const parsed: unknown = JSON.parse(value);
		if (typeof parsed === "string" && parsed !== value) values.push(parsed);
		else if (Array.isArray(parsed))
		{
			for (const item of parsed)
			{
				values.push(typeof item === "object" && item !== null ? JSON.stringify(item) : String(item));
			}
		}
	}
	catch
	{
		// Not JSON: the value as written.
	}
	return values;
}

/**
 * Upstream `X9`: a destination-consuming page whose return destination is a sign-in route (`Qz`), following
 * destinations that consume destinations in turn; failing closed past 20 hops.
 */
function forwardsToAuthRoute(start: URL, rule: DestinationRule): boolean
{
	const queue = [start];
	for (let hops = 1; queue.length > 0; hops++)
	{
		if (hops > MAX_HOPS) return true;
		const url = queue.shift();
		if (url === undefined || !rule.consumes(url)) continue;
		if (url.search.length > MAX_PATH) return true;
		const seen = new Set<string>();
		for (const [key, raw] of url.searchParams)
		{
			if (!rule.keys.has(key) || raw === "") continue;
			for (const value of destinationValues(raw))
			{
				for (const base of ["https://r.invalid", "http://r.invalid"])
				{
					let target: URL;
					try
					{
						target = new URL(value, base);
					}
					catch
					{
						return true;
					}
					if (isAuthRoute(target.pathname)) return true;
					const folded = new URL(
						target.pathname.replace(/\\/g, "/").replace(/^\/+/, "/") + target.search,
						base,
					);
					const path = folded.pathname + folded.search + folded.hash;
					if (rule.consumes(folded) && !seen.has(path))
					{
						seen.add(path);
						queue.push(folded);
					}
				}
			}
		}
	}
	return false;
}

/** Upstream `aw`. */
function forwardsDestinationToAuth(url: URL): boolean
{
	return forwardsToAuthRoute(url, DESTINATION_RULE);
}

/** Upstream `$M`, `gx` and `tP`: redirect routes, API routes, and the OAuth pages a link may open. */
const REDIRECT_PREFIXES = ["/redirect/", "/cai/"];
const API_PREFIXES = [
	"/api/",
	"/edge-api/",
	"/web-api/",
	"/v1/",
	"/v2/",
	"/mcp-registry/",
	"/sandbox/",
	"/oauth/",
	"/claudeai-rpc/",
	"/design/mcp/",
	"/design/v1/",
	"/design/anthropic.omelette.api.v1alpha.omeletteservice/",
];
const OPENABLE_OAUTH_PAGES = ["/oauth/authorize", "/oauth/code", "/oauth/device"];
/** Upstream `JL` and `gt`. */
const SIGN_OUT_PREFIXES = ["/logout/", "/sso-callback/", "/magic-link/", "/partner-callback/"];
const SIGNED_OUT_PAGE_PREFIXES = ["/partner-callback/signed-out/"];
/** Upstream `EI`. */
const ACCOUNT_LINKING_PREFIXES = [
	"/connect/",
	"/connect-github/",
	"/github-integration/",
	"/messages/password-manager/",
	"/duet/password-manager/",
	"/dm/password-manager/",
	"/lti/",
	"/referral/",
	"/perks/redeem/",
	"/login/app-google-auth/",
	"/login/popup-google-auth/",
	"/login/apple-callback/",
	"/partner-onboarding/",
	"/email/usage-auto-reload/",
];

/** Upstream `Cs`: under one of the `/`-ended prefixes, or the prefix's route itself. */
function underPrefix(path: string, prefixes: readonly string[]): boolean
{
	return prefixes.some((prefix) => path.startsWith(prefix) || path === prefix.slice(0, -1));
}

/** Upstream `ua`: the path before `?`/`#`, plus its form without `;` parameters. */
function pathForms(path: string): string[]
{
	const cut = path.search(/[?#]/);
	const bare = cut === -1 ? path : path.slice(0, cut);
	return bare.includes(";") ? [bare, bare.replace(/;[^/]*/g, "").replace(/\/{2,}/g, "/")] : [bare];
}

/** Upstream `Zk`. */
function isOpenableOauthPage(path: string): boolean
{
	return OPENABLE_OAUTH_PAGES.some((page) => path === page || path.startsWith(`${page}/`));
}

/** Upstream `Z8`: a redirect or API route. */
function isApiOrRedirectRoute(path: string): boolean
{
	return (
		underPrefix(path, REDIRECT_PREFIXES) ||
		pathForms(path).some((form) => !isOpenableOauthPage(form) && underPrefix(form, API_PREFIXES))
	);
}

/** Upstream `DD`. */
function isSignOutRoute(path: string): boolean
{
	return pathForms(path).some(
		(form) => underPrefix(form, SIGN_OUT_PREFIXES) && !underPrefix(form, SIGNED_OUT_PAGE_PREFIXES),
	);
}

/** Upstream `i3`. */
function isAccountLinkingRoute(path: string): boolean
{
	return pathForms(path).some((form) => underPrefix(form, ACCOUNT_LINKING_PREFIXES));
}

/**
 * Upstream `SH`: a path (or a URL's path and query) matching `matches` in any spelling: with tabs and newlines
 * dropped, backslashes as slashes, lowercased, doubled slashes folded, and percent-decoded; failing closed when
 * it cannot be read. Upstream also tries the route with its trailing slashes dropped and its control-character
 * spellings (`aG`, `ND`, `wD`); this tries those it can reach with one decode.
 */
function routeMatches(raw: string, matches: (path: string) => boolean, depth = 0): boolean
{
	const text = raw
		.replace(/[\t\n\r]/g, "")
		.trim()
		.replace(/\\/g, "/");
	const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(text);
	if (scheme !== null)
	{
		if (depth >= 32) return true;
		try
		{
			const url = new URL(text, `${(scheme[1] ?? "").toLowerCase()}://example.com`);
			return routeMatches(`${url.pathname}${url.search}`, matches, depth + 1);
		}
		catch
		{
			return true;
		}
	}
	if (!text.startsWith("/")) return false;
	const folded = text.toLowerCase().replace(/\/{2,}/g, "/");
	let decoded: string;
	try
	{
		decoded = decodeURIComponent(folded).replace(/\/{2,}/g, "/");
	}
	catch
	{
		return true;
	}
	return matches(folded) || matches(decoded);
}

/** Upstream `zb` (`uO`): an API or redirect route. */
export function isApiRoute(path: string): boolean
{
	return routeMatches(path, isApiOrRedirectRoute);
}

/** Upstream `Nw` (`r1`): a sign-out route. */
export function isSignOutLink(path: string): boolean
{
	return routeMatches(path, isSignOutRoute);
}

/** Upstream `RO` (`Ix`): an account-linking route. */
export function isAccountLinkingLink(path: string): boolean
{
	return routeMatches(path, isAccountLinkingRoute);
}

/** Upstream `ZI`: the desktop download redirect. */
const DESKTOP_DOWNLOAD = /^\/api\/desktop\/(?:darwin|win32|linux)\/[a-z0-9_-]+\/[a-z0-9_-]+\/latest\/redirect$/;

/** Upstream `MB` (`P_`): the desktop download redirect, which a link may open. */
export function isDesktopDownload(path: string): boolean
{
	const folded = path
		// eslint-disable-next-line no-control-regex -- upstream `aA` drops control characters
		.replace(/[\x00-\x1f\x7f]/g, "")
		.replace(/\\/g, "/")
		.replace(/\/{2,}/g, "/")
		.toLowerCase();
	return !path.includes("%") && DESKTOP_DOWNLOAD.test(folded);
}

/** Upstream `GP`. */
function isNonDownloadApiRoute(path: string): boolean
{
	return isApiRoute(path) && !isDesktopDownload(path);
}

/** Upstream `Rq`: the decoded path when it reads cleanly, else null. */
function cleanPath(path: string): string | null
{
	if (path.includes("//")) return null;
	let decoded: string;
	try
	{
		decoded = decodeURIComponent(path);
	}
	catch
	{
		return null;
	}
	// eslint-disable-next-line no-control-regex -- refusing control characters is the point
	if (/[\x00-\x1F\x7F\\]/.test(decoded)) return null;
	const segments = decoded.split("/");
	if (decoded !== path && segments.length !== path.split("/").length) return null;
	return segments.some((segment) => segment === "." || segment === "..") ? null : decoded;
}

/** Upstream `Tg`. */
function isUnclearPath(path: string): boolean
{
	return isAuthRoute(path) || path.includes(";") || path.includes("%") || cleanPath(path) === null;
}

/** Upstream `Rc`. */
function isConsoleHost(host: string): boolean
{
	return (
		host === "platform.claude.com" ||
		host === "platform.claude.ai" ||
		host === "console.claude.com" ||
		host === "console.claude.ai"
	);
}

function isWeb(url: URL): boolean
{
	return url.protocol === "http:" || url.protocol === "https:";
}

/** Upstream `bM`: a Claude or Anthropic link to a sign-in route, or one that forwards there. */
function isFirstPartyAuthLink(url: URL): boolean
{
	if (!isWeb(url)) return false;
	const host = trimHost(url.hostname);
	const bare = withoutWww(host);
	const claude = isClaudeFamilyHost(host) || isClaudeFamilyHost(bare);
	const anthropic =
		!claude &&
		(ANTHROPIC_CONSOLE_HOSTS.has(host) ||
			ANTHROPIC_CONSOLE_HOSTS.has(bare) ||
			host === "anthropic.com" ||
			host.endsWith(".anthropic.com") ||
			bare.endsWith(".anthropic.com"));
	if (!claude && !anthropic) return false;
	if (anthropic)
	{
		return (
			pathMatches(url.pathname, (path) => underRoute(path, AUTH_ROUTES) && !isLoginRoute(path)) ||
			forwardsToAuthRoute(url, STRICT_DESTINATION_RULE)
		);
	}
	const strict = isConsoleHost(host) || isConsoleHost(bare) || PORTAL_HOSTS.has(host) || PORTAL_HOSTS.has(bare);
	return isAuthRoute(url.pathname) || forwardsToAuthRoute(url, strict ? STRICT_DESTINATION_RULE : DESTINATION_RULE);
}

/** Upstream `Wt`. */
function isCredentialLink(url: URL): boolean
{
	if (isFirstPartyAuthLink(url)) return true;
	if (!isWeb(url)) return false;
	const host = trimHost(url.hostname);
	return (
		(isClaudeFamilyHost(host) || isClaudeFamilyHost(withoutWww(host))) &&
		isApiRoute(`${url.pathname}${url.search}`) &&
		!isDesktopDownload(url.pathname)
	);
}

/**
 * Upstream `sk`: a link the external-link confirm must not open — a credential link, or one to a held host
 * (`D6`) that forwards to sign-in or reaches a route the host keeps. Not ported: upstream's `nw` route table
 * (claude.ai's own share, certification and invite pages behind a hash or token), which this app never links to.
 */
export function isHeldHostLink(url: URL, pageHostname: string | null): boolean
{
	if (isCredentialLink(url)) return true;
	const strictness = hostStrictness(url.hostname, pageHostname);
	if (strictness === null) return false;
	if (forwardsDestinationToAuth(url)) return true;
	return strictness === "strict"
		? isUnclearPath(url.pathname) || isNonDownloadApiRoute(url.pathname)
		: isAuthRoute(url.pathname);
}

/** Upstream `cx` and `SO`. */
const CONSOLE_HOSTS = new Set(["console.anthropic.com", "platform.anthropic.com", "console-staging.anthropic.com"]);
const SHORTCUT_HOSTS = new Set(["claude.new", "claude.design"]);

/** Upstream `bS`. */
function isAppHost(host: string): boolean
{
	const bare = withoutWww(host);
	return isClaudeFamilyHost(host) || isClaudeFamilyHost(bare) || CONSOLE_HOSTS.has(bare) || SHORTCUT_HOSTS.has(bare);
}

/** Upstream `Ep`. */
function isAppOrApiHost(hostname: string): boolean
{
	const host = trimHost(hostname);
	return (
		host.length <= 253 &&
		(host === "claude.ai" ||
			host.endsWith(".claude.ai") ||
			(host.startsWith("api.") && isClaudeFamilyHost(host.slice(4))) ||
			isAppHost(host))
	);
}

/** Upstream `nV`: the page's own origin, or a host `matches` accepts (exact hosts only beside a loopback page). */
function sameSiteOr(url: URL, page: URL, matches: (host: string, pageHost: string) => boolean): boolean
{
	if (url.protocol === page.protocol && url.host.toLowerCase() === page.host.toLowerCase()) return true;
	if (!isWeb(url)) return false;
	const host = trimHost(url.hostname);
	if (host.length > 253) return false;
	const pageHost = trimHost(page.hostname);
	return isLoopbackHost(pageHost)
		? url.host.toLowerCase() === page.host.toLowerCase() || matches(host, pageHost)
		: host === pageHost || matches(host, pageHost);
}

/** Upstream `ja`: this page's site or a Claude app host. */
export function isOwnAppLink(url: URL, page: URL): boolean
{
	return sameSiteOr(url, page, (host) => isAppHost(host));
}

/** Upstream `Mv`: as `ja`, plus the API hosts. */
export function isOwnAppOrApiLink(url: URL, page: URL): boolean
{
	return sameSiteOr(url, page, (host, pageHost) => host === `api.${pageHost}` || isAppOrApiHost(host));
}
