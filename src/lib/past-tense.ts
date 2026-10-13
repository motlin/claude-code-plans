/**
 * Upstream claude.ai/code's past tense for a Bash (or subagent) description:
 * "Check status" -> "Checked status", "Wait and recheck DNS" -> "Waited and
 * rechecked DNS". Only a leading word upstream knows to be a verb changes;
 * anything else ("Open the page", "Cherry-pick fold") stays verbatim.
 */

/** Verbs whose past tense no suffix rule produces. */
const IRREGULAR_PAST: Record<string, string> = {
	begin: "began",
	bind: "bound",
	bring: "brought",
	build: "built",
	buy: "bought",
	catch: "caught",
	choose: "chose",
	come: "came",
	cut: "cut",
	debug: "debugged",
	dig: "dug",
	do: "did",
	draw: "drew",
	feed: "fed",
	feel: "felt",
	fight: "fought",
	find: "found",
	fly: "flew",
	forget: "forgot",
	freeze: "froze",
	get: "got",
	give: "gave",
	go: "went",
	have: "had",
	hide: "hid",
	hit: "hit",
	hold: "held",
	input: "input",
	keep: "kept",
	know: "knew",
	lead: "led",
	leave: "left",
	let: "let",
	lose: "lost",
	make: "made",
	mean: "meant",
	meet: "met",
	override: "overrode",
	overwrite: "overwrote",
	pay: "paid",
	put: "put",
	quit: "quit",
	read: "read",
	rebuild: "rebuilt",
	redo: "redid",
	rerun: "reran",
	reset: "reset",
	rewrite: "rewrote",
	run: "ran",
	see: "saw",
	seek: "sought",
	send: "sent",
	set: "set",
	show: "showed",
	shut: "shut",
	sit: "sat",
	sleep: "slept",
	spend: "spent",
	spin: "spun",
	split: "split",
	spread: "spread",
	stand: "stood",
	sweep: "swept",
	sync: "synced",
	take: "took",
	teach: "taught",
	tear: "tore",
	tell: "told",
	think: "thought",
	throw: "threw",
	understand: "understood",
	undo: "undid",
	unset: "unset",
	win: "won",
	unwrap: "unwrapped",
	unzip: "unzipped",
	write: "wrote",
};

/** Multi-syllable verbs that double their final consonant: "commit" -> "committed". */
const DOUBLING_VERBS = new Set([
	"commit",
	"control",
	"emit",
	"equip",
	"format",
	"occur",
	"omit",
	"output",
	"permit",
	"prefer",
	"refer",
	"screenshot",
	"snapshot",
	"submit",
	"transfer",
]);

/** Regular verbs upstream recognizes at the start of a description. */
const REGULAR_VERBS = [
	"add",
	"analyze",
	"append",
	"apply",
	"archive",
	"assert",
	"attempt",
	"audit",
	"autofix",
	"await",
	"benchmark",
	"bisect",
	"call",
	"capture",
	"check",
	"click",
	"clone",
	"collect",
	"compare",
	"compile",
	"compute",
	"confirm",
	"connect",
	"convert",
	"copy",
	"count",
	"create",
	"curl",
	"decode",
	"delete",
	"deploy",
	"detect",
	"disable",
	"discard",
	"dismiss",
	"display",
	"download",
	"dump",
	"edit",
	"enable",
	"encode",
	"ensure",
	"enumerate",
	"evaluate",
	"execute",
	"expand",
	"expect",
	"export",
	"extract",
	"fetch",
	"fill",
	"filter",
	"fix",
	"flush",
	"focus",
	"follow",
	"generate",
	"grep",
	"identify",
	"ignore",
	"import",
	"include",
	"inject",
	"insert",
	"inspect",
	"install",
	"invoke",
	"kill",
	"launch",
	"lint",
	"list",
	"load",
	"locate",
	"loop",
	"measure",
	"merge",
	"monitor",
	"move",
	"navigate",
	"normalize",
	"parse",
	"patch",
	"pick",
	"ping",
	"pipe",
	"poll",
	"post",
	"prepare",
	"preview",
	"print",
	"probe",
	"profile",
	"prune",
	"publish",
	"pull",
	"push",
	"queue",
	"rebase",
	"recheck",
	"record",
	"recover",
	"redirect",
	"reduce",
	"refresh",
	"regenerate",
	"reinstall",
	"relaunch",
	"reload",
	"remove",
	"rename",
	"render",
	"reopen",
	"repeat",
	"replay",
	"reply",
	"report",
	"request",
	"resolve",
	"restart",
	"restore",
	"retry",
	"revert",
	"save",
	"scan",
	"scroll",
	"search",
	"select",
	"serialize",
	"serve",
	"settle",
	"skip",
	"sort",
	"spawn",
	"squash",
	"stage",
	"start",
	"stash",
	"stop",
	"strip",
	"summarize",
	"switch",
	"tail",
	"tally",
	"test",
	"toggle",
	"touch",
	"trace",
	"track",
	"trigger",
	"trim",
	"truncate",
	"try",
	"typecheck",
	"unblock",
	"uninstall",
	"unlink",
	"unmount",
	"unpack",
	"update",
	"upgrade",
	"upload",
	"validate",
	"verify",
	"visit",
	"wait",
	"walk",
	"warn",
	"wipe",
];

const KNOWN_VERBS = new Set([...Object.keys(IRREGULAR_PAST), ...DOUBLING_VERBS, ...REGULAR_VERBS]);

/**
 * Known verbs left alone after "and"/"then": ones that are also nouns or
 * adjectives ("and output"), or whose base and past forms read alike.
 */
