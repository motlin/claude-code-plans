import {
	CheckCircle,
	Globe,
	Camera,
	MousePointer,
	Type,
	Keyboard,
	ArrowLeft,
	X,
	Download,
	GripVertical,
	MessageSquare,
	Network,
	Code,
	Upload,
	Clock,
	Maximize2,
	XCircle,
	AlertTriangle,
	Info,
} from 'lucide-react';
import type {ToolRendererProps} from './types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function truncateUrl(url: string, max: number): string {
	if (url.length <= max) return url;
	return url.slice(0, max - 3) + '...';
}

function extractUrl(input: Record<string, unknown>): string {
	return (input['url'] as string) ?? '';
}

function extractRef(input: Record<string, unknown>): string {
	return (input['ref'] as string) ?? (input['element'] as string) ?? '';
}

function extractValue(input: Record<string, unknown>): string {
	return (input['value'] as string) ?? (input['text'] as string) ?? '';
}

function ResultSummary({resultText}: {resultText: string}) {
	if (!resultText) return null;
	const lines = resultText.split('\n');
	const preview = lines.slice(0, 5).join('\n');
	const hasMore = lines.length > 5;
	return (
		<div className="bg-muted rounded p-2 max-h-48 overflow-auto">
			<pre className="text-xs text-muted-foreground font-mono whitespace-pre-wrap">
				{preview}
				{hasMore && `\n... (${lines.length - 5} more lines)`}
			</pre>
		</div>
	);
}

function ActionResult({
	icon,
	label,
	detail,
	resultText,
}: {
	icon: React.ReactNode;
	label: string;
	detail?: string | undefined;
	resultText: string;
}) {
	return (
		<div className="px-2 py-2 space-y-2">
			<div className="flex items-center gap-2">
				{icon}
				<span className="text-sm text-foreground">{label}</span>
				{detail && <span className="text-xs text-muted-foreground font-mono truncate">{detail}</span>}
			</div>
			<ResultSummary resultText={resultText} />
		</div>
	);
}

// ---------------------------------------------------------------------------
// Sub-renderers
// ---------------------------------------------------------------------------

/**
 * Strip the URL from result text when it duplicates the input URL.
 */
function stripNavigateUrlFromResult(resultText: string, url: string): string {
	if (!url || !resultText) return resultText;
	const lines = resultText.split('\n');
	const filtered = lines.filter((line) => {
		const trimmed = line.trim();
		if (trimmed === url) return false;
		if (/^navigated to\s+/i.test(trimmed) && trimmed.toLowerCase().includes(url.toLowerCase())) return false;
		if (/^page loaded:\s+/i.test(trimmed) && trimmed.toLowerCase().includes(url.toLowerCase())) return false;
		return true;
	});
	return filtered.join('\n').trim();
}

function NavigateRenderer({input, resultText}: {input: Record<string, unknown>; resultText: string}) {
	const url = extractUrl(input);
	const cleanedResult = stripNavigateUrlFromResult(resultText, url);

	return (
		<div className="px-2 py-2 space-y-2">
			<div className="flex items-center gap-2">
				<CheckCircle className="h-4 w-4 text-green-500" />
				<span className="text-sm text-foreground">Navigated successfully</span>
			</div>
			{cleanedResult && <ResultSummary resultText={cleanedResult} />}
		</div>
	);
}

