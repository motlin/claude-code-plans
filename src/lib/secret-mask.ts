// Port of upstream claude.ai/code's secret detector and masker (shared-m-0,
// crawl-inset 2026-11-03, dumped verbatim in
// .llm/upstream-sync/dumps/secret-pattern-masking-bundle-shared-m-0.js.txt).
// The control flow mirrors the bundle one-to-one so behaviour stays identical;
// upstream minified names are given in comments for cross-reference.

export interface SecretMatch
{
	start: number;
	end: number;
	value: string;
	patternId: string;
	keep?: number;
}

interface RawMatch
{
	start: number;
	end: number;
	patternId: string;
	added: boolean;
	inner?: number;
}

interface Found
{
	index: number;
	value: string;
	added?: boolean;
}

/** cK */
function lazy<T>(make: () => T): () => T
{
	let cache:
		|
		  {
				value: T;
		  }
		| undefined;
	return () =>
		(cache ??=
		{
			value: make(),
		}).value;
}

export const MASK_CHAR = "•";

/** KG (shared-l-p-m-w-0): control, format, ignorable and noncharacter code points. */
export const INVISIBLE_BASE = new RegExp(
	String.raw`[\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}\p{Default_Ignorable_Code_Point}\u2800\uFFFC\u{1D159}\u{13441}\u{13442}\u{16910}\u{16FE4}\uFDD0-\uFDEF\uFFFE\uFFFF\u{1FFFE}\u{1FFFF}\u{2FFFE}\u{2FFFF}\u{3FFFE}\u{3FFFF}\u{4FFFE}\u{4FFFF}\u{5FFFE}\u{5FFFF}\u{6FFFE}\u{6FFFF}\u{7FFFE}\u{7FFFF}\u{8FFFE}\u{8FFFF}\u{9FFFE}\u{9FFFF}\u{AFFFE}\u{AFFFF}\u{BFFFE}\u{BFFFF}\u{CFFFE}\u{CFFFF}\u{DFFFE}\u{DFFFF}\u{EFFFE}\u{EFFFF}\u{FFFFE}\u{FFFFF}\u{10FFFE}\u{10FFFF}]`,
	"u",
);
/** r6 */
const BOUNDARY = "(?<![A-Za-z0-9_-])";
/** Dm */
const ESCAPE_PREFIXES = [
	String.raw`\\[bfnrt]`,
	String.raw`\\x[0-9A-Fa-f]{2}`,
	String.raw`\\u[0-9A-Fa-f]{4}`,
	"%[0-9A-Fa-f]{2}",
	"%25[0-9A-Fa-f]{2}",
];
/** xX */
const WIDE_SPACES = "\\u00A0\\u1680\\u2000-\\u200A\\u202F\\u205F\\u3000";
/** OR */
const ANY_SPACE = `\\t\\v\\f\\r\\n\\u2028\\u2029 ${WIDE_SPACES}`;
/** M3 */
const SPACES = `[${ANY_SPACE}]*`;
/** OY */
const DASHES = "-{4,5}";
/** iA */
const INLINE_SPACES = `[ \\t${WIDE_SPACES}]*`;
/** ii */
const PRIVATE_KEY_TAIL = new RegExp(`PRIVATE${SPACES}KEY(?:${SPACES}BLOCK)?${INLINE_SPACES}${DASHES}`);
/** dA */
export const PEM_BEGIN = new RegExp(`${DASHES}${INLINE_SPACES}BEGIN[A-Z0-9${ANY_SPACE}]*${PRIVATE_KEY_TAIL.source}`);
/** Tp */
const PEM_END = new RegExp(`${DASHES}${INLINE_SPACES}END[A-Z0-9${ANY_SPACE}]*${PRIVATE_KEY_TAIL.source}`);
/** mL */
const NOT_BEFORE_BEGIN = "(?![A-Za-z0-9_-]*----BEGIN)";
/** wL */
const JWT = `eyJ[A-Za-z0-9_-]{10,}\\.(?:${NOT_BEFORE_BEGIN}[A-Za-z0-9_-]*\\.(?!-?eyJ)${NOT_BEFORE_BEGIN}[A-Za-z0-9_-]{10,}\\.(?!-?eyJ)${NOT_BEFORE_BEGIN}[A-Za-z0-9_-]{10,}\\.(?!-?eyJ)(?:[A-Za-z0-9_]|-(?!---)){10,64}(?:(?![A-Za-z0-9_-]*----)[A-Za-z0-9_-]*)?|eyJ[A-Za-z0-9_-]{10,}\\.[A-Za-z0-9_-]{10,})`;

export interface SecretPattern
{
	id: string;
	inWord?: boolean;
	regex: RegExp;
	trigger: string;
}

