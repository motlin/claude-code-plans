import {
	CheckCircle,
	Globe,
	File,
	AlertTriangle,
	XCircle,
	Info,
	MessageSquare,
	Camera,
	Network,
	Plug,
	ArrowRight,
	ArrowLeft,
} from 'lucide-react';
import type {ToolRendererProps} from './types';

// ---------------------------------------------------------------------------
// Shared parsers
// ---------------------------------------------------------------------------

interface PageInfo {
	index: number;
	url: string;
	selected: boolean;
}

export function parsePageList(text: string): PageInfo[] {
	const pages: PageInfo[] = [];
	for (const line of text.split('\n')) {
		const m = /^(\d+):\s+(.+?)(\s+\[selected\])?$/.exec(line.trim());
		if (m) {
			pages.push({
				index: parseInt(m[1]!, 10),
				url: m[2]!,
				selected: !!m[3],
			});
		}
	}
	return pages;
}

interface ConsoleMessage {
	msgid: string;
	level: string;
	message: string;
	argCount?: number;
}

export function parseConsoleMessage(line: string): ConsoleMessage | null {
	const m = /^msgid=(\d+)\s+\[(\w+)\]\s+(.+?)(?:\s+\((\d+)\s+args?\))?$/.exec(line.trim());
	if (!m) return null;
	const result: ConsoleMessage = {
		msgid: m[1]!,
		level: m[2]!,
		message: m[3]!,
	};
	if (m[4]) {
		result.argCount = parseInt(m[4], 10);
	}
	return result;
}

interface NetworkRequest {
	reqid: string;
	method: string;
	url: string;
	status: string;
	statusCode?: number;
}

export function parseNetworkRequest(line: string): NetworkRequest | null {
	const m = /^reqid=(\d+)\s+(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS)\s+(\S+)\s+\[(\w+)(?:\s*-\s*(\d+))?\]/.exec(
		line.trim(),
	);
	if (!m) return null;
	const result: NetworkRequest = {
		reqid: m[1]!,
		method: m[2]!,
		url: m[3]!,
		status: m[4]!,
	};
	if (m[5]) {
		result.statusCode = parseInt(m[5], 10);
	}
	return result;
}

// ---------------------------------------------------------------------------
// Style helpers
// ---------------------------------------------------------------------------

function logLevelBadgeClasses(level: string): string {
	switch (level) {
		case 'error':
			return 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300';
		case 'warn':
			return 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300';
		case 'issue':
			return 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300';
		case 'info':
			return 'bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-300';
		default:
			return 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400';
	}
}

