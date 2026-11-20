/**
 * Upstream claude.ai/code's past tense for a Bash (or subagent) description:
 * "Check status" -> "Checked status", "Wait and recheck DNS" -> "Waited and
 * rechecked DNS". Only a leading word upstream knows to be a verb changes;
 * anything else ("Open the page", "Cherry-pick fold") stays verbatim.
 */

/** Verbs whose past tense no suffix rule produces. */
const IRREGULAR_PAST: Record<string, string> =
{
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

/** Upstream `Ha`: verbs whose progressive form no suffix rule produces ("screenshot" -> "screenshotting"). */
const IRREGULAR_PROGRESSIVE: Record<string, string> =
{
	begin: "beginning",
	commit: "committing",
	control: "controlling",
	debug: "debugging",
	emit: "emitting",
	equip: "equipping",
	forget: "forgetting",
	format: "formatting",
	input: "inputting",
	occur: "occurring",
	omit: "omitting",
	output: "outputting",
	permit: "permitting",
	prefer: "preferring",
	quit: "quitting",
	refer: "referring",
	rerun: "rerunning",
	reset: "resetting",
	screenshot: "screenshotting",
	snapshot: "snapshotting",
	submit: "submitting",
	sync: "syncing",
	transfer: "transferring",
	unset: "unsetting",
	unwrap: "unwrapping",
	unzip: "unzipping",
};

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
	"emit",
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
	"screenshot",
	"scroll",
	"search",
	"select",
	"serialize",
	"serve",
	"settle",
	"skip",
	"snapshot",
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
	"sync",
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

const KNOWN_VERBS = new Set([...Object.keys(IRREGULAR_PAST), ...Object.keys(IRREGULAR_PROGRESSIVE), ...REGULAR_VERBS]);

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
function isBareWord(word: string): boolean
{
	if (!/^[A-Za-z]{2,16}$/.test(word) || word === word.toUpperCase()) return false;
	const lower = word.toLowerCase();
	if (PAST_FORMS.has(lower)) return false;
	if (Object.hasOwn(IRREGULAR_PAST, lower)) return true;
	if (word.length > 4 && /ing$/i.test(word)) return false;
	if (word.length > 3 && /ed$/i.test(word) && !/eed$/i.test(word)) return false;
	if (word.length > 3 && /s$/i.test(word) && !/(ss|us)$/i.test(word)) return false;
	return /[aeiouy]/i.test(word);
}

function vowelCount(word: string): number
{
	return (word.match(/[aeiou]/gi) ?? []).length;
}

const SINGLE_SYLLABLE_CVC_RE = /[^aeiou][aeiou][bcdfghjklmnpqrstvz]$/i;

/** A one-syllable consonant-vowel-consonant verb doubles its final consonant: "grep" -> "grepped". */
function isSingleSyllableCvc(word: string): boolean
{
	return SINGLE_SYLLABLE_CVC_RE.test(word) && vowelCount(word) === 1;
}

/** Upstream `Ga`: the progressive form of a known verb, keeping the word's own letter case. */
function progressiveOf(word: string): string
{
	const irregular = IRREGULAR_PROGRESSIVE[word.toLowerCase()];
	if (irregular !== undefined) return irregular;
	if (/ie$/i.test(word)) return `${word.slice(0, -2)}ying`;
	if (/[^eoy]e$/i.test(word)) return `${word.slice(0, -1)}ing`;
	if (isSingleSyllableCvc(word)) return `${word}${word.slice(-1)}ing`;
	if (/c$/i.test(word)) return `${word}king`;
	return `${word}ing`;
}

/** Upstream `Ka`: the past tense of a known verb, keeping the word's own letter case. */
function pastOf(word: string): string
{
	const lower = word.toLowerCase();
	const irregular = IRREGULAR_PAST[lower];
	if (irregular !== undefined) return irregular;
	if (/e$/i.test(word)) return `${word}d`;
	if (/[^aeiou]y$/i.test(word)) return `${word.slice(0, -1)}ied`;
	if (isSingleSyllableCvc(word)) return `${word}${word.slice(-1)}ed`;
	if (/c$/i.test(word)) return `${word}ked`;
	const doubled = IRREGULAR_PROGRESSIVE[lower];
	if (doubled !== undefined) return `${doubled.slice(0, -3)}ed`;
	return `${word}ed`;
}

function matchCapital(original: string, replacement: string): string
{
	return /^[A-Z]/.test(original) ? replacement.charAt(0).toUpperCase() + replacement.slice(1) : replacement;
}

/** Inflect each known verb joined on by "and"/"then"; comma-separated verbs stay as written. */
function inflectFollowingVerbs(text: string, inflect: (verb: string) => string): string
{
	return text.replace(FOLLOWING_VERB_RE, (whole: string, joiners: string, verb: string, offset: number) =>
	{
		if (!KNOWN_VERBS.has(verb) || UNCHANGED_FOLLOWERS.has(verb)) return whole;
		if (NOUN_CONTEXT_RE.test(text.slice(offset + whole.length))) return whole;
		return joiners + inflect(verb);
	});
}

/** A description's running, done and infinitive forms ("Re-running", "Re-ran", "re-run the tests"). */
export interface VerbForms
{
	running: string;
	done: string;
	infinitive: string;
}

interface Inflection
{
	/** The table whose entry for a whole prefixed verb ("rerun") wins over inflecting its base. */
	irregular: Record<string, string>;
	inflect: (word: string) => string;
}

const RUNNING: Inflection =
{
	irregular: IRREGULAR_PROGRESSIVE,
	inflect: progressiveOf,
};
const DONE: Inflection =
{
	irregular: IRREGULAR_PAST,
	inflect: pastOf,
};

/**
 * Upstream `ro`: inflect a Bash or subagent description whose leading word is a
 * known bare verb, optionally hyphen-prefixed ("Re-run"), along with each known
 * verb joined on by "and"/"then". Undefined when the description opens with no
 * verb upstream knows ("Open draft PR", "Cherry-pick fold", "Polling the API").
 */
export function describeVerbForms(description: string): VerbForms | undefined
{
	const trimmed = description.trimStart();
	const indent = description.slice(0, description.length - trimmed.length);
	const [, word, rest] = /^(\S+)([\s\S]*)$/.exec(trimmed) ?? [];
	if (word === undefined || rest === undefined) return undefined;
	const infinitive = indent + word.charAt(0).toLowerCase() + word.slice(1) + rest;
	const [, prefix, base] = VERB_PREFIX_RE.exec(word) ?? [];
	if (prefix !== undefined && base !== undefined && isBareWord(base))
	{
		const joined = (prefix + base).toLowerCase();
		const lowerBase = base.toLowerCase();
		if (PAST_FORMS.has(joined) || PAST_FORMS.has(lowerBase)) return undefined;
		if (!KNOWN_VERBS.has(joined) && !KNOWN_VERBS.has(lowerBase)) return undefined;
		const form = ({irregular, inflect}: Inflection) =>
		{
			const whole = irregular[joined];
			const head = matchCapital(base, whole === undefined ? inflect(base) : whole.slice(prefix.length));
			return `${indent}${prefix}-${head}${inflectFollowingVerbs(rest, inflect)}`;
		};
		return {
			running: form(RUNNING),
			done: form(DONE),
			infinitive,
		};
	}
	if (!isBareWord(word) || !KNOWN_VERBS.has(word.toLowerCase())) return undefined;
	const form = ({inflect}: Inflection) =>
		indent + matchCapital(word, inflect(word)) + inflectFollowingVerbs(rest, inflect);
	return {
		running: form(RUNNING),
		done: form(DONE),
		infinitive,
	};
}

export function pastTense(description: string): string
{
	return describeVerbForms(description)?.done ?? description;
}

/**
 * Upstream's infinitive of a Bash or subagent description, for its failed label
 * ("Failed to run the tests"). Undefined when the description opens with no verb
 * upstream knows.
 */
export function infinitive(description: string): string | undefined
{
	return describeVerbForms(description)?.infinitive;
}
