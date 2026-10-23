/**
 * The CLI sometimes rewrites a registry file in place without truncating it, so a shorter
 * document leaves the old one's last bytes behind (e.g. a stray `}`). That stale tail is not
 * schema drift, so parse the complete leading document and let the caller's schema judge it.
 * A torn document with no complete leading value still throws.
 */
export function parseIgnoringStaleTail(text: string): unknown {
	try {
		return JSON.parse(text);
	} catch (error) {
		const end =
			error instanceof SyntaxError
				? /Unexpected non-whitespace character after JSON at position (\d+)/.exec(error.message)?.[1]
				: undefined;
		if (end === undefined) {
			throw error;
		}
		return JSON.parse(text.slice(0, Number(end)));
	}
}