/** _O */
export const SECRET_PATTERNS: readonly SecretPattern[] = [
	{
		id: "anthropic",
		inWord: true,
		regex: new RegExp(`${BOUNDARY}sk-ant-[A-Za-z0-9_-]{20,}`),
		trigger: "sk-ant-",
	},
	{
		id: "openai_proj",
		inWord: true,
		regex: new RegExp(`${BOUNDARY}sk-(?:proj|svcacct|admin|None)-[A-Za-z0-9_-]{20,}`),
		trigger: "sk-(?:proj|svcacct|admin|None)-",
	},
	{
		id: "openai",
		regex: new RegExp(`${BOUNDARY}sk-[A-Za-z0-9]{20,}`),
		trigger: "sk-[A-Za-z0-9]{20}",
	},
	{
		id: "github",
		inWord: true,
		regex: new RegExp(`${BOUNDARY}(?:(?:gh[opsu]_|github_pat_)[A-Za-z0-9_]{20,}|ghr_[A-Za-z0-9]{20,})`),
		trigger: "gh[oprsu]_|github_pat_",
	},
	{
		id: "aws",
		inWord: true,
		regex: new RegExp(`${BOUNDARY}AKIA[A-Z0-9]{16}`),
		trigger: "AKIA",
	},
	{
		id: "slack",
		inWord: true,
		regex: new RegExp(
			`${BOUNDARY}(?:xox[abceprs]-[A-Za-z0-9-]{10,}|xapp-[0-9]-[A-Z0-9]{1,20}-[0-9]{1,20}-[A-Za-z0-9]{10,})`,
		),
		trigger: "xox[abceprs]-|xapp-[0-9]-",
	},
	{
		id: "google",
		inWord: true,
		regex: new RegExp(`${BOUNDARY}AIza[A-Za-z0-9_-]{35}`),
		trigger: "AIza",
	},
	{
		id: "stripe",
		inWord: true,
		regex: new RegExp(`${BOUNDARY}(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{20,}`),
		trigger: "[sr]k_(?:live|test)_[A-Za-z0-9]{20}",
	},
	{
		id: "stripe_webhook",
		inWord: true,
		regex: new RegExp(`${BOUNDARY}whsec_[A-Za-z0-9]{20,}`),
		trigger: "whsec_[A-Za-z0-9]{20}",
	},
	{
		id: "age",
		inWord: true,
		regex: new RegExp(`${BOUNDARY}AGE-SECRET-KEY-1[02-9AC-HJ-NP-Z]{58}`),
		trigger: "AGE-SECRET-KEY-1",
	},
	{
		id: "gitlab",
		inWord: true,
		regex: new RegExp(`${BOUNDARY}gl(?:pat|dt)-[A-Za-z0-9_-]{20,}`),
		trigger: "gl(?:pat|dt)-",
	},
	{
		id: "jwt",
		regex: new RegExp(`${BOUNDARY}${JWT}`),
		trigger: "\\.eyJ|(?:^|[^A-Za-z0-9_-])-?eyJ[A-Za-z0-9_-]{10,}\\.",
	},
	{
		id: "private_key",
		regex: new RegExp(
			`${PEM_BEGIN.source}[A-Za-z0-9+/=$\\\\\\r\\n\\u2028\\u2029${WIDE_SPACES}]{0,5000}?${PEM_END.source}`,
		),
		trigger: PRIVATE_KEY_TAIL.source,
	},
];

/** cb557955f `g`: the cloak's label per pattern id. gitlab falls back to unknown. */
export const SECRET_LABELS: Readonly<Record<string, string>> =
{
	anthropic: "Anthropic API key",
	openai_proj: "OpenAI API key",
	openai: "OpenAI API key",
	github: "GitHub token",
	aws: "AWS access key",
	slack: "Slack token",
	google: "Google API key",
	stripe: "Stripe API key",
	stripe_webhook: "Stripe webhook secret",
	age: "age secret key",
	jwt: "JWT",
	private_key: "private key",
	unknown: "secret",
};

/** Upstream `MT4Yqa` / `UO1fKe`: the block toggle's label. */
export function secretToggleLabel(count: number, revealed: boolean): string
{
	return `${revealed ? "Hide" : "Reveal"} ${count} ${count === 1 ? "secret" : "secrets"}`;
}

export function secretLabel(patternId: string): string
{
	return SECRET_LABELS[patternId] ?? "secret";
}

