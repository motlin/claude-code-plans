import {
	Globe,
	CheckCircle,
	MousePointer,
	Search,
	Code,
	MessageSquare,
	XCircle,
	AlertTriangle,
	Info,
	FileText,
} from 'lucide-react';
import type {ToolRendererProps} from './types';
import {CollapsibleSection, ErrorBorder} from './shared';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function truncateUrl(url: string, max: number): string {
	if (url.length <= max) return url;
	return url.slice(0, max - 3) + '...';
}

function isHttpUrl(url: string): boolean {
	return url.startsWith('http://') || url.startsWith('https://');
}

function ResultSummary({resultText, maxLines = 10}: {resultText: string; maxLines?: number}) {
	if (!resultText) return null;
	const lines = resultText.split('\n');
	const preview = lines.slice(0, maxLines).join('\n');
	const hasMore = lines.length > maxLines;
	return (
		<div className="bg-muted rounded p-2 max-h-48 overflow-auto">
			<pre className="text-xs text-muted-foreground font-mono whitespace-pre-wrap">
				{preview}
				{hasMore && `\n... (${lines.length - maxLines} more lines)`}
			</pre>
		</div>
	);
}

function logLevelIcon(level: string) {
	switch (level) {
		case 'error':
			return <XCircle className="h-4 w-4 text-red-500" />;
		case 'warning':
		case 'warn':
			return <AlertTriangle className="h-4 w-4 text-amber-500" />;
		case 'info':
			return <Info className="h-4 w-4 text-cyan-500" />;
		default:
			return <MessageSquare className="h-4 w-4 text-muted-foreground" />;
	}
}

function logLevelBadgeClasses(level: string): string {
	switch (level) {
		case 'error':
			return 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300';
		case 'warning':
		case 'warn':
			return 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300';
		case 'info':
			return 'bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-300';
		default:
			return 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400';
	}
}

// ---------------------------------------------------------------------------
// Sub-renderers
// ---------------------------------------------------------------------------

function NavigateRenderer({input, resultText}: {input: Record<string, unknown>; resultText: string}) {
	const url = (input['url'] as string) ?? '';
	const isSuccess = resultText.toLowerCase().includes('navigated to');

	return (
		<div className="px-2 py-2 space-y-2">
			<div className="flex items-center gap-2">
				{isSuccess ? (
					<CheckCircle className="h-4 w-4 text-green-500" />
				) : (
					<Globe className="h-4 w-4 text-blue-500" />
				)}
				<span className="text-sm text-foreground">Navigate</span>
				{url &&
					(isHttpUrl(url) ? (
						<a
							href={url}
							target="_blank"
							rel="noreferrer"
							className="text-sm text-blue-600 hover:underline truncate"
						>
							{truncateUrl(url, 60)}
						</a>
					) : (
						<span className="text-sm text-muted-foreground font-mono truncate">{url}</span>
					))}
			</div>
			<ResultSummary resultText={resultText} />
		</div>
	);
}

function ReadPageRenderer({resultText}: {resultText: string}) {
	return (
		<div className="px-2 py-2 space-y-2">
			<div className="flex items-center gap-2">
				<FileText className="h-4 w-4 text-blue-500" />
				<span className="text-sm text-foreground">Read page content</span>
				<span className="text-xs text-muted-foreground">{resultText.split('\n').length} lines</span>
			</div>
			<CollapsibleSection label="Page content">
				<ResultSummary
					resultText={resultText}
					maxLines={20}
				/>
			</CollapsibleSection>
		</div>
	);
}

function ComputerRenderer({input, resultText}: {input: Record<string, unknown>; resultText: string}) {
	const action = (input['action'] as string) ?? '';
	const coordinate = input['coordinate'] as number[] | undefined;
	const text = (input['text'] as string) ?? '';
	const isError = resultText.toLowerCase().includes('no element found') || resultText.toLowerCase().includes('error');

	const detail = [action, coordinate ? `(${coordinate.join(', ')})` : '', text ? `"${text}"` : '']
		.filter(Boolean)
		.join(' ');

	return (
		<ErrorBorder isError={isError}>
			<div className="px-2 py-2 space-y-2">
				<div className="flex items-center gap-2">
					<MousePointer className="h-4 w-4 text-blue-500" />
					<span className="text-sm text-foreground">Computer action</span>
					{detail && <span className="text-xs text-muted-foreground font-mono truncate">{detail}</span>}
				</div>
				<ResultSummary resultText={resultText} />
			</div>
		</ErrorBorder>
	);
}

function FindRenderer({input, resultText}: {input: Record<string, unknown>; resultText: string}) {
	const description = (input['description'] as string) ?? (input['query'] as string) ?? '';

	return (
		<div className="px-2 py-2 space-y-2">
			<div className="flex items-center gap-2">
				<Search className="h-4 w-4 text-amber-500" />
				<span className="text-sm text-foreground">Find elements</span>
				{description && (
					<span className="text-xs text-muted-foreground truncate">&quot;{description}&quot;</span>
				)}
			</div>
			<ResultSummary resultText={resultText} />
		</div>
	);
}

