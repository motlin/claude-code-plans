/** Upstream's emoji data and `:shortcode` search (ca8b34310 `cs`/`ps`/`ms`/`ys`/`Wm`), over the lazy {@link import("./emoji-table")}. */

export interface EmojiItem
{
	name: string;
	char: string;
	keywords: readonly string[];
}

/** Upstream `Um`: the popup's row cap. */
const EMOJI_SUGGESTION_LIMIT = 8;

/** Upstream `cs`: drop U+FE0F so text- and emoji-presentation forms compare equal. */
export function stripVs16(text: string): string
{
	return text.replaceAll("️", "");
}

let names: ReadonlyMap<string, string> | null = null;
let loading: Promise<readonly EmojiItem[]> | null = null;

/** Upstream `ps`: load the table once (again after a failure), as items plus a name→char map. */
export async function loadEmoji(): Promise<readonly EmojiItem[]>
{
	loading ??= import("./emoji-table").then(
		({EMOJI_TABLE}) =>
		{
			const items: EmojiItem[] = [];
			const byName = new Map<string, string>();
			for (const [char, rowNames, keywords] of EMOJI_TABLE)
			{
				const [name, ...aliases] = rowNames;
				items.push(
					{
						name,
						char,
						keywords: [...aliases, ...keywords],
					},
				);
				for (const alias of rowNames) byName.set(alias, char);
			}
			names = byName;
			return items;
		},
		(error: unknown) =>
		{
			loading = null;
			throw error;
		},
	);
	return loading;
}

/** Upstream `ms`: start loading the table without waiting for it. */
export function warmEmoji(): void
{
	loadEmoji().catch(() => undefined);
}

/** Upstream `ys`: GitHub/Slack-style shortcodes, entry for entry (the integer key enumerates first, as upstream's does). */
export const EXTRA_SHORTCODES: Readonly<Record<string, string>> =
{
	"+1": "\uD83D\uDC4D",
	"-1": "\uD83D\uDC4E",
	thumbsup: "\uD83D\uDC4D",
	thumbsdown: "\uD83D\uDC4E",
	heart: "\u2764\uFE0F",
	eyes: "\uD83D\uDC40",
	rocket: "\uD83D\uDE80",
	tada: "\uD83C\uDF89",
	confused: "\uD83D\uDE15",
	laugh: "\uD83D\uDE04",
	hooray: "\uD83C\uDF89",
	otter: "\uD83E\uDDA6",
	ok_hand: "\uD83D\uDC4C",
	heavy_check_mark: "\u2714\uFE0F",
	heavy_plus_sign: "\u2795",
	shipit: "\uD83D\uDEA2",
	ship: "\uD83D\uDEA2",
	white_check_mark: "\u2705",
	x: "\u274C",
	warning: "\u26A0\uFE0F",
	stop_sign: "\uD83D\uDED1",
	no_entry: "\u26D4",
	no_entry_sign: "\uD83D\uDEAB",
	red_circle: "\uD83D\uDD34",
	yellow_circle: "\uD83D\uDFE1",
	green_circle: "\uD83D\uDFE2",
	wrench: "\uD83D\uDD27",
	hammer: "\uD83D\uDD28",
	hammer_and_wrench: "\uD83D\uDEE0\uFE0F",
	computer: "\uD83D\uDCBB",
	desktop_computer: "\uD83D\uDDA5\uFE0F",
	memo: "\uD83D\uDCDD",
	books: "\uD83D\uDCDA",
	book: "\uD83D\uDCD6",
	bulb: "\uD83D\uDCA1",
	sparkles: "\u2728",
	fire: "\uD83D\uDD25",
	boom: "\uD83D\uDCA5",
	zap: "\u26A1",
	bug: "\uD83D\uDC1B",
	wave: "\uD83D\uDC4B",
	pray: "\uD83D\uDE4F",
	point_up: "\u261D\uFE0F",
	point_right: "\uD83D\uDC49",
	clap: "\uD83D\uDC4F",
	muscle: "\uD83D\uDCAA",
	raised_hands: "\uD83D\uDE4C",
	robot: "\uD83E\uDD16",
	art: "\uD83C\uDFA8",
	pencil: "\u270F\uFE0F",
	scissors: "\u2702\uFE0F",
	package: "\uD83D\uDCE6",
	lock: "\uD83D\uDD12",
	key: "\uD83D\uDD11",
	mag: "\uD83D\uDD0D",
	chart_with_upwards_trend: "\uD83D\uDCC8",
	chart_with_downwards_trend: "\uD83D\uDCC9",
	recycle: "\u267B\uFE0F",
	construction: "\uD83D\uDEA7",
	construction_worker: "\uD83D\uDC77",
	100: "\uD83D\uDCAF",
	calendar: "\uD83D\uDCC5",
	clock1: "\uD83D\uDD50",
	timer_clock: "\u23F1\uFE0F",
	thinking: "\uD83E\uDD14",
	thinking_face: "\uD83E\uDD14",
	saluting_face: "\uD83E\uDEE1",
	salute: "\uD83E\uDEE1",
	face_with_monocle: "\uD83E\uDDD0",
	facepalm: "\uD83E\uDD26",
	sob: "\uD83D\uDE2D",
	sweat_smile: "\uD83D\uDE05",
	slightly_smiling_face: "\uD83D\uDE42",
	cry: "\uD83D\uDE22",
	disappointed: "\uD83D\uDE1E",
};

/** Upstream `Wm`: names starting with the query, then containing it, then keywords starting with it; extras last. */
export async function searchEmoji(query: string): Promise<EmojiItem[]>
{
	const needle = query.toLowerCase();
	if (needle.length === 0) return [];
	const items = await loadEmoji().catch((): readonly EmojiItem[] => []);
	const starts: EmojiItem[] = [];
	const includes: EmojiItem[] = [];
	const keywords: EmojiItem[] = [];
	const seen = new Set<string>();
	const consider = (item: EmojiItem) =>
	{
		if (item.name.startsWith(needle)) starts.push(item);
		else if (item.name.includes(needle)) includes.push(item);
		else if (item.keywords.some((keyword) => keyword.startsWith(needle))) keywords.push(item);
		else return;
		seen.add(stripVs16(item.char));
	};
	for (const item of items)
	{
		consider(item);
		if (starts.length >= EMOJI_SUGGESTION_LIMIT) break;
	}
	for (const [name, char] of Object.entries(EXTRA_SHORTCODES))
	{
		if (names?.get(name) === undefined && !seen.has(stripVs16(char)))
			consider(
				{
					name,
					char,
					keywords: [],
				},
			);
	}
	return [...starts, ...includes, ...keywords].slice(0, EMOJI_SUGGESTION_LIMIT);
}
