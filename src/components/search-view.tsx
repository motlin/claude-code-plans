import {useNavigate} from "@tanstack/react-router";
import {useQuery} from "@tanstack/react-query";
import {Brain, CornerDownLeft, File, FileText, MessageSquare} from "lucide-react";
import {useEffect, useRef, useState, type KeyboardEvent, type ReactNode} from "react";
import {CodePageHeader} from "./code-page-header";
import {FileSearchResults} from "./file-search-results";
import {fileSearchViewerNavigation} from "./file-search-viewer-target";
import {HighlightRuns} from "./highlight-runs";
import {useDebouncedValue} from "../hooks/use-debounced-value";
import {encodeFilePath} from "../lib/api/file";
import {
	unifiedSearchQueryOptions,
	UnifiedSearchTypeSchema,
	type UnifiedSearchItem,
	type UnifiedSearchType,
} from "../lib/api/search";
import {assertNever} from "../lib/assert-never";
import {formatCount} from "../lib/pluralize";
import {unifiedSearchTypeLabels} from "../lib/schema-choices";
import {relativeBucket} from "../lib/search-text";

/** The page lists more than the palette's 25 rows; 100 is the endpoint's cap. */
const PAGE_LIMIT = 100;
const QUERY_DEBOUNCE_MS = 150;
const RESULTS_ID = "search-results";

const KIND_ICONS = {
	session: <MessageSquare />,
	plan: <FileText />,
	memory: <Brain />,
	file: <File />,
} as const satisfies Record<UnifiedSearchItem["kind"], ReactNode>;

/** The palette's search-row anatomy: kind icon, title runs, quoted snippet, then muted project and bucket meta. */
export function SearchResultCard({item, now}: {item: UnifiedSearchItem; now: number}) {
	const bucket = relativeBucket(Date.parse(item.mtime), now);
	return (
		<span data-item-type={item.kind} className="flex min-w-0 flex-1 items-center gap-2 max-sm:items-start">
			<span className="flex size-5 shrink-0 items-center justify-center [&_svg]:size-[18px]">
				{KIND_ICONS[item.kind]}
			</span>
			{/* Below 640px the body wraps: icon, title and time on line 1; snippet and project muted on line 2. */}
			<span
				data-search-body=""
				className="flex min-w-0 flex-1 items-baseline gap-2 max-sm:flex-wrap max-sm:gap-y-0.5"
			>
				<span data-search-label="" className="min-w-0 truncate max-sm:order-1 max-sm:flex-1">
					<HighlightRuns text={item.title} matches={item.titleMatches} />
				</span>
				{item.snippet !== undefined && item.snippet.text !== "" && (
					<span
						data-search-snippet=""
						className="max-w-[60%] shrink-0 overflow-hidden text-xs whitespace-nowrap text-ink-muted max-sm:order-4 max-sm:max-w-none max-sm:min-w-0 max-sm:flex-1 max-sm:basis-0 max-sm:truncate"
					>
						“<HighlightRuns text={item.snippet.text} matches={item.snippet.matches} />”
					</span>
				)}
				<span aria-hidden="true" className="hidden max-sm:order-3 max-sm:block max-sm:basis-full" />
				<span data-search-meta="" className="ml-auto shrink-0 text-xs text-ink-muted max-sm:contents">
					<span data-search-project="" className="min-w-0 truncate max-sm:order-5 max-sm:max-w-1/2">
						{item.projectName}
					</span>
					{bucket !== null && (
						<>
							<span className="max-sm:hidden"> · </span>
							<span data-search-time="" className="shrink-0 max-sm:order-2">
								{bucket}
							</span>
						</>
					)}
				</span>
			</span>
		</span>
	);
}

/** The "all results" page: the palette's rows and type tabs over `/api/search`, plus files mode. */
export function SearchView({q, type}: {q: string; type: UnifiedSearchType}) {
	const navigate = useNavigate();

	return (
		<div>
			<CodePageHeader title="Search" />
			<TypeTabs
				value={type}
				onChange={(next) => {
					void navigate({to: "/search", search: {q, type: next}, replace: true});
				}}
			/>
			{type === "files" ? (
				<FileSearchResults
					initialQuery={q}
					onQueryChange={(nextQuery) => {
						void navigate({
							to: "/search",
							search: {q: nextQuery, type: "files"},
							replace: true,
						});
					}}
					onOpen={(absolutePath, lineNumber) => {
						const destination = fileSearchViewerNavigation(absolutePath, lineNumber);
						void navigate({
							to: "/file/$",
							params: {_splat: destination.pathToken},
							hash: destination.hash,
						});
					}}
					onClose={() => {
						void navigate({to: "/search", search: {q, type: "all"}, replace: true});
					}}
				/>
			) : (
				<UnifiedResults q={q} type={type} />
			)}
		</div>
	);
}