function SnapshotRenderer({resultText}: {resultText: string}) {
	const rootMatch = /RootWebArea\s+"([^"]*)"(?:\s+url="([^"]*)")?/.exec(resultText);
	const title = rootMatch?.[1] ?? '';
	const url = rootMatch?.[2] ?? '';

	const lines = resultText.split('\n');
	const maxLines = 20;
	const displayedLines = lines.slice(0, maxLines);
	const remainingCount = lines.length - maxLines;

	return (
		<div className="px-2 py-2 space-y-2">
			<div className="flex items-center gap-2">
				<Network className="h-4 w-4 text-indigo-500" />
				<span className="text-sm text-foreground">Accessibility snapshot</span>
				{title && <span className="text-xs text-muted-foreground truncate">&quot;{title}&quot;</span>}
			</div>
			{url && (
				<a
					href={url}
					target="_blank"
					rel="noreferrer"
					className="text-xs text-blue-600 hover:underline block truncate"
				>
					{url}
				</a>
			)}
			<div className="bg-muted rounded p-2 max-h-48 overflow-auto">
				<pre className="text-xs text-muted-foreground font-mono whitespace-pre">
					{displayedLines.join('\n')}
					{remainingCount > 0 && `\n... (${remainingCount} more nodes)`}
				</pre>
			</div>
		</div>
	);
}

function ScreenshotRenderer({resultText}: {resultText: string}) {
	const pathMatch = /Saved screenshot to (.+)/.exec(resultText) ?? /Screenshot saved to (.+)/.exec(resultText);
	const path = pathMatch?.[1]?.trim() ?? '';

	return (
		<div className="px-2 py-2 space-y-2">
			<div className="flex items-center gap-2">
				<Camera className="h-4 w-4 text-purple-500" />
				<span className="text-sm text-foreground">Screenshot captured</span>
				{path && <span className="text-xs text-muted-foreground font-mono truncate">{path}</span>}
			</div>
			{path && (
				<img
					src={`file://${path}`}
					alt="Screenshot"
					className="max-w-full rounded border border-border"
					style={{maxHeight: 300}}
					onError={(e) => {
						(e.target as HTMLImageElement).style.display = 'none';
					}}
				/>
			)}
			{!path && <ResultSummary resultText={resultText} />}
		</div>
	);
}

function ClickRenderer({input, resultText}: {input: Record<string, unknown>; resultText: string}) {
	const ref = extractRef(input);
	return (
		<ActionResult
			icon={<MousePointer className="h-4 w-4 text-blue-500" />}
			label="Clicked"
			detail={ref ? `ref=${ref}` : undefined}
			resultText={resultText}
		/>
	);
}

function FillFormRenderer({input, resultText}: {input: Record<string, unknown>; resultText: string}) {
	const ref = extractRef(input);
	const value = extractValue(input);
	const detail = [ref ? `ref=${ref}` : '', value ? `"${value}"` : ''].filter(Boolean).join(' ');
	return (
		<ActionResult
			icon={<Type className="h-4 w-4 text-green-500" />}
			label="Filled form field"
			detail={detail || undefined}
			resultText={resultText}
		/>
	);
}

function TypeRenderer({input, resultText}: {input: Record<string, unknown>; resultText: string}) {
	const ref = extractRef(input);
	const text = extractValue(input);
	const detail = [ref ? `ref=${ref}` : '', text ? `"${text}"` : ''].filter(Boolean).join(' ');
	return (
		<ActionResult
			icon={<Keyboard className="h-4 w-4 text-green-500" />}
			label="Typed text"
			detail={detail || undefined}
			resultText={resultText}
		/>
	);
}

function PressKeyRenderer({input, resultText}: {input: Record<string, unknown>; resultText: string}) {
	const key = (input['key'] as string) ?? '';
	return (
		<ActionResult
			icon={<Keyboard className="h-4 w-4 text-amber-500" />}
			label="Pressed key"
			detail={key}
			resultText={resultText}
		/>
	);
}

function HoverRenderer({input, resultText}: {input: Record<string, unknown>; resultText: string}) {
	const ref = extractRef(input);
	return (
		<ActionResult
			icon={<MousePointer className="h-4 w-4 text-cyan-500" />}
			label="Hovered"
			detail={ref ? `ref=${ref}` : undefined}
			resultText={resultText}
		/>
	);
}

