import {createFileRoute, Link, useNavigate} from '@tanstack/react-router';
import {useState} from 'react';
import {searchSessions} from '../lib/server-fns';

type SearchResult = Awaited<ReturnType<typeof searchSessions>>[number];

export const Route = createFileRoute('/search')({
	component: SearchPage,
	validateSearch: (search: Record<string, unknown>) => ({
		q: (search['q'] as string) ?? '',
	}),
	head: () => ({
		meta: [{title: 'Search'}],
	}),
});

function SearchPage() {
	const {q} = Route.useSearch();
	const navigate = useNavigate();
	const [query, setQuery] = useState(q);
	const [results, setResults] = useState<SearchResult[]>([]);
	const [searched, setSearched] = useState(false);
	const [loading, setLoading] = useState(false);

	async function handleSearch(searchQuery?: string) {
		const q = searchQuery ?? query;
		if (!q.trim()) return;

		setLoading(true);
		try {
			const data = await searchSessions({data: q.trim()});
			setResults(data);
			setSearched(true);
			navigate({to: '/search', search: {q: q.trim()}, replace: true});
		} finally {
			setLoading(false);
		}
	}

	// Auto-search on mount if query param present
	if (q && !searched && !loading) {
		handleSearch(q);
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
					placeholder="Search sessions..."
					className="flex-1 rounded-md border border-border bg-transparent px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-primary"
					autoFocus
				/>
				<button
					type="submit"
					disabled={loading || !query.trim()}
					className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
				>
					{loading ? 'Searching...' : 'Search'}
				</button>
			</form>

			{searched && results.length === 0 && (
				<p className="mt-6 text-sm text-muted-foreground">No results found for &ldquo;{q}&rdquo;</p>
			)}

			{results.length > 0 && (
				<ul className="mt-4 space-y-1">
					{results.map((result) => (
						<li key={result.sessionId}>
							<Link
								to="/session/$id"
								params={{id: result.sessionId}}
								className="block rounded-md p-2 cursor-pointer transition-colors hover:bg-muted/50"
							>
								<div
									className="truncate"
									style={{fontSize: '14px', fontWeight: 430}}
								>
									{result.title}
								</div>
								<div className="mt-0.5 text-xs text-muted-foreground">{result.projectName}</div>
								{result.snippet && (
									<div
										className="mt-0.5 truncate text-xs text-muted-foreground [&_mark]:rounded-sm [&_mark]:bg-yellow-200/70 [&_mark]:px-0.5 [&_mark]:text-foreground dark:[&_mark]:bg-yellow-700/40"
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
