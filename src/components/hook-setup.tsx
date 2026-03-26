import {useState} from 'react';
import {Check, Copy, Settings} from 'lucide-react';
import {generateHooksJson, DEFAULT_HOOK_PORT} from '../lib/hook-config';

export function HookSetup() {
	const [port, setPort] = useState(DEFAULT_HOOK_PORT);
	const [copied, setCopied] = useState(false);

	const json = generateHooksJson({port});

	function handleCopy() {
		navigator.clipboard.writeText(json);
		setCopied(true);
		setTimeout(() => setCopied(false), 1500);
	}

	return (
		<div className="space-y-4">
			<div className="flex items-center gap-3">
				<Settings className="h-5 w-5 text-text-300" />
				<h2 className="text-base font-semibold text-text-000">Hook Configuration</h2>
			</div>

			<p className="text-sm text-text-300">
				Add this hooks block to your{' '}
				<code className="rounded bg-bg-200 px-1.5 py-0.5 font-mono text-xs">~/.claude/settings.json</code> to
				enable real-time session tracking and push-based updates. Each hook fires a lightweight POST to the
				local server whenever Claude starts/ends sessions, completes tools, or finishes tasks.
			</p>

			<div className="flex items-center gap-3">
				<label
					htmlFor="hook-port"
					className="text-sm text-text-300"
				>
					Server port
				</label>
				<input
					id="hook-port"
					type="number"
					value={port}
					onChange={(e) => setPort(Number(e.target.value) || DEFAULT_HOOK_PORT)}
					className="w-24 rounded-md border border-border-300/15 bg-bg-100 px-2 py-1 text-sm text-text-000 focus:outline-none focus:ring-1 focus:ring-accent-100"
				/>
			</div>

			<div className="relative">
				<button
					type="button"
					onClick={handleCopy}
					className="absolute right-2 top-2 flex items-center gap-1.5 rounded-md border border-border-300/15 bg-bg-200 px-2.5 py-1 text-xs text-text-300 transition-colors hover:bg-bg-300/50 hover:text-text-000"
					title="Copy to clipboard"
				>
					{copied ? (
						<>
							<Check className="h-3.5 w-3.5 text-green-500" />
							<span>Copied</span>
						</>
					) : (
						<>
							<Copy className="h-3.5 w-3.5" />
							<span>Copy</span>
						</>
					)}
				</button>
				<pre className="overflow-auto rounded-md border border-border-300/15 bg-bg-200 p-4 pr-24 font-mono text-xs leading-relaxed text-text-300">
					{json}
				</pre>
			</div>

			<div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
				Merge this into the existing <code className="font-mono">"hooks"</code> key in your settings file. If
				you already have hooks defined for these events, add the new entries to each event's array rather than
				replacing them.
			</div>
		</div>
	);
}