function TypeTabs({value, onChange}: {value: UnifiedSearchType; onChange: (type: UnifiedSearchType) => void}) {
	return (
		<div role="tablist" aria-label="Type" className="mt-3 flex items-center gap-1 overflow-x-auto">
			{UnifiedSearchTypeSchema.options.map((type) => {
				const selected = type === value;
				return (
					<button
						key={type}
						type="button"
						role="tab"
						aria-selected={selected}
						onClick={() => {
							onChange(type);
						}}
						className={`h-7 shrink-0 rounded-r6 px-2 text-sm transition-colors hover:bg-fill-ghost-hover hover:text-primary ${
							selected ? "bg-fill-ghost-hover font-medium text-primary" : "text-secondary"
						}`}
					>
						{unifiedSearchTypeLabels[type]}
					</button>
				);
			})}
		</div>
	);
}

function optionId(item: UnifiedSearchItem): string {
	return `search-result-${item.kind}-${item.id}`;
}

function UnifiedResults({q, type}: {q: string; type: Exclude<UnifiedSearchType, "files">}) {
	const navigate = useNavigate();
	const [query, setQuery] = useState(q);
	const debouncedQuery = useDebouncedValue(query.trim(), QUERY_DEBOUNCE_MS);
	const lastDebouncedQuery = useRef(debouncedQuery);

	// Only a settled edit writes the URL, so back/forward can change `q` without being overwritten.
	useEffect(() => {
		if (debouncedQuery === lastDebouncedQuery.current) return;
		lastDebouncedQuery.current = debouncedQuery;
		void navigate({to: "/search", search: {q: debouncedQuery, type}, replace: true});
	}, [debouncedQuery, navigate, type]);

	const trimmedQ = q.trim();
	const search = useQuery({
		...unifiedSearchQueryOptions({query: trimmedQ, type, limit: PAGE_LIMIT}),
		enabled: trimmedQ !== "",
	});
	const items = trimmedQ === "" ? undefined : search.data?.items;

	// The selection belongs to one result list; a new list starts at its first row.
	const [selection, setSelection] = useState<{items: unknown; index: number}>({
		items: undefined,
		index: 0,
	});
	const selectedIndex = selection.items === items ? selection.index : 0;
	const selected = items?.[selectedIndex];

	function select(index: number) {
		if (items === undefined || items.length === 0) return;
		const clamped = Math.min(Math.max(index, 0), items.length - 1);
		setSelection({items, index: clamped});
		const target = items[clamped];
		if (target !== undefined) {
			document.getElementById(optionId(target))?.scrollIntoView({block: "nearest"});
		}
	}

	function openItem(item: UnifiedSearchItem) {
		switch (item.kind) {
			case "session":
				void navigate({to: "/session/$id", params: {id: item.id}});
				return;
			case "file":
				void navigate({to: "/file/$", params: {_splat: encodeFilePath(item.id)}});
				return;
			case "plan":
			case "memory":
				if (item.href !== undefined) void navigate({href: item.href});
				return;
			default:
				assertNever(item.kind);
		}
	}

	function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
		if (event.key === "ArrowDown") {
			event.preventDefault();
			select(selectedIndex + 1);
		} else if (event.key === "ArrowUp") {
			event.preventDefault();
			select(selectedIndex - 1);
		} else if (event.key === "Enter" && selected !== undefined) {
			event.preventDefault();
			openItem(selected);
		}
	}

	const now = Date.now();

	return (
		<div>
			<input
				type="text"
				role="combobox"
				aria-label="Search"
				aria-controls={RESULTS_ID}
				aria-expanded={items !== undefined && items.length > 0}
				{...(selected === undefined ? {} : {"aria-activedescendant": optionId(selected)})}
				value={query}
				onChange={(event) => {
					setQuery(event.target.value);
				}}
				onKeyDown={handleKeyDown}
				placeholder="Search sessions, plans and memories"
				className="mt-4 w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-accent-100"
				autoFocus
			/>

			{items !== undefined && items.length === 0 && (
				<p className="mt-6 text-sm text-ink-muted">
					No results for “{trimmedQ}”{type === "all" ? "" : ` in ${unifiedSearchTypeLabels[type]}`}
				</p>
			)}

			{items !== undefined && items.length > 0 && (
				<div className="mt-4 text-xs text-ink-muted">{formatCount(items.length, "result")}</div>
			)}

			<ul
				id={RESULTS_ID}
				role="listbox"
				aria-label="Search results"
				aria-busy={search.isFetching}
				className="mt-2"
			>
				{items?.map((item, index) => (
					// oxlint-disable-next-line jsx-a11y/click-events-have-key-events -- an aria-activedescendant option: focus and arrow keys stay in the search input
					<li
						key={`${item.kind}:${item.id}`}
						id={optionId(item)}
						role="option"
						aria-selected={index === selectedIndex}
						onMouseMove={() => {
							if (index !== selectedIndex) setSelection({items, index});
						}}
						onClick={() => {
							openItem(item);
						}}
						className="group flex w-full cursor-pointer items-center justify-between gap-3 truncate rounded-lg px-3 py-2 text-sm leading-5 text-secondary select-none aria-selected:bg-fill-ghost-hover aria-selected:text-primary"
					>
						<SearchResultCard item={item} now={now} />
						<span
							data-search-enter-hint=""
							className="hidden shrink-0 text-xs text-ink-muted group-aria-selected:inline-flex pointer-coarse:hidden"
						>
							<CornerDownLeft aria-hidden="true" className="size-4" />
						</span>
					</li>
				))}
			</ul>
		</div>
	);
}
