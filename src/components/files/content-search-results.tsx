import {keepPreviousData, replaceEqualDeep, useQuery} from "@tanstack/react-query";
import
{
	type KeyboardEvent,
	type ReactNode,
	type RefObject,
	useCallback,
	useEffect,
	useId,
	useLayoutEffect,
	useRef,
	useState,
} from "react";

import {fetchFileSearch} from "../../lib/api/search";
import type {AttachContextHandler} from "../../lib/context-attach";
import {isRecord} from "../../lib/narrow";
import
{
	askAboutPrompt,
	CONTENT_SEARCH_MESSAGES,
	contentSearchCapNote,
	contentSearchOutcome,
	type ContentSearchMatch,
	type ContentSearchOutcome,
	type ContentSearchResults as Results,
	EMPTY_CONTENT_SEARCH_RESULTS,
	groupContentSearchResults,
	keepResultsOnFailedRefetch,
	type SnippetParts,
	type TextRange,
} from "../../lib/files-content-search";
import {FileTypeIcon} from "../file-type-icon";
import {RetryButton} from "../retry-button";
import {ContextMenu, ContextMenuTrigger, MenuContent, MenuItem} from "../ui/menu";
import {TreeRowMenuItems} from "./file-context-menu";

/** Upstream's content query `staleTime`. */
const STALE_TIME_MS = 5000;
/** Upstream `nc(0)`: the tree's depth-0 inline padding, on the cap note and the someMissing retry. */
const DEPTH_ZERO_PADDING =
{
	paddingInline: 8,
};
/** Upstream `rj`: a match row's and the More matches row's inline padding, `nc(0)` with 2px less at the start. */
const MATCH_ROW_PADDING =
{
	paddingInlineStart: 6,
	paddingInlineEnd: 8,
};
/**
 * Upstream's match row: the menu-row base (`NJ`) merged with the tree row (`JT`) and its ghost paint (`lc`).
 * The base's density padding is dropped, since the depth padding is inline.
 */
const MATCH_ROW_CLASS =
	"cds-reset flex w-full items-center gap-xs rounded text-body font-normal font-control select-none outline-none relative h-[var(--file-tree-row-h,var(--cds-h-control))] py-0 focus-visible:outline-hidden focus-visible:shadow-focus bg-transparent text-primary hover:bg-fill-ghost-hover data-[pressed]:bg-fill-ghost-hover group-data-[hover-rests]/file-tree:hover:bg-alpha-0";
/** Upstream `nj`: the gap between a match row's line number and snippet, and on the More matches row. */
const MATCH_GAP_CLASS = "gap-1.5";
/** Upstream `ej` merged with `nj`: the row's primary button, whose `before:` box makes the whole row clickable. */
const MATCH_PRIMARY_CLASS = `flex flex-1 min-w-0 items-baseline text-start bg-transparent border-0 outline-none hide-focus-ring rounded-r2 before:absolute before:inset-0 before:content-[''] ${MATCH_GAP_CLASS}`;
/** Upstream `tj`: a line-number column as wide as `data-widest`, the group's widest line number. */
const LINE_NUMBER_SIZER_CLASS =
	"min-w-4 text-caption tabular-nums after:invisible after:block after:h-0 after:overflow-hidden after:content-[attr(data-widest)]";

/** Upstream `AD`: the query data is a content search result. */
function isResults(value: unknown): value is Results
{
	return isRecord(value) && Array.isArray(value["groups"]);
}

/**
 * Upstream's content query (`qE`): a failed request settles as `failed` data rather than an error,
 * so a failed refetch can keep the matches already shown (`jD`). A cancelled fetch still throws.
 */
function contentSearchQueryOptions(query: string, cwd: string)
{
	return {
		queryKey: ["search", "files-content", query, cwd] as const,
		queryFn: async ({signal}: {signal: AbortSignal}): Promise<Results> =>
		{
			try
			{
				return groupContentSearchResults(await fetchFileSearch(query, cwd, signal), cwd, query);
			}
			catch (error)
			{
				if (signal.aborted) throw error;
				return {
					...EMPTY_CONTENT_SEARCH_RESULTS,
					failed: true,
				};
			}
		},
		staleTime: STALE_TIME_MS,
		structuralSharing: (previous: unknown, next: unknown) =>
			replaceEqualDeep(
				previous,
				isResults(next) ? keepResultsOnFailedRefetch(isResults(previous) ? previous : undefined, next) : next,
			),
	};
}

export interface ContentMatchOpenOptions
{
	pin: boolean;
	line?: number;
	findQuery?: string;
}

