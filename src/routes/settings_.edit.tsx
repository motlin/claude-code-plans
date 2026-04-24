import type {ThemedToken} from '@shikijs/core';
import {queryOptions, useQueryClient, useSuspenseQuery} from '@tanstack/react-query';
import {createFileRoute, Link} from '@tanstack/react-router';
import {AlertCircle, Check, RotateCcw, Save, X} from 'lucide-react';
import {useCallback, useEffect, useRef, useState} from 'react';
import {useHighlightedLines} from '../hooks/use-shiki';
import {getSettingsRaw, saveSettingsFile} from '../lib/server-fns';

const settingsRawQueryOptions = queryOptions({
	queryKey: ['settings', 'raw'] as const,
	queryFn: () => getSettingsRaw(),
	staleTime: 30_000,
});

const FILE_LABELS: Record<string, string> = {
	'settings.json': 'Global Settings',
	'settings.local.json': 'Local Settings',
};

const FILE_DESCRIPTIONS: Record<string, string> = {
	'settings.json': 'Shared across machines, checked into dotfiles.',
	'settings.local.json': 'Machine-specific overrides, not shared.',
};

export const Route = createFileRoute('/settings_/edit')({
	component: SettingsEditPage,
	loader: ({context: {queryClient}}) => queryClient.ensureQueryData(settingsRawQueryOptions),
	head: () => ({
		meta: [{title: 'Edit Settings'}],
	}),
});

type Feedback = {type: 'success' | 'error'; text: string};

function HighlightedLine({tokens}: {tokens: ThemedToken[]}) {
	return (
		<>
			{tokens.map((token, index) => (
				<span
					key={index}
					style={{color: token.color}}
				>
					{token.content}
				</span>
			))}
		</>
	);
}