const BOUNDARY_LENGTH = BOUNDARY.length; // 18
/** M9 */
const ALL_PATTERNS = SECRET_PATTERNS.map((p) => `(?:${p.regex.source})`).join("|");
/** gp */
const UNBOUNDED_PATTERNS = SECRET_PATTERNS.filter(({regex}) => regex.source.startsWith(BOUNDARY)).map(
	({regex}) => `(?:${regex.source.slice(BOUNDARY_LENGTH)})`,
);
/** q9 */
const AFTER_DASH = `(?<=${BOUNDARY}-)(?:${UNBOUNDED_PATTERNS.join("|")})`;
/** h5 */
const JWT_AFTER_DOT = `(?<=\\.)(?=(${JWT}))`;
/** j4 */
const DASH_RUN_OR_PRIVATE = /(?<!-)-{4,}(?=BEGIN|END|$)|PRIVATE/;
/** dh */
const GLUED = `(?<![^0-9_-]${ESCAPE_PREFIXES.map((e) => `(?<!${e})`).join("")})(?:${SECRET_PATTERNS.filter(
	(p) => p.inWord === true && p.regex.source.startsWith(BOUNDARY),
)
	.map((p) => p.regex.source.slice(BOUNDARY_LENGTH))
	.join("|")})|(?:${ESCAPE_PREFIXES.join("|")})(?<jwt>${JWT})`;
/** db */
const TRIGGERS = new RegExp(SECRET_PATTERNS.map((p) => `(?:${p.trigger})`).join("|"));
/** uL */
const ESCAPED_JWT = lazy(() => new RegExp(`(?:${ESCAPE_PREFIXES.join("|")})eyJ[A-Za-z0-9_-]{10,}\\.`));
/** ju */
const mayContainSecret = (text: string): boolean =>
	TRIGGERS.test(text) || (text.includes("eyJ") && ESCAPED_JWT().test(text));

/** LB */
function allPatternsGlobal(): RegExp
{
	return new RegExp(ALL_PATTERNS, "g");
}

/** xc */
function* scan(text: string, atEnd: boolean, atStart: boolean): Generator<Found>
{
	for (const m of text.matchAll(allPatternsGlobal()))
		yield {
			index: m.index,
			value: m[0],
		};
	for (const m of text.matchAll(new RegExp(AFTER_DASH, "g")))
	{
		const cut = m[0].search(/(?<!-)-{4,}(?=BEGIN|END|$)/);
		yield {
			index: m.index,
			value: cut < 0 ? m[0] : m[0].slice(0, cut),
		};
	}
	let runEnd = -1;
	let keyAt = -1;
	let tailEnd = -1;
	for (const o of text.matchAll(new RegExp(GLUED, "g")))
	{
		const token = o.groups?.["jwt"] ?? o[0];
		const start = o.index + o[0].length - token.length;
		const end = o.index + o[0].length;
		if (end > runEnd)
		{
			runEnd = runThrough(text, end);
			keyAt = -1;
			for (let n = start; n < runEnd; n++)
			{
				const a = text.charCodeAt(n) === 80 ? matchLoose(text, n, "PRIVATE") : -1;
				if (a >= 0 && a <= runEnd && looksLikeKeyTail(text, a, atEnd)) keyAt = n;
			}
		}
		let unsure = false;
		if (!atEnd && runEnd >= text.length)
		{
			if (end > tailEnd) tailEnd = extendToken(text, end);
			unsure = o.index - LOOKBACK_SLACK >= text.length - 8192 || tailEnd >= text.length;
		}
		if (keyAt >= start || unsure) continue;
		const cut = cutBeforeDashRun(text, start, end, prefixIsLong(text, start, atStart));
		yield {
			index: start,
			value: text.slice(start, cut),
			added: true,
		};
	}
	if (text.includes(".eyJ"))
		for (const m of text.matchAll(new RegExp(JWT_AFTER_DOT, "g")))
		{
			const jwt = m[1] ?? "";
			const cp = text.codePointAt(m.index + jwt.length);
			const next = cp === undefined ? "" : String.fromCodePoint(cp);
			const ok = next === "" ? atEnd : !WORDISH.test(next) && !(NON_ASCII.test(next) && isInvisible(next));
			if (ok && !DASH_RUN_OR_PRIVATE.test(jwt))
				yield {
					index: m.index,
					value: jwt,
				};
		}
}

/** Z$ */
function patternFor(value: string): SecretPattern | undefined
{
	return SECRET_PATTERNS.find((p) => p.regex.test(value));
}

