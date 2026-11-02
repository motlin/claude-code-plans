/*
 * Upstream's mermaid guard (chunk c763d2034, lazily loaded beside mermaid): the limits that refuse a diagram which
 * would take too long to draw or come out unreadable. It needs mermaid's patch (patches/mermaid@11.17.2.patch),
 * which hands each parsed diagram to `globalThis.__antMermaidGuard.parsed` and charges each label mermaid measures
 * through `__antMermaidGuard.fit`. A drawing whose check never ran is refused (`MermaidGuardNotRun`).
 *
 * The parts, in upstream's order: the sequence-diagram repairs, the refusal errors and their messages, the per-type
 * limits on mermaid's parsed data, the text charge, and the frame meter that counts and times the measuring calls
 * mermaid makes inside its sandbox iframe. The messages name this file and mermaid-render.ts where upstream names
 * mermaidLimits.ts and MermaidDiagram.tsx.
 */

type Obj = Record<string | symbol, unknown>;
const isObject = (value: unknown): value is Obj => typeof value === "object" && value !== null;
const isFunction = (value: unknown): value is (...args: unknown[]) => unknown => typeof value === "function";

// ---- sequence repairs (upstream m and its helpers) ----

const INACTIVE_PARTICIPANT = "Trying to inactivate an inactive participant";
const ARROW =
	/<<-->>|<<->>|-->>|->>|-->|->|--x|-x|--\)|-\)|--\|\\|--\|\/|--\\\\|--\/\/|\/\|--|\\\|--|\/\/--|\\\\--|-\|\\|-\|\/|-\\\\|-\/\/|\/\|-|\\\|-|\/\/-|\\\\-/i;
const KEYWORD =
	/^(?:note|loop|alt|else|opt|par_over|par|and|critical|option|break|rect|box|end|participant|actor|create|destroy|activate|deactivate|autonumber|title|links?|properties|details|acc(?:Title|Descr))\b/i;
