import {EFFORT_LABELS, MODE_LABELS} from "./composer-state";
import {modelLabel} from "./launch-options";
import {mcpStatusSummary} from "./mcp-status-summary";
import {formatRelativeTimestamp} from "./timestamp-format";

/**
 * Upstream's `/status` "Session info" card model (c44e562e8 `uU`, local branch): three groups of
 * label/value rows, each value sanitized, and the plain-text report its Copy button writes (`QH`).
 * Rows with no local meaning (Desktop app, Host, cloud trust, sandbox) are not built.
 */

export type StatusRowId =
	| "claudeCode"
	| "model"
	| "permissions"
	| "outputStyle"
	| "started"
	| "sessionId"
	| "folder"
	| "extraFolders"
	| "mcp"
	| "dataFlow"
	| "account"
	| "organization";

export interface StatusRow
{
	id: StatusRowId;
	label: string;
	value: string;
	/** The untruncated value: the cell's `title` and what Copy writes. */
	fullValue?: string;
	hint?: string;
	copyable?: true;
}

export interface StatusGroup
{
	id: "session" | "environment" | "account";
	label: "Session" | "Environment" | "Account";
	rows: StatusRow[];
}

/** Everything the card reads; any of it may be unknown. */
export interface StatusSources
{
	cliVersion: string | null;
	modelId: string | null;
	/** The effort level id (`high`, `xhigh`, …). */
	effort: string | null;
	fastMode: boolean;
	permissionMode: string | null;
	outputStyle: string | null;
	/** When the session started, in ms. */
	createdAt: number | null;
	now: number;
	forked: boolean;
	sessionId: string | null;
	cwd: string | null;
	homePath: string | null;
	additionalDirectories: readonly string[];
	/** The session's MCP servers as `[name, status]`; null when unknown, which drops the row. */
	mcpStatuses: ReadonlyArray<readonly [string, string]> | null;
	/** The newest data-flow-incomplete record's codes; null drops the row. Local-only: upstream has no such row. */
	dataFlowIncompleteCodes: readonly number[] | null;
	email: string | null;
	planDetail: string | null;
	organizationName: string | null;
}

/** Upstream's "started within a minute" window (`lU`). */
const STARTED_NOW_MS = 60_000;

// eslint-disable-next-line no-control-regex -- replacing control characters is the point
const HIDDEN_RE = /[\u0000-\u001F\u007F-\u009F\u2028\u2029\p{Default_Ignorable_Code_Point}]/gu;

/** Upstream's `rE`: control and default-ignorable characters become spaces, whitespace runs collapse, ends trim. */
export function sanitizeStatusText(text: string): string
{
	return text
		.replace(HIDDEN_RE, " ")
		.replace(/\s{2,}/g, " ")
		.trim();
}

/** Upstream's `rU`: a path at or under home becomes `~…`. */
export function tildePath(path: string, home: string | null): string
{
	return home && (path === home || path.startsWith(`${home}/`)) ? `~${path.slice(home.length)}` : path;
}

/** Upstream's `Wp`: the catalog name, with a context-window suffix such as `[1m]` as "1M". */
function modelDisplayName(modelId: string): string
{
	const window = /\[([^\]]+)\]$/.exec(modelId)?.[1];
	const label = modelLabel(window === undefined ? modelId : modelId.slice(0, -window.length - 2));
	return window === undefined ? label : `${label} ${window.toUpperCase()}`;
}

function modelRow({modelId, effort, fastMode}: StatusSources): StatusRow | null
{
	if (!modelId) return null;
	const effortLabel = effort ? (EFFORT_LABELS[effort] ?? effort) : null;
	const effortPart = effortLabel && fastMode ? `${effortLabel} · Fast` : effortLabel;
	const join = (model: string) => [model, effortPart].filter(Boolean).join(" · ");
	return {
		id: "model",
		label: "Model",
		value: join(modelDisplayName(modelId)),
		fullValue: join(modelId),
	};
}

function startedRow({createdAt, now, forked}: StatusSources): StatusRow | null
{
	if (createdAt === null) return null;
	const who = forked ? "Forked" : "You";
	const iso = new Date(createdAt).toISOString();
	const when = createdAt > now - STARTED_NOW_MS ? "now" : (formatRelativeTimestamp(iso, now) ?? "now");
	return {
		id: "started",
		label: "Started",
		value: `${who} · ${when}`,
		fullValue: `${who} · ${iso}`,
	};
}

