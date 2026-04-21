import {createFileRoute, Link, useRouter} from '@tanstack/react-router';
import type {ErrorComponentProps} from '@tanstack/react-router';
import {createServerFn} from '@tanstack/react-start';
import {queryOptions, useSuspenseQuery} from '@tanstack/react-query';
import {z} from 'zod';
import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {SessionChat} from '../components/session-chat';
import {ChatInput} from '../components/chat-input';
import {StreamingMessage} from '../components/streaming-message';
import {useChatStream} from '../hooks/use-chat-stream';
import {AskUserQuestionProvider, type AskUserQuestionContextValue} from '../components/ask-user-question-context';
import {getSubagentTree, getSessionSummary, requestSummary, isStarred, toggleSessionStar} from '../lib/server-fns';
import {useIsSessionActive, useStatusline} from '../hooks/use-claude-events';
import {StatusFooter} from '../components/status-footer';
import type {SerializedToolResultMap} from '../components/tool-renderers';
import {ArrowLeft, ArrowUp, ArrowDown, Copy, Terminal, GitFork, Download, Maximize2, Minimize2} from 'lucide-react';
import {DetailTopBar, pillStyles} from '../components/detail-top-bar';
import {SubagentTree} from '../components/subagent-tree';
import {SubagentGantt} from '../components/subagent-gantt';
import {SubagentSequence} from '../components/subagent-sequence';
import {useDebug} from '../components/debug-provider';

const getSession = createServerFn({method: 'GET'})
	.inputValidator(z.object({id: z.string()}))
	.handler(async ({data: {id}}) => {
		const {homedir} = await import('node:os');
		const {join} = await import('node:path');
		const projectsDir = join(homedir(), '.claude', 'projects');
		const {readSessionLines} = await import('../lib/sessions');
		const [detail, subagentResult, starResult] = await Promise.all([
			readSessionLines(projectsDir, id),
			getSubagentTree({data: id}),
			isStarred({data: id}),
		]);
		if (!detail) return null;

		const {getDb} = await import('../lib/db');
		const {getSessionProjectPath, getSessionMeta, getTaskCountsForProject} = await import('../lib/db/queries');
		const {index} = getDb();
		const projectPath = getSessionProjectPath(index, id);
		const sessionMeta = getSessionMeta(index, id);

		let pendingTaskCount = 0;
		if (sessionMeta?.projectName) {
			const taskCounts = getTaskCountsForProject(index, sessionMeta.projectName);
			pendingTaskCount = taskCounts.pending + taskCounts.inProgress;
		}

		let gitSha: string | null = null;
		let gitClean: boolean | null = null;
		if (projectPath) {
			try {
				const {execSync} = await import('node:child_process');
				const execOpts = {cwd: projectPath, encoding: 'utf-8', stdio: 'pipe'} as const;
				gitSha = execSync('git rev-parse --short HEAD', execOpts).trim();
				const status = execSync('git status --porcelain', execOpts).trim();
				gitClean = status.length === 0;
			} catch {
				// not a git repo or git not available
			}
		}

		return {
			title: detail.title,
			projectName: detail.projectName,
			projectId: detail.projectId,
			lines: detail.lines,
			toolResultMap: Array.from(detail.toolResultMap.entries()) as SerializedToolResultMap,
			subagentTree: subagentResult.tree,
			subagentCount: subagentResult.totalCount,
			subagents: subagentResult.agents,
			starred: starResult.starred,
			projectPath,
			gitBranch: sessionMeta?.gitBranch ?? null,
			cwd: sessionMeta?.cwd ?? null,
			gitSha,
			gitClean,
			messageCount: sessionMeta?.messageCount ?? detail.lines.length,
			pendingTaskCount,
		};
	});

const sessionDetailQueryOptions = (id: string) =>
	queryOptions({
		queryKey: ['session', id, 'detail'] as const,
		queryFn: () => getSession({data: {id}}),
		staleTime: 30_000,
	});

export const Route = createFileRoute('/session/$id')({
	component: SessionPage,
	loader: ({context: {queryClient}, params}) => queryClient.ensureQueryData(sessionDetailQueryOptions(params.id)),
	errorComponent: SessionErrorComponent,
	head: ({loaderData}) => ({
		meta: [{title: loaderData?.title ?? 'Session Not Found'}],
	}),
});

