import {Loader2, X} from "lucide-react";
import {useEffect, useState} from "react";
import {useQueryClient} from "@tanstack/react-query";
import {apiFetch, ApiResponseError} from "../lib/api/client";
import {IndexingStatusResponse} from "../lib/api/indexing";
import {invalidateSessionIdentities} from "../lib/api/session-identity";
import {sessionQueryKeys} from "../lib/api/sessions";

export function IndexingBannerView({onDismiss}: {onDismiss: () => void}) {
	return (
		<div className="mx-6 mt-4 flex items-center gap-3 rounded-md border border-blue-200 bg-blue-50 px-4 py-2.5 text-sm text-blue-800 dark:border-blue-800 dark:bg-blue-950/30 dark:text-blue-300">
			<Loader2 className="h-4 w-4 animate-spin shrink-0" />
			<span>Building search index... This is a one-time operation.</span>
			<button
				type="button"
				onClick={onDismiss}
				className="ml-auto text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-200"
			>
				<X className="h-4 w-4" />
			</button>
		</div>
	);
}

export function IndexingBanner() {
	const queryClient = useQueryClient();
	const [isIndexing, setIsIndexing] = useState(false);
	const [dismissed, setDismissed] = useState(false);

	useEffect(() => {
		let cancelled = false;
		let previous: boolean | undefined;
		const retried = new Set<string>();

		async function poll() {
			try {
				const result = await apiFetch("/api/indexing-status", IndexingStatusResponse);
				if (cancelled) return;
				setIsIndexing(result.isIndexing);
				if (result.isIndexing) retried.clear();
				else {
					const completed = previous === true;
					const pending = queryClient
						.getQueryCache()
						.findAll({queryKey: sessionQueryKeys.identities()})
						.filter(
							(query) =>
								completed ||
								(!retried.has(query.queryHash) &&
									query.state.error instanceof ApiResponseError &&
									query.state.error.status === 503),
						);
					for (const query of pending) retried.add(query.queryHash);
					// A 503 can precede the first poll: retry once even if no true sample was observed.
					if (pending.length > 0) {
						void invalidateSessionIdentities(queryClient, (query) => pending.includes(query));
					}
				}
				previous = result.isIndexing;
			} catch {
				// Server function unavailable during HMR
			}
		}

		void poll();
		const interval = setInterval(() => void poll(), 3000);
		return () => {
			cancelled = true;
			clearInterval(interval);
		};
	}, [queryClient]);

	if (!isIndexing || dismissed) return null;

	return <IndexingBannerView onDismiss={() => setDismissed(true)} />;
}