function sessionRows(sources: StatusSources): StatusRow[]
{
	const rows: (StatusRow | null)[] = [
		sources.cliVersion
			?
				{
					id: "claudeCode",
					label: "Claude Code",
					value: sources.cliVersion,
				}
			: null,
		modelRow(sources),
		sources.permissionMode
			?
				{
					id: "permissions",
					label: "Permissions",
					value: MODE_LABELS[sources.permissionMode] ?? sources.permissionMode,
				}
			: null,
		sources.outputStyle && sources.outputStyle !== "default"
			?
				{
					id: "outputStyle",
					label: "Output style",
					value: sources.outputStyle,
				}
			: null,
		startedRow(sources),
		sources.sessionId
			?
				{
					id: "sessionId",
					label: "Session ID",
					value: sources.sessionId,
					copyable: true,
				}
			: null,
	];
	return rows.filter((row) => row !== null);
}

function environmentRows({
	cwd,
	homePath,
	additionalDirectories,
	mcpStatuses,
	dataFlowIncompleteCodes,
}: StatusSources): StatusRow[]
{
	const rows: StatusRow[] = [];
	if (cwd)
		rows.push(
			{
				id: "folder",
				label: "Folder",
				value: tildePath(cwd, homePath),
				fullValue: cwd,
			},
		);
	if (additionalDirectories.length > 0)
		rows.push(
			{
				id: "extraFolders",
				label: "Additional folders",
				value: additionalDirectories.map((path) => tildePath(path, homePath)).join(", "),
				fullValue: additionalDirectories.join(", "),
			},
		);
	if (mcpStatuses !== null)
		rows.push(
			{
				id: "mcp",
				label: "MCP servers",
				value: mcpStatusSummary(mcpStatuses),
				fullValue: mcpStatusSummary(mcpStatuses, Infinity),
			},
		);
	if (dataFlowIncompleteCodes !== null)
		rows.push(
			{
				id: "dataFlow",
				label: "Data-flow ledger",
				value:
					dataFlowIncompleteCodes.length > 0
						? `Incomplete (codes ${dataFlowIncompleteCodes.join(", ")})`
						: "Incomplete",
			},
		);
	return rows;
}

function accountRows({email, planDetail, organizationName}: StatusSources): StatusRow[]
{
	const rows: StatusRow[] = [];
	if (email)
		rows.push(
			{
				id: "account",
				label: "Signed in as",
				value: planDetail ? `${email} · ${planDetail}` : email,
			},
		);
	if (organizationName)
		rows.push(
			{
				id: "organization",
				label: "Organization",
				value: organizationName,
			},
		);
	return rows;
}

/** Upstream's `ZH`: sanitizes a row's value, full value and hint. */
function sanitizeRow(row: StatusRow): StatusRow
{
	const sanitized: StatusRow =
	{
		...row,
		value: sanitizeStatusText(row.value),
	};
	if (row.fullValue !== undefined) sanitized.fullValue = sanitizeStatusText(row.fullValue);
	if (row.hint !== undefined) sanitized.hint = sanitizeStatusText(row.hint);
	return sanitized;
}

/** Upstream's `uU` groups: Session, Environment, Account, each dropped when it has no rows. */
export function sessionStatusGroups(sources: StatusSources): StatusGroup[]
{
	const groups: StatusGroup[] = [
		{
			id: "session",
			label: "Session",
			rows: sessionRows(sources).map(sanitizeRow),
		},
		{
			id: "environment",
			label: "Environment",
			rows: environmentRows(sources).map(sanitizeRow),
		},
		{
			id: "account",
			label: "Account",
			rows: accountRows(sources).map(sanitizeRow),
		},
	];
	return groups.filter((group) => group.rows.length > 0);
}

/** Upstream's `QH`: the Copy session info report, one `- label: value (hint)` line per row. */
export function sessionStatusReport(groups: readonly StatusGroup[], generatedAt: string): string
{
	const lines = [`Claude Code session info (${generatedAt})`];
	for (const group of groups)
	{
		if (group.rows.length === 0) continue;
		lines.push("", `${group.label}:`);
		for (const row of group.rows)
		{
			lines.push(`- ${row.label}: ${row.fullValue ?? row.value}${row.hint ? ` (${row.hint})` : ""}`);
		}
	}
	return lines.join("\n");
}