interface ContentSearchResultsProps
{
	/** The content query, without the leading "?". */
	query: string;
	/** The query once the filter has held steady; "" while it is not a "?" query yet. */
	debouncedQuery: string;
	cwd: string;
	inputRef: RefObject<HTMLInputElement | null>;
	/** Set to the filter's ways into the matches. */
	navRef: RefObject<ContentSearchNav | null>;
	onOpenFile?: ((relPath: string, options: ContentMatchOpenOptions) => void) | undefined;
	/** Puts the "Ask about this" prompt into the chat input, unsent. */
	onAsk?: ((prompt: string) => void) | undefined;
	onAttachContext?: AttachContextHandler | undefined;
	/** The id the cap note takes, so the filter input can point `aria-describedby` at it. */
	capNoteId: string;
	/** Told whether the cap note is showing. */
	onCapNoteShownChange?: ((shown: boolean) => void) | undefined;
	/** Told the outcome the filter announces and whether its spinner shows. */
	onSearchStateChange?: ((state: ContentSearchState) => void) | undefined;
}

export interface ContentSearchNav
{
	/** ArrowDown: focuses the first match; false when there is none. */
	focusFirst: () => boolean;
	/** Enter: focuses the first match once results for the query as typed have settled. */
	focusFirstWhenSettled: () => void;
}

export interface ContentSearchState
{
	outcome: ContentSearchOutcome | undefined;
	/** Upstream `cn`: fetching with no settled data, so the filter shows its spinner. */
	searching: boolean;
}

/** Upstream `RD`: a centred one-line message in the results area. */
function OutcomeMessage({children}: {children: ReactNode})
{
	return (
		<div className="flex items-center justify-center px-lg py-1 text-body text-muted-as-secondary">{children}</div>
	);
}

/**
 * Upstream `MD`: Try again for a failed or unfinished search, busy while the retry runs. Focus
 * inside it when it unmounts goes to `onFocusLost` so it isn't lost to the body.
 */
function SearchRetry({
	outcome,
	onRetry,
	onFocusLost,
}: {
	outcome: ContentSearchOutcome;
	onRetry: () => Promise<boolean>;
	onFocusLost: () => void;
})
{
	const [busy, setBusy] = useState(false);
	const ref = useRef<HTMLDivElement>(null);
	useLayoutEffect(() =>
	{
		const element = ref.current;
		return () =>
		{
			if (element?.contains(document.activeElement) === true) onFocusLost();
		};
	}, [onFocusLost]);
	return (
		<div ref={ref}>
			<RetryButton
				size="sm"
				busy={busy}
				busyLabel="Searching files"
				failedLabel={CONTENT_SEARCH_MESSAGES[outcome]}
				onRetry={async () =>
				{
					setBusy(true);
					return onRetry().finally(() =>
					{
						setBusy(false);
					});
				}}
			/>
		</div>
	);
}

/** Upstream `Ss`: text with its matches marked. */
function Marked({text, matches}: {text: string; matches: readonly TextRange[]})
{
	const parts: ReactNode[] = [];
	let at = 0;
	for (const {start, end} of matches)
	{
		if (start > at) parts.push(text.slice(at, start));
		parts.push(
			<mark key={start} className="bg-upstream-accent-pressed text-inherit rounded-sm">
				{text.slice(start, end)}
			</mark>,
		);
		at = end;
	}
	if (at < text.length) parts.push(text.slice(at));
	return <>{parts}</>;
}

/** Upstream's snippet: an rtl lead that ellipsizes from the left, the hit kept whole, and a tail that gives way first. */
function Snippet({snippet}: {snippet: SnippetParts})
{
	const {lead, hit, hitMatches, tail, tailMatches} = snippet;
	return (
		<span dir="ltr" className="flex min-w-0 overflow-hidden whitespace-pre text-code text-primary">
			{lead !== "" && (
				<span dir="rtl" className="min-w-0 overflow-hidden text-ellipsis">
					<span dir="ltr">{lead}</span>
				</span>
			)}
			{hit !== "" && (
				<span className="max-w-full shrink-0 overflow-hidden text-ellipsis">
					<Marked text={hit} matches={hitMatches} />
				</span>
			)}
			{tail !== "" && (
				<span className="min-w-[2ch] shrink-[9999] overflow-hidden text-ellipsis">
					<Marked text={tail} matches={tailMatches} />
				</span>
			)}
		</span>
	);
}

function fileName(relPath: string): string
{
	return relPath.slice(relPath.lastIndexOf("/") + 1);
}

function parentDir(relPath: string): string
{
	const lastSlash = relPath.lastIndexOf("/");
	return lastSlash === -1 ? "" : relPath.slice(0, lastSlash);
}

/**
 * The Files filter's "?" mode: matches from the indexed file contents under
 * the working directory, grouped per file with windowed snippets.
 */