function SelectOptionRenderer({input, resultText}: {input: Record<string, unknown>; resultText: string}) {
	const ref = extractRef(input);
	const values = (input['values'] as string[]) ?? [];
	const detail = [ref ? `ref=${ref}` : '', values.length > 0 ? values.join(', ') : ''].filter(Boolean).join(' ');
	return (
		<ActionResult
			icon={<CheckCircle className="h-4 w-4 text-green-500" />}
			label="Selected option"
			detail={detail || undefined}
			resultText={resultText}
		/>
	);
}

function TabsRenderer({resultText}: {resultText: string}) {
	const lines = resultText
		.split('\n')
		.map((l) => l.trim())
		.filter(Boolean);

	return (
		<div className="px-2 py-2 space-y-1">
			<div className="flex items-center gap-2 mb-2">
				<Globe className="h-4 w-4 text-muted-foreground" />
				<span className="text-sm text-foreground">{lines.length} tab(s) open</span>
			</div>
			<div className="bg-muted rounded p-2 max-h-48 overflow-auto">
				<pre className="text-xs text-muted-foreground font-mono whitespace-pre-wrap">{resultText}</pre>
			</div>
		</div>
	);
}

function logLevelIcon(level: string) {
	switch (level) {
		case 'error':
			return <XCircle className="h-4 w-4 text-red-500" />;
		case 'warning':
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
			return 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300';
		case 'info':
			return 'bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-300';
		default:
			return 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400';
	}
}

