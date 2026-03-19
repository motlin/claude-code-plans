import {Loader2, X} from 'lucide-react';
import {useEffect, useState} from 'react';
import {getIndexingStatus} from '../lib/server-fns';

export function IndexingBanner() {
	const [isIndexing, setIsIndexing] = useState(false);
	const [dismissed, setDismissed] = useState(false);

	useEffect(() => {
		let cancelled = false;

		async function poll() {
			const {isIndexing: status} = await getIndexingStatus();
			if (!cancelled) setIsIndexing(status);
		}

		poll();
		const interval = setInterval(poll, 3000);
		return () => {
			cancelled = true;
			clearInterval(interval);
		};
	}, []);

	if (!isIndexing || dismissed) return null;

	return (
		<div className="mx-6 mt-4 flex items-center gap-3 rounded-md border border-blue-200 bg-blue-50 px-4 py-2.5 text-sm text-blue-800 dark:border-blue-800 dark:bg-blue-950/30 dark:text-blue-300">
			<Loader2 className="h-4 w-4 animate-spin shrink-0" />
			<span>Building search index... This is a one-time operation.</span>
			<button
				type="button"
				onClick={() => setDismissed(true)}
				className="ml-auto text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-200"
			>
				<X className="h-4 w-4" />
			</button>
		</div>
	);
}
