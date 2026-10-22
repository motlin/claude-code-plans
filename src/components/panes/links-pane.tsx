import {useQuery} from "@tanstack/react-query";
import {ChevronDown, ChevronRight, Copy, ExternalLink, Search, SquareTerminal} from "lucide-react";
import {useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent} from "react";

import {sessionDevServersQueryOptions, sessionResourcesQueryOptions} from "../../lib/api/sessions";
import {writeClipboardText} from "../../lib/clipboard";
import {formatResourceCount, resourceCoverageNote} from "../../lib/session-resources";
import type {LinkEntry} from "../../lib/session-links";
import type {SessionLine} from "../../lib/transcript";
import {JumpChips} from "../jump-chips";
import {JumpTargetProvider, type JumpTargetWindow} from "../jump-target-context";
import {useSettings} from "../settings-context";
import {
	type SessionLinkDisplay,
	useExtractedSessionLinks,
	useGroupedSessionLinks,
	useIncludeToolsAndThinking,
	useSessionLinkDisplay,
} from "./session-link-display";

interface LinkRowProps {
	entry: LinkEntry;
	copied: boolean;
	onCopy: (url: string) => Promise<void>;
}

function LinkRow({entry, copied, onCopy}: LinkRowProps) {
	return (
		<li className="border-b border-subtle px-4 py-3 last:border-b-0">
			<div className="flex items-center gap-2">
				<span title={entry.url} className="min-w-0 flex-1 truncate text-xs text-secondary">
					{entry.label}
				</span>
				<a
					href={entry.url}
					target="_blank"
					rel="noopener noreferrer"
					aria-label={`Open ${entry.label} in a new tab`}
					title="Open in a new tab"
					className="flex size-7 shrink-0 items-center justify-center rounded text-t6 transition-colors hover:bg-fill-control hover:text-primary hide-focus-ring focus-visible:outline-hidden focus-visible:shadow-focus"
				>
					<ExternalLink className="size-3.5" aria-hidden="true" />
				</a>
				<button
					type="button"
					aria-label={`Copy ${entry.label}`}
					title={copied ? "Copied" : "Copy URL"}
					onClick={() => void onCopy(entry.url)}
					className="flex size-7 shrink-0 items-center justify-center rounded text-t6 transition-colors hover:bg-fill-control hover:text-primary hide-focus-ring focus-visible:outline-hidden focus-visible:shadow-focus"
				>
					<Copy className="size-3.5" aria-hidden="true" />
				</button>
			</div>
			<div className="mt-2">
				<JumpChips occurrences={entry.occurrences} resourceLabel="link" />
			</div>
		</li>
	);
}

interface DevServerLink {
	url: string;
	name?: string | undefined;
	live: boolean;
}

