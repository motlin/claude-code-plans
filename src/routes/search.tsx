import {createFileRoute, Link, useNavigate} from '@tanstack/react-router';
import {useState} from 'react';
import {searchSessions, searchMessageContent} from '../lib/server-fns';

type TitleResult = Awaited<ReturnType<typeof searchSessions>>[number];
type ContentResult = Awaited<ReturnType<typeof searchMessageContent>>[number];
type SearchResult = (TitleResult | ContentResult) & {
	sessionId: string;
	title: string;
	snippet: string;
	projectName: string;
};

export const Route = createFileRoute('/search')({
	component: SearchPage,
	validateSearch: (search: Record<string, unknown>) => ({
		q: (search['q'] as string) ?? '',
		mode: (search['mode'] as string) === 'conversations' ? ('conversations' as const) : ('titles' as const),
	}),
	head: () => ({
		meta: [{title: 'Search'}],
	}),
});

function SearchPage() {
	const {q, mode: initialMode} = Route.useSearch();
	const navigate = useNavigate();
	const [query, setQuery] = useState(q);
	const [mode, setMode] = useState<'titles' | 'conversations'>(initialMode);
	const [results, setResults] = useState<SearchResult[]>([]);
	const [searched, setSearched] = useState(false);
	const [loading, setLoading] = useState(false);

	async function handleSearch(searchQuery?: string, searchMode?: 'titles' | 'conversations') {
		const q = searchQuery ?? query;
		const m = searchMode ?? mode;
		if (!q.trim()) return;

		setLoading(true);
		try {
			let data: SearchResult[];
			if (m === 'conversations') {
				data = await searchMessageContent({data: q.trim()});
			} else {
				data = await searchSessions({data: q.trim()});
			}
			setResults(data);
			setSearched(true);
			navigate({to: '/search', search: {q: q.trim(), mode: m}, replace: true});
		} finally {
			setLoading(false);
		}
	}

	// Auto-search on mount if query param present
	if (q && !searched && !loading) {
		handleSearch(q, mode);
	}

	return (
		<div>
			<h1 className="text-lg font-semibold">Search Sessions</h1>

			<form
				className="mt-4 flex gap-2"
				onSubmit={(e) => {
					e.preventDefault();
					handleSearch();
				}}
			>
				<input
					type="text"
					value={query}
					onChange={(e) => setQuery(e.target.value)}
					placeholder={mode === 'conversations' ? 'Search conversations...' : 'Search session titles...'}
					className="flex-1 rounded-md border border-border-300/15 bg-transparent px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-accent-100"
					autoFocus
				/>
				<button
					type="submit"
					disabled={loading || !query.trim()}
					className="rounded-md bg-accent-100 px-4 py-2 text-sm font-medium text-bg-000 disabled:opacity-50"
				>
					{loading ? 'Searching...' : 'Search'}
				</button>
			</form>

			<div className="mt-3 flex gap-1">
				<button
					type="button"
					onClick={() => {
						setMode('titles');
						if (searched && query.trim()) handleSearch(query, 'titles');
					}}
					className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
						mode === 'titles' ? 'bg-accent-100 text-bg-000' : 'bg-bg-200 text-text-500 hover:bg-bg-200/80'
					}`}
				>
					Search titles
				</button>
				<button
					type="button"
					onClick={() => {
						setMode('conversations');
						if (searched && query.trim()) handleSearch(query, 'conversations');
					}}
					className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
						mode === 'conversations'
							? 'bg-accent-100 text-bg-000'
							: 'bg-bg-200 text-text-500 hover:bg-bg-200/80'
					}`}
				>
					Search conversations
				</button>
			</div>

			{searched && results.length === 0 && (
				<p className="mt-6 text-sm text-text-500">No results found for &ldquo;{q}&rdquo;</p>
			)}

			{results.length > 0 && (
				<ul className="mt-4 space-y-1">
					{results.map((result) => (
						<li key={result.sessionId}>
							<Link
								to="/session/$id"
								params={{id: result.sessionId}}
								className="block rounded-md p-2 cursor-pointer transition-colors hover:bg-bg-200/50"
							>
								<div
									className="truncate"
									style={{fontSize: '14px', fontWeight: 430}}
								>
									{result.title}
								</div>
								<div className="mt-0.5 text-xs text-text-500">{result.projectName}</div>
								{result.snippet && (
									<div
										className="mt-0.5 truncate text-xs text-text-500 [&_mark]:rounded-sm [&_mark]:bg-yellow-200/70 [&_mark]:px-0.5 [&_mark]:text-text-100 dark:[&_mark]:bg-yellow-700/40"
										dangerouslySetInnerHTML={{__html: result.snippet}}
									/>
								)}
							</Link>
						</li>
					))}
				</ul>
			)}
		</div>
	);
}
