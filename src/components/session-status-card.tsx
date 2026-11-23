import {useQuery} from "@tanstack/react-query";
import {useNavigate} from "@tanstack/react-router";
import {createContext, useContext, useState} from "react";

import {useTimedFlag} from "../hooks/use-timed-flag";
import {localAccountQueryOptions} from "../lib/api/local-account";
import {sessionStatusInfoQueryOptions} from "../lib/api/sessions";
import {writeClipboardText} from "../lib/clipboard";
import
{
	type StatusGroup,
	type StatusRow,
	type StatusSources,
	sessionStatusGroups,
	sessionStatusReport,
} from "../lib/session-status-card";
import {useDensity} from "./ui/density-context";
import {Icon} from "./ui/icon";
import {Tooltip} from "./ui/tooltip";

/** How long a copy button shows "Copied" with a check. */
const COPIED_MS = 1200;

/**
 * Upstream's ghost icon-only cds Button: step 2 (24px, `size:"base"`) or step 1 (20px, `size:"sm"`) in the
 * transcript's compact scope, both 28px when comfortable (`ma()`). Mouse down keeps focus where it was (`Zd`).
 */
export function GhostCopyButton({
	size,
	copied,
	label,
	onCopy,
}: {
	size: "base" | "sm";
	copied: boolean;
	label: string;
	onCopy: () => void;
})
{
	const comfortable = useDensity() === "comfortable";
	const box = comfortable ? "size-7" : size === "base" ? "size-6" : "size-5";
	const shown = copied ? "Copied" : label;
	return (
		<Tooltip content={shown} closeOnClick={false}>
			<button
				type="button"
				aria-label={shown}
				className={`inline-flex ${box} shrink-0 cursor-pointer items-center justify-center rounded-r5 text-ink-muted transition-colors hover:bg-fill-ghost-hover hover:text-primary hide-focus-ring focus-visible:outline-hidden focus-visible:shadow-focus`}
				onMouseDown={(event) =>
				{
					event.preventDefault();
				}}
				onClick={onCopy}
			>
				{size === "base" ? (
					<Icon name={copied ? "Check" : "Copy"} size="sm" />
				) : (
					<Icon name={copied ? "Check" : "Copy"} customSize={14} />
				)}
			</button>
		</Tooltip>
	);
}

/** Upstream's value class: the session id in mono (its inner span truncates), other full-valued rows but MCP servers truncated, the rest wrapping. */
function valueClass(row: StatusRow): string
{
	if (row.id === "sessionId") return "min-w-0 max-w-full font-mono-ui";
	return row.fullValue === undefined || row.id === "mcp"
		? "min-w-0 [overflow-wrap:anywhere]"
		: "min-w-0 max-w-full truncate";
}

/** Upstream's `SU` row: label left, value (and hint) right, a copy button on copyable rows, Manage after MCP servers. */
function StatusCardRow({
	row,
	copied,
	onCopy,
	onManageMcp,
}: {
	row: StatusRow;
	copied: boolean;
	onCopy: (row: StatusRow) => void;
	onManageMcp: (() => void) | undefined;
})
{
	return (
		<div className="flex items-baseline justify-between gap-3">
			<span className="text-muted-as-secondary shrink-0">{row.label}</span>
			<span className="min-w-0 flex items-center justify-end gap-1.5 text-end">
				<span className="min-w-0 flex flex-col items-end">
					<span className={valueClass(row)} title={row.fullValue ?? row.value}>
						{row.id === "sessionId" ? (
							<span className="block truncate [direction:rtl]">
								<bdi dir="ltr" className="[direction:inherit] [unicode-bidi:plaintext]">
									{row.value}
								</bdi>
							</span>
						) : (
							row.value
						)}
					</span>
					{row.hint && (
						<span className="max-w-full text-muted-as-secondary [overflow-wrap:anywhere]">{row.hint}</span>
					)}
				</span>
				{row.copyable && (
					<GhostCopyButton
						size="sm"
						copied={copied}
						label="Copy session ID"
						onCopy={() =>
						{
							onCopy(row);
						}}
					/>
				)}
				{row.id === "mcp" && onManageMcp !== undefined && (
					<span className="shrink-0 text-muted-as-secondary">
						<button
							type="button"
							data-cds="TextLink"
							className="cds-reset text-link-inherit"
							onClick={onManageMcp}
						>
							Manage
						</button>
					</span>
				)}
			</span>
		</div>
	);
}