/** hX */
const MAX_SCAN = 262144;
/** EN */
const INVISIBLE = lazy(() => new RegExp(String.raw`(?![\t\n\r])${INVISIBLE_BASE.source}|[\p{M}\p{Co}\p{Cn}]`, "u"));
/** y6 */
function isInvisible(ch: string): boolean
{
	return INVISIBLE().test(ch);
}
/** zT */
const INVISIBLE_RUNS = lazy(() => new RegExp(`(?:${INVISIBLE().source})+`, "gu"));
/** _o */
const NON_ASCII = /[^\t\n\r\x20-\x7E]/;
/** eF */
const BEYOND_LATIN1 = new RegExp(String.raw`[\u0100-\uffff]`);
const INVISIBLE_FLAG = 1;
/** HN */
const BLOCK_TABLES: (Uint8Array | undefined)[] = Array.from(
	{
		length: 4352,
	},
	() => undefined,
);
/** z6 */
const MAX_TABLE_BUILDS = 8;

/** t5 */
function blockTable(block: number): Uint8Array
{
	let table = BLOCK_TABLES[block];
	if (table === undefined)
	{
		table = new Uint8Array(256);
		const cps: number[] = [];
		for (let i = 0; i < 256; i++) cps.push((block << 8) | i);
		const width = block > 255 ? 2 : 1;
		const {source, flags} = INVISIBLE();
		const re = new RegExp(source, flags.includes("g") ? flags : `g${flags}`);
		for (const m of String.fromCodePoint(...cps).matchAll(re)) table[m.index >> (width - 1)] = INVISIBLE_FLAG;
		BLOCK_TABLES[block] = table;
	}
	return table;
}

/** Tw */
function hasInvisible(text: string): boolean
{
	const first = NON_ASCII.exec(text);
	if (first === null) return false;
	if (!BEYOND_LATIN1.test(text)) return INVISIBLE().test(text);
	let builds = 0;
	for (let r = first.index; r < text.length; r++)
	{
		const cp = text.codePointAt(r) ?? 0;
		let table = BLOCK_TABLES[cp >> 8];
		if (table === undefined)
		{
			if (builds === MAX_TABLE_BUILDS) return INVISIBLE().test(text.slice(r));
			builds += 1;
			table = blockTable(cp >> 8);
		}
		if (table[cp & 255] === INVISIBLE_FLAG) return true;
		if (cp > 65535) r++;
	}
	return false;
}

/** c1 */
const STARTS_WITH_SECRET = new RegExp(`^(?:${UNBOUNDED_PATTERNS.concat(PEM_BEGIN.source).join("|")})`);
/** Eq */
const EDGE_PROBE = 512;
/** Be */
const JWT_HEAD = /^eyJ[A-Za-z0-9_-]{10,}(?:\.[A-Za-z0-9_-]*){0,2}$/;
/** iT */
const WORDISH = /[A-Za-z0-9_-]/;
/** PF (sticky) */
const TOKEN_TAIL = /(?:[A-Za-z0-9_]|(?<=[A-Za-z0-9_])-(?=[A-Za-z0-9_]))*/y;
/** Ej */
const ANY_SPACE_CHAR = new RegExp(`[${ANY_SPACE}]`);

/** U0 */
function runThrough(text: string, from: number): number
{
	let lowerOk = true;
	let r = from;
	while (r < text.length)
	{
		const c = text.codePointAt(r) ?? 0;
		if (
			(c >= 65 && c <= 90) ||
			(c >= 48 && c <= 57) ||
			(lowerOk && ((c >= 97 && c <= 122) || c === 95 || c === 45))
		)
		{
			r += 1;
			continue;
		}
		const ch = String.fromCodePoint(c);
		const invisible = isInvisible(ch);
		if (!invisible && !ANY_SPACE_CHAR.test(ch)) break;
		lowerOk &&= invisible;
		r += ch.length;
	}
	return r;
}

/** zI: match `word` at `from`, skipping invisible non-ASCII chars between letters. */
function matchLoose(text: string, from: number, word: string): number
{
	let r = from;
	for (let k = 0; k < word.length; k++)
	{
		while (k > 0 && r < text.length)
		{
			const ch = String.fromCodePoint(text.codePointAt(r) ?? 0);
			if (!NON_ASCII.test(ch) || !isInvisible(ch)) break;
			r += ch.length;
		}
		if (text[r] !== word[k]) return -1;
		r += 1;
	}
	return r;
}

/** Sm */
const KEY_TAIL_FULL = new RegExp(`^[${ANY_SPACE}]*KEY(?:[${ANY_SPACE}]*BLOCK)?${INLINE_SPACES}-{4}`);
/** ok */
const KEY_TAIL_PARTIAL = new RegExp(
	`^[${ANY_SPACE}]*(?:K|KE|KEY[${ANY_SPACE}]*(?:B|BL|BLO|BLOC|BLOCK)?${INLINE_SPACES}-{0,3})?$`,
);
/** cX */
const KEY_TAIL_PROBE = 64;
/** wO */
const LOOKBACK_SLACK = 6;