const AUTONUMBER = /^autonumber(?:\s+off|\s+\d+(?:\s+\d+)?)?$/i;
const WHOLE_STATEMENT = /^\s*(?:sequenceDiagram|end|autonumber(?:\s+off|\s+\d+(?:\s+\d+)?)?)\s*$/i;
const PARTICIPANT_STATEMENT = /^(?:(?:create\s+)?(?:participant|actor)|activate|deactivate|destroy)\s+(\S.*)$/is;
const TEXT_STATEMENT = /^(?:note\s+(?:left\s+of|right\s+of|over)|links?|properties|details)\s+\S/i;
const ACC_STATEMENT = /^acc(?:Title|Descr)\s*[:{]/i;
const BLOCK_OPENER = /^(par_over|loop|alt|opt|par|critical|break|rect|box)\b/i;
const BRANCH_OF: Readonly<Record<string, readonly string[]>> =
{
	else: ["alt"],
	and: ["par", "par_over"],
	option: ["critical"],
};
const branchWord = (part: string) => /^\s*(else|and|option)\b/i.exec(part)?.[1]?.toLowerCase() ?? "";
const isSpace = (char: string | undefined) => char !== undefined && /\s/.test(char);
/** Mermaid's own encoded entity (`#name;` / `#123;`), which it decodes back after drawing. */
const encodedEntity = (name: string) => `${/^\d+$/.test(name) ? "ﬂ°°" : "ﬂ°"}${name}¶ß`;

type PartKind = "stops" | "takes-text" | "whole" | "end" | "branch" | "text";

/** Upstream `ee`: what the part after a semicolon is, so the semicolon can be told apart from message text. */
function partKind(part: string, participants: ReadonlySet<string>): PartKind
{
	const trimmed = part.trim();
	if (trimmed.startsWith("%") || ACC_STATEMENT.test(trimmed)) return "stops";
	if (isMessage(trimmed) || (TEXT_STATEMENT.test(trimmed) && trimmed.includes(":"))) return "takes-text";
	const name = participantName(trimmed);
	if (
		/^title(?:\s|:)/i.test(trimmed) ||
		AUTONUMBER.test(trimmed) ||
		(name !== undefined && (!/\s/.test(name) || participants.has(name)))
	)
		return "whole";
	if (/^end$/i.test(trimmed)) return "end";
	return /^(?:else|and|option)\b/i.test(trimmed) ? "branch" : "text";
}

export interface SequenceRepair
{
	text: string;
	repair: "deactivate" | "semicolon";
}

/**
 * Upstream `m` (`repairSequenceText`): a sequence diagram that failed to parse, rewritten so it may parse: an
 * inactive participant's deactivation blanked, or a semicolon inside message text written as its entity.
 */
export function repairSequenceText(text: string, error: unknown): SequenceRepair | undefined
{
	const deactivate = error instanceof Error && error.message.startsWith(INACTIVE_PARTICIPANT);
	const participants = new Set<string>();
	const repaired = mapStatementLines(text, deactivate ? deactivationFix(participants) : semicolonFix(participants));
	return repaired === text
		? undefined
		:
			{
				text: repaired,
				repair: deactivate ? "deactivate" : "semicolon",
			};
}

/** Upstream `h`: where a front-matter block ends, or 0. */
function frontMatterEnd(text: string): number
{
	const open = /^([^\S\n]*)-{3}[^\S\n]*\n/.exec(text);
	if (!open) return 0;
	const close = `\n${open[1] ?? ""}---`;
	for (let at = text.indexOf(close, open[0].length); at >= 0; at = text.indexOf(close, at + 1))
	{
		let index = at + close.length;
		let lineEnd = -1;
		while (isSpace(text[index]))
		{
			lineEnd = text[index] === "\n" ? index : lineEnd;
			index++;
		}
		if (lineEnd >= 0) return lineEnd + 1;
	}
	return 0;
}

/** Upstream `g`: `fix` over each statement line, skipping front matter, directives, comments and accessibility text. */
function mapStatementLines(text: string, fix: (line: string) => string): string
{
	const start = frontMatterEnd(text);
	let until: string | undefined;
	const lines = text
		.slice(start)
		.split("\n")
		.map((line) =>
		{
			if (until !== undefined)
			{
				until = line.includes(until) ? undefined : until;
				return line;
			}
			const trimmed = line.trimStart();
			if (trimmed.startsWith("%%{")) until = trimmed.includes("}%%", 3) ? undefined : "}%%";
			else if (/^accDescr\s*\{/i.test(trimmed)) until = trimmed.includes("}") ? undefined : "}";
			else if (!trimmed.startsWith("%") && !/^acc(?:Title|Descr)\s*:/i.test(trimmed)) return fix(line);
			return line;
		});
	return text.slice(0, start) + lines.join("\n");
}

/** Upstream `_`: a line's semicolons, up to an entity-looking `#…` that is not one. */
function semicolons(line: string):
{
	breaks: number[];
	end: number;
}
{
	const breaks: number[] = [];
	for (let index = 0; index < line.length; index++)
	{
		if (line[index] === ";") breaks.push(index);
		else if (line[index] === "#")
		{
			let after = index + 1;
			while (after < line.length && /\w/.test(line[after] ?? "")) after++;
			if (after === index + 1 || line[after] !== ";")
				return {
					breaks,
					end: index,
				};
			index = after;
		}
	}
	return {
		breaks,
		end: line.length,
	};
}

/** Upstream `v`. */
function participantName(statement: string): string | undefined
{
	const named = PARTICIPANT_STATEMENT.exec(statement)?.[1];
	const alias = named?.search(/\sas\s/) ?? -1;
	return alias >= 0 ? named?.slice(0, alias).trim() : named?.trim();
}

/** Upstream `y`: an `A->>B: text` message. */
function isMessage(statement: string): boolean
{
	const colon = statement.indexOf(":");
	const arrow = colon > 0 ? ARROW.exec(statement.slice(0, colon)) : null;
	return arrow !== null && arrow.index > 0 && !KEYWORD.test(statement);
}

/** Upstream `b`: semicolons that sit inside message text become `#59;` (or finish an `&name` entity). */
function semicolonFix(participants: Set<string>): (line: string) => string
{
	const blocks: string[] = [];
	const track = (part: string) =>
	{
		const trimmed = part.trim();
		const opener = BLOCK_OPENER.exec(trimmed)?.[1];
		if (opener === undefined)
		{
			if (/^end$/i.test(trimmed)) blocks.pop();
		}
		else blocks.push(opener.toLowerCase());
		const name = /^(?:create\s+)?(?:participant|actor)\s/i.test(trimmed) ? participantName(trimmed) : undefined;
		if (name) participants.add(name);
	};
	return (line) =>
	{
		const {breaks, end} = semicolons(line);
		let last = end - 1;
		while (last >= 0 && (line[last] === ";" || isSpace(line[last]))) last--;
		const inner = breaks.filter((at) => at <= last);
		const partAfter = (index: number) => line.slice((breaks[index] ?? 0) + 1, breaks[index + 1] ?? end);
		track(line.slice(0, breaks[0] ?? end));
		const kinds = inner.map((_at, index) => partKind(partAfter(index), participants));
		const branchFits = (index: number) =>
			(BRANCH_OF[branchWord(partAfter(index))] ?? []).includes(blocks.at(-1) ?? "");
		const endsStatement: boolean[] = [];
		for (let index = inner.length - 1; index >= 0; index--)
		{
			const next = kinds[index + 1];
			endsStatement[index] =
				next === undefined ||
				next === "stops" ||
				next === "takes-text" ||
				(next === "end" && blocks.length > 0) ||
				(next === "branch" && branchFits(index + 1)) ||
				(next === "whole" && (endsStatement[index + 1] ?? false));
		}
		let out = "";
		let copied = 0;
		let statementStart = 0;
		let stoppedAt = inner.length;
		const encode = (at: number, always: boolean) =>
		{
			let wordStart = at;
			while (wordStart > copied && /[A-Za-z0-9]/.test(line[wordStart - 1] ?? "")) wordStart--;
			const entity =
				wordStart < at &&
				wordStart > copied &&
				line[wordStart - 1] === "&" &&
				/[A-Za-z]/.test(line[wordStart] ?? "");
			if (entity || always)
			{
				out += entity
					? line.slice(copied, wordStart - 1) + encodedEntity(line.slice(wordStart, at))
					: line.slice(copied, at) + encodedEntity("59");
				copied = at + 1;
			}
		};
		for (const [index, at] of inner.entries())
		{
			const kind = kinds[index];
			if (kind === "stops")
			{
				stoppedAt = index;
				break;
			}
			if (
				(statementStart === (index === 0 ? 0 : (inner[index - 1] ?? 0) + 1) &&
					WHOLE_STATEMENT.test(line.slice(statementStart, at))) ||
				kind === "takes-text" ||
				(kind === "whole" && endsStatement[index] === true) ||
				(kind === "end" && blocks.length > 0 && endsStatement[index] === true) ||
				(kind === "branch" && branchFits(index))
			)
			{
				statementStart = at + 1;
				track(partAfter(index));
				continue;
			}
			encode(at, true);
		}
		const trailing = breaks[inner.length];
		if (stoppedAt === inner.length && trailing !== undefined) encode(trailing, false);
		return out + line.slice(copied);
	};
}

/** Upstream `x`: blanks a `deactivate X` (or a `-` arrow suffix) for a participant that is not active. */
function deactivationFix(participants: Set<string>): (line: string) => string
{
	const active = new Map<string, number>();
	const bump = (name: string, by: number) =>
	{
		active.set(name, (active.get(name) ?? 0) + by);
	};
	return (line) =>
	{
		const {breaks, end} = semicolons(line);
		let out = "";
		let copied = 0;
		const blank = (from: number, to: number) =>
		{
			out += line.slice(copied, from) + " ".repeat(to - from);
			copied = to;
		};
		let start = 0;
		for (const stop of [...breaks, end])
		{
			const part = line.slice(start, stop);
			const activation = /^(activate|deactivate)\s+(\S.*)$/is.exec(part.trim());
			const target = activation?.[2] ?? "";
			if (/^(?:create\s+)?(?:participant|actor)\s/i.test(part.trim()))
				participants.add(participantName(part.trim()) ?? "");
			else if (activation?.[1]?.toLowerCase() === "activate") bump(target, 1);
			else if (activation && (active.get(target) ?? 0) > 0) bump(target, -1);
			else if (activation && (start === 0 || participants.has(target))) blank(start, stop);
			else if (isMessage(part.trim()))
			{
				const arrow = ARROW.exec(part);
				if (arrow)
				{
					let after = arrow.index + arrow[0].length;
					while (isSpace(part[after])) after++;
					const suffixed = part[after] === "+" || part[after] === "-";
					const from = part.slice(0, arrow.index).trim();
					const to = part.slice(suffixed ? after + 1 : after, part.indexOf(":")).trim();
					participants.add(from);
					participants.add(to);
					if (part[after] === "+") bump(to, 1);
					else if (part[after] === "-")
					{
						if ((active.get(from) ?? 0) > 0) bump(from, -1);
						else blank(start + after, start + after + 1);
					}
				}
			}
			start = stop + 1;
		}
		return out + line.slice(copied);
	};
}

// ---- refusals (upstream S, te, w, ne) ----

const REFUSED_BY =
{
	MermaidRefusedLength: "length",
	MermaidRefusedType: "type",
	MermaidRefusedUnprepared: "unprepared",
	MermaidRefusedAltered: "altered",
	MermaidRefusedGantt: "gantt",
	MermaidRefusedPacket: "packet",
	MermaidRefusedBlock: "block",
	MermaidRefusedTreemap: "treemap",
	MermaidRefusedMindmap: "mindmap",
	MermaidRefusedGraph: "graph",
	MermaidRefusedC4: "c4",
	MermaidRefusedTimeline: "timeline",
	MermaidRefusedKanban: "kanban",
	MermaidRefusedXychart: "xychart",
	MermaidRefusedVenn: "venn",
	MermaidRefusedGitgraph: "gitgraph",
	MermaidRefusedText: "text",
	MermaidRefusedMeasure: "measure",
} as const;

export type MermaidRefusalName = keyof typeof REFUSED_BY | "MermaidGuardNotRun";
export type MermaidRefusedBy = (typeof REFUSED_BY)[keyof typeof REFUSED_BY];

/** What a measuring refusal was over: the calls, the size of the text to lay out, or the time. */
type MeasureOver = "calls" | "size" | "time";

export interface MeasuredDraw
{
	calls: number;
	spanMs: number;
	taskMs: number;
	hidden: boolean;
	firstCallMs?: number;
}

/** Upstream's refusal: an Error carrying why the guard refused. */
export interface MermaidRefusal extends Error
{
	refusedBy?: MermaidRefusedBy;
	diagramType?: string;
	byClock?: boolean;
	overReportCount?: boolean;
	unreadable?: boolean;
	hidden?: boolean;
	over?: MeasureOver;
	measured?: MeasuredDraw;
}

interface RefusalDetail
{
	unreadable?: boolean;
	hidden?: boolean;
	max?: number;
	over?: MeasureOver;
	ms?: number;
	why?: string;
}

const refusals = new WeakSet<Error>();

/** Upstream `te`. */
function refusalMessage(
	refusedBy: MermaidRefusedBy | undefined,
	diagramType: string | undefined,
	detail: RefusalDetail,
	byClock: boolean,
): string
{
	const {unreadable, max, over, ms} = detail;
	if (refusedBy === undefined)
		return "not shown: no check against the limits ran for this diagram; the installed mermaid may lack its patch (see patches/mermaid@11.17.2.patch)";
	if (refusedBy === "type")
		return diagramType === undefined || diagramType === "other"
			? "not drawn: this diagram's type has no entry in the limits table in mermaid-guard.ts"
			: `not drawn: the type "${diagramType}" is listed as not drawn in mermaid-guard.ts`;
	if (refusedBy === "length")
		return `not drawn: the diagram's text, after mermaid-render.ts's clean-up passes, is longer than ${max === undefined ? "the longest text that is drawn" : `${max.toLocaleString("en-US")} characters, the longest that is drawn`}`;
	if (refusedBy === "unprepared")
		return unreadable
			? "not drawn: the check could not read the text mermaid parsed; the installed mermaid may have changed: see checkParsedDiagram in mermaid-guard.ts"
			: "not drawn: the text mermaid parsed held a shape-data opener, or a dollar sign in a sequence diagram, both of which mermaid-render.ts's passes take out before mermaid reads a text. Either a text got past those passes or the installed mermaid has changed: see checkParsedDiagram in mermaid-guard.ts";
	if (refusedBy === "altered")
		return `not drawn: mermaid-render.ts's passes changed this gitGraph's text, or it holds "%%}%%", so the drawing could show ids, tags, names or settings other than those written: see checkGitgraphText in mermaid-guard.ts`;
	if (refusedBy === "measure" && "why" in detail)
		return `not drawn: the check that limits how long mermaid's drawing may hold the page was not in force on the frame it draws in (${detail.why}): see meterMermaidFrame and mermaidMeterLost in mermaid-guard.ts`;
	if (unreadable)
		return `not drawn: the "${refusedBy}" check could not read mermaid's data for this diagram; the installed mermaid may have changed`;
	if (byClock)
	{
		const limit =
			ms === undefined
				? "one drawing may take"
				: `the ${(ms / 1e3).toLocaleString("en-US")} seconds one drawing may take`;
		return refusedBy === "measure"
			? `not drawn: on this device, drawing this diagram kept the page busy without a pause for longer than ${limit}`
			: `not drawn: on this device the drawing took longer than its "${refusedBy}" limit allows`;
	}
	if (refusedBy === "text") return "not drawn: measuring this diagram's text is more work than one drawing may take";
	if (refusedBy === "measure")
		return over === "size"
			? "not drawn: this diagram has more text to lay out at once than one drawing may have"
			: "not drawn: drawing this diagram needs more measuring calls than one drawing may make";
	return `not drawn: this diagram is over the "${refusedBy}" limit on how much work one drawing may take`;
}

/** Upstream `w` (`mermaidRefusal`). */
export function mermaidRefusal(
	name: MermaidRefusalName,
	diagramType?: string,
	byClock?:
	{
		overReportCount: boolean;
	},
	detail: RefusalDetail = {},
): MermaidRefusal
{
	const refusedBy = name === "MermaidGuardNotRun" ? undefined : REFUSED_BY[name];
	const error: MermaidRefusal = Object.assign(
		new Error(refusalMessage(refusedBy, diagramType, detail, byClock !== undefined)),
		{
			name,
		},
	);
	if (refusedBy) error.refusedBy = refusedBy;
	if (diagramType !== undefined) error.diagramType = diagramType;
	if (byClock)
	{
		error.byClock = true;
		error.overReportCount = byClock.overReportCount;
	}
	if (detail.unreadable) error.unreadable = true;
	if (detail.hidden) error.hidden = true;
	refusals.add(error);
	return error;
}

/** Upstream `ne` (`isMermaidRefusal`). */
export function isMermaidRefusal(error: unknown): error is MermaidRefusal
{
	return error instanceof Error && refusals.has(error);
}

// ---- limits (upstream T, E, D, O, re) ----

/** Upstream `T`: the longest text drawn, whatever mermaid's maxTextSize. */
const MERMAID_MAX_TEXT = 20_000;

/** Upstream `E`. */
const MERMAID_LIMIT_NUMBERS =
{
	packetMaxRows: 1e3,
	blockMaxEntries: 250,
	blockMaxArrows: 400,
	blockMaxDepth: 8,
	treemapLongName: 100,
	treemapMaxLongNameChars: 1e3,
	mindmapReportNodes: 161,
	mindmapRefuseNodes: 304,
	graphReportNodes: 329,
	graphRefuseNodes: 620,
	graphReportEdges: 207,
	graphRefuseEdges: 285,
	graphReportGroups: 124,
	graphRefuseGroups: 272,
	graphClassReportNodes: 125,
	graphClassRefuseNodes: 159,
	graphErReportNodes: 100,
	graphErRefuseNodes: 175,
	graphRequirementReportNodes: 130,
	ganttReportCalls: 1e5,
	ganttRefuseCalls: 3e5,
	ganttReportMs: 1e3,
	ganttRefuseMs: 2500,
	ganttClockEvery: 64,
	ganttMaxDateFormat: 64,
	timelineWrap: 400,
	timelineReportCount: 6e5,
	timelineRefuseCount: 14e5,
	kanbanReportNodes: 225,
	kanbanRefuseNodes: 400,
	kanbanMaxSectionsOfOneId: 2,
	kanbanMinSectionWidth: 100,
	kanbanMaxSectionWidth: 2e3,
	xychartLabel: 100,
	xychartPoint: 120,
	xychartReportCount: 75e4,
	xychartRefuseCount: 16e5,
	xychartMaxSide: 1e4,
	vennReportSets: 20,
	vennRefuseSets: 28,
	vennReportNames: 300,
	vennRefuseNames: 600,
	vennSizedReportSets: 4,
	vennSizedRefuseSets: 6,
	vennSizedReportNames: 40,
	vennSizedRefuseNames: 80,
	vennMinSize: 1e-6,
	vennMaxSize: 1e6,
	vennMaxSide: 1e3,
	vennMaxPadding: 100,
	gitgraphReportCount: 600,
	gitgraphRefuseCount: 1200,
	textCharsPerUnit: 100,
	textTextWeight: 4,
	textLinesSquare: 1e3,
	textReportUnits: 6500,
	textRefuseUnits: 13e3,
	measureReportMs: 2500,
	measureRefuseMs: 8e3,
	measureReportCalls: 3e4,
	measureRefuseCalls: 6e4,
	measureGapMs: 50,
	measureRefuseSize: 4e6,
	measureTspanChars: 8,
	measureAfterPart: 8,
};
type LimitNumbers = typeof MERMAID_LIMIT_NUMBERS;

type CheckName =
	| "graph"
	| "mindmap"
	| "gantt"
	| "packet"
	| "block"
	| "treemap"
	| "c4"
	| "timeline"
	| "kanban"
	| "xychart"
	| "venn"
	| "gitgraph";

/** Upstream `D`: every diagram type mermaid 11.17.2 parses, with the check its parsed data goes through. */
const MERMAID_TYPES: Readonly<Record<string, CheckName | undefined>> =
{
	"flowchart-v2": "graph",
	"flowchart-elk": "graph",
	swimlane: "graph",
	classDiagram: "graph",
	stateDiagram: "graph",
	er: "graph",
	requirement: "graph",
	mindmap: "mindmap",
	gantt: "gantt",
	packet: "packet",
	block: "block",
	treemap: "treemap",
	error: undefined,
	"---": undefined,
	architecture: undefined,
	c4: "c4",
	kanban: "kanban",
	info: undefined,
	pie: undefined,
	sequence: undefined,
	timeline: "timeline",
	gitGraph: "gitgraph",
	journey: undefined,
	quadrantChart: undefined,
	sankey: undefined,
	xychart: "xychart",
	eventmodeling: undefined,
	treeView: undefined,
	radar: undefined,
	ishikawa: undefined,
	railroad: undefined,
	railroadEbnf: undefined,
	railroadAbnf: undefined,
	railroadPeg: undefined,
	venn: "venn",
	wardley: undefined,
	cynefin: undefined,
};
/** Upstream `O`. */
const MERMAID_TYPES_NOT_DRAWN: ReadonlySet<string> = new Set(["eventmodeling"]);
/** Upstream `re`. */
const REFUSAL_OF: Readonly<Record<CheckName, keyof typeof REFUSED_BY>> =
{
	graph: "MermaidRefusedGraph",
	mindmap: "MermaidRefusedMindmap",
	gantt: "MermaidRefusedGantt",
	packet: "MermaidRefusedPacket",
	block: "MermaidRefusedBlock",
	treemap: "MermaidRefusedTreemap",
	c4: "MermaidRefusedC4",
	timeline: "MermaidRefusedTimeline",
	kanban: "MermaidRefusedKanban",
	xychart: "MermaidRefusedXychart",
	venn: "MermaidRefusedVenn",
	gitgraph: "MermaidRefusedGitgraph",
};

type Now = () => number;

/** What one draw's checks have seen: filled in as mermaid parses, measures and draws. */
export interface MermaidDrawSeen
{
	ran: boolean;
	diagramType: string;
	enteredAt?: number;
	overLimit?: string;
	empty?: boolean;
	cleanup?: () => void;
	refusal?: MermaidRefusal;
	measured?: MeasuredDraw;
}

interface CheckContext
{
	seen: MermaidDrawSeen;
	now: Now;
	numbers: LimitNumbers;
	refusal: (byClock?: {overReportCount: boolean}) => MermaidRefusal;
	unreadable: () => MermaidRefusal;
}

/** Upstream `A`: call a db method, or the db is unreadable. */
function callDb(db: unknown, name: string, context: CheckContext, ...args: unknown[]): unknown
{
	const method = isObject(db) ? db[name] : undefined;
	if (!isFunction(method)) throw context.unreadable();
	return Reflect.apply(method, db, args);
}

/** Upstream `j`. */
function asArray(value: unknown, context: CheckContext): unknown[]
{
	if (!Array.isArray(value)) throw context.unreadable();
	return value as unknown[];
}

type NumberKey = {[K in keyof LimitNumbers]: LimitNumbers[K] extends number ? K : never}[keyof LimitNumbers];

/** Upstream `ie`. */
const GRAPH_NODE_LIMITS: Readonly<
	Record<
		string,
		{
			report: NumberKey;
			refuse: NumberKey;
		}
	>
> =
{
	classDiagram:
	{
		report: "graphClassReportNodes",
		refuse: "graphClassRefuseNodes",
	},
	er:
	{
		report: "graphErReportNodes",
		refuse: "graphErRefuseNodes",
	},
	requirement:
	{
		report: "graphRequirementReportNodes",
		refuse: "graphRefuseNodes",
	},
};

/** Upstream `ae`. */
function checkGraph(db: unknown, context: CheckContext): void
{
	const data = callDb(db, "getData", context);
	const nodes = asArray(isObject(data) ? data["nodes"] : undefined, context);
	const edges = asArray(isObject(data) ? data["edges"] : undefined, context).length;
	const groups = nodes.filter((node) => isObject(node) && node["isGroup"] === true).length;
	const numbers = context.numbers;
	const limits = Object.hasOwn(GRAPH_NODE_LIMITS, context.seen.diagramType)
		? GRAPH_NODE_LIMITS[context.seen.diagramType]
		: undefined;
	if (
		nodes.length > numbers[limits?.refuse ?? "graphRefuseNodes"] ||
		edges > numbers.graphRefuseEdges ||
		groups > numbers.graphRefuseGroups
	)
		throw context.refusal();
	if (
		nodes.length > numbers[limits?.report ?? "graphReportNodes"] ||
		edges > numbers.graphReportEdges ||
		groups > numbers.graphReportGroups
	)
		context.seen.overLimit = "graph";
}

/** Upstream `oe`. */
function checkMindmap(db: unknown, context: CheckContext): void
{
	const root = callDb(db, "getMindmap", context);
	const stack: unknown[] = root === null ? [] : [root];
	let count = 0;
	while (stack.length > 0)
	{
		const node = stack.pop();
		count += 1;
		if (!isObject(node)) throw context.unreadable();
		if (count > context.numbers.mindmapRefuseNodes) throw context.refusal();
		if (Array.isArray(node["children"])) for (const child of node["children"] as unknown[]) stack.push(child);
	}
	if (count > context.numbers.mindmapReportNodes) context.seen.overLimit = "mindmap";
	context.seen.empty = count === 0;
}

/** Upstream `se`. */
function checkPacket(db: unknown, context: CheckContext): void
{
	if (asArray(callDb(db, "getPacket", context), context).length > context.numbers.packetMaxRows)
		throw context.refusal();
}

/** Upstream `ce`. */
function checkBlock(db: unknown, context: CheckContext): void
{
	const numbers = context.numbers;
	const entries = asArray(callDb(db, "getBlocksFlat", context), context).length;
	const arrows = asArray(callDb(db, "getEdges", context), context).length;
	if (entries > numbers.blockMaxEntries || arrows > numbers.blockMaxArrows) throw context.refusal();
	const stack: [unknown, number][] = [[callDb(db, "getBlock", context, "root"), -1]];
	for (let visited = 1; ; visited += 1)
	{
		const next = stack.pop();
		if (next === undefined) return;
		const [block, depth] = next;
		if (!isObject(block)) throw context.unreadable();
		if (depth > numbers.blockMaxDepth || visited > numbers.blockMaxEntries) throw context.refusal();
		if (block["children"] !== undefined)
			for (const child of asArray(block["children"], context)) stack.push([child, depth + 1]);
	}
}

/** Upstream `le`. */
function checkTreemap(db: unknown, context: CheckContext): void
{
	let longNameChars = 0;
	for (const node of asArray(callDb(db, "getNodes", context), context))
	{
		const name = isObject(node) && Array.isArray(node["children"]) ? node["name"] : "";
		if (typeof name === "string" && name.length > context.numbers.treemapLongName) longNameChars += name.length;
	}
	if (longNameChars > context.numbers.treemapMaxLongNameChars) throw context.refusal();
}

/** Upstream `ue`: a gantt's date format, and a clock on the work its excluded days cost. */
function checkGantt(db: unknown, context: CheckContext): void
{
	const numbers = context.numbers;
	const dateFormat = callDb(db, "getDateFormat", context);
	if (typeof dateFormat !== "string") throw context.unreadable();
	if (dateFormat.length > numbers.ganttMaxDateFormat) throw context.refusal();
	const includes = asArray(callDb(db, "getIncludes", context), context);
	if (callDb(db, "getIncludes", context) !== includes) throw context.unreadable();
	if (asArray(callDb(db, "getExcludes", context), context).length === 0) return;
	let calls = 0;
	let startedAt: number | undefined;
	Object.defineProperty(
		includes,
		"includes",
		{
			configurable: true,
			enumerable: false,
			value: (searchElement: unknown, fromIndex?: number) =>
			{
				calls += 1;
				startedAt ??= context.now();
				if (calls > numbers.ganttRefuseCalls) throw context.refusal();
				let report = calls > numbers.ganttReportCalls;
				if (calls % numbers.ganttClockEvery === 0)
				{
					const elapsed = context.now() - startedAt;
					if (elapsed > numbers.ganttRefuseMs)
						throw context.refusal(
							{
								overReportCount: report,
							},
						);
					report ||= elapsed > numbers.ganttReportMs;
				}
				if (report) context.seen.overLimit = "gantt";
				return Array.prototype.includes.call(includes, searchElement, fromIndex);
			},
		},
	);
	context.seen.cleanup = () =>
	{
		Reflect.deleteProperty(includes, "includes");
	};
}

/** Upstream `de`. */
function checkC4(db: unknown, context: CheckContext): void
{
	const boundaries = asArray(callDb(db, "getBoundaries", context), context);
	const children = new Map<string, string[]>();
	const aliases = new Set<string>();
	for (const boundary of boundaries)
	{
		const alias = isObject(boundary) ? boundary["alias"] : undefined;
		const parent = isObject(boundary) ? boundary["parentBoundary"] : undefined;
		if (typeof alias !== "string" || typeof parent !== "string") throw context.unreadable();
		if (aliases.has(alias)) throw context.refusal();
		aliases.add(alias);
		const siblings = children.get(parent);
		if (siblings) siblings.push(alias);
		else children.set(parent, [alias]);
	}
	const stack = [...(children.get("") ?? [])];
	for (let visited = 0; stack.length > 0; visited += 1)
	{
		if (visited + stack.length > boundaries.length) throw context.refusal();
		const alias = stack.pop();
		if (alias !== undefined) stack.push(...(children.get(alias) ?? []));
	}
}

/** Upstream `M`. */
function timelineCost(text: unknown, context: CheckContext): number
{
	if (typeof text !== "string") throw context.refusal();
	return context.numbers.timelineWrap + text.split(/(\s+|<br>)/).length * text.length;
}

/** Upstream `fe`. */
function checkTimeline(db: unknown, context: CheckContext): void
{
	const sections = asArray(callDb(db, "getSections", context), context);
	const tasks = asArray(callDb(db, "getTasks", context), context);
	const taskCount = tasks.length;
	if (callDb(db, "getTasks", context) !== tasks || 2 * taskCount < tasks.length) throw context.refusal();
	const ownTasks = tasks.slice(0, taskCount);
	tasks.length = 2 * taskCount - tasks.length;
	const sectionCounts = new Map<unknown, number>();
	let cost = 0;
	for (const section of sections)
	{
		cost += 2 * timelineCost(section, context);
		sectionCounts.set(section, (sectionCounts.get(section) ?? 0) + 1);
	}
	for (const task of ownTasks)
	{
		const {section, task: name, events} = isObject(task) ? task : ({} as Obj);
		const eventCost = asArray(events, context).reduce<number>(
			(sum, event) => sum + timelineCost(event, context),
			0,
		);
		const copies = sections.length > 0 ? (sectionCounts.get(section) ?? 0) : 1;
		cost += context.numbers.timelineWrap + eventCost + copies * (timelineCost(name, context) + eventCost);
	}
	if (cost > context.numbers.timelineRefuseCount) throw context.refusal();
	if (cost > context.numbers.timelineReportCount) context.seen.overLimit = "timeline";
}

/** Upstream `pe`. */
function checkKanban(db: unknown, context: CheckContext): void
{
	const sectionIds = new Map<string, number>();
	for (const section of asArray(callDb(db, "getSections", context), context))
	{
		const id = isObject(section) ? section["id"] : undefined;
		if (typeof id !== "string") throw context.refusal();
		const count = (sectionIds.get(id) ?? 0) + 1;
		if (count > context.numbers.kanbanMaxSectionsOfOneId) throw context.refusal();
		sectionIds.set(id, count);
	}
	const data = callDb(db, "getData", context);
	const config = isObject(data) && isObject(data["config"]) ? data["config"] : {};
	const sectionWidth = isObject(config["kanban"]) ? config["kanban"]["sectionWidth"] : undefined;
	if (
		sectionWidth &&
		!(
			Number(sectionWidth) >= context.numbers.kanbanMinSectionWidth &&
			Number(sectionWidth) <= context.numbers.kanbanMaxSectionWidth
		)
	)
		throw context.refusal();
	const nodes = asArray(isObject(data) ? data["nodes"] : undefined, context);
	if (nodes.some((node) => isObject(node) && node["look"] === "handDrawn")) throw context.refusal();
	const items = new Map<unknown, number>();
	for (const node of nodes)
	{
		if (!isObject(node)) throw context.refusal();
		if (!node["isGroup"]) items.set(node["parentId"], (items.get(node["parentId"]) ?? 0) + 1);
	}
	let count = 0;
	for (const node of nodes) if (isObject(node) && node["isGroup"]) count += 1 + (items.get(node["id"]) ?? 0);
	if (count > context.numbers.kanbanRefuseNodes) throw context.refusal();
	if (count > context.numbers.kanbanReportNodes) context.seen.overLimit = "kanban";
}

/** Upstream `me`. */
function checkXychart(db: unknown, context: CheckContext): void
{
	const data = callDb(db, "getXYChartData", context);
	const config = callDb(db, "getChartConfig", context);
	if (!isObject(data) || !isObject(config)) throw context.refusal();
	const {xAxis, plots} = data;
	const xAxisConfig = config["xAxis"];
	if (!isObject(xAxis) || !isObject(xAxisConfig)) throw context.refusal();
	const numbers = context.numbers;
	if (config["showDataLabel"])
	{
		const fits = ([key, value]: [string, unknown]) =>
		{
			const number = Number(value);
			return key === "labelRotation" || Number.isNaN(number) || (number >= 0 && number <= numbers.xychartMaxSide);
		};
		const reserved = Number(config["plotReservedSpacePercent"]);
		if (
			!Object.entries(config)
				.flatMap((entry) =>
					isObject(entry[1]) && !Array.isArray(entry[1]) ? Object.entries(entry[1]) : [entry],
				)
				.every(fits) ||
			!(reserved >= 0 && reserved <= 100)
		)
			throw context.refusal();
	}
	const categories = Array.isArray(xAxis["categories"]) ? (xAxis["categories"] as unknown[]) : [];
	let labelChars = 0;
	for (const category of categories)
	{
		if (typeof category !== "string") throw context.refusal();
		labelChars += category.length;
	}
	const rotation = Number(xAxisConfig["labelRotation"]);
	const rotated = rotation >= -90 && rotation <= 90 && rotation !== 0 && config["chartOrientation"] !== "horizontal";
	let points = 0;
	for (const plot of asArray(plots, context))
		points += asArray(isObject(plot) ? plot["data"] : undefined, context).length;
	const cost =
		(rotated ? 1 + 2 * categories.length : 1) * (labelChars + numbers.xychartLabel * categories.length) +
		numbers.xychartPoint * points;
	if (cost > numbers.xychartRefuseCount) throw context.refusal();
	if (cost > numbers.xychartReportCount) context.seen.overLimit = "xychart";
}

/** Upstream `he`. */
function checkVennConfig(db: unknown, context: CheckContext): void
{
	const numbers = context.numbers;
	const config = callDb(db, "getConfig", context);
	if (!isObject(config)) throw context.refusal();
	const {width, height, padding, ...rest} = config;
	const side = (value: unknown) => typeof value === "number" && value > 0 && value <= numbers.vennMaxSide;
	if (
		!side(width) ||
		!side(height) ||
		typeof padding !== "number" ||
		!(padding >= 0 && padding <= numbers.vennMaxPadding)
	)
		throw context.refusal();
	for (const value of Object.values(rest))
		if (!(typeof value === "boolean" || (typeof value === "number" && value >= 0 && value <= numbers.vennMaxSide)))
			throw context.refusal();
}

/** Upstream `ge`. */
function checkVenn(db: unknown, context: CheckContext): void
{
	const numbers = context.numbers;
	checkVennConfig(db, context);
	let single = 0;
	let names = 0;
	let sized = false;
	for (const subset of asArray(callDb(db, "getSubsetData", context), context))
	{
		const sets = asArray(isObject(subset) ? subset["sets"] : undefined, context);
		const size = isObject(subset) ? subset["size"] : undefined;
		if (
			sets.length === 0 ||
			new Set(sets).size !== sets.length ||
			typeof size !== "number" ||
			!(size >= numbers.vennMinSize && size <= numbers.vennMaxSize)
		)
			throw context.refusal();
		sized ||= size !== 10 / sets.length ** 2;
		if (sets.length === 1) single += 1;
		else names += sets.length;
	}
	const refuseSets = sized ? numbers.vennSizedRefuseSets : numbers.vennRefuseSets;
	const refuseNames = sized ? numbers.vennSizedRefuseNames : numbers.vennRefuseNames;
	if (single > refuseSets || names > refuseNames) throw context.refusal();
	const reportSets = sized ? numbers.vennSizedReportSets : numbers.vennReportSets;
	const reportNames = sized ? numbers.vennSizedReportNames : numbers.vennReportNames;
	if (single > reportSets || names > reportNames) context.seen.overLimit = "venn";
}

/** Upstream `_e`. */
function checkGitgraph(db: unknown, context: CheckContext): void
{
	const commits = callDb(db, "getCommits", context);
	if (!(commits instanceof Map)) throw context.unreadable();
	let count = 0;
	for (const branch of asArray(callDb(db, "getBranchesAsObjArray", context), context))
	{
		const name = isObject(branch) ? branch["name"] : undefined;
		if (typeof name !== "string") throw context.refusal();
		count += name.split(/\\n|\n|<br\s*\/?>/gi).length;
	}
	commits.forEach((commit: unknown) =>
	{
		const {parents, tags} = isObject(commit) ? commit : ({} as Obj);
		count += Math.max(asArray(parents, context).length, 1) + asArray(tags, context).length;
	});
	if (count > context.numbers.gitgraphRefuseCount) throw context.refusal();
	if (count > context.numbers.gitgraphReportCount) context.seen.overLimit = "gitgraph";
}

/** Upstream `ve`. */
const CHECKS: Readonly<Record<CheckName, (db: unknown, context: CheckContext) => void>> =
{
	graph: checkGraph,
	mindmap: checkMindmap,
	gantt: checkGantt,
	packet: checkPacket,
	block: checkBlock,
	treemap: checkTreemap,
	c4: checkC4,
	timeline: checkTimeline,
	kanban: checkKanban,
	xychart: checkXychart,
	venn: checkVenn,
	gitgraph: checkGitgraph,
};

/** Upstream `N` (`mermaidMaxText`). */
export function mermaidMaxText(maxTextSize: unknown): number
{
	return typeof maxTextSize === "number" && maxTextSize < MERMAID_MAX_TEXT ? maxTextSize : MERMAID_MAX_TEXT;
}

/** Upstream `ye` (`checkMermaidLength`). */
export function checkMermaidLength(text: string, maxTextSize: unknown): void
{
	const max = mermaidMaxText(maxTextSize);
	if (text.length > max)
		throw mermaidRefusal(
			"MermaidRefusedLength",
			undefined,
			undefined,
			{
				max,
			},
		);
}

/** Upstream `be`. */
const DETECT_CHARS = 2e3;

/** Upstream `xe` (`detectedMermaidType`): the type mermaid detects in a text it failed to parse. */
export function detectedMermaidType(detect: (text: string) => unknown, text: string): string
{
	try
	{
		const type = detect(text.slice(0, DETECT_CHARS));
		return typeof type === "string" ? (Object.hasOwn(MERMAID_TYPES, type) ? type : "other") : "none";
	}
	catch
	{
		return "none";
	}
}

/** Upstream `Se` (`checkParsedDiagram`): the check the patched mermaid runs on each parsed diagram. */
export function checkParsedDiagram(
	diagram: unknown,
	seen: MermaidDrawSeen,
	now: Now,
	numbers: LimitNumbers = MERMAID_LIMIT_NUMBERS,
): void
{
	seen.ran = true;
	seen.enteredAt = now();
	const type = isObject(diagram) && typeof diagram["type"] === "string" ? diagram["type"] : "";
	if (!Object.hasOwn(MERMAID_TYPES, type))
	{
		seen.diagramType = "other";
		throw mermaidRefusal("MermaidRefusedType", "other");
	}
	seen.diagramType = type;
	if (MERMAID_TYPES_NOT_DRAWN.has(type)) throw mermaidRefusal("MermaidRefusedType", type);
	const text = isObject(diagram) ? diagram["text"] : undefined;
	if (typeof text !== "string")
		throw mermaidRefusal(
			"MermaidRefusedUnprepared",
			type,
			undefined,
			{
				unreadable: true,
			},
		);
	if (text.includes("@{") || (type === "sequence" && text.includes("$")))
		throw mermaidRefusal("MermaidRefusedUnprepared", type);
	const check = MERMAID_TYPES[type];
	if (check !== undefined)
		CHECKS[check](
			isObject(diagram) ? diagram["db"] : undefined,
			{
				seen,
				now,
				numbers,
				refusal: (byClock) => mermaidRefusal(REFUSAL_OF[check], type, byClock),
				unreadable: () =>
					mermaidRefusal(
						REFUSAL_OF[check],
						type,
						undefined,
						{
							unreadable: true,
						},
					),
			},
		);
	if (currentDraw)
	{
		currentDraw.charge = textCharge(seen, type, now, numbers);
		guardGlobal()?.drawing?.add(currentDraw.charge);
	}
}

/** Upstream `P`. */
const significantLines = (text: string) =>
	text
		.replace(/\r\n?/g, "\n")
		.split("\n")
		.map((line) => line.trim())
		.filter(Boolean)
		.join("\n");

/** Upstream `Ce` (`checkGitgraphText`): a gitGraph is drawn only from exactly the text written. */
export function checkGitgraphText(source: string, prepared: string, seen: MermaidDrawSeen): void
{
	if (
		seen.diagramType === "gitGraph" &&
		(source.includes("%%}%%") || significantLines(source) !== significantLines(prepared))
	)
		throw mermaidRefusal("MermaidRefusedAltered", seen.diagramType);
}

// ---- the text charge (upstream F, we, Te, Ee) ----

type Charge = (kind: string, text: unknown) => void;

/** Upstream `F`: the draw whose check is running, so its charge can be installed. */
let currentDraw:
	|
	  {
			charge?: Charge;
	  }
	| undefined;

const LINE_BREAK = /<br\s*\/?>/gi;

/** Upstream `Te`: the work one measured label costs, or undefined when it is not text. */
function textUnits(text: unknown, numbers: LimitNumbers): number | undefined
{
	if (!text) return 0;
	if (typeof text !== "string") return undefined;
	const lines = (text.match(LINE_BREAK)?.length ?? 0) + 1;
	return (
		numbers.textTextWeight *
		(lines + (lines * lines) / numbers.textLinesSquare + text.length / numbers.textCharsPerUnit)
	);
}

/** Upstream `Ee`: charges each label mermaid measures for this draw, refusing past `textRefuseUnits`. */
function textCharge(seen: MermaidDrawSeen, type: string, now: Now, numbers: LimitNumbers): Charge
{
	let units = 0;
	const refuse = (unreadable = false): never =>
	{
		throw storeRefusal(
			seen,
			mermaidRefusal(
				"MermaidRefusedText",
				type,
				undefined,
				{
					unreadable,
				},
			),
		);
	};
	return (kind, text) =>
	{
		if (seen.refusal) throw seen.refusal;
		const cost = kind === "text" ? textUnits(text, numbers) : undefined;
		if (cost === undefined) refuse(true);
		else
		{
			units += cost;
			if (units > numbers.textRefuseUnits) refuse();
			if (units > numbers.textReportUnits) seen.overLimit ??= "text";
			const meter = meters.get(seen);
			if (meter) checkClock(seen, meter, now(), numbers);
		}
	};
}

// ---- the measuring meter (upstream I, L, De, Oe, z, B, V, H, Ae, U) ----

interface TurnClock
{
	last: () => number;
	stop: () => void;
}

interface Meter
{
	startedAt: number;
	turns: TurnClock;
	measured: MeasuredDraw;
	takeOut?: (() => void) | undefined;
	frameAt?: number;
	forget?: () => void;
	due?: MeasureOver;
	lastCallEndAt?: number;
	page?: Document;
	wrapped?: [object, string, WrapKind][];
	wrappers?: WeakSet<object>;
}

/** Upstream `I`. */
const meters = new WeakMap<MermaidDrawSeen, Meter>();

/** Upstream `L`: keep a draw's first refusal, and take its frame out of the page. */
function storeRefusal(seen: MermaidDrawSeen, refusal: MermaidRefusal): MermaidRefusal
{
	seen.refusal ??= refusal;
	meters.get(seen)?.takeOut?.();
	return seen.refusal;
}

/** Upstream `De`: the last time the page got a turn (a frame, a 16ms timer, or a message while hidden). */
function turnClock(now: Now): TurnClock
{
	let last = now();
	let running = true;
	let timer: ReturnType<typeof setTimeout> | undefined;
	let frame: number | undefined;
	const channel = new MessageChannel();
	let posted = false;
	channel.port1.onmessage = () =>
	{
		posted = false;
	};
	const onVisibility = () =>
	{
		last = now();
	};
	const onFrame = () =>
	{
		last = now();
		frame = running ? requestAnimationFrame(onFrame) : undefined;
	};
	const onTimer = () =>
	{
		last = now();
		timer = running ? setTimeout(onTimer, 16) : undefined;
	};
	frame = requestAnimationFrame(onFrame);
	timer = setTimeout(onTimer, 16);
	document.addEventListener("visibilitychange", onVisibility);
	return {
		last: () =>
		{
			if (running && document.hidden && !posted)
			{
				posted = true;
				last = now();
				channel.port2.postMessage(0);
			}
			return last;
		},
		stop: () =>
		{
			running = false;
			clearTimeout(timer);
			if (frame !== undefined) cancelAnimationFrame(frame);
			document.removeEventListener("visibilitychange", onVisibility);
			channel.port1.close();
		},
	};
}

/** Upstream `Oe` (`startMermaidMeasuring`): starts the clock on a draw; returns its stop. */
export function startMermaidMeasuring(seen: MermaidDrawSeen, now: Now, turns: TurnClock = turnClock(now)): () => void
{
	const measured: MeasuredDraw =
	{
		calls: 0,
		spanMs: 0,
		taskMs: 0,
		hidden: document.hidden,
	};
	seen.measured = measured;
	meters.set(
		seen,
		{
			startedAt: now(),
			turns,
			measured,
		},
	);
	const onVisibility = () =>
	{
		measured.hidden ||= document.hidden;
	};
	document.addEventListener("visibilitychange", onVisibility);
	return () =>
	{
		turns.stop();
		document.removeEventListener("visibilitychange", onVisibility);
		meters.get(seen)?.forget?.();
	};
}

/** Upstream `R`. */
const typeSeen = (seen: MermaidDrawSeen) => (seen.ran ? seen.diagramType : undefined);

/** Upstream `z`: when the last draw settled. */
let lastSettledAt = -Infinity;

/** Upstream `ke` (`noteMermaidRenderSettled`). */
export function noteMermaidRenderSettled(now: Now): void
{
	lastSettledAt = now();
}

/** Upstream `B`: how long the page has gone without a turn while this draw ran. */
const busyFor = (meter: Meter, at: number) =>
	at - Math.max(meter.turns.last(), meter.startedAt, Math.min(lastSettledAt, meter.frameAt ?? lastSettledAt));

/** Upstream `V`. */
function clockRefusal(seen: MermaidDrawSeen, measured: MeasuredDraw, numbers: LimitNumbers): MermaidRefusal
{
	measured.hidden ||= document.hidden;
	const refusal = mermaidRefusal(
		"MermaidRefusedMeasure",
		typeSeen(seen),
		{
			overReportCount: measured.calls > numbers.measureReportCalls,
		},
		{
			hidden: measured.hidden,
			ms: numbers.measureRefuseMs,
		},
	);
	refusal.measured = measured;
	return storeRefusal(seen, refusal);
}

/** Upstream `H`. */
function checkClock(seen: MermaidDrawSeen, meter: Meter, at: number, numbers: LimitNumbers): void
{
	const {measured} = meter;
	const busy = busyFor(meter, at);
	if (busy > measured.taskMs) measured.taskMs = busy;
	if (busy > numbers.measureRefuseMs)
	{
		meter.due = "time";
		throw clockRefusal(seen, measured, numbers);
	}
	if (busy > numbers.measureReportMs) seen.overLimit ??= "measure";
}

/** Upstream `Ae` (`mermaidRefusalDue`): the refusal a draw has earned, if any. */
export function mermaidRefusalDue(
	seen: MermaidDrawSeen,
	numbers: LimitNumbers = MERMAID_LIMIT_NUMBERS,
): MermaidRefusal | undefined
{
	const meter = meters.get(seen);
	if (seen.refusal || !meter?.due) return seen.refusal;
	return meter.due === "time"
		? clockRefusal(seen, meter.measured, numbers)
		: overRefusal(seen, meter.measured, meter.due);
}

/** Upstream `U`. */
function overRefusal(seen: MermaidDrawSeen, measured: MeasuredDraw, over: MeasureOver): MermaidRefusal
{
	const refusal = mermaidRefusal(
		"MermaidRefusedMeasure",
		typeSeen(seen),
		undefined,
		{
			over,
		},
	);
	refusal.over = over;
	refusal.measured = measured;
	return storeRefusal(seen, refusal);
}

// ---- counting the text put into the frame (upstream W, Me, Ne, Pe, Fe, G, K, q, Ie, Le, Re) ----

const isElement = (node: unknown): node is Element => isObject(node) && node["nodeType"] === 1;
const isDocument = (node: unknown): node is Document => isObject(node) && node["nodeType"] === 9;
const isNode = (node: unknown): node is Node => isObject(node) && typeof node["nodeType"] === "number";

type WrapKind = "method" | "setter";
type Wrapper = (original: (...args: unknown[]) => unknown) => (...args: unknown[]) => unknown;
type Wrap = (target: object, key: string, kind: WrapKind, wrapper: Wrapper) => boolean;

/** Upstream `Ne`: the members that put text into a node, wrapped to see where it went. */
const TEXT_WRITERS: [keyof typeof PROBES, string[], WrapKind][] = [
	[
		"element",
		[
			"append",
			"prepend",
			"before",
			"after",
			"replaceWith",
			"replaceChildren",
			"insertAdjacentHTML",
			"insertAdjacentElement",
			"insertAdjacentText",
			"setHTMLUnsafe",
			"setHTML",
		],
		"method",
	],
	["element", ["innerHTML", "outerHTML"], "setter"],
	["text node", ["before", "after", "replaceWith", "splitText"], "method"],
];
/** Upstream `Pe`. */
const INSERTERS = ["appendChild", "insertBefore", "replaceChild", "moveBefore"];
/** Upstream `Fe`. */
const TEXT_CHILDREN: ReadonlySet<string> = new Set(["tspan", "a", "textPath", "tref", "altGlyph"]);
const PROBES =
{
	element: true,
	"text node": true,
};

/** Upstream `G`: the layout work of a `<text>` whose `changed` nodes (or all of it) were written. */
function textWork(text: Node, changed: ReadonlySet<Node> | "whole", numbers: LimitNumbers): number
{
	let chars = 0;
	let elements = 0;
	let work = 0;
	let writes = 0;
	const walk = (node: Node, inChanged: boolean) =>
	{
		for (let child = node.firstChild; child; child = child.nextSibling)
		{
			const written = inChanged || (changed !== "whole" && changed.has(child));
			if (child.nodeType === 3)
			{
				if (written)
				{
					work += chars + numbers.measureTspanChars * elements;
					writes += 1;
				}
				chars += child.textContent?.length ?? 0;
			}
			else if (isElement(child))
			{
				work += written ? elements : 0;
				elements += 1;
				walk(child, written);
			}
		}
	};
	walk(text, changed === "whole");
	const whole = chars + numbers.measureTspanChars * elements;
	return (work * (numbers.measureAfterPart - 1) + writes * whole) / numbers.measureAfterPart;
}

/** Upstream `q`. */
const textOf = (node: unknown): Element | null =>
	isElement(node)
		? node.closest("text")
		: isObject(node) && isElement(node["parentElement"])
			? node["parentElement"].closest("text")
			: null;
/** Upstream `Ie`. */
const textAncestor = (node: unknown): Element | null =>
	isElement(node)
		? node.localName === "text"
			? node
			: TEXT_CHILDREN.has(node.localName)
				? node.closest("text")
				: null
		: null;

/** Upstream `Le`: the object on `start`'s prototype chain that owns `key`. */
function ownerOf(start: object, key: string): object | undefined
{
	for (let at: object | null = start; at !== null; at = Reflect.getPrototypeOf(at))
		if (Object.hasOwn(at, key)) return at;
	return undefined;
}

interface TextCounter
{
	size: () => number;
	forget: () => void;
	sees: () => boolean;
}

/** Upstream `Re`: wraps the frame's text writers and counts the layout work of what they put into `<text>`. */
function textCounter(doc: Document, numbers: LimitNumbers, wrap: Wrap): TextCounter
{
	const changed = new Set<Node>();
	const rewritten = new Set<Element>();
	const inserted = new Set<Element>();
	let wrappedAppend: unknown;
	const noteForeign = (node: unknown, text: Element | null) =>
	{
		if (!isElement(node) || Reflect.get(node, "appendChild") === wrappedAppend) return;
		for (const found of [text, node.localName === "text" ? node : null, ...node.getElementsByTagName("text")])
			if (found) inserted.add(found);
	};
	const noteInsert = (parent: unknown, node: unknown) =>
	{
		const text = textAncestor(parent);
		if (text?.isConnected && isNode(node)) changed.add(node);
		noteForeign(node, text);
	};
	const nodesOf = (node: unknown) => (isNode(node) && node.nodeType === 11 ? Array.from(node.childNodes) : [node]);
	const inserter: Wrapper = (original) =>
		function (this: unknown, ...args: unknown[])
		{
			const nodes = nodesOf(args[0]);
			const result = Reflect.apply(original, this, args);
			for (const node of nodes) noteInsert(this, node);
			return result;
		};
	const textSetter: Wrapper = (original) =>
		function (this: unknown, ...args: unknown[])
		{
			const result = Reflect.apply(original, this, args);
			if (isNode(this) && this.firstChild && textAncestor(this)?.isConnected) changed.add(this.firstChild);
			return result;
		};
	const writer: Wrapper = (original) =>
		function (this: unknown, ...args: unknown[])
		{
			const before = textOf(this);
			try
			{
				return Reflect.apply(original, this, args);
			}
			finally
			{
				const after = textOf(this);
				for (const text of [before, after]) if (text?.isConnected) rewritten.add(text);
				for (const arg of args) noteForeign(arg, after);
			}
		};
	const probes: Record<keyof typeof PROBES, Node> =
	{
		element: doc.createElementNS(SVG_NS, "text"),
		"text node": doc.createTextNode(""),
	};
	const wrapOn = (probe: keyof typeof PROBES, key: string, kind: WrapKind, wrapper: Wrapper, required = false) =>
	{
		const owner = ownerOf(probes[probe], key);
		return owner === undefined ? !required : wrap(owner, key, kind, wrapper);
	};
	if (
		!(
			INSERTERS.every((key, index) =>
				wrapOn(
					"element",
					key,
					"method",
					(original) =>
					{
						const wrapped = inserter(original);
						wrappedAppend = key === "appendChild" ? wrapped : wrappedAppend;
						return wrapped;
					},
					index < 2,
				),
			) &&
			wrapOn("element", "textContent", "setter", textSetter, true) &&
			TEXT_WRITERS.every(([probe, keys, kind]) => keys.every((key) => wrapOn(probe, key, kind, writer)))
		)
	)
		throw new TypeError("a call that puts something into the frame's text could not be wrapped");
	const size = () =>
	{
		if (changed.size === 0 && rewritten.size === 0 && inserted.size === 0) return 0;
		let work = 0;
		const counted = new Set<Element>();
		for (const node of changed)
		{
			const parent = node.parentNode;
			const text = node.isConnected
				? isElement(parent) && parent.localName === "text"
					? parent
					: textOf(parent)
				: null;
			if (text && !counted.has(text))
			{
				counted.add(text);
				if (!rewritten.has(text) && !inserted.has(text)) work += textWork(text, changed, numbers);
			}
		}
		for (const text of rewritten) if (text.isConnected) work += textWork(text, "whole", numbers);
		for (const text of inserted)
			if (text.isConnected && !rewritten.has(text)) work += textWork(text, "whole", numbers);
		changed.clear();
		rewritten.clear();
		return work;
	};
	const forget = () =>
	{
		changed.clear();
		rewritten.clear();
	};
	return {
		size,
		forget,
		sees: () =>
		{
			const text = doc.createElementNS(SVG_NS, "text");
			const first = doc.createElementNS(SVG_NS, "tspan");
			const second = doc.createElementNS(SVG_NS, "tspan");
			// oxlint-disable-next-line typescript/no-unnecessary-condition -- upstream allows a frame document without a body
			(doc.body ?? doc.documentElement).appendChild(text);
			text.appendChild(first);
			text.insertBefore(second, first);
			first.textContent = "x";
			const seen =
				changed.has(first) && changed.has(second) && first.firstChild !== null && changed.has(first.firstChild);
			text.remove();
			forget();
			return seen;
		},
	};
}

/** Upstream `ze`: a measuring method that counts, times and limits each call. */
function meteredCall(
	original: (...args: unknown[]) => unknown,
	seen: MermaidDrawSeen,
	meter: Meter,
	now: Now,
	numbers: LimitNumbers,
	size: () => number,
): (...args: unknown[]) => unknown
{
	const {measured} = meter;
	return function (this: unknown, ...args: unknown[])
	{
		const due = meter.due ? mermaidRefusalDue(seen, numbers) : seen.refusal;
		if (due) throw due;
		const startedAt = now();
		measured.calls += 1;
		measured.firstCallMs ??= startedAt - meter.startedAt;
		if (meter.lastCallEndAt !== undefined)
			measured.spanMs += Math.min(startedAt - meter.lastCallEndAt, numbers.measureGapMs);
		if (measured.calls > numbers.measureRefuseCalls)
		{
			meter.due = "calls";
			throw overRefusal(seen, measured, "calls");
		}
		if (size() > numbers.measureRefuseSize)
		{
			meter.due = "size";
			throw overRefusal(seen, measured, "size");
		}
		if (measured.calls > numbers.measureReportCalls) seen.overLimit ??= "measure";
		checkClock(seen, meter, startedAt, numbers);
		let result: unknown;
		try
		{
			result = Reflect.apply(original, this, args);
		}
		catch (error)
		{
			if (busyFor(meter, now()) > numbers.measureRefuseMs) meter.due ??= "time";
			throw error;
		}
		finally
		{
			meter.lastCallEndAt = now();
			measured.spanMs += meter.lastCallEndAt - startedAt;
		}
		checkClock(seen, meter, meter.lastCallEndAt, numbers);
		return result;
	};
}

const SVG_NS = "http://www.w3.org/2000/svg";
/** Upstream `Be`: the measuring methods mermaid calls, and the elements that must answer to the wrapped ones. */
const MEASURERS: [string, string[], "if there"?][] = [
	["getBBox", ["text", "tspan", "g", "svg", "path"]],
	["getBoundingClientRect", ["text", "tspan", "g", "svg", "path"]],
	["getComputedTextLength", ["text", "tspan"]],
	["getTotalLength", ["path"], "if there"],
	["getPointAtLength", ["path"], "if there"],
];

/** Upstream `Ve`: the prototype of `element` that owns the method `key`. */
function methodOwner(element: object, key: string): Obj | undefined
{
	for (let at: unknown = Object.getPrototypeOf(element); isObject(at); at = Object.getPrototypeOf(at))
		if (Object.hasOwn(at, key)) return typeof at[key] === "function" ? at : undefined;
	return undefined;
}

/** Upstream `Y`. */
function meterLost(seen: MermaidDrawSeen, why: string): MermaidRefusal
{
	return storeRefusal(
		seen,
		mermaidRefusal(
			"MermaidRefusedMeasure",
			typeSeen(seen),
			undefined,
			{
				unreadable: true,
				why,
			},
		),
	);
}

/**
 * Upstream `He` (`meterMermaidFrame`): wraps the measuring methods and text writers of mermaid's sandbox frame,
 * so each call is counted and timed against the limits. Throws (and takes the frame out) when it cannot.
 */
export function meterMermaidFrame(
	frameWindow: unknown,
	seen: MermaidDrawSeen,
	now: Now,
	numbers: LimitNumbers = MERMAID_LIMIT_NUMBERS,
	takeOut?: () => void,
): void
{
	const meter = meters.get(seen);
	const doc = isObject(frameWindow) ? frameWindow["document"] : undefined;
	if (!meter) throw meterLost(seen, "no measuring was started for the drawing");
	meter.takeOut = takeOut;
	meter.frameAt = now();
	if (!isObject(frameWindow) || !isDocument(doc)) throw meterLost(seen, "the frame has no window or no document");
	const wrappers = new WeakSet<object>();
	const wrapped: [object, string, WrapKind][] = [];
	const wrap: Wrap = (target, key, kind, wrapper) =>
	{
		const descriptor = isObject(target) ? Reflect.getOwnPropertyDescriptor(target, key) : undefined;
		const original: unknown = kind === "setter" ? descriptor?.set : descriptor?.value;
		if (!isObject(target) || !descriptor || !isFunction(original)) return false;
		const replacement = wrapper(original);
		const done = Reflect.defineProperty(
			target,
			key,
			kind === "setter"
				?
					{
						...descriptor,
						set: replacement,
					}
				:
					{
						...descriptor,
						value: replacement,
					},
		);
		if (done)
		{
			wrappers.add(replacement);
			wrapped.push([target, key, kind]);
		}
		return done;
	};
	let counter: TextCounter;
	try
	{
		counter = textCounter(doc, numbers, wrap);
	}
	catch
	{
		throw meterLost(seen, "what is put into the frame's text could not be counted");
	}
	const size = counter.size;
	meter.forget = counter.forget;
	for (const [key, tags, optional] of MEASURERS)
	{
		const probes = tags.map((tag) => doc.createElementNS(SVG_NS, tag));
		if (optional === "if there" && probes.every((probe) => !isObject(probe) || !methodOwner(probe, key))) continue;
		for (const probe of probes)
		{
			const owner = isObject(probe) ? methodOwner(probe, key) : undefined;
			const original = owner?.[key];
			if (!owner || !isFunction(original)) throw meterLost(seen, `the frame's elements have no ${key}`);
			if (!wrappers.has(original))
			{
				const replacement = meteredCall(original, seen, meter, now, numbers, size);
				wrappers.add(replacement);
				const enumerable = Reflect.getOwnPropertyDescriptor(owner, key)?.enumerable ?? false;
				if (
					!Reflect.defineProperty(
						owner,
						key,
						{
							value: replacement,
							writable: true,
							configurable: true,
							enumerable,
						},
					)
				)
					throw meterLost(seen, `${key} could not be wrapped`);
				wrapped.push([owner, key, "method"]);
			}
		}
		if (
			probes.some((probe) =>
			{
				const method = isObject(probe) ? Reflect.get(probe, key) : undefined;
				return typeof method !== "function" || !wrappers.has(method);
			})
		)
			throw meterLost(seen, `an element does not answer to the wrapped ${key}`);
	}
	if (!counter.sees()) throw meterLost(seen, "what is put into a text element of the frame is not seen");
	meter.page = doc;
	meter.wrapped = wrapped;
	meter.wrappers = wrappers;
}

/** Upstream `Ue`: types whose drawing always measures text inside the frame. */
const MEASURING_TYPES: ReadonlySet<string> = new Set([
	"flowchart-v2",
	"swimlane",
	"classDiagram",
	"stateDiagram",
	"er",
	"requirement",
	"mindmap",
	"block",
	"gitGraph",
]);

/** Upstream `We`: a fresh `<text>` of the page still answers to the wrapped measurers. */
function stillWrapped(page: Document, meter: Meter): boolean
{
	const prototype: unknown = Object.getPrototypeOf(page);
	const create: unknown = isObject(prototype) ? Reflect.get(prototype, "createElementNS") : undefined;
	if (typeof create !== "function") return false;
	const text: unknown = Reflect.apply(create, page, [SVG_NS, "text"]);
	return MEASURERS.every(([key, tags]) =>
	{
		const method = isObject(text) ? text[key] : undefined;
		return !tags.includes("text") || (typeof method === "function" && meter.wrappers?.has(method) === true);
	});
}

/** Upstream `Ge` (`mermaidMeterLost`): the refusal when the meter is no longer in force on the drawing frame. */
export function mermaidMeterLost(seen: MermaidDrawSeen, frame: unknown, final: boolean): MermaidRefusal | undefined
{
	const meter = meters.get(seen);
	if (!meter?.page) return meterLost(seen, "no frame was metered for the drawing");
	const doc = isObject(frame) ? frame["contentDocument"] : undefined;
	if (doc !== meter.page && !(final && !isObject(doc)))
		return meterLost(
			seen,
			final
				? "the frame's document was replaced during the drawing"
				: "mermaid was not drawing in the metered document when the diagram was parsed",
		);
	const intact =
		meter.wrapped?.every(([target, key, kind]) =>
		{
			const method: unknown =
				kind === "setter" ? Reflect.getOwnPropertyDescriptor(target, key)?.set : Reflect.get(target, key);
			return typeof method === "function" && meter.wrappers?.has(method);
		}) ?? false;
	if (!intact || !stillWrapped(meter.page, meter))
		return meterLost(seen, "a wrapped method of the frame was replaced");
	if (final && meter.measured.calls === 0 && !seen.empty && MEASURING_TYPES.has(seen.diagramType))
		return meterLost(seen, "a diagram of a type that always measures its text made no measuring call in the frame");
	return undefined;
}

// ---- the hook the patched mermaid calls (upstream Ke, X, Z, Q, qe, Je, Ye, Xe) ----

interface GuardGlobal
{
	pending: Map<string, (diagram: unknown) => void>;
	count: number;
	parsed: (diagram: unknown, id: string) => void;
	drawing?: Set<Charge>;
	fit?: Charge;
}

/** Upstream `Ke`. */
const isGuardGlobal = (value: unknown): value is GuardGlobal =>
	isObject(value) &&
	value["pending"] instanceof Map &&
	typeof value["count"] === "number" &&
	typeof value["parsed"] === "function";

/** Upstream `X`: `globalThis.__antMermaidGuard`, installed on first use. */
function guardGlobal(): GuardGlobal | undefined
{
	if (!Object.hasOwn(globalThis, "__antMermaidGuard"))
	{
		const pending = new Map<string, (diagram: unknown) => void>();
		Object.defineProperty(
			globalThis,
			"__antMermaidGuard",
			{
				configurable: true,
				enumerable: false,
				writable: true,
				value:
				{
					pending,
					count: 0,
					parsed: (diagram: unknown, id: string) => pending.get(id)?.(diagram),
				},
			},
		);
	}
	const guard: unknown = Reflect.get(globalThis, "__antMermaidGuard");
	if (!isGuardGlobal(guard)) return undefined;
	const drawing = guard.drawing instanceof Set ? guard.drawing : new Set<Charge>();
	guard.drawing = drawing;
	if (typeof guard.fit !== "function")
		guard.fit = (kind, text) =>
		{
			for (const charge of drawing) charge(kind, text);
		};
	return guard;
}

/** Upstream `Z`: mermaid drew without calling the hook once, so it lacks the patch. */
let hookMissing = false;
/** Upstream `Q`. */
const drawnTypes = new Set<string>();

/** Upstream `qe` (`noteMermaidHookMissing`). */
export function noteMermaidHookMissing(): void
{
	hookMissing = true;
}

/** Upstream `Je`. */
const randomHex = () =>
	Array.from(crypto.getRandomValues(new Uint32Array(2)), (part) => part.toString(16).padStart(8, "0")).join("");

export interface MermaidCheckHandle
{
	/** The render id to draw under, so the hook can find this check. */
	id: string;
	done: () => void;
}

/**
 * Upstream `Ye` (`registerMermaidCheck`): a fresh render id whose parsed diagram the patched mermaid hands to
 * `check`. Undefined once mermaid has shown it lacks the hook.
 */
export function registerMermaidCheck(
	scopeId: string,
	check: (diagram: unknown) => void,
): MermaidCheckHandle | undefined
{
	const guard = hookMissing ? undefined : guardGlobal();
	if (!guard) return undefined;
	guard.count += 1;
	const id = `${scopeId}-r${guard.count}-${randomHex()}`;
	if (guard.pending.has(id)) return undefined;
	const draw:
	{
		charge?: Charge;
	} = {};
	const run = (diagram: unknown) =>
	{
		currentDraw = draw;
		try
		{
			check(diagram);
		}
		finally
		{
			currentDraw = undefined;
		}
	};
	guard.pending.set(id, run);
	return {
		id,
		done: () =>
		{
			if (guard.pending.get(id) === run) guard.pending.delete(id);
			if (draw.charge) guard.drawing?.delete(draw.charge);
		},
	};
}

/** Upstream `Xe` (`closeMermaidDraw`). */
export function closeMermaidDraw(
	seen: MermaidDrawSeen,
	now: Now,
):
{
	drawMs: number;
	typeDrawnBefore: boolean;
}
{
	const typeDrawnBefore = drawnTypes.has(seen.diagramType);
	drawnTypes.add(seen.diagramType);
	return {
		drawMs: now() - (seen.enteredAt ?? now()),
		typeDrawnBefore,
	};
}

/** Upstream `Ze` (`_test`). */
export const _test =
{
	MERMAID_MAX_TEXT,
	MERMAID_LIMIT_NUMBERS,
	MERMAID_TYPES,
	MERMAID_TYPES_NOT_DRAWN,
	reset: (): void =>
	{
		lastSettledAt = -Infinity;
		hookMissing = false;
		drawnTypes.clear();
		guardGlobal()?.drawing?.clear();
	},
};
