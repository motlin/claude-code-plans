const HTTP_URL = /^https?:\/\//i;

/** Upstream `Ic`: a PR url the browser can open, or undefined. */
export function openablePrUrl(url: string | undefined): string | undefined
{
	return url !== undefined && HTTP_URL.test(url) ? url : undefined;
}

/** Upstream `nm`: the forge named in "Open on {host}", "GitHub" for github.com or a URL that does not parse. */
export function prHostLabel(url: string): string
{
	try
	{
		const {hostname} = new URL(url);
		return hostname === "github.com" ? "GitHub" : hostname;
	}
	catch
	{
		return "GitHub";
	}
}