export function ContentSearchResults({
	query,
	debouncedQuery,
	cwd,
	inputRef,
	navRef,
	onOpenFile,
	onAsk,
	onAttachContext,
	capNoteId,
	onCapNoteShownChange,
	onSearchStateChange,
}: ContentSearchResultsProps)
{
	const search = useQuery(
		{
			...contentSearchQueryOptions(debouncedQuery, cwd),
			enabled: debouncedQuery !== "",
			placeholderData: keepPreviousData,
		},
	);
	const listRef = useRef<HTMLDivElement>(null);
	const moreIdPrefix = useId();
	/** Upstream `mn`: the query an early Enter asked to focus the first match of. */
	const queuedFocusRef = useRef<string | null>(null);

	const results = query === "" ? null : (search.data ?? null);
	// Upstream `sn`: the outcome message waits for settled data for the query as typed.
	const settled = results !== null && !search.isPlaceholderData && debouncedQuery === query;
	const outcome = settled
		? contentSearchOutcome(
				{
					groupCount: results.groups.length,
					failed: results.failed,
					unfinished: results.unfinished,
				},
			)
		: undefined;
	const searching = search.isFetching && !(search.data !== undefined && !search.isPlaceholderData);
	const capNote = results === null || results.groups.length === 0 ? null : contentSearchCapNote(results);

	useEffect(() =>
	{
		onCapNoteShownChange?.(capNote !== null);
	}, [capNote, onCapNoteShownChange]);
	useEffect(() => () => onCapNoteShownChange?.(false), [onCapNoteShownChange]);
	useEffect(() =>
	{
		onSearchStateChange?.(
			{
				outcome,
				searching,
			},
		);
	}, [outcome, searching, onSearchStateChange]);
	useEffect(
		() => () =>
			onSearchStateChange?.(
				{
					outcome: undefined,
					searching: false,
				},
			),
		[onSearchStateChange],
	);

	const focusList = useCallback(() =>
	{
		listRef.current?.focus();
	}, []);

	/** Reruns the search; true when it ended with the same outcome, so the retry re-announces it. */
	async function retry(): Promise<boolean>
	{
		const before = outcome;
		const {data} = await search.refetch();
		const after =
			data === undefined
				? undefined
				: contentSearchOutcome(
						{
							groupCount: data.groups.length,
							failed: data.failed,
							unfinished: data.unfinished,
						},
					);
		return after === before;
	}
	const rows: Array<
	{
		relPath: string;
		match: ContentSearchMatch;
	}> =
		results?.groups.flatMap((group) =>
			group.matches.map((match) => (
			{
				relPath: group.relPath,
				match,
			})),
		) ?? [];

	function focusRow(index: number): void
	{
		listRef.current?.querySelector<HTMLElement>(`[data-row-index="${index}"]`)?.focus();
	}

	function focusFirst(): boolean
	{
		if (rows.length === 0) return false;
		focusRow(0);
		return true;
	}

	useEffect(() =>
	{
		navRef.current =
		{
			focusFirst,
			focusFirstWhenSettled: () =>
			{
				if (settled) focusFirst();
				else queuedFocusRef.current = query;
			},
		};
		return () =>
		{
			navRef.current = null;
		};
	});

	// Upstream applies a queued Enter once results for that query land.
	useEffect(() =>
	{
		if (!settled || queuedFocusRef.current === null) return;
		if (queuedFocusRef.current === query) focusFirst();
		queuedFocusRef.current = null;
	});

	function openMatch(relPath: string, match: ContentSearchMatch, pin: boolean): void
	{
		onOpenFile?.(
			relPath,
			{
				pin,
				line: match.line,
				findQuery: debouncedQuery,
			},
		);
	}

	function handleRowKeyDown(event: KeyboardEvent<HTMLDivElement>, index: number): void
	{
		if (event.target !== event.currentTarget) return;
		if (event.key === "ArrowDown")
		{
			event.preventDefault();
			focusRow(Math.min(rows.length - 1, index + 1));
		}
		else if (event.key === "ArrowUp")
		{
			event.preventDefault();
			if (index === 0) inputRef.current?.focus();
			else focusRow(index - 1);
		}
		else if (event.key === "Home")
		{
			event.preventDefault();
			focusRow(0);
		}
		else if (event.key === "End")
		{
			event.preventDefault();
			focusRow(rows.length - 1);
		}
		else if (event.key === "Enter")
		{
			const row = rows[index];
			if (row === undefined) return;
			event.preventDefault();
			openMatch(row.relPath, row.match, false);
		}
	}

	if (results === null || results.groups.length === 0)
	{
		let body: ReactNode = null;
		if (query === "") body = <OutcomeMessage>Type after ? to search in files</OutcomeMessage>;
		else if (outcome !== undefined)
		{
			body = (
				<div className="flex flex-col items-center gap-sm">
					<OutcomeMessage>{CONTENT_SEARCH_MESSAGES[outcome]}</OutcomeMessage>
					{outcome !== "none" && <SearchRetry outcome={outcome} onRetry={retry} onFocusLost={focusList} />}
				</div>
			);
		}
		return (
			<div ref={listRef} tabIndex={-1} className="min-h-0 flex-1 overflow-y-auto px-1 py-1.25 outline-none">
				{body}
			</div>
		);
	}

	let rowIndex = 0;
	return (
		<div
			ref={listRef}
			role="tree"
			tabIndex={-1}
			aria-label="File content matches"
			className="min-h-0 flex-1 overflow-y-auto px-1 py-1.25 outline-none"
		>
			{results.groups.map((group, groupIndex) =>
			{
				const dir = parentDir(group.relPath);
				const moreId = `${moreIdPrefix}-${groupIndex}`;
				return (
					<div key={group.path} role="group" aria-label={group.relPath} className="pb-1">
						<button
							type="button"
							tabIndex={-1}
							data-content-file
							title={group.relPath}
							aria-describedby={group.more ? moreId : undefined}
							onClick={() =>
								onOpenFile?.(
									group.relPath,
									{
										pin: false,
									},
								)
							}
							onDoubleClick={() =>
								onOpenFile?.(
									group.relPath,
									{
										pin: true,
									},
								)
							}
							className="flex h-6 w-full min-w-0 cursor-pointer items-baseline gap-1 rounded-r5 border-0 bg-transparent pr-2 pl-2 text-left text-body outline-none select-none hover:bg-fill-ghost-hover"
						>
							<FileTypeIcon fileName={group.relPath} size="xs" className="self-center text-ink-muted" />
							<span className="truncate text-primary">{fileName(group.relPath)}</span>
							{dir !== "" && <span className="min-w-0 truncate text-footnote text-ink-muted">{dir}</span>}
						</button>
						{group.matches.map((match) =>
						{
							const index = rowIndex;
							rowIndex += 1;
							return (
								<ContextMenu key={match.line}>
									<ContextMenuTrigger
										data-tree-row
										role="treeitem"
										aria-level={2}
										aria-selected={false}
										tabIndex={-1}
										data-content-match
										data-row-index={index}
										onKeyDown={(event: KeyboardEvent<HTMLDivElement>) =>
										{
											handleRowKeyDown(event, index);
										}}
										className={MATCH_ROW_CLASS}
										style={MATCH_ROW_PADDING}
									>
										<button
											type="button"
											data-tree-primary
											tabIndex={-1}
											onClick={(event) =>
											{
												openMatch(group.relPath, match, event.metaKey || event.ctrlKey);
											}}
											onDoubleClick={() =>
											{
												openMatch(group.relPath, match, true);
											}}
											onMouseDown={(event) =>
											{
												if (event.button === 1) event.preventDefault();
											}}
											onAuxClick={(event) =>
											{
												if (event.button === 1) openMatch(group.relPath, match, true);
											}}
											className={MATCH_PRIMARY_CLASS}
										>
											<span
												className={`${LINE_NUMBER_SIZER_CLASS} shrink-0 text-secondary text-end`}
												data-widest={group.maxLine}
											>
												{match.line}
											</span>
											<Snippet snippet={match.snippet} />
										</button>
									</ContextMenuTrigger>
									<MenuContent>
										{onAsk !== undefined && (
											<MenuItem
												onSelect={() =>
												{
													onAsk(askAboutPrompt(group.relPath, match.line, match.text));
												}}
											>
												Ask about this
											</MenuItem>
										)}
										<TreeRowMenuItems
											path={group.path}
											cwd={cwd}
											isDirectory={false}
											onAttachContext={onAttachContext}
										/>
									</MenuContent>
								</ContextMenu>
							);
						})}
						{group.more && (
							<div
								id={moreId}
								aria-hidden
								data-content-more
								className={`flex items-center ${MATCH_GAP_CLASS} h-control text-footnote text-secondary select-none`}
								style={MATCH_ROW_PADDING}
							>
								<span
									className={`${LINE_NUMBER_SIZER_CLASS} shrink-[9999]`}
									data-widest={group.maxLine}
								/>
								<span className="min-w-0 truncate">More matches in this file.</span>
							</div>
						)}
					</div>
				);
			})}
			{capNote !== null && (
				<div
					id={capNoteId}
					className="py-1.5 text-footnote text-muted-as-secondary select-none"
					style={DEPTH_ZERO_PADDING}
				>
					{capNote}
				</div>
			)}
			{outcome === "someMissing" && (
				<div className="pb-1.5" style={DEPTH_ZERO_PADDING}>
					<SearchRetry outcome={outcome} onRetry={retry} onFocusLost={focusList} />
				</div>
			)}
		</div>
	);
}
