import {keepPreviousData, replaceEqualDeep, useQuery} from "@tanstack/react-query";
import {MessageSquare} from "lucide-react";
import
{
	type KeyboardEvent,
	type ReactNode,
	type RefObject,
	useCallback,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
} from "react";

import {useDebouncedValue} from "../../hooks/use-debounced-value";
import {fetchFileSearch} from "../../lib/api/search";
import {isRecord} from "../../lib/narrow";
import {TOUCH_REVEAL} from "../../lib/touch-reveal";
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
	type MarkedText,
} from "../../lib/files-content-search";
import {FileTypeIcon} from "../file-type-icon";
import {RetryButton} from "../retry-button";

const QUERY_DEBOUNCE_MS = 120;
/** Upstream's content query `staleTime`. */
const STALE_TIME_MS = 5000;
/** Upstream `nc(0)`: the tree's depth-0 inline padding, on the cap note and the someMissing retry. */
const DEPTH_ZERO_PADDING =
{
	paddingInline: 8,
};

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
	cwd: string;
	inputRef: RefObject<HTMLInputElement | null>;
	/** Set to a function that focuses the first match; false when there is none. */
	focusFirstRef: RefObject<(() => boolean) | null>;
	onOpenFile?: ((relPath: string, options: ContentMatchOpenOptions) => void) | undefined;
	/** Puts the "Ask about this" prompt into the chat input, unsent. */
	onAsk?: ((prompt: string) => void) | undefined;
	/** The id the cap note takes, so the filter input can point `aria-describedby` at it. */
	capNoteId: string;
	/** Told whether the cap note is showing. */
	onCapNoteShownChange?: ((shown: boolean) => void) | undefined;
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

function Snippet({snippet}: {snippet: MarkedText})
{
	const {text, match} = snippet;
	if (match === null) return <>{text}</>;
	return (
		<>
			{text.slice(0, match.start)}
			<mark className="rounded-r3 bg-accent-100/25 text-primary">{text.slice(match.start, match.end)}</mark>
			{text.slice(match.end)}
		</>
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
	cwd,
	inputRef,
	focusFirstRef,
	onOpenFile,
	onAsk,
	capNoteId,
	onCapNoteShownChange,
}: ContentSearchResultsProps)
{
	const debouncedQuery = useDebouncedValue(query, QUERY_DEBOUNCE_MS);
	const search = useQuery(
		{
			...contentSearchQueryOptions(debouncedQuery, cwd),
			enabled: debouncedQuery !== "",
			placeholderData: keepPreviousData,
		},
	);
	const listRef = useRef<HTMLDivElement>(null);

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
	const capNote = results === null || results.groups.length === 0 ? null : contentSearchCapNote(results);

	useEffect(() =>
	{
		onCapNoteShownChange?.(capNote !== null);
	}, [capNote, onCapNoteShownChange]);
	useEffect(() => () => onCapNoteShownChange?.(false), [onCapNoteShownChange]);

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

	useEffect(() =>
	{
		focusFirstRef.current = () =>
		{
			if (rows.length === 0) return false;
			focusRow(0);
			return true;
		};
		return () =>
		{
			focusFirstRef.current = null;
		};
	});

	function openMatch(relPath: string, match: ContentSearchMatch): void
	{
		onOpenFile?.(
			relPath,
			{
				pin: false,
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
			openMatch(row.relPath, row.match);
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
			{results.groups.map((group) =>
			{
				const dir = parentDir(group.relPath);
				return (
					<div key={group.path} role="group" aria-label={group.relPath} className="pb-1">
						<button
							type="button"
							tabIndex={-1}
							data-content-file
							title={group.relPath}
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
								<div
									key={match.line}
									role="treeitem"
									aria-level={2}
									aria-selected={false}
									tabIndex={-1}
									data-content-match
									data-row-index={index}
									onKeyDown={(event) =>
									{
										handleRowKeyDown(event, index);
									}}
									onClick={() =>
									{
										openMatch(group.relPath, match);
									}}
									className="group/match flex min-h-6 cursor-pointer items-baseline gap-2 rounded-r5 py-0.5 pr-1 pl-6 text-footnote outline-none hover:bg-fill-ghost-hover focus-visible:bg-fill-ghost-hover"
								>
									<span className="shrink-0 font-mono text-ink-muted tabular-nums">{match.line}</span>
									<span className="min-w-0 flex-1 truncate font-mono text-secondary">
										<Snippet snippet={match.snippet} />
									</span>
									{onAsk !== undefined && (
										<button
											type="button"
											tabIndex={-1}
											aria-label="Ask about this"
											title="Ask about this"
											onClick={(event) =>
											{
												event.stopPropagation();
												onAsk(askAboutPrompt(group.relPath, match.line, match.text));
											}}
											className={`flex size-5 shrink-0 cursor-pointer items-center justify-center self-center rounded-r3 text-t6 opacity-0 group-hover/match:opacity-100 group-focus-visible/match:opacity-100 hover:text-primary ${TOUCH_REVEAL}`}
										>
											<MessageSquare aria-hidden="true" className="size-3" />
										</button>
									)}
								</div>
							);
						})}
						{group.more && (
							<p data-content-more className="py-0.5 pl-6 text-footnote text-ink-muted select-none">
								More matches in this file.
							</p>
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