function SessionErrorComponent({error, reset}: ErrorComponentProps) {
	const router = useRouter();
	const message = error instanceof Error ? error.message : 'Failed to load session';

	return (
		<div className="p-8">
			<h1 className="text-lg font-semibold text-red-600 dark:text-red-400">Failed to load session</h1>
			<pre className="mt-3 max-w-2xl overflow-auto rounded-md border border-border-300/15 bg-bg-200 p-3 font-mono text-sm text-text-500">
				{message}
			</pre>
			<div className="mt-4 flex gap-2">
				<button
					type="button"
					onClick={reset}
					className="rounded-md bg-accent-100 px-3 py-1.5 text-sm font-medium text-white hover:bg-accent-100/80"
				>
					Retry
				</button>
				<button
					type="button"
					onClick={() => router.navigate({to: '/sessions'})}
					className="rounded-md border border-border-300/15 px-3 py-1.5 text-sm font-medium text-text-300 hover:bg-bg-200"
				>
					Back to sessions
				</button>
			</div>
		</div>
	);
}

function useScrollButtons() {
	const [showUp, setShowUp] = useState(false);
	const [showDown, setShowDown] = useState(false);

	useEffect(() => {
		function check() {
			const scrollTop = window.scrollY;
			const scrollHeight = document.documentElement.scrollHeight;
			const clientHeight = window.innerHeight;
			setShowUp(scrollTop > 300);
			setShowDown(scrollTop + clientHeight < scrollHeight - 300);
		}
		check();
		window.addEventListener('scroll', check, {passive: true});
		window.addEventListener('resize', check, {passive: true});
		return () => {
			window.removeEventListener('scroll', check);
			window.removeEventListener('resize', check);
		};
	}, []);

	return {showUp, showDown};
}

function FloatingScrollButtons() {
	const {showUp, showDown} = useScrollButtons();

	return (
		<div className="fixed bottom-6 right-6 flex flex-col gap-2 z-20">
			<button
				type="button"
				onClick={() => window.scrollTo({top: 0, behavior: 'smooth'})}
				className="h-9 w-9 rounded-full bg-bg-200 border border-border-300/15 shadow-md flex items-center justify-center text-text-500 hover:text-text-000 hover:bg-bg-200/80 transition-all cursor-pointer"
				style={{opacity: showUp ? 1 : 0, pointerEvents: showUp ? 'auto' : 'none'}}
				title="Scroll to top"
			>
				<ArrowUp className="h-4 w-4" />
			</button>
			<button
				type="button"
				onClick={() => window.scrollTo({top: document.documentElement.scrollHeight, behavior: 'smooth'})}
				className="h-9 w-9 rounded-full bg-bg-200 border border-border-300/15 shadow-md flex items-center justify-center text-text-500 hover:text-text-000 hover:bg-bg-200/80 transition-all cursor-pointer"
				style={{opacity: showDown ? 1 : 0, pointerEvents: showDown ? 'auto' : 'none'}}
				title="Scroll to bottom"
			>
				<ArrowDown className="h-4 w-4" />
			</button>
		</div>
	);
}