function ConsoleMessagesRenderer({resultText}: {resultText: string}) {
	const lines = resultText
		.split('\n')
		.map((l) => l.trim())
		.filter(Boolean);

	// Try to parse structured lines like "[level] message"
	const messages = lines.map((line, i) => {
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

function httpMethodClasses(method: string): string {
	switch (method) {
		case 'GET':
			return 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300';
		case 'POST':
			return 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300';
		case 'PUT':
			return 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300';
		case 'DELETE':
			return 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300';
		case 'PATCH':
			return 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300';
		default:
			return 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400';
	}
}

function NetworkRequestsRenderer({resultText}: {resultText: string}) {
	const lines = resultText
		.split('\n')
		.map((l) => l.trim())
		.filter(Boolean);

	// Try to parse structured network lines
	const requests = lines.map((line, i) => {
		const m = /^(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS)\s+(\S+)\s+(\d+)/.exec(line);
		if (m) {
			return {id: i, method: m[1]!, url: m[2]!, status: parseInt(m[3]!, 10)};
		}
		return {id: i, method: '', url: line, status: 0};
	});

	return (
		<div className="space-y-1 max-h-64 overflow-auto px-2 py-2">
			<div className="text-xs text-muted-foreground mb-1 flex items-center gap-2">
				<Network className="h-3 w-3" />
				{requests.length} network request(s)
			</div>
			{requests.map((req) => (
				<div
					key={req.id}
					className="flex items-center gap-2 px-2 py-1 hover:bg-muted/50 rounded text-xs"
				>
					{req.method && (
						<span className={`px-1.5 py-0.5 rounded font-mono ${httpMethodClasses(req.method)}`}>
							{req.method}
						</span>
					)}
					{req.status > 0 && (
						<span
							className={`px-1.5 py-0.5 rounded ${
								req.status >= 400
									? 'bg-red-100 text-red-700'
									: req.status >= 300
										? 'bg-amber-100 text-amber-700'
										: 'bg-green-100 text-green-700'
							}`}
						>
							{req.status}
						</span>
					)}
					<span className="text-muted-foreground truncate flex-1 font-mono">{truncateUrl(req.url, 60)}</span>
				</div>
			))}
		</div>
	);
}

function EvaluateRenderer({input, resultText}: {input: Record<string, unknown>; resultText: string}) {
	const expression = (input['expression'] as string) ?? (input['code'] as string) ?? '';
	return (
		<div className="px-2 py-2 space-y-2">
			<div className="flex items-center gap-2">
				<Code className="h-4 w-4 text-amber-500" />
				<span className="text-sm text-foreground">Evaluated JavaScript</span>
			</div>
			{expression && (
				<pre className="bg-muted rounded p-2 text-xs text-muted-foreground font-mono whitespace-pre-wrap max-h-32 overflow-auto">
					{expression}
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

function DefaultPlaywrightRenderer({resultText}: {resultText: string}) {
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

export function PlaywrightRenderer({toolCall}: ToolRendererProps) {
	// Extract tool name: "mcp__plugin_playwright_playwright__browser_navigate" -> "browser_navigate"
	const tool = toolCall.name.split('__').slice(2).join('__');
	const resultText = toolCall.result ?? '';
	const input = toolCall.input as Record<string, unknown>;

	switch (tool) {
		case 'browser_navigate':
			return (
				<NavigateRenderer
					input={input}
					resultText={resultText}
				/>
			);
		case 'browser_navigate_back':
			return (
				<ActionResult
					icon={<ArrowLeft className="h-4 w-4 text-blue-500" />}
					label="Navigated back"
					resultText={resultText}
				/>
			);
		case 'browser_snapshot':
			return <SnapshotRenderer resultText={resultText} />;
		case 'browser_take_screenshot':
			return <ScreenshotRenderer resultText={resultText} />;
		case 'browser_click':
			return (
				<ClickRenderer
					input={input}
					resultText={resultText}
				/>
			);
		case 'browser_fill_form':
			return (
				<FillFormRenderer
					input={input}
					resultText={resultText}
				/>
			);
		case 'browser_type':
			return (
				<TypeRenderer
					input={input}
					resultText={resultText}
				/>
			);
		case 'browser_press_key':
			return (
				<PressKeyRenderer
					input={input}
					resultText={resultText}
				/>
			);
		case 'browser_hover':
			return (
				<HoverRenderer
					input={input}
					resultText={resultText}
				/>
			);
		case 'browser_select_option':
			return (
				<SelectOptionRenderer
					input={input}
					resultText={resultText}
				/>
			);
		case 'browser_tabs':
			return <TabsRenderer resultText={resultText} />;
		case 'browser_console_messages':
			return <ConsoleMessagesRenderer resultText={resultText} />;
		case 'browser_network_requests':
			return <NetworkRequestsRenderer resultText={resultText} />;
		case 'browser_evaluate':
		case 'browser_run_code':
			return (
				<EvaluateRenderer
					input={input}
					resultText={resultText}
				/>
			);
		case 'browser_file_upload':
			return (
				<ActionResult
					icon={<Upload className="h-4 w-4 text-blue-500" />}
					label="Uploaded file"
					detail={(input['paths'] as string[] | undefined)?.join(', ')}
					resultText={resultText}
				/>
			);
		case 'browser_drag':
			return (
				<ActionResult
					icon={<GripVertical className="h-4 w-4 text-purple-500" />}
					label="Drag and drop"
					resultText={resultText}
				/>
			);
		case 'browser_handle_dialog':
			return (
				<ActionResult
					icon={<MessageSquare className="h-4 w-4 text-amber-500" />}
					label="Handled dialog"
					detail={(input['action'] as string) ?? undefined}
					resultText={resultText}
				/>
			);
		case 'browser_wait_for':
			return (
				<ActionResult
					icon={<Clock className="h-4 w-4 text-cyan-500" />}
					label="Waited for condition"
					resultText={resultText}
				/>
			);
		case 'browser_resize':
			return (
				<ActionResult
					icon={<Maximize2 className="h-4 w-4 text-blue-500" />}
					label="Resized viewport"
					detail={input['width'] && input['height'] ? `${input['width']}x${input['height']}` : undefined}
					resultText={resultText}
				/>
			);
		case 'browser_close':
			return (
				<ActionResult
					icon={<X className="h-4 w-4 text-red-500" />}
					label="Browser closed"
					resultText={resultText}
				/>
			);
		case 'browser_install':
			return (
				<ActionResult
					icon={<Download className="h-4 w-4 text-green-500" />}
					label="Browser installed"
					resultText={resultText}
				/>
			);
		default:
			return <DefaultPlaywrightRenderer resultText={resultText} />;
	}
}
