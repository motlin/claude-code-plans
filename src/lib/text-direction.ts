/** Upstream `I8` (shared-33): a strong right-to-left code point. */
function isRtl(c: number): boolean
{
	return (
		(c >= 1425 && c <= 2047) ||
		(c >= 2048 && c <= 2303) ||
		c === 8207 ||
		c === 8235 ||
		c === 8238 ||
		(c >= 64285 && c <= 64829) ||
		(c >= 64848 && c <= 65021) ||
		(c >= 65136 && c <= 65276) ||
		(c >= 67584 && c <= 69631) ||
		(c >= 124928 && c <= 126975)
	);
}

/** Upstream `MV` (shared-33): a strong left-to-right code point. */
function isLtr(c: number): boolean
{
	return (
		(c >= 65 && c <= 90) ||
		(c >= 97 && c <= 122) ||
		(c >= 192 && c <= 696 && c !== 215 && c !== 247) ||
		(c >= 880 && c <= 1417) ||
		(c >= 2304 && c <= 8191) ||
		(c >= 11264 && c <= 11775) ||
		(c >= 12352 && c <= 12735 && c !== 12443 && c !== 12444 && c !== 12448 && c !== 12539) ||
		(c >= 12784 && c <= 12799) ||
		(c >= 13312 && c <= 19903) ||
		(c >= 19968 && c <= 42127) ||
		(c >= 42192 && c <= 55295) ||
		(c >= 57344 && c <= 64284) ||
		(c >= 65313 && c <= 65338) ||
		(c >= 65345 && c <= 65370) ||
		(c >= 65382 && c <= 65500) ||
		c === 8206
	);
}

/** Upstream `Gz` (shared-33): the direction of the first strong code point among the first `limit`. */
export function firstStrongDir(text: string, limit = Infinity): "rtl" | "ltr" | undefined
{
	let seen = 0;
	for (const char of text)
	{
		if (seen++ >= limit) break;
		const code = char.codePointAt(0) ?? 0;
		if (isRtl(code)) return "rtl";
		if (isLtr(code)) return "ltr";
	}
	return undefined;
}
