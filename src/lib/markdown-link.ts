/** Upstream's `or` (cbb72cde9): a `[label](http(s) URL)` link, balanced parens allowed in the URL. */
export const MARKDOWN_LINK = /(?<!\w)\[([^\]\n]+)\]\((https?:\/\/(?:[^\s()]|\([^\s()]*\))+)\)/g;

/** Upstream's `Zo` (cf6507c5a): the bidi controls dropped from a link label. */
export const BIDI_CONTROLS = /[‎‏‪-‮⁦-⁩]/g;

/** Upstream's `rs` (cf6507c5a): a Slack-style `<@U…>` / `<#C…>` token, with an optional `|label`. */
export const SLACK_TOKEN = /<([@#])([UWCG][A-Z0-9]{8,})(?:\|([^>\r\n]+))?>/g;

/** Upstream's `Nt`: a label that is a full http(s) address. */
const FULL_ADDRESS = /^(https?):\/\/([a-zA-Z0-9_.-]+)(:\d+)?(?:[/?#][\x21-\x7E]*)?$/i;
/** Upstream's `Pt`: a label that is a bare host, or a word followed by a port or path. */
const BARE_ADDRESS = /^([a-zA-Z0-9_-]+(?:\.[a-zA-Z0-9_-]+)+|[a-zA-Z0-9_-]+(?=[:/?#]))(:\d+)?(?:[/?#][\x21-\x7E]*)?$/;
const SCHEME = /^(https?):\/\//i;

interface LabelAddress
{
	host: string;
	port: string | null;
}

/** Upstream's `Lt`: the host and port a label claims. */
function labelAddress(label: string): LabelAddress | null
{
	const trimmed = label.trim();
	const full = FULL_ADDRESS.exec(trimmed);
	if (full)
		return {
			host: (full[2] ?? "").toLowerCase(),
			port: full[3]?.slice(1) ?? null,
		};
	const bare = BARE_ADDRESS.exec(trimmed);
	return bare
		?
			{
				host: (bare[1] ?? "").toLowerCase(),
				port: bare[2]?.slice(1) ?? null,
			}
		: null;
}

/** Upstream's `It`: the scheme a label claims, with non-printable characters ignored. */
function labelScheme(label: string): string | null
{
	return SCHEME.exec(label.replace(/[^\x21-\x7E]+/g, ""))?.[1]?.toLowerCase() ?? null;
}

/** Upstream's `PS`: an http(s) URL normalized, or null. */
function safeHref(url: string): string | null
{
	if (url === "") return null;
	let parsed: URL;
	try
	{
		parsed = new URL(url);
	}
	catch
	{
		return null;
	}
	return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.href : null;
}

export type MarkdownLinkTarget =
	|
	  {
			kind: "plain";
	  }
	|
	  {
			kind: "link";
			href: string;
			discloseHost: string | null;
	  };

/**
 * Upstream's `Rt`: where a markdown link goes, and the host to disclose beside its label unless the label
 * already names that host (same scheme, no user info, same port).
 */
export function markdownLinkTarget(label: string, url: string): MarkdownLinkTarget
{
	const href = safeHref(url);
	if (href === null)
		return {
			kind: "plain",
		};
	const parsed = new URL(href);
	const claimed = labelAddress(label);
	const port = parsed.port || (parsed.protocol === "https:" ? "443" : "80");
	const scheme = labelScheme(label);
	const otherScheme = scheme !== null && `${scheme}:` !== parsed.protocol;
	const named =
		parsed.username === "" &&
		parsed.password === "" &&
		!otherScheme &&
		claimed !== null &&
		claimed.host === parsed.hostname &&
		(claimed.port === null || claimed.port === port);
	const host = claimed?.port != null && claimed.port !== port ? `${parsed.hostname}:${port}` : parsed.host;
	return {
		kind: "link",
		href,
		discloseHost: named ? null : otherScheme ? `${parsed.protocol}//${host}` : host,
	};
}