/** ng */
function extendToken(text: string, from: number): number
{
	TOKEN_TAIL.lastIndex = from;
	TOKEN_TAIL.exec(text);
	return TOKEN_TAIL.lastIndex;
}

/** Gf */
function looksLikeKeyTail(text: string, at: number, atEnd: boolean): boolean
{
	const probe = text.slice(at, at + KEY_TAIL_PROBE).replace(INVISIBLE_RUNS(), "");
	return KEY_TAIL_FULL.test(probe) || ((!atEnd || at + KEY_TAIL_PROBE < text.length) && KEY_TAIL_PARTIAL.test(probe));
}

/** lR */
const LONG_PREFIX = 15;

/** Y2 */
function prefixIsLong(text: string, start: number, atStart: boolean): boolean
{
	let r = start;
	while (r > 0 && start - r < LONG_PREFIX)
	{
		const prev = text[r - 1] ?? "";
		if (
			(text.charCodeAt(r - 1) !== 45 || text[r - 2] === "-" || text[r] === "-") &&
			!/[A-Za-z0-9_]/.test(prev) &&
			!NON_ASCII.test(prev)
		)
			return false;
		--r;
	}
	return start - r >= LONG_PREFIX || !atStart;
}

/** QL */
function cutBeforeDashRun(text: string, start: number, end: number, force = false): number
{
	for (let i = start; i < end; i++)
	{
		if (text[i] !== "-") continue;
		let dashes = 0;
		let k = i;
		while (k < text.length)
		{
			const cp = text.codePointAt(k) ?? 0;
			if (text[k] === "-") dashes++;
			else if (!isInvisible(String.fromCodePoint(cp))) break;
			k += cp > 65535 ? 2 : 1;
		}
		if (
			dashes >= 4 &&
			(force ||
				!WORDISH.test(text[k] ?? "") ||
				matchLoose(text, k, "BEGIN") >= 0 ||
				matchLoose(text, k, "END") >= 0)
		)
			return i;
		i = k - 1;
	}
	return end;
}

/** Ka */
const EDGE_MARK = "\0";

interface Shadow
{
	shadow: string;
	edges: number;
	toRaw: (index: number) => number;
}

/** jK: remove invisible runs, mapping shadow offsets back to raw ones. */
function shadowOf(text: string, previous?: string): Shadow
{
	let removed = 0;
	const gaps: number[] = [];
	const shifts: number[] = [];
	let shift = 0;
	let edges = 0;
	const shadow = text.replace(INVISIBLE_RUNS(), (run: string, at: number) =>
	{
		const l = at - removed;
		removed += run.length;
		const probe =
			previous !== undefined && at > 0 && WORDISH.test(text[at - 1] ?? "")
				? previous.slice(l, l + EDGE_PROBE)
				: undefined;
		const mark =
			probe !== undefined &&
			(STARTS_WITH_SECRET.test(probe) || (probe.length === EDGE_PROBE && JWT_HEAD.test(probe)))
				? EDGE_MARK
				: "";
		edges += mark.length;
		gaps.push(at - shift + mark.length);
		shift += run.length - mark.length;
		shifts.push(shift);
		return mark;
	});
	return {
		shadow,
		edges,
		toRaw: (index) =>
		{
			let lo = 0;
			let hi = gaps.length;
			while (lo < hi)
			{
				const mid = (lo + hi) >>> 1;
				if ((gaps[mid] ?? 0) <= index) lo = mid + 1;
				else hi = mid;
			}
			return lo === 0 ? index : index + (shifts[lo - 1] ?? 0);
		},
	};
}

/** s0: every secret in `text`. */
export function findSecrets(text: string): SecretMatch[]
{
	return findAll(text, true).map(({added: _added, ...rest}) => rest);
}