/**
 * Upstream's `/status` "Session info" card (c44e562e8 `EU`): a header with Copy session info, then
 * each group's rows. With no groups yet it shows "Loading session info…" and no Copy button.
 */
export function SessionStatusCard({
	groups,
	onManageMcp,
}: {
	groups: readonly StatusGroup[];
	onManageMcp?: (() => void) | undefined;
})
{
	const [reportCopied, showReportCopied] = useTimedFlag(COPIED_MS);
	const [rowCopied, showRowCopied] = useTimedFlag(COPIED_MS);
	const [copiedRowId, setCopiedRowId] = useState<string | null>(null);
	const hasGroups = groups.length > 0;
	const copyReport = () =>
	{
		const report = sessionStatusReport(groups, new Date().toISOString());
		void writeClipboardText(report).then((ok) =>
		{
			if (ok) showReportCopied();
		});
	};
	const copyRow = (row: StatusRow) =>
	{
		setCopiedRowId(row.id);
		void writeClipboardText(row.fullValue ?? row.value).then((ok) =>
		{
			if (ok) showRowCopied();
		});
	};
	return (
		<div
			className="flex flex-col gap-md p-lg rounded-lg w-[360px] max-w-full card-ring"
			data-testid="epitaxy-status-card"
		>
			<span className="flex items-center justify-between text-footnote text-primary pb-xs min-h-[24px]">
				Session info
				{hasGroups && (
					<GhostCopyButton size="base" copied={reportCopied} label="Copy session info" onCopy={copyReport} />
				)}
			</span>
			{hasGroups ? (
				<div className="flex flex-col gap-lg">
					{groups.map((group) => (
						<div key={group.id} className="flex flex-col gap-1.5">
							<span className="text-footnote text-secondary font-medium">{group.label}</span>
							<div className="flex flex-col gap-1.5 text-footnote">
								{group.rows.map((row) => (
									<StatusCardRow
										key={row.id}
										row={row}
										copied={rowCopied && copiedRowId === row.id}
										onCopy={copyRow}
										onManageMcp={onManageMcp}
									/>
								))}
							</div>
						</div>
					))}
				</div>
			) : (
				<span className="text-footnote text-muted-as-secondary">Loading session info…</span>
			)}
		</div>
	);
}

/** The card's inputs the session page already holds live: the chin's model, effort and mode, and the statusline. */
type LiveStatusSources = Pick<
	StatusSources,
	"cliVersion" | "modelId" | "effort" | "fastMode" | "permissionMode" | "outputStyle"
>;

const LiveStatusSourcesContext = createContext<LiveStatusSources | null>(null);

/**
 * Hands the live sources to every card below it, so the transcript's card renderer can stay stable
 * (the transcript doesn't re-render when the chin or statusline moves; only the cards do).
 */
export const LiveStatusSourcesProvider = LiveStatusSourcesContext.Provider;

const NO_LIVE_SOURCES: LiveStatusSources =
{
	cliVersion: null,
	modelId: null,
	effort: null,
	fastMode: false,
	permissionMode: null,
	outputStyle: null,
};

/**
 * The transcript's Session info card. Like upstream's `TU` it rebuilds on every render, so a model,
 * effort or mode change shows in earlier cards too; the server inputs load while it is mounted.
 */
export function LiveSessionStatusCard({sessionId}: {sessionId: string})
{
	const live = useContext(LiveStatusSourcesContext) ?? NO_LIVE_SOURCES;
	const info = useQuery(sessionStatusInfoQueryOptions(sessionId));
	const account = useQuery(localAccountQueryOptions).data;
	const navigate = useNavigate();
	const groups =
		info.data === undefined && !info.isError
			? []
			: sessionStatusGroups(
					{
						...live,
						cliVersion: live.cliVersion ?? info.data?.cliVersion ?? null,
						createdAt: info.data?.createdAt ?? null,
						now: Date.now(),
						forked: info.data?.forked ?? false,
						sessionId,
						cwd: info.data?.cwd ?? null,
						homePath: info.data?.homePath ?? null,
						additionalDirectories: info.data?.additionalDirectories ?? [],
						mcpStatuses: info.data?.mcpStatuses ?? null,
						email: account?.email ?? null,
						planDetail: account?.planDetail ?? null,
						organizationName: account?.organizationName ?? null,
					},
				);
	return (
		<SessionStatusCard
			groups={groups}
			onManageMcp={() =>
				void navigate(
					{
						to: "/customize/connectors",
					},
				)
			}
		/>
	);
}
