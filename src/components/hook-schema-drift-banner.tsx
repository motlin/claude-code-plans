import {AlertTriangle, X} from 'lucide-react';
import {useHookSchemaDrifts} from '../hooks/use-claude-events';

/**
 * Renders a dismissable amber banner per active hook schema drift. The server
 * broadcasts `hook:schema-drift` when Claude Code POSTs a payload that fails
 * `HookEventEnvelope` parsing — typically because Claude Code shipped a new
 * tool or added a new field. The banner tells the user to rebuild the viewer
 * to pick up the new schema; the underlying file change is still indexed via
 * the watcher / hook fallback path so functionality is not blocked.
 */
export function HookSchemaDriftBanner() {
	const {drifts, dismiss} = useHookSchemaDrifts();
	if (drifts.length === 0) return null;

	return (
		<div className="mx-6 mt-4 flex flex-col gap-2">
			{drifts.map((drift) => (
				<div
					key={drift.hookEventName}
					className="flex items-start gap-3 rounded-md border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200"
				>
					<AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
					<div className="flex-1 min-w-0">
						<div className="font-medium">
							Claude Code sent an unknown field on {drift.hookEventName} (×{drift.count})
						</div>
						{drift.unknownFields.length > 0 && (
							<div className="mt-1 text-xs">Unknown: {drift.unknownFields.join(', ')}</div>
						)}
						{drift.missingFields.length > 0 && (
							<div className="mt-1 text-xs">Missing: {drift.missingFields.join(', ')}</div>
						)}
						<div className="mt-1 text-xs opacity-80">Rebuild the viewer to pick up the new schema.</div>
					</div>
					<button
						type="button"
						onClick={() => dismiss(drift.hookEventName)}
						className="shrink-0 text-amber-700 hover:text-amber-900 dark:text-amber-400 dark:hover:text-amber-200"
						aria-label={`Dismiss ${drift.hookEventName} drift notice`}
					>
						<X className="h-4 w-4" />
					</button>
				</div>
			))}
		</div>
	);
}