/** tz */
function findAll(
	text: string,
	atEnd: boolean,
	atStart = true,
): (SecretMatch &
{
	added: boolean;
})[]
{
	if (text.length > MAX_SCAN) return [];
	const found: RawMatch[] = [];
	const push = (start: number, end: number, value: string, added = false) =>
	{
		found.push(
			{
				start,
				end,
				patternId: patternFor(value)?.id ?? "unknown",
				added,
			},
		);
	};
	if (mayContainSecret(text))
		for (const m of scan(text, atEnd, atStart)) push(m.index, m.index + m.value.length, m.value, m.added);
	if (hasInvisible(text))
	{
		const pass = (previous?: string): string =>
		{
			const {shadow, edges, toRaw} = shadowOf(text, previous);
			if ((previous === undefined || edges !== 0) && mayContainSecret(shadow))
				for (const m of scan(shadow, atEnd, atStart))
					push(toRaw(m.index), toRaw(m.index + m.value.length - 1) + 1, m.value, m.added);
			return shadow;
		};
		pass(pass());
	}
	found.sort((a, b) => a.start - b.start);
	const merged: RawMatch[] = [];
	const noteInner = (m: RawMatch, at: number) =>
	{
		if (m.added && at > m.start) m.inner = Math.min(m.inner ?? at, at);
	};
	for (const m of found)
	{
		const last = merged[merged.length - 1];
		if (last !== undefined && m.start < last.end)
		{
			noteInner(last, m.start);
			last.end = Math.max(last.end, m.end);
		}
		else
			merged.push(
				{
					...m,
				},
			);
	}
	const out: RawMatch[] = [];
	let reach = 0;
	for (const m of merged)
	{
		const prev = out[out.length - 1];
		let cur: RawMatch;
		if (prev !== undefined && m.start < reach)
		{
			noteInner(prev, m.start);
			prev.end = m.end;
			cur = prev;
		}
		else
		{
			if (prev !== undefined) prev.end = Math.max(prev.end, reach);
			out.push(m);
			cur = m;
		}
		if (cur.patternId === "private_key") reach = cur.end;
		else if (cur.end >= reach)
		{
			TOKEN_TAIL.lastIndex = cur.end;
			reach = cur.end + (TOKEN_TAIL.exec(text)?.[0].length ?? 0);
		}
	}
	const last = out[out.length - 1];
	if (last !== undefined) last.end = Math.max(last.end, reach);
	return out.map(({start, end, patternId, added, inner}) => (
	{
		start,
		end,
		value: text.slice(start, end),
		patternId,
		added,
		...(inner === undefined
			? {}
			:
				{
					keep: inner - start,
				}),
	}));
}

/** gh */
const VISIBLE_PREFIX = 8;
/** 12 */
const SHORT_MAX = 12;
/** N4 */
const PEM_BEGIN_PREFIX = "-----BEGIN";
/** ah */
const PEM_END_PREFIX = "-----END";
/** bY */
const PEM_TRAILER = /^[^-]*(?:-[^A-Za-z0-9]*)?$/;

/** TR: index just past the PEM header's closing dash run. */
function pemHeaderEnd(value: string): number
{
	const invisible = INVISIBLE();
	let dashes = 0;
	for (let r = 10; r < value.length;)
	{
		const ch = String.fromCodePoint(value.codePointAt(r) ?? 0);
		if (ch === "-")
		{
			dashes += 1;
			if (dashes === 5) return r + 1;
		}
		else if (!invisible.test(ch))
		{
			if (dashes === 4) return r;
			dashes = 0;
		}
		r += ch.length;
	}
	return -1;
}

/** L9: one bullet per char, newlines kept. */
function bulletLines(text: string): string
{
	return text.includes("\n")
		? text
				.split("\n")
				.map((line) => MASK_CHAR.repeat(line.length))
				.join("\n")
		: MASK_CHAR.repeat(text.length);
}

/** sE: mask one matched value. */
export function maskSecretValue(value: string, keep = Infinity): string
{
	const limit = Math.max(0, keep);
	if (value.startsWith(PEM_BEGIN_PREFIX))
	{
		const endAt = value.lastIndexOf(PEM_END_PREFIX);
		const bodyEnd = endAt >= 0 && PEM_TRAILER.test(value.slice(endAt + 8)) ? endAt : value.length;
		const headerEnd = pemHeaderEnd(value);
		const bodyStart = headerEnd >= 0 && headerEnd <= bodyEnd ? headerEnd : 10;
		return (
			maskSecrets(value.slice(0, bodyStart)) +
			bulletLines(value.slice(bodyStart, bodyEnd)) +
			maskSecrets(value.slice(bodyEnd))
		);
	}
	if (!INVISIBLE().test(value))
	{
		if (value.length <= SHORT_MAX) return bulletLines(value);
		const kept = Math.min(VISIBLE_PREFIX, limit);
		return value.slice(0, kept) + bulletLines(value.slice(kept));
	}
	const invisible = INVISIBLE();
	let visible = 0;
	let prefixEnd = 0;
	let keepEnd = 0;
	for (let p = 0; p < value.length;)
	{
		const ch = String.fromCodePoint(value.codePointAt(p) ?? 0);
		p += ch.length;
		if (!invisible.test(ch))
		{
			visible += 1;
			if (visible === VISIBLE_PREFIX) prefixEnd = p;
		}
		if (p <= limit) keepEnd = p;
	}
	if (visible <= SHORT_MAX) return bulletLines(value);
	const kept = Math.min(prefixEnd, keepEnd);
	return value.slice(0, kept) + bulletLines(value.slice(kept));
}