function DevServersSection({servers}: {servers: readonly DevServerLink[]}) {
	return (
		<section aria-labelledby="links-dev-servers">
			<h3
				id="links-dev-servers"
				className="flex items-center gap-2 border-b border-border px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-secondary"
			>
				<SquareTerminal className="size-3.5" aria-hidden="true" />
				<span className="min-w-0 flex-1 truncate">Dev servers</span>
				<span>{servers.length}</span>
			</h3>
			<ul>
				{servers.map((server) => {
					const host = server.url.replace(/^https?:\/\//, "");
					return (
						<li
							key={server.url}
							className="flex items-center gap-2 border-b border-subtle px-4 py-2 last:border-b-0"
						>
							<span
								role="img"
								aria-label={server.live ? "Running" : "Not responding"}
								title={server.live ? "Running" : "Not responding"}
								className={`size-2 shrink-0 rounded-full ${server.live ? "bg-success-100" : "bg-alpha-3"}`}
							/>
							<span title={server.url} className="min-w-0 flex-1 truncate text-xs text-secondary">
								{server.name === undefined ? host : `${server.name} · ${host}`}
							</span>
							<a
								href={server.url}
								target="_blank"
								rel="noopener noreferrer"
								aria-label={`Open dev server ${host} in a new tab`}
								className="flex shrink-0 items-center gap-1 rounded px-2 py-1 text-xs text-t6 transition-colors hover:bg-fill-control hover:text-primary hide-focus-ring focus-visible:outline-hidden focus-visible:shadow-focus"
							>
								Open dev server
								<ExternalLink className="size-3.5" aria-hidden="true" />
							</a>
						</li>
					);
				})}
			</ul>
		</section>
	);
}

interface LinksPaneViewProps {
	display: SessionLinkDisplay;
	/** Loopback dev servers the session declared or printed. */
	devServers?: readonly DevServerLink[];
	/** JSONL records before the loaded window, which extraction never saw. */
	unscannedRecordCount?: number;
	includeToolsAndThinking: boolean;
	onIncludeToolsAndThinkingChange: (include: boolean) => void;
}

const NO_DEV_SERVERS: readonly DevServerLink[] = [];

export function LinksPaneView({
	display,
	devServers = NO_DEV_SERVERS,
	unscannedRecordCount = 0,
	includeToolsAndThinking,
	onIncludeToolsAndThinkingChange,
}: LinksPaneViewProps) {
	const [filterText, setFilterText] = useState("");
	const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
	const [copiedUrl, setCopiedUrl] = useState<string | null>(null);
	const copiedTimeoutReference = useRef<number | undefined>(undefined);
	const query = filterText.trim().toLowerCase();

	const filteredGroups = useMemo(
		() =>
			query === ""
				? display.groups
				: display.groups.flatMap((group) => {
						const entries = group.entries.filter(
							(entry) =>
								entry.url.toLowerCase().includes(query) || entry.label.toLowerCase().includes(query),
						);
						return entries.length === 0 ? [] : [{...group, entries}];
					}),
		[display.groups, query],
	);

	useEffect(
		() => () => {
			if (copiedTimeoutReference.current !== undefined) {
				window.clearTimeout(copiedTimeoutReference.current);
			}
		},
		[],
	);

	const copyUrl = useCallback(async (url: string) => {
		setCopiedUrl(null);
		const succeeded = await writeClipboardText(url);
		if (!succeeded) return;

		setCopiedUrl(url);
		if (copiedTimeoutReference.current !== undefined) {
			window.clearTimeout(copiedTimeoutReference.current);
		}
		copiedTimeoutReference.current = window.setTimeout(() => {
			setCopiedUrl(null);
		}, 1_500);
	}, []);

	function toggleCategory(categoryId: string): void {
		setCollapsed((current) => {
			const next = new Set(current);
			if (next.has(categoryId)) next.delete(categoryId);
			else next.add(categoryId);
			return next;
		});
	}

	function handleFilterChange(event: ChangeEvent<HTMLInputElement>): void {
		setFilterText(event.target.value);
	}

	const emptyMessage =
		query === ""
			? includeToolsAndThinking
				? "No links in this session."
				: display.hiddenCount > 0
					? `No links in visible messages. Enable 'Include tools and thinking' to see ${display.hiddenCount} more.`
					: "No links in visible messages."
			: `No links match “${filterText}”.`;

	const coverageNote = resourceCoverageNote(unscannedRecordCount);

	return (
		<div className="flex min-h-0 flex-1 flex-col text-primary">
			<div className="flex shrink-0 items-center gap-3 border-b border-border px-4 py-2">
				<label className="flex min-w-0 flex-1 items-center gap-1.5 text-[11px] text-secondary">
					<input
						type="checkbox"
						checked={includeToolsAndThinking}
						onChange={(event) => {
							onIncludeToolsAndThinkingChange(event.target.checked);
						}}
						className="size-3.5 shrink-0 accent-accent-100"
					/>
					<span className="truncate">Include tools and thinking</span>
				</label>
				<span
					aria-label={
						coverageNote === undefined
							? `${display.totalCount} items`
							: `${display.totalCount} items in the loaded messages`
					}
					className="rounded-full bg-fill-control px-2 py-0.5 text-xs font-medium text-secondary"
				>
					{formatResourceCount(display.totalCount, unscannedRecordCount)}
				</span>
			</div>
			{coverageNote !== undefined && (
				<p
					role="note"
					className="shrink-0 border-b border-border bg-fill-ghost-hover px-4 py-2 text-[11px] text-t6"
				>
					{coverageNote}
				</p>
			)}

			<div role="region" aria-label="Links contents" className="min-h-0 flex-1 overflow-y-auto">
				<div className="sticky top-0 z-20 border-b border-border bg-surface-2 p-3">
					<label className="relative block">
						<span className="sr-only">Filter links</span>
						<Search
							className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-t6"
							aria-hidden="true"
						/>
						<input
							type="search"
							value={filterText}
							onChange={handleFilterChange}
							placeholder="Filter links"
							className="w-full rounded-md border border-strong bg-surface-1 py-2 pl-8 pr-3 text-xs text-primary outline-none placeholder:text-t6 focus:border-accent-100/60"
						/>
					</label>
				</div>

				{devServers.length > 0 && <DevServersSection servers={devServers} />}

				{filteredGroups.length === 0 ? (
					<p className="px-4 py-8 text-center text-xs text-t6">{emptyMessage}</p>
				) : (
					filteredGroups.map((group) => {
						const isCollapsed = query === "" && collapsed.has(group.categoryId);
						return (
							<section key={group.categoryId} aria-labelledby={`links-${group.categoryId}`}>
								<button
									type="button"
									id={`links-${group.categoryId}`}
									aria-expanded={!isCollapsed}
									onClick={() => {
										toggleCategory(group.categoryId);
									}}
									className="sticky top-[57px] z-10 flex w-full items-center gap-2 border-b border-border bg-surface-2 px-4 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-secondary hover:bg-fill-ghost-hover"
								>
									{isCollapsed ? (
										<ChevronRight className="size-3.5" aria-hidden="true" />
									) : (
										<ChevronDown className="size-3.5" aria-hidden="true" />
									)}
									<span className="min-w-0 flex-1 truncate">{group.label}</span>
									<span>{group.entries.length}</span>
								</button>
								{!isCollapsed && (
									<ul>
										{group.entries.map((entry) => (
											<LinkRow
												key={entry.url}
												entry={entry}
												copied={copiedUrl === entry.url}
												onCopy={copyUrl}
											/>
										))}
									</ul>
								)}
							</section>
						);
					})
				)}
			</div>
		</div>
	);
}

export interface LinksPaneProps {
	sessionId: string;
	/** The loaded transcript window, whose links stand in until the full-session scan lands. */
	lines: SessionLine[];
	/** JSONL records before the loaded window. */
	windowStartIndex: number;
	jumpTargetWindow: JumpTargetWindow;
}

export function LinksPane({sessionId, lines, windowStartIndex, jumpTargetWindow}: LinksPaneProps) {
	const {settings} = useSettings();
	const [currentHost, setCurrentHost] = useState<string | undefined>(undefined);
	useEffect(() => {
		setCurrentHost(window.location.hostname);
	}, []);
	const [includeToolsAndThinking, setIncludeToolsAndThinking] = useIncludeToolsAndThinking();
	// A whole-session inventory costs a full pass over the JSONL, and each dev
	// server fetch re-probes liveness, so only an open Links pane asks for them.
	const resources = useQuery(sessionResourcesQueryOptions(sessionId, true)).data;
	const devServers = useQuery(sessionDevServersQueryOptions(sessionId, true)).data?.servers;
	const windowLinks = useExtractedSessionLinks(lines, currentHost, settings.linkCategoryRules);
	const fullLinks = useGroupedSessionLinks(resources?.links, currentHost, settings.linkCategoryRules);
	const display = useSessionLinkDisplay(fullLinks ?? windowLinks, includeToolsAndThinking);

	return (
		<JumpTargetProvider value={jumpTargetWindow}>
			<LinksPaneView
				display={display}
				devServers={devServers ?? []}
				unscannedRecordCount={resources === undefined ? windowStartIndex : 0}
				includeToolsAndThinking={includeToolsAndThinking}
				onIncludeToolsAndThinkingChange={setIncludeToolsAndThinking}
			/>
		</JumpTargetProvider>
	);
}