function JsonEditor({filename, initialContent, path}: {filename: string; initialContent: string; path: string}) {
	const draftRef = useRef(initialContent);
	const [editorValue, setEditorValue] = useState(initialContent);
	const [saving, setSaving] = useState(false);
	const [feedback, setFeedback] = useState<Feedback | null>(null);
	const [validationError, setValidationError] = useState<string | null>(null);
	const queryClient = useQueryClient();

	const validate = useCallback((text: string): string | null => {
		try {
			const parsed: unknown = JSON.parse(text);
			if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
				return 'Settings must be a JSON object, not an array or primitive.';
			}
			return null;
		} catch (error) {
			return (error as SyntaxError).message;
		}
	}, []);

	const handleChange = useCallback(
		(event: React.ChangeEvent<HTMLTextAreaElement>) => {
			const value = event.target.value;
			draftRef.current = value;
			setEditorValue(value);
			setValidationError(validate(value));
			setFeedback(null);
		},
		[validate],
	);

	const handleSave = useCallback(async () => {
		const content = draftRef.current;
		const error = validate(content);
		if (error) {
			setValidationError(error);
			return;
		}

		setSaving(true);
		setFeedback(null);
		try {
			const result = await saveSettingsFile({
				data: {filename: filename as 'settings.json' | 'settings.local.json', content},
			});
			setFeedback({type: 'success', text: `Saved to ${result.path}`});
			// Re-format the content after save (server normalizes it)
			const pretty = JSON.stringify(JSON.parse(content), null, 2);
			draftRef.current = pretty;
			setEditorValue(pretty);
			setValidationError(null);
			// Invalidate the viewer query so navigating back shows fresh data
			await queryClient.invalidateQueries({queryKey: ['settings']});
		} catch (error) {
			setFeedback({type: 'error', text: (error as Error).message});
		} finally {
			setSaving(false);
		}
	}, [filename, validate, queryClient]);

	const handleReset = useCallback(() => {
		draftRef.current = initialContent;
		setEditorValue(initialContent);
		setValidationError(null);
		setFeedback(null);
	}, [initialContent]);

	const handleFormat = useCallback(() => {
		const content = draftRef.current;
		const error = validate(content);
		if (error) {
			setValidationError(error);
			return;
		}
		const pretty = JSON.stringify(JSON.parse(content), null, 2);
		draftRef.current = pretty;
		setEditorValue(pretty);
		setValidationError(null);
	}, [validate]);

	const isDirty = editorValue !== initialContent;
	const lineCount = editorValue.split('\n').length;

	const tokens = useHighlightedLines(editorValue, 'json');
	const textareaRef = useRef<HTMLTextAreaElement>(null);
	const highlightRef = useRef<HTMLDivElement>(null);

	// Synchronize scroll position between textarea and highlight layer.
	useEffect(() => {
		const textarea = textareaRef.current;
		const highlight = highlightRef.current;
		if (!textarea || !highlight) return;

		function handleScroll(): void {
			if (highlight && textarea) {
				highlight.scrollTop = textarea.scrollTop;
				highlight.scrollLeft = textarea.scrollLeft;
			}
		}
		textarea.addEventListener('scroll', handleScroll);
		return () => {
			textarea.removeEventListener('scroll', handleScroll);
		};
	}, []);

	return (
		<section className="space-y-3">
			<div>
				<h2 className="text-sm font-semibold text-text-100">{FILE_LABELS[filename] ?? filename}</h2>
				<p className="text-xs text-text-500 mt-0.5">
					{FILE_DESCRIPTIONS[filename]} <span className="font-mono">{path}</span>
				</p>
			</div>

			<div className="relative rounded-md bg-bg-100">
				{tokens && (
					<div
						ref={highlightRef}
						aria-hidden
						className="absolute inset-0 overflow-hidden rounded-md border border-transparent p-4 font-mono text-xs leading-relaxed pointer-events-none whitespace-pre-wrap break-words"
					>
						{tokens.map((lineTokens, lineIndex) => (
							<div
								key={lineIndex}
								className="min-h-[1.625em]"
							>
								<HighlightedLine tokens={lineTokens} />
							</div>
						))}
					</div>
				)}
				<textarea
					ref={textareaRef}
					value={editorValue}
					onChange={handleChange}
					spellCheck={false}
					className={`relative w-full rounded-md border p-4 font-mono text-xs leading-relaxed focus:outline-none focus:ring-1 resize-y ${
						tokens
							? 'bg-transparent text-transparent caret-text-100 selection:bg-accent-100/30'
							: 'bg-bg-100 text-text-100'
					} ${
						validationError
							? 'border-danger-000 focus:ring-danger-000'
							: 'border-border-300/15 focus:ring-accent-100'
					}`}
					rows={Math.min(Math.max(lineCount + 2, 10), 40)}
				/>
			</div>

			{validationError && (
				<div className="flex items-start gap-2 rounded-md border border-danger-000/30 bg-danger-000/5 px-3 py-2 text-sm text-danger-000">
					<AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
					<span className="font-mono text-xs">{validationError}</span>
				</div>
			)}

			{feedback && (
				<div
					className={`flex items-center gap-2 rounded-md border px-3 py-2 text-sm ${
						feedback.type === 'success'
							? 'border-green-200 bg-green-50 text-green-800 dark:border-green-800 dark:bg-green-950/30 dark:text-green-300'
							: 'border-red-200 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-950/30 dark:text-red-300'
					}`}
				>
					{feedback.type === 'success' ? <Check className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />}
					{feedback.text}
				</div>
			)}

			<div className="flex items-center gap-2">
				<button
					type="button"
					onClick={handleSave}
					disabled={saving || validationError !== null}
					className="flex items-center gap-1.5 rounded-md bg-accent-100 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-accent-100/80 disabled:opacity-50"
				>
					<Save className="h-3.5 w-3.5" />
					{saving ? 'Saving...' : 'Save'}
				</button>
				<button
					type="button"
					onClick={handleFormat}
					disabled={validationError !== null}
					className="rounded-md border border-border-300/15 px-3 py-1.5 text-sm text-text-300 transition-colors hover:bg-bg-200 disabled:opacity-50"
				>
					Format
				</button>
				{isDirty && (
					<button
						type="button"
						onClick={handleReset}
						className="flex items-center gap-1.5 rounded-md border border-border-300/15 px-3 py-1.5 text-sm text-text-300 transition-colors hover:bg-bg-200"
					>
						<RotateCcw className="h-3.5 w-3.5" />
						Reset
					</button>
				)}
			</div>
		</section>
	);
}

function SettingsEditPage() {
	const {data: files} = useSuspenseQuery(settingsRawQueryOptions);

	return (
		<div className="max-w-4xl">
			<div className="flex items-center justify-between">
				<div>
					<h1 className="text-lg font-semibold">Edit Settings</h1>
					<p className="mt-1 text-sm text-text-500">
						Edit Claude Code configuration files from <code className="font-mono text-xs">~/.claude/</code>
					</p>
				</div>
				<Link
					to="/settings"
					className="flex items-center gap-1.5 rounded-md border border-border-300/15 px-3 py-1.5 text-sm text-text-300 transition-colors hover:bg-bg-200"
				>
					<X className="h-3.5 w-3.5" />
					Cancel
				</Link>
			</div>

			<div className="mt-6 space-y-10">
				{files.map((file) => (
					<JsonEditor
						key={file.filename}
						filename={file.filename}
						initialContent={file.content}
						path={file.path}
					/>
				))}
			</div>
		</div>
	);
}