/** $2: mask secrets in a URL but keep its host legible. */
export function maskUrlSecrets(url: string): string
{
	const matches = findSecrets(url);
	if (matches.length === 0) return url;
	let hostStart = -1;
	let hostEnd = -1;
	try
	{
		const parsed = new URL(url);
		const host = parsed.host;
		if (host.length > 0)
		{
			let a = url.indexOf(":") + 1;
			while (a < url.length && (url[a] === "/" || url[a] === "\\")) a++;
			let o = url.length;
			for (let t = a; t < url.length; t++)
			{
				const ch = url[t];
				if (ch === "/" || ch === "?" || ch === "#" || ch === "\\")
				{
					o = t;
					break;
				}
			}
			const at = url.lastIndexOf("@", o - 1);
			hostStart = at >= a ? at + 1 : a;
			hostEnd = o;
			try
			{
				if (new URL(`${parsed.protocol}//${url.slice(hostStart, hostEnd)}`).host !== host)
				{
					hostStart = -1;
					hostEnd = -1;
				}
			}
			catch
			{
				hostStart = -1;
				hostEnd = -1;
			}
		}
	}
	catch
	{
		// not a URL: mask everything
	}
	let out = "";
	let pos = 0;
	for (const m of matches)
	{
		if (hostStart !== -1 && m.start < hostEnd && m.end > hostStart)
		{
			const before = url.slice(m.start, Math.min(m.end, hostStart));
			const after = url.slice(Math.max(m.start, hostEnd), m.end);
			out += url.slice(pos, m.start);
			out += before.length > 0 ? maskSecretValue(before, m.keep) : "";
			out += url.slice(Math.max(m.start, hostStart), Math.min(m.end, hostEnd));
			out +=
				after.length > 0
					? maskSecretValue(after, (m.keep ?? Infinity) - (Math.max(m.start, hostEnd) - m.start))
					: "";
			pos = m.end;
			continue;
		}
		out += url.slice(pos, m.start) + maskSecretValue(m.value, m.keep);
		pos = m.end;
	}
	return out + url.slice(pos);
}

type ValueMasker = (value: string, keep?: number) => string;

/** eD */
function replaceMatches(text: string, matches: readonly SecretMatch[], mask: ValueMasker): string
{
	if (matches.length === 0) return text;
	let out = "";
	let pos = 0;
	for (const m of matches)
	{
		out += text.slice(pos, m.start) + mask(m.value, m.keep);
		pos = m.end;
	}
	return out + text.slice(pos);
}

/** zm */
const WINDOW_OVERLAP = 8192;
/** 253952 */
const WINDOW_STEP = MAX_SCAN - WINDOW_OVERLAP;

/** vk: mask every match, scanning long text in overlapping windows. */
function maskAll(text: string, mask: ValueMasker): string
{
	if (text.length <= MAX_SCAN) return replaceMatches(text, findSecrets(text), mask);
	const found: (SecretMatch &
	{
		added: boolean;
	})[] = [];
	for (let o = 0; o < text.length; o += WINDOW_STEP)
		for (const m of findAll(text.slice(o, o + MAX_SCAN), o + MAX_SCAN >= text.length, o === 0))
			found.push(
				{
					patternId: m.patternId,
					value: m.value,
					start: o + m.start,
					end: o + m.end,
					added: m.added,
					...(m.keep === undefined
						? {}
						:
							{
								keep: m.keep,
							}),
				},
			);
	found.sort((a, b) => a.start - b.start || Number(a.added) - Number(b.added) || a.end - b.end);
	const merged: (SecretMatch &
	{
		added: boolean;
	})[] = [];
	for (const m of found)
	{
		const last = merged[merged.length - 1];
		const gluedToKey = m.added && m.start === last?.end && last.patternId === "private_key";
		if (last !== undefined && m.start <= last.end && !gluedToKey)
		{
			if (m.end > last.end)
			{
				last.end = m.end;
				last.value = text.slice(last.start, last.end);
			}
		}
		else
			merged.push(
				{
					...m,
				},
			);
	}
	return replaceMatches(text, merged, mask);
}

/** XF: bullet every secret in place. */
export function maskSecrets(text: string): string
{
	return maskAll(text, maskSecretValue);
}

/** J7 */
const SEVEN_BULLETS = MASK_CHAR.repeat(7);
/** na */
const BULLET_RUN = new RegExp(`(?<!\\n)\\n*${MASK_CHAR}[${MASK_CHAR}\\n]*`, "g");

/** Ed */
function maskCompactValue(value: string, keep?: number): string
{
	return maskSecretValue(value, keep).replace(BULLET_RUN, SEVEN_BULLETS);
}

