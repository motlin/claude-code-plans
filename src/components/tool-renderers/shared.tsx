import {type ReactNode, useState} from 'react';

export function FilePath({path}: {path: string}) {
	return <code className="text-xs font-mono bg-muted px-1.5 py-0.5 rounded truncate">{path}</code>;
}

export function DiffLine({type, line}: {type: 'equal' | 'add' | 'remove'; line: string}) {
	const styles = {
		equal: 'border-l-3 border-transparent',
		add: 'bg-green-50 dark:bg-green-950/30 border-l-3 border-green-500',
		remove: 'bg-red-50 dark:bg-red-950/30 border-l-3 border-red-500',
	};
	const markers = {equal: ' ', add: '+', remove: '-'};
	const markerColors = {equal: 'text-muted-foreground', add: 'text-green-600', remove: 'text-red-600'};

	return (
		<div className={`flex font-mono text-xs leading-relaxed ${styles[type]}`}>
			<span className={`inline-flex w-5 shrink-0 items-center justify-center select-none ${markerColors[type]}`}>
				{markers[type]}
			</span>
			<span className="whitespace-pre-wrap break-all px-1">{line}</span>
		</div>
	);
}

export function DiffStats({added, removed}: {added: number; removed: number}) {
	return (
		<span className="inline-flex gap-1 font-mono text-xs shrink-0">
			{added > 0 && <span className="text-green-600">+{added}</span>}
			{removed > 0 && <span className="text-red-600">-{removed}</span>}
		</span>
	);
}

export function TerminalOutput({content, maxLines = 100}: {content: string; maxLines?: number}) {
	const [showAll, setShowAll] = useState(false);
	const lines = content.split('\n');
	const truncated = !showAll && lines.length > maxLines;
	const displayed = truncated ? lines.slice(0, maxLines).join('\n') : content;

	return (
		<div className="relative">
			<pre className="bg-gray-900 text-gray-100 rounded text-xs leading-relaxed p-2 overflow-x-auto whitespace-pre-wrap break-all">
				{displayed}
			</pre>
			{truncated && (
				<button
					type="button"
					onClick={() => setShowAll(true)}
					className="text-xs text-blue-400 hover:text-blue-300 mt-1"
				>
					Show all {lines.length} lines
				</button>
			)}
		</div>
	);
}

export function CollapsibleSection({
	label,
	defaultOpen = false,
	children,
}: {
	label: ReactNode;
	defaultOpen?: boolean;
	children: ReactNode;
}) {
	const [open, setOpen] = useState(defaultOpen);

	return (
		<div>
			<button
				type="button"
				onClick={() => setOpen(!open)}
				className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground cursor-pointer"
			>
				<svg
					width="14"
					height="14"
					viewBox="0 0 20 20"
					fill="none"
					className="shrink-0 transition-transform duration-200"
					style={{transform: open ? 'rotate(0deg)' : 'rotate(-90deg)'}}
				>
					<path
						d="M14.128 7.165a.625.625 0 0 1 .707-.038l.128.098a.625.625 0 0 1 .037.844l-4.5 5-.157.131a.625.625 0 0 1-.686 0L9.5 13.069l-4.5-5-.07-.107a.625.625 0 0 1 .07-.737l.107-.098a.625.625 0 0 1 .765.038L10 11.585l4.128-4.42Z"
						fill="currentColor"
					/>
				</svg>
				{label}
			</button>
			{open && <div className="mt-1">{children}</div>}
		</div>
	);
}

export function ToolMeta({children}: {children: ReactNode}) {
	return <span className="text-xs text-muted-foreground">{children}</span>;
}

export function formatDuration(ms: number): string {
	if (ms < 1000) return '< 1s';
	if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
	const mins = Math.floor(ms / 60000);
	const secs = Math.round((ms % 60000) / 1000);
	return `${mins}m ${secs}s`;
}

export function DurationBadge({duration}: {duration: number}) {
	return <span className="text-xs text-muted-foreground ml-1.5">{formatDuration(duration)}</span>;
}