const UNCHANGED_FOLLOWERS = new Set([
	"output",
	"input",
	"lead",
	"feed",
	"spread",
	"set",
	"cut",
	"split",
	"hit",
	"let",
	"put",
	"quit",
	"shut",
	"read",
	"go",
	"make",
	"dig",
	"tear",
	"win",
	"fly",
	"spin",
	"control",
	"permit",
	"have",
	"hold",
	"keep",
	"mean",
	"feel",
	"do",
	"see",
	"know",
	"think",
	"understand",
]);

/** Words that are already a past form, so a description starting with one is left as written. */
const PAST_FORMS = new Set([
	...Object.entries(IRREGULAR_PAST)
		.filter(([base, past]) => base !== past)
		.map(([, past]) => past),
	"been",
	"broken",
	"chosen",
	"done",
	"drawn",
	"driven",
	"eaten",
	"fallen",
	"forgotten",
	"given",
	"gone",
	"grown",
	"hidden",
	"known",
	"ridden",
	"risen",
	"seen",
	"shown",
	"spoken",
	"taken",
	"thrown",
	"torn",
	"worn",
	"written",
]);

const VERB_PREFIX_RE = /^(re|un|de|pre|co|sub|over|out|mis|auto|post)-(.+)$/i;
const FOLLOWING_VERB_RE = /(?<![\w-])((?:(?:[Aa]nd|[Tt]hen)\s+)+)([a-z]{2,16})(?=$|[\s,;!?]|\.(?:\s|$))/g;
/** "and run is green": the word after "and" is a noun, not a verb, when a verb or condition follows it. */
const NOUN_CONTEXT_RE =
	/^(?:\s+\w+){0,2}\s+(?:is|are|was|were|has|have|do|does|did|will|would|should|can|could|passes|passed|fails|failed|exists|works|worked|succeeds|succeeded|stays|remains|looks|runs|ran|not|if|when|unless|whether)(?:n['’]t)?\b/;

/** A bare, uninflected word: no -ing, -ed, or plural -s, not an acronym, not already past. */
function isBareWord(word: string): boolean {
	if (!/^[A-Za-z]{2,16}$/.test(word) || word === word.toUpperCase()) return false;
	const lower = word.toLowerCase();
	if (PAST_FORMS.has(lower)) return false;
	if (Object.hasOwn(IRREGULAR_PAST, lower)) return true;
	if (word.length > 4 && /ing$/i.test(word)) return false;
	if (word.length > 3 && /ed$/i.test(word) && !/eed$/i.test(word)) return false;
	if (word.length > 3 && /s$/i.test(word) && !/(ss|us)$/i.test(word)) return false;
	return /[aeiouy]/i.test(word);
}

function vowelCount(word: string): number {
	return (word.match(/[aeiou]/gi) ?? []).length;
}

/** The past tense of a known verb, keeping the word's own letter case. */
function pastOf(word: string): string {
	const lower = word.toLowerCase();
	const irregular = IRREGULAR_PAST[lower];
	if (irregular !== undefined) return irregular;
	if (/e$/i.test(word)) return `${word}d`;
	if (/[^aeiou]y$/i.test(word)) return `${word.slice(0, -1)}ied`;
	// A one-syllable consonant-vowel-consonant verb doubles its final consonant: "grep" -> "grepped".
	const singleSyllableCvc = /[^aeiou][aeiou][bcdfghjklmnpqrstvz]$/i.test(word) && vowelCount(word) === 1;
	if (singleSyllableCvc || DOUBLING_VERBS.has(lower)) return `${word}${word.slice(-1)}ed`;
	if (/c$/i.test(word)) return `${word}ked`;
	return `${word}ed`;
}

function matchCapital(original: string, replacement: string): string {
	return /^[A-Z]/.test(original) ? replacement.charAt(0).toUpperCase() + replacement.slice(1) : replacement;
}

/** Past-tense each known verb joined on by "and"/"then"; comma-separated verbs stay as written. */
function pastTenseFollowingVerbs(text: string): string {
	return text.replace(FOLLOWING_VERB_RE, (whole: string, joiners: string, verb: string, offset: number) => {
		if (!KNOWN_VERBS.has(verb) || UNCHANGED_FOLLOWERS.has(verb)) return whole;
		if (NOUN_CONTEXT_RE.test(text.slice(offset + whole.length))) return whole;
		return joiners + pastOf(verb);
	});
}

/** A hyphen-prefixed verb ("Re-run") in past tense ("Re-ran"), or null when it is not a known verb. */
function pastOfPrefixed(word: string): string | null {
	const [, prefix, base] = VERB_PREFIX_RE.exec(word) ?? [];
	if (prefix === undefined || base === undefined || !isBareWord(base)) return null;
	const joined = (prefix + base).toLowerCase();
	const lowerBase = base.toLowerCase();
	if (PAST_FORMS.has(joined) || PAST_FORMS.has(lowerBase)) return null;
	if (!KNOWN_VERBS.has(joined) && !KNOWN_VERBS.has(lowerBase)) return null;
	const joinedIrregular = IRREGULAR_PAST[joined];
	const pastBase = joinedIrregular === undefined ? pastOf(base) : joinedIrregular.slice(prefix.length);
	return `${prefix}-${matchCapital(base, pastBase)}`;
}

export function pastTense(description: string): string {
	const trimmed = description.trimStart();
	const indent = description.slice(0, description.length - trimmed.length);
	const [, word, rest] = /^(\S+)([\s\S]*)$/.exec(trimmed) ?? [];
	if (word === undefined || rest === undefined) return description;
	const prefixed = pastOfPrefixed(word);
	if (prefixed !== null) return indent + prefixed + pastTenseFollowingVerbs(rest);
	if (!isBareWord(word) || !KNOWN_VERBS.has(word.toLowerCase())) return description;
	return indent + matchCapital(word, pastOf(word)) + pastTenseFollowingVerbs(rest);
}