function TabsContextRenderer({resultText}: {resultText: string}) {
	const lines = resultText
		.split('\n')
		.map((l) => l.trim())
		.filter(Boolean);

	return (
		<div className="px-2 py-2 space-y-1">
			<div className="flex items-center gap-2 mb-2">
				<Globe className="h-4 w-4 text-muted-foreground" />
				<span className="text-sm text-foreground">{lines.length} tab(s)</span>
			</div>
			<div className="bg-muted rounded p-2 max-h-48 overflow-auto">
				<pre className="text-xs text-muted-foreground font-mono whitespace-pre-wrap">{resultText}</pre>
			</div>
		</div>
	);
}

function JavaScriptToolRenderer({input, resultText}: {input: Record<string, unknown>; resultText: string}) {
	const code = (input['code'] as string) ?? (input['expression'] as string) ?? (input['javascript'] as string) ?? '';

	return (
		<div className="px-2 py-2 space-y-2">
			<div className="flex items-center gap-2">
				<Code className="h-4 w-4 text-amber-500" />
				<span className="text-sm text-foreground">Execute JavaScript</span>
			</div>
			{code && (
				<pre className="bg-muted rounded p-2 text-xs text-muted-foreground font-mono whitespace-pre-wrap max-h-32 overflow-auto">
					{code}
				</pre>
			)}
			{resultText && (
				<div className="border-l-2 border-green-200 dark:border-green-800 pl-3">
					<div className="text-xs text-muted-foreground font-medium mb-1">Result</div>
					<pre className="bg-muted rounded p-2 text-xs text-muted-foreground font-mono whitespace-pre-wrap max-h-32 overflow-auto">
						{resultText}
					</pre>
				</div>
			)}
		</div>
	);
}

function ReadConsoleMessagesRenderer({resultText}: {resultText: string}) {
	const lines = resultText
		.split('\n')
		.map((l) => l.trim())
		.filter(Boolean);

	const messages = lines.map((line, i) => {
		// Try "[level] message" format
		const m = /^\[(\w+)\]\s+(.+)$/.exec(line);
		if (m) {
			return {id: i, level: m[1]!, message: m[2]!};
		}
		return {id: i, level: 'log', message: line};
	});

	return (
		<div className="space-y-1 max-h-64 overflow-auto px-2 py-2">
			<div className="text-xs text-muted-foreground mb-1 flex items-center gap-2">
				<MessageSquare className="h-3 w-3" />
				{messages.length} console message(s)
			</div>
			{messages.map((msg) => (
				<div
					key={msg.id}
					className="flex items-start gap-2 px-2 py-1 hover:bg-muted/50 rounded"
				>
					{logLevelIcon(msg.level)}
					<span className={`text-xs px-1.5 py-0.5 rounded shrink-0 ${logLevelBadgeClasses(msg.level)}`}>
						{msg.level}
					</span>
					<span
						className="text-xs text-foreground truncate flex-1"
						title={msg.message}
					>
						{msg.message.length > 80 ? msg.message.slice(0, 77) + '...' : msg.message}
					</span>
				</div>
			))}
		</div>
	);
}

function DefaultRenderer({resultText}: {resultText: string}) {
	if (!resultText) return <span className="text-xs text-muted-foreground">Action completed</span>;
	return (
		<div className="bg-muted rounded p-2 max-h-48 overflow-auto">
			<pre className="text-xs text-muted-foreground font-mono whitespace-pre-wrap">{resultText}</pre>
		</div>
	);
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export function ClaudeInChromeRenderer({toolCall}: ToolRendererProps) {
	// Extract tool name: "mcp__claude-in-chrome__navigate" -> "navigate"
	const tool = toolCall.name.split('__').slice(2).join('__');
	const resultText = toolCall.result ?? '';
	const input = toolCall.input as Record<string, unknown>;

	switch (tool) {
		case 'navigate':
			return (
				<NavigateRenderer
					input={input}
					resultText={resultText}
				/>
			);
		case 'read_page':
			return <ReadPageRenderer resultText={resultText} />;
		case 'computer':
			return (
				<ComputerRenderer
					input={input}
					resultText={resultText}
				/>
			);
		case 'find':
			return (
				<FindRenderer
					input={input}
					resultText={resultText}
				/>
			);
		case 'tabs_context_mcp':
			return <TabsContextRenderer resultText={resultText} />;
		case 'javascript_tool':
			return (
				<JavaScriptToolRenderer
					input={input}
					resultText={resultText}
				/>
			);
		case 'read_console_messages':
			return <ReadConsoleMessagesRenderer resultText={resultText} />;
		default:
			return <DefaultRenderer resultText={resultText} />;
	}
}