function CopyButton({
	title,
	text,
	icon: Icon,
}: {
	title: string;
	text: string;
	icon: React.ComponentType<{className?: string}>;
}) {
	const [copied, setCopied] = useState(false);

	return (
		<div className="relative">
			<button
				type="button"
				title={title}
				onClick={() => {
					navigator.clipboard.writeText(text);
					setCopied(true);
					setTimeout(() => setCopied(false), 1500);
				}}
				className="text-text-500 hover:text-text-000 transition-colors cursor-pointer"
			>
				<Icon className="h-3.5 w-3.5" />
			</button>
			<span
				className={`absolute -bottom-6 left-1/2 -translate-x-1/2 rounded bg-bg-200 px-1.5 py-0.5 text-[10px] text-text-300 shadow-sm transition-opacity whitespace-nowrap ${copied ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
			>
				Copied!
			</span>
		</div>
	);
}

function useDisplayToggle(key: string, defaultValue: boolean): [boolean, (v: boolean) => void] {
	// Initialize with `defaultValue` unconditionally so SSR and the first client
	// render agree. Reading localStorage during the initial render would diverge
	// from the server's output and trip React's hydration check. We sync from
	// localStorage in an effect right after mount; a user with a non-default
	// stored preference may see a brief flash of the default, which is preferable
	// to a hydration error (and mirrors DebugProvider / ThemeProvider).
	const [value, setValue] = useState(defaultValue);

	useEffect(() => {
		const stored = localStorage.getItem(key);
		if (stored !== null) setValue(stored === 'true');
	}, [key]);

	const setAndPersist = useCallback(
		(v: boolean) => {
			setValue(v);
			localStorage.setItem(key, String(v));
		},
		[key],
	);

	return [value, setAndPersist];
}

function SessionPage() {
	const params = Route.useParams();
	const {data} = useSuspenseQuery(sessionDetailQueryOptions(params.id));
	const [aiSummary, setAiSummary] = useState<string | null>(null);
	const [summaryLoaded, setSummaryLoaded] = useState(false);
	const [starred, setStarred] = useState(data?.starred ?? false);
	const isActive = useIsSessionActive(params.id);
	const statusline = useStatusline(params.id);
	const [generating, setGenerating] = useState(false);
	const [chromeHidden, setChromeHidden] = useDisplayToggle('ccp-chrome-hidden', false);
	const chromeHiddenRef = useRef(chromeHidden);
	chromeHiddenRef.current = chromeHidden;

	useEffect(() => {
		function handleKeyDown(e: KeyboardEvent) {
			if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'f') {
				e.preventDefault();
				setChromeHidden(!chromeHiddenRef.current);
			}
		}
		window.addEventListener('keydown', handleKeyDown);
		return () => window.removeEventListener('keydown', handleKeyDown);
	}, [setChromeHidden]);

	const submitAnswer = useCallback(
		async ({toolUseId, answers}: {toolUseId: string; answers: Array<{question: string; answer: string}>}) => {
			const res = await fetch('/api/answer-question', {
				method: 'POST',
				headers: {'Content-Type': 'application/json'},
				body: JSON.stringify({sessionId: params.id, toolUseId, answers}),
			});
			if (!res.ok) {
				const body = (await res.json().catch(() => ({}))) as {error?: string};
				throw new Error(body.error ?? `Request failed (${res.status})`);
			}
			// Drain the stream so the spawned `claude --resume` runs to
			// completion in the background. The SSE watcher will refresh the
			// session view once the new JSONL is written.
			const reader = res.body?.getReader();
			if (reader) {
				try {
					while (true) {
						const {done} = await reader.read();
						if (done) break;
					}
				} finally {
					reader.releaseLock();
				}
			}
		},
		[params.id],
	);
	const askUserQuestionCtx: AskUserQuestionContextValue = useMemo(
		() => ({isSessionActive: isActive, submitAnswer}),
		[isActive, submitAnswer],
	);
	const [showThinking, setShowThinking] = useDisplayToggle('ccp-show-thinking', true);
	const [showTools, setShowTools] = useDisplayToggle('ccp-show-tools', true);
	const {enabled: showDebug, setEnabled: setShowDebug} = useDebug();
	const [subagentView, setSubagentView] = useState<'tree' | 'gantt' | 'sequence'>('tree');
	const chatStream = useChatStream();
	const prevSessionIdRef = useRef(params.id);

	useEffect(() => {
		if (prevSessionIdRef.current !== params.id) {
			prevSessionIdRef.current = params.id;
			chatStream.reset();
		}
	}, [params.id]);

	useEffect(() => {
		let cancelled = false;
		setSummaryLoaded(false);
		setAiSummary(null);
		getSessionSummary({data: params.id})
			.then((r) => {
				if (!cancelled) {
					setAiSummary(r.summary);
					setSummaryLoaded(true);
				}
			})
			.catch(() => {
				if (!cancelled) setSummaryLoaded(true);
			});
		return () => {
			cancelled = true;
		};
	}, [params.id]);

	if (!data) {
		return (
			<div>
				<DetailTopBar>
					<Link
						to="/sessions"
						className={pillStyles.primary}
					>
						<ArrowLeft className="h-3.5 w-3.5" />
						All Sessions
					</Link>
				</DetailTopBar>
				<h1 className="mt-4 text-lg font-semibold">Session Not Found</h1>
				<p className="mt-2 text-text-500">This session could not be found.</p>
			</div>
		);
	}

	async function handleGenerateSummary() {
		setGenerating(true);
		try {
			const result = await requestSummary({data: params.id});
			if (result.summary) {
				setAiSummary(result.summary);
			}
		} finally {
			setGenerating(false);
		}
	}

	return (
		<div>
			{/* Sticky header: top bar + title + subagent views + display toggles */}
			{!chromeHidden && (
				<div className="sticky top-0 z-10 bg-bg-000 pb-2 -mx-4 px-4 sm:-mx-8 sm:px-8 border-b border-border-300/15">
					<DetailTopBar>
						<Link
							to="/sessions"
							className={pillStyles.primary}
						>
							<ArrowLeft className="h-3.5 w-3.5" />
							All Sessions
						</Link>
						<span className="text-xs text-text-500">{data.projectName}</span>
						{isActive && (
							<span className="inline-flex items-center gap-1 rounded-full bg-success-900 px-2 py-0.5 text-xs font-medium text-success-000">
								<span className="h-1.5 w-1.5 rounded-full bg-success-000 animate-pulse" />
								Active
							</span>
						)}
						<CopyButton
							title="Copy session ID"
							text={params.id}
							icon={Copy}
						/>
						<CopyButton
							title="Copy resume command"
							text={`claude -r ${params.id}`}
							icon={Terminal}
						/>
						<CopyButton
							title="Copy fork command"
							text={`claude -r ${params.id} --fork-session`}
							icon={GitFork}
						/>
						<a
							href={`/api/raw?sessionId=${params.id}`}
							download
							className="text-text-500 hover:text-text-000 transition-colors"
							title="Download raw JSONL"
						>
							<Download className="h-3.5 w-3.5" />
						</a>
						<button
							type="button"
							onClick={async () => {
								const result = await toggleSessionStar({data: params.id});
								setStarred(result.starred);
							}}
							className="shrink-0 cursor-pointer text-text-500 transition-colors hover:text-warning-000"
							title={starred ? 'Unstar session' : 'Star session'}
						>
							<svg
								viewBox="0 0 24 24"
								className="h-5 w-5"
								fill={starred ? 'currentColor' : 'none'}
								stroke="currentColor"
								strokeWidth="2"
								style={{color: starred ? 'rgb(234, 179, 8)' : undefined}}
							>
								<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
							</svg>
						</button>
						<button
							type="button"
							onClick={() => setChromeHidden(true)}
							className="ml-auto shrink-0 cursor-pointer text-text-500 transition-colors hover:text-text-000"
							title="Expand chat (Ctrl+Shift+F)"
						>
							<Maximize2 className="h-3.5 w-3.5" />
						</button>
					</DetailTopBar>
					<h1 className="text-lg font-semibold">{data.title}</h1>

					{aiSummary ? (
						<p className="mt-1 text-sm text-text-500 italic">{aiSummary}</p>
					) : (
						summaryLoaded && (
							<button
								type="button"
								onClick={handleGenerateSummary}
								disabled={generating}
								className="mt-1 text-xs text-accent-100 hover:underline disabled:opacity-50 disabled:no-underline"
							>
								{generating ? 'Generating summary...' : 'Generate AI summary'}
							</button>
						)
					)}

					{data.subagentCount > 0 && (
						<div className="mt-3">
							<div className="flex items-center gap-2 text-[10px] text-text-500">
								<span>View</span>
								<button
									type="button"
									onClick={() => setSubagentView('tree')}
									aria-pressed={subagentView === 'tree'}
									className={`rounded px-1.5 py-0.5 ${
										subagentView === 'tree'
											? 'bg-accent-000/15 text-accent-100'
											: 'hover:bg-bg-200/50 text-text-500'
									}`}
								>
									Tree
								</button>
								<button
									type="button"
									onClick={() => setSubagentView('gantt')}
									aria-pressed={subagentView === 'gantt'}
									className={`rounded px-1.5 py-0.5 ${
										subagentView === 'gantt'
											? 'bg-accent-000/15 text-accent-100'
											: 'hover:bg-bg-200/50 text-text-500'
									}`}
								>
									Gantt
								</button>
								<button
									type="button"
									onClick={() => setSubagentView('sequence')}
									aria-pressed={subagentView === 'sequence'}
									className={`rounded px-1.5 py-0.5 ${
										subagentView === 'sequence'
											? 'bg-accent-000/15 text-accent-100'
											: 'hover:bg-bg-200/50 text-text-500'
									}`}
								>
									Sequence
								</button>
							</div>
							{subagentView === 'tree' ? (
								<SubagentTree
									tree={data.subagentTree}
									totalCount={data.subagentCount}
								/>
							) : subagentView === 'gantt' ? (
								<SubagentGantt agents={data.subagents} />
							) : (
								<SubagentSequence agents={data.subagents} />
							)}
						</div>
					)}

					<div className="flex items-center gap-3 mt-2 text-xs text-text-500">
						<label className="flex items-center gap-1 cursor-pointer select-none">
							<input
								type="checkbox"
								checked={showThinking}
								onChange={(e) => setShowThinking(e.target.checked)}
								className="accent-accent-000"
							/>
							Thinking
						</label>
						<label className="flex items-center gap-1 cursor-pointer select-none">
							<input
								type="checkbox"
								checked={showTools}
								onChange={(e) => setShowTools(e.target.checked)}
								className="accent-accent-000"
							/>
							Tools
						</label>
						<label className="flex items-center gap-1 cursor-pointer select-none">
							<input
								type="checkbox"
								checked={showDebug}
								onChange={(e) => setShowDebug(e.target.checked)}
								className="accent-accent-000"
							/>
							Debug JSONL
						</label>
					</div>
				</div>
			)}

			{/* Floating restore button when chrome is hidden */}
			{chromeHidden && (
				<div className="sticky top-0 z-10 flex justify-end py-1">
					<button
						type="button"
						onClick={() => setChromeHidden(false)}
						className="rounded-md bg-bg-200 border border-border-300/15 px-2 py-1 text-xs text-text-500 hover:text-text-000 hover:bg-bg-300/70 transition-colors cursor-pointer flex items-center gap-1.5 shadow-sm"
						title="Show header and footer (Ctrl+Shift+F)"
					>
						<Minimize2 className="h-3 w-3" />
						Show chrome
					</button>
				</div>
			)}

			{/* Chat messages */}
			<AskUserQuestionProvider value={askUserQuestionCtx}>
				<SessionChat
					sessionId={params.id}
					lines={data.lines}
					toolResultMap={data.toolResultMap}
					subagentTree={data.subagentTree}
					showThinking={showThinking}
					showTools={showTools}
				/>
			</AskUserQuestionProvider>

			{(chatStream.state.isStreaming || chatStream.state.isComplete) && (
				<StreamingMessage
					text={chatStream.state.text}
					isComplete={chatStream.state.isComplete}
					error={chatStream.state.error}
					forkedSessionId={chatStream.state.forkedSessionId}
					sentPrompt={chatStream.state.sentPrompt}
				/>
			)}

			<FloatingScrollButtons />

			{/* Sticky footer: chat input + status bar */}
			{((!chromeHidden && data.projectPath) || statusline) && (
				<div className="sticky bottom-0 z-10 -mx-4 sm:-mx-8">
					{!chromeHidden && data.projectPath && (
						<ChatInput
							onSend={(prompt) => chatStream.send(params.id, prompt)}
							onCancel={chatStream.cancel}
							isStreaming={chatStream.state.isStreaming}
							disabled={isActive}
							projectPath={data.projectPath}
						/>
					)}
					{statusline && (
						<StatusFooter
							data={statusline}
							gitBranch={data.gitBranch}
							gitSha={data.gitSha}
							gitClean={data.gitClean}
							messageCount={data.messageCount}
							pendingTaskCount={data.pendingTaskCount}
						/>
					)}
				</div>
			)}
		</div>
	);
}