function logLevelIcon(level: string) {
	switch (level) {
		case 'error':
			return <XCircle className="h-4 w-4 text-red-500" />;
		case 'warn':
			return <AlertTriangle className="h-4 w-4 text-amber-500" />;
		case 'issue':
			return <Info className="h-4 w-4 text-blue-500" />;
		case 'info':
			return <Info className="h-4 w-4 text-cyan-500" />;
		default:
			return <MessageSquare className="h-4 w-4 text-muted-foreground" />;
	}
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

function statusCodeClasses(status: string, code?: number): string {
	if (status === 'failed' || (code !== undefined && code >= 400)) {
		return 'bg-red-100 text-red-700';
	}
	if (code !== undefined && code >= 300 && code < 400) {
		return 'bg-amber-100 text-amber-700';
	}
	if (status === 'success' || (code !== undefined && code >= 200 && code < 300)) {
		return 'bg-green-100 text-green-700';
	}
	return 'bg-gray-100 text-gray-600';
}

function truncateUrl(url: string, max: number): string {
	if (url.length <= max) return url;
	return url.slice(0, max - 3) + '...';
}

function truncateUrlEnd(url: string, max: number): string {
	if (url.length <= max) return url;
	return '...' + url.slice(url.length - (max - 3));
}

function isHttpUrl(url: string): boolean {
	return url.startsWith('http://') || url.startsWith('https://');
}

// ---------------------------------------------------------------------------
// Shared components
// ---------------------------------------------------------------------------

function PageList({pages}: {pages: PageInfo[]}) {
	if (pages.length === 0) return null;
	return (
		<div className="space-y-0.5">
			{pages.map((page) => (
				<div
					key={page.index}
					className={`flex items-center gap-2 px-2 py-1 rounded text-xs ${
						page.selected ? 'bg-blue-50 dark:bg-blue-950/30' : 'hover:bg-muted/50'
					}`}
				>
					<File className={`h-3 w-3 ${page.selected ? 'text-blue-500' : 'text-muted-foreground'}`} />
					<span className="text-muted-foreground w-4">{page.index}</span>
					{isHttpUrl(page.url) ? (
						<a
							href={page.url}
							target="_blank"
							rel="noreferrer"
							className={`hover:text-blue-600 hover:underline truncate ${
								page.selected ? 'text-foreground' : 'text-muted-foreground'
							}`}
						>
							{page.url}
						</a>
					) : (
						<span className="text-muted-foreground italic truncate">{page.url}</span>
					)}
					{page.selected && <span className="text-xs text-blue-600 font-medium ml-auto">active</span>}
				</div>
			))}
		</div>
	);
}

// ---------------------------------------------------------------------------
// Sub-renderers
// ---------------------------------------------------------------------------

function NavigatePageRenderer({resultText}: {resultText: string}) {
	const urlMatch = /Successfully navigated to (.+)/.exec(resultText);
	const url = urlMatch?.[1]?.trim() ?? '';
	const pages = parsePageList(resultText);

	return (
		<div className="px-2 py-2 space-y-2">
			<div className="flex items-center gap-2">
				<CheckCircle className="h-4 w-4 text-green-500" />
				<span className="text-sm text-foreground">Navigated to</span>
				{url && (
					<a
						href={url}
						target="_blank"
						rel="noreferrer"
						className="text-sm text-blue-600 hover:underline truncate"
					>
						{truncateUrl(url, 60)}
					</a>
				)}
			</div>
			<PageList pages={pages} />
		</div>
	);
}

function NewPageRenderer({resultText}: {resultText: string}) {
	const pages = parsePageList(resultText);
	return (
		<div className="px-2 py-2 space-y-2">
			<div className="flex items-center gap-2">
				<CheckCircle className="h-4 w-4 text-green-500" />
				<span className="text-sm text-foreground">New page created</span>
			</div>
			<PageList pages={pages} />
		</div>
	);
}

function ClosePageRenderer({resultText}: {resultText: string}) {
	const pages = parsePageList(resultText);
	return (
		<div className="px-2 py-2 space-y-2">
			<div className="flex items-center gap-2">
				<CheckCircle className="h-4 w-4 text-green-500" />
				<span className="text-sm text-foreground">Page closed</span>
			</div>
			<PageList pages={pages} />
		</div>
	);
}

function ListPagesRenderer({resultText}: {resultText: string}) {
	const pages = parsePageList(resultText);
	return (
		<div className="px-2 py-2">
			<div className="flex items-center gap-2 mb-2">
				<Globe className="h-4 w-4 text-muted-foreground" />
				<span className="text-sm text-foreground">{pages.length} page(s) open</span>
			</div>
			<PageList pages={pages} />
		</div>
	);
}

function ListConsoleMessagesRenderer({resultText}: {resultText: string}) {
	const lines = resultText.split('\n').filter((l) => l.trim());
	const messages: ConsoleMessage[] = [];
	let totalLine: string | undefined;

	for (const line of lines) {
		const parsed = parseConsoleMessage(line);
		if (parsed) {
			messages.push(parsed);
		} else if (/^\d+\s+messages?\s+total$/i.test(line.trim()) || /^Showing\s+/i.test(line.trim())) {
			totalLine = line.trim();
		}
	}

	return (
		<div className="space-y-1 max-h-64 overflow-auto">
			{totalLine && <div className="text-xs text-muted-foreground px-2 py-1">{totalLine}</div>}
			{messages.map((msg) => (
				<div
					key={msg.msgid}
					className="flex items-start gap-2 px-2 py-1 hover:bg-muted/50 rounded"
				>
					<span className="text-xs text-muted-foreground w-6 shrink-0">#{msg.msgid}</span>
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

function GetConsoleMessageRenderer({resultText}: {resultText: string}) {
	// Parse ID, level, message, and arguments
	const idMatch = /^ID:\s*(\d+)/m.exec(resultText);
	const msgMatch = /^Message:\s*(\w+)>\s*(.+)/m.exec(resultText);
	const msgid = idMatch?.[1] ?? '?';
	const level = msgMatch?.[1] ?? 'log';
	const message = msgMatch?.[2] ?? resultText;

	// Parse arguments section
	const argsSection = resultText.split('### Arguments')[1];
	const args: Array<{index: number; value: string}> = [];
	if (argsSection) {
		const argMatches = argsSection.matchAll(/Arg\s+#(\d+):\s*([\s\S]*?)(?=Arg\s+#|\s*$)/g);
		for (const m of argMatches) {
			args.push({index: parseInt(m[1]!, 10), value: m[2]!.trim()});
		}
	}

	return (
		<div className="px-2 py-2 space-y-2">
			<div className="flex items-start gap-2">
				{logLevelIcon(level)}
				<span className="text-xs text-muted-foreground">#{msgid}</span>
				<span className={`text-xs px-1.5 py-0.5 rounded ${logLevelBadgeClasses(level)}`}>{level}</span>
			</div>
			<div className="text-sm text-foreground font-mono break-words">{message}</div>
			{args.length > 0 && (
				<div className="space-y-1 border-l-2 border-border pl-3 mt-2">
					<div className="text-xs text-muted-foreground font-medium">Arguments</div>
					{args.map((arg) => {
						let isJson = false;
						let formatted = arg.value;
						try {
							const parsed = JSON.parse(arg.value);
							formatted = JSON.stringify(parsed, null, 2);
							isJson = true;
						} catch {
							// plain text
						}
						return (
							<div
								key={arg.index}
								className="text-xs"
							>
								<span className="text-muted-foreground">arg[{arg.index}]: </span>
								{isJson ? (
									<pre className="text-muted-foreground font-mono whitespace-pre-wrap bg-muted rounded p-1 mt-0.5 text-xs overflow-auto max-h-32">
										{formatted}
									</pre>
								) : (
									<span className="text-foreground font-mono">{formatted}</span>
								)}
							</div>
						);
					})}
				</div>
			)}
		</div>
	);
}

function TakeScreenshotRenderer({resultText}: {resultText: string}) {
	const pathMatch = /Saved screenshot to (.+)/.exec(resultText);
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
		</div>
	);
}

function ScreenshotRenderer({path}: {path: string}) {
	return (
		<div className="px-2 py-2 space-y-2">
			<div className="flex items-center gap-2">
				<Camera className="h-4 w-4 text-purple-500" />
				<span className="text-sm text-foreground">Screenshot</span>
				<span className="text-xs text-muted-foreground font-mono truncate">{path}</span>
			</div>
			<img
				src={`file://${path}`}
				alt="Screenshot"
				className="max-w-full rounded border border-border"
				style={{maxHeight: 300}}
				onError={(e) => {
					(e.target as HTMLImageElement).style.display = 'none';
				}}
			/>
		</div>
	);
}

function TakeSnapshotRenderer({resultText}: {resultText: string}) {
	// Extract page title and URL from RootWebArea line
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

function ListNetworkRequestsRenderer({resultText}: {resultText: string}) {
	const lines = resultText.split('\n').filter((l) => l.trim());
	const requests: NetworkRequest[] = [];

	for (const line of lines) {
		const parsed = parseNetworkRequest(line);
		if (parsed) {
			requests.push(parsed);
		}
	}

	return (
		<div className="space-y-1 max-h-64 overflow-auto">
			<div className="text-xs text-muted-foreground px-2 py-1 flex items-center gap-2">
				<Plug className="h-3 w-3" />
				{requests.length} requests
			</div>
			{requests.map((req) => (
				<div
					key={req.reqid}
					className="flex items-center gap-2 px-2 py-1 hover:bg-muted/50 rounded text-xs"
				>
					<span className="text-muted-foreground w-8">#{req.reqid}</span>
					<span className={`px-1.5 py-0.5 rounded font-mono ${httpMethodClasses(req.method)}`}>
						{req.method}
					</span>
					{req.statusCode !== undefined && (
						<span className={`px-1.5 py-0.5 rounded ${statusCodeClasses(req.status, req.statusCode)}`}>
							{req.statusCode}
						</span>
					)}
					{isHttpUrl(req.url) ? (
						<a
							href={req.url}
							target="_blank"
							rel="noreferrer"
							className="text-muted-foreground hover:text-blue-600 hover:underline truncate flex-1 font-mono"
						>
							{truncateUrlEnd(req.url, 60)}
						</a>
					) : (
						<span className="text-muted-foreground truncate flex-1 font-mono">
							{truncateUrlEnd(req.url, 60)}
						</span>
					)}
				</div>
			))}
		</div>
	);
}

function GetNetworkRequestRenderer({resultText}: {resultText: string}) {
	// Parse URL from "## Request <url>"
	const urlMatch = /^##\s+Request\s+(.+)/m.exec(resultText);
	const url = urlMatch?.[1]?.trim() ?? '';

	// Parse status from "Status: [status - code]"
	const statusMatch = /^Status:\s+\[(\w+)(?:\s*-\s*(\d+))?\]/m.exec(resultText);
	const status = statusMatch?.[1] ?? '';
	const statusCode = statusMatch?.[2] ? parseInt(statusMatch[2], 10) : undefined;

	// Parse headers (- Name: Value lines)
	function parseHeaders(section: string): Array<{name: string; value: string}> {
		const headers: Array<{name: string; value: string}> = [];
		for (const line of section.split('\n')) {
			const m = /^-\s+(.+?):\s+(.+)/.exec(line.trim());
			if (m) {
				headers.push({name: m[1]!, value: m[2]!});
			}
		}
		return headers;
	}

	// Split into sections
	const reqHeadersSection = resultText.split('### Request Headers')[1]?.split('###')[0] ?? '';
	const reqBodySection = resultText.split('### Request Body')[1]?.split('###')[0] ?? '';
	const resHeadersSection = resultText.split('### Response Headers')[1]?.split('###')[0] ?? '';
	const resBodySection = resultText.split('### Response Body')[1]?.split('###')[0] ?? '';

	const reqHeaders = parseHeaders(reqHeadersSection);
	const resHeaders = parseHeaders(resHeadersSection);
	const reqBody = reqBodySection.trim();
	const resBody = resBodySection.trim();

	function formatBody(body: string): string {
		if (!body) return body;
		if (body.startsWith('{') || body.startsWith('[')) {
			try {
				return JSON.stringify(JSON.parse(body), null, 2);
			} catch {
				// not valid JSON
			}
		}
		return body.length > 2000 ? body.slice(0, 2000) + '...' : body;
	}

	function HeadersList({headers}: {headers: Array<{name: string; value: string}>}) {
		return (
			<div className="mt-1 bg-muted rounded p-2 max-h-32 overflow-auto">
				{headers.map((h, i) => (
					<div
						key={i}
						className="font-mono"
					>
						<span className="text-muted-foreground">{h.name}:</span>
						<span className="text-foreground"> {h.value}</span>
					</div>
				))}
			</div>
		);
	}

	const statusLabel = statusCode !== undefined ? `${statusCode} ${status}` : status;

	return (
		<div className="px-2 py-2 space-y-3 max-h-96 overflow-auto">
			<div className="space-y-1">
				{url && (
					<a
						href={url}
						target="_blank"
						rel="noreferrer"
						className="text-sm text-blue-600 hover:underline font-mono break-all"
					>
						{url}
					</a>
				)}
				{statusLabel && (
					<span
						className={`inline-block px-2 py-0.5 rounded text-xs ${statusCodeClasses(status, statusCode)}`}
					>
						{statusLabel}
					</span>
				)}
			</div>

			{/* Request section */}
			{(reqHeaders.length > 0 || reqBody) && (
				<div className="border-l-2 border-blue-200 dark:border-blue-800 pl-3 space-y-2">
					<div className="flex items-center gap-1 text-xs font-medium text-blue-600">
						<ArrowRight className="h-3 w-3" /> Request
					</div>
					{reqHeaders.length > 0 && (
						<details className="text-xs">
							<summary className="text-muted-foreground cursor-pointer hover:text-foreground">
								Headers ({reqHeaders.length})
							</summary>
							<HeadersList headers={reqHeaders} />
						</details>
					)}
					{reqBody && (
						<details className="text-xs">
							<summary className="text-muted-foreground cursor-pointer hover:text-foreground">
								Body
							</summary>
							<pre className="mt-1 bg-muted rounded p-2 max-h-32 overflow-auto text-muted-foreground font-mono whitespace-pre-wrap">
								{formatBody(reqBody)}
							</pre>
						</details>
					)}
				</div>
			)}

			{/* Response section */}
			{(resHeaders.length > 0 || resBody) && (
				<div className="border-l-2 border-green-200 dark:border-green-800 pl-3 space-y-2">
					<div className="flex items-center gap-1 text-xs font-medium text-green-600">
						<ArrowLeft className="h-3 w-3" /> Response
					</div>
					{resHeaders.length > 0 && (
						<details className="text-xs">
							<summary className="text-muted-foreground cursor-pointer hover:text-foreground">
								Headers ({resHeaders.length})
							</summary>
							<HeadersList headers={resHeaders} />
						</details>
					)}
					{resBody && (
						<details
							className="text-xs"
							open
						>
							<summary className="text-muted-foreground cursor-pointer hover:text-foreground">
								Body
							</summary>
							<pre className="mt-1 bg-muted rounded p-2 max-h-48 overflow-auto text-muted-foreground font-mono whitespace-pre-wrap text-xs">
								{formatBody(resBody)}
							</pre>
						</details>
					)}
				</div>
			)}
		</div>
	);
}

function DefaultCdpRenderer({resultText}: {resultText: string}) {
	return (
		<div className="bg-gray-900 rounded p-3 max-h-64 overflow-auto">
			<pre className="text-xs text-gray-100 font-mono whitespace-pre-wrap">{resultText}</pre>
		</div>
	);
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export function ChromeDevtoolsRenderer({toolCall}: ToolRendererProps) {
	// Extract tool name: "mcp__chrome-devtools__navigate_page" -> "navigate_page"
	const tool = toolCall.name.split('__').slice(2).join('__');
	const resultText = toolCall.result ?? '';

	// Try to parse result as JSON for screenshot path detection
	let parsedResult: Record<string, unknown> | null = null;
	try {
		parsedResult = JSON.parse(resultText) as Record<string, unknown>;
	} catch {
		/* text result */
	}

	// Handle screenshot results (screenshot_path or path field pointing to image)
	const screenshotPath = (parsedResult?.['screenshot_path'] ?? parsedResult?.['path']) as string | undefined;
	if (screenshotPath && /\.(png|jpg|jpeg|gif|webp)$/i.test(screenshotPath)) {
		return <ScreenshotRenderer path={screenshotPath} />;
	}

	if (!resultText) return <span className="text-xs text-muted-foreground">No result</span>;

	switch (tool) {
		case 'navigate_page':
			return <NavigatePageRenderer resultText={resultText} />;
		case 'new_page':
			return <NewPageRenderer resultText={resultText} />;
		case 'close_page':
			return <ClosePageRenderer resultText={resultText} />;
		case 'list_pages':
			return <ListPagesRenderer resultText={resultText} />;
		case 'list_console_messages':
			return <ListConsoleMessagesRenderer resultText={resultText} />;
		case 'get_console_message':
			return <GetConsoleMessageRenderer resultText={resultText} />;
		case 'take_screenshot':
			return <TakeScreenshotRenderer resultText={resultText} />;
		case 'take_snapshot':
			return <TakeSnapshotRenderer resultText={resultText} />;
		case 'list_network_requests':
			return <ListNetworkRequestsRenderer resultText={resultText} />;
		case 'get_network_request':
			return <GetNetworkRequestRenderer resultText={resultText} />;
		default:
			return <DefaultCdpRenderer resultText={resultText} />;
	}
}