/** I6: like maskSecrets, but each masked run collapses to 7 bullets. */
export function maskSecretsCompact(text: string): string
{
	return maskAll(text, maskCompactValue);
}

/** AK: mask, then cap at MAX_SCAN chars plus an ellipsis. */
export function maskAndCap(text: string): string
{
	const masked = maskSecrets(text);
	return masked.length > MAX_SCAN ? `${masked.slice(0, MAX_SCAN)}…` : masked;
}

/** GF */
const TOKEN_CHAR = /[A-Za-z0-9_.+/=-]/;

/** jR: mask then truncate to `length`; a token cut at the edge keeps at most 8 visible chars. */
export function maskedPrefix(text: string, length: number, more = false): string
{
	const head = text.slice(0, length + WINDOW_OVERLAP);
	const masked = maskSecrets(head);
	const cut = masked.slice(0, length);
	if (!more && text.length <= head.length) return cut;
	let o = head.length;
	while (o > 0)
	{
		const c = head.charCodeAt(o - 1);
		const p = o > 1 ? head.charCodeAt(o - 2) : 0;
		const pair = c >= 56320 && c <= 57343 && p >= 55296 && p <= 56319;
		const ch = head.slice(o - (pair ? 2 : 1), o);
		if (!TOKEN_CHAR.test(ch) && !isInvisible(ch)) break;
		o -= ch.length;
	}
	if (o >= cut.length) return cut;
	const shown = Math.min(cut.length, o + VISIBLE_PREFIX);
	return cut.slice(0, o) + masked.slice(o, shown) + MASK_CHAR.repeat(cut.length - shown);
}

/** W4 */
const NOT_SPACE_OR_BULLET = new RegExp(`[^\\s${MASK_CHAR}]`);
/** hd */
const MASKED_KEY_TAIL = new RegExp(`${MASK_CHAR}-{0,4}[A-Z0-9${ANY_SPACE}]*${PRIVATE_KEY_TAIL.source}`);
/** QF */
const MASKED_PEM_BEGIN = new RegExp(
	`${DASHES}${INLINE_SPACES}BEGIN[A-Z0-9${ANY_SPACE}]*${MASK_CHAR}[A-Z0-9${ANY_SPACE}${MASK_CHAR}]*${DASHES}`,
);

/** _h: cut the text before a private-key header whose body is not masked or not terminated. */
export function cutUnterminatedPrivateKey(text: string): string
{
	if (
		(!PRIVATE_KEY_TAIL.test(text) && !NON_ASCII.test(text)) ||
		(!text.includes("BEGIN") && !text.includes("PRIVATE") && !hasInvisible(text))
	)
		return text;
	const {shadow, toRaw} = shadowOf(text);
	const maskedTail = MASKED_KEY_TAIL.exec(shadow);
	const tailCut = maskedTail === null ? Infinity : toRaw(maskedTail.index) + 1;
	const begin = new RegExp(`${PEM_BEGIN.source}|${MASKED_PEM_BEGIN.source}`, "g");
	const end = new RegExp(PEM_END.source, "g");
	for (let m = begin.exec(shadow); m !== null; m = begin.exec(shadow))
	{
		const bodyStart = m.index + m[0].length;
		end.lastIndex = bodyStart;
		const close = end.exec(shadow);
		begin.lastIndex = bodyStart;
		const next = begin.exec(shadow);
		if (
			close === null ||
			(next !== null && next.index < close.index) ||
			NOT_SPACE_OR_BULLET.test(shadow.slice(bodyStart, close.index))
		)
			return text.slice(0, Math.min(toRaw(m.index), tailCut));
		begin.lastIndex = close.index + close[0].search(/-+$/);
	}
	return maskedTail === null ? text : text.slice(0, tailCut);
}

/** VS: every secret becomes exactly 7 bullets. */
export function maskSecretsFixed(text: string): string
{
	return maskAll(text, () => SEVEN_BULLETS);
}

/** Jd */
const DISPLAY_CONTROLS = lazy(
	() =>
		new RegExp(
			String.raw`(?![\t\n\r])[\p{Cc}\p{Cf}\p{Default_Ignorable_Code_Point}\u034F\u115F\u1160\u3164\uFE00-\uFE0F\uFFA0\u{E0100}-\u{E01EF}]`,
			"gu",
		),
);

/** Strip display controls (upstream `.replace(Jd(), "")`). */
export function stripDisplayControls(text: string): string
{
	return text.replace(DISPLAY_CONTROLS(), "");
}

/** Iv: mask, then strip display controls. */
export function stripControlsAndMask(text: string): string
{
	return stripDisplayControls(maskSecrets(text));
}
