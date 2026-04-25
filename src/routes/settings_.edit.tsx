import type {ThemedToken} from '@shikijs/core';
import {queryOptions, useQueryClient, useSuspenseQuery} from '@tanstack/react-query';
import {createFileRoute, Link} from '@tanstack/react-router';
import {AlertCircle, Check, ChevronDown, ChevronRight, Code, RotateCcw, Save, SlidersHorizontal, X} from 'lucide-react';
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
	const [savedContent, setSavedContent] = useState(initialContent);
	const [saving, setSaving] = useState(false);
	const [feedback, setFeedback] = useState<Feedback | null>(null);
	const [validationError, setValidationError] = useState<string | null>(null);
	const [formatFeedback, setFormatFeedback] = useState(false);
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
			setSavedContent(pretty);
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
		draftRef.current = savedContent;
		setEditorValue(savedContent);
		setValidationError(null);
		setFeedback(null);
	}, [savedContent]);

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
		setFormatFeedback(true);
		setTimeout(() => {
			setFormatFeedback(false);
		}, 1500);
	}, [validate]);

	const isDirty = editorValue !== savedContent;
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
					disabled={saving || validationError !== null || !isDirty}
					className="flex items-center gap-1.5 rounded-md bg-accent-100 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-accent-100/80 disabled:opacity-50"
				>
					<Save className="h-3.5 w-3.5" />
					{saving ? 'Saving...' : 'Save'}
				</button>
				<button
					type="button"
					onClick={handleFormat}
					disabled={validationError !== null}
					className={`flex items-center gap-1.5 rounded-md border border-border-300/15 px-3 py-1.5 text-sm transition-colors hover:bg-bg-200 disabled:opacity-50 ${
						formatFeedback ? 'text-green-600 dark:text-green-400' : 'text-text-300'
					}`}
				>
					{formatFeedback && <Check className="h-3.5 w-3.5" />}
					{formatFeedback ? 'Formatted' : 'Format'}
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

type FieldType = 'boolean' | 'string' | 'number' | 'enum' | 'object';

interface FieldDefinition {
	key: string;
	label: string;
	description: string;
	type: FieldType;
	section: string;
	options?: Array<{value: string; label: string}>;
	min?: number;
	max?: number;
}

const FIELD_DEFINITIONS: FieldDefinition[] = [
	{
		key: 'model',
		label: 'Model',
		description: 'Default Claude model to use',
		type: 'string',
		section: 'General',
	},
	{
		key: 'theme',
		label: 'Theme',
		description: 'Color scheme for the Claude Code TUI',
		type: 'enum',
		section: 'General',
		options: [
			{value: 'light', label: 'Light'},
			{value: 'dark', label: 'Dark'},
			{value: 'light-daltonized', label: 'Light (daltonized)'},
			{value: 'dark-daltonized', label: 'Dark (daltonized)'},
		],
	},
	{
		key: 'tui',
		label: 'TUI mode',
		description: 'Terminal UI display mode',
		type: 'enum',
		section: 'General',
		options: [
			{value: 'fullscreen', label: 'Fullscreen'},
			{value: 'inline', label: 'Inline'},
		],
	},
	{
		key: 'verbose',
		label: 'Verbose',
		description: 'Enable verbose output in the terminal',
		type: 'boolean',
		section: 'General',
	},
	{
		key: 'includeCoAuthoredBy',
		label: 'Co-authored-by',
		description: 'Include co-authored-by trailer in git commits',
		type: 'boolean',
		section: 'General',
	},
	{
		key: 'alwaysThinkingEnabled',
		label: 'Extended thinking',
		description: 'Enable extended thinking on every request',
		type: 'boolean',
		section: 'General',
	},
	{
		key: 'voiceEnabled',
		label: 'Voice',
		description: 'Enable voice input',
		type: 'boolean',
		section: 'General',
	},
	{
		key: 'cleanupPeriodDays',
		label: 'Cleanup period (days)',
		description: 'Number of days before old sessions are cleaned up',
		type: 'number',
		section: 'Data',
		min: 1,
	},
	{
		key: 'fileCheckpointingEnabled',
		label: 'File checkpointing',
		description: 'Enable automatic file checkpointing for undo support',
		type: 'boolean',
		section: 'Data',
	},
	{
		key: 'autoUpdatesChannel',
		label: 'Auto-updates channel',
		description: 'Release channel for automatic updates',
		type: 'enum',
		section: 'Updates',
		options: [
			{value: 'latest', label: 'Latest (stable)'},
			{value: 'beta', label: 'Beta'},
			{value: 'disabled', label: 'Disabled'},
		],
	},
	{
		key: 'enableAllProjectMcpServers',
		label: 'Enable all project MCP servers',
		description: 'Auto-enable MCP servers from project .mcp.json files',
		type: 'boolean',
		section: 'MCP',
	},
	{
		key: 'skipDangerousModePermissionPrompt',
		label: 'Skip dangerous mode prompt',
		description: 'Skip the permission confirmation when using dangerous/yolo mode',
		type: 'boolean',
		section: 'Permissions',
	},
	{
		key: 'teammateMode',
		label: 'Teammate mode',
		description: 'How Claude Code runs as a teammate / background agent',
		type: 'enum',
		section: 'Advanced',
		options: [
			{value: 'in-process', label: 'In-process'},
			{value: 'detached', label: 'Detached'},
		],
	},
	{
		key: 'preferredNotifChannel',
		label: 'Notification channel',
		description: 'Where to deliver desktop notifications',
		type: 'string',
		section: 'Advanced',
	},
];

const SECTIONS_ORDER = ['General', 'Data', 'Updates', 'MCP', 'Permissions', 'Advanced'];

function groupFieldsBySection(): Map<string, FieldDefinition[]> {
	const groups = new Map<string, FieldDefinition[]>();
	for (const section of SECTIONS_ORDER) {
		groups.set(section, []);
	}
	for (const field of FIELD_DEFINITIONS) {
		const existing = groups.get(field.section);
		if (existing) {
			existing.push(field);
		} else {
			groups.set(field.section, [field]);
		}
	}
	return groups;
}

function FormToggle({checked, onChange}: {checked: boolean; onChange: (value: boolean) => void}) {
	return (
		<button
			type="button"
			role="switch"
			aria-checked={checked}
			onClick={() => onChange(!checked)}
			className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full transition-colors ${
				checked ? 'bg-accent-100' : 'bg-bg-300'
			}`}
		>
			<span
				className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow-sm transition-transform ${
					checked ? 'translate-x-[18px]' : 'translate-x-[3px]'
				}`}
			/>
		</button>
	);
}

function FormField({
	field,
	value,
	onChange,
}: {
	field: FieldDefinition;
	value: unknown;
	onChange: (key: string, value: unknown) => void;
}) {
	switch (field.type) {
		case 'boolean': {
			return (
				<div className="flex items-center justify-between gap-4 py-2">
					<div>
						<div className="text-sm font-medium text-text-100">{field.label}</div>
						<div className="text-xs text-text-500">{field.description}</div>
					</div>
					<FormToggle
						checked={value === true}
						onChange={(checked) => onChange(field.key, checked)}
					/>
				</div>
			);
		}
		case 'enum': {
			return (
				<div className="flex items-center justify-between gap-4 py-2">
					<div>
						<div className="text-sm font-medium text-text-100">{field.label}</div>
						<div className="text-xs text-text-500">{field.description}</div>
					</div>
					<select
						value={typeof value === 'string' ? value : ''}
						onChange={(event) => onChange(field.key, event.target.value)}
						className="rounded-md border border-border-300/15 bg-bg-100 px-2 py-1 text-sm text-text-100 focus:outline-none focus:ring-1 focus:ring-accent-100"
					>
						{!field.options?.some((o) => o.value === value) && (
							<option value={typeof value === 'string' ? value : ''}>
								{typeof value === 'string' ? value : '(not set)'}
							</option>
						)}
						{field.options?.map((option) => (
							<option
								key={option.value}
								value={option.value}
							>
								{option.label}
							</option>
						))}
					</select>
				</div>
			);
		}
		case 'number': {
			return (
				<div className="flex items-center justify-between gap-4 py-2">
					<div>
						<div className="text-sm font-medium text-text-100">{field.label}</div>
						<div className="text-xs text-text-500">{field.description}</div>
					</div>
					<input
						type="number"
						value={typeof value === 'number' ? value : ''}
						min={field.min}
						max={field.max}
						onChange={(event) => {
							const parsed = Number(event.target.value);
							if (Number.isFinite(parsed)) {
								onChange(field.key, parsed);
							}
						}}
						className="w-24 rounded-md border border-border-300/15 bg-bg-100 px-2 py-1 text-sm text-text-100 focus:outline-none focus:ring-1 focus:ring-accent-100"
					/>
				</div>
			);
		}
		case 'string': {
			return (
				<div className="flex items-center justify-between gap-4 py-2">
					<div>
						<div className="text-sm font-medium text-text-100">{field.label}</div>
						<div className="text-xs text-text-500">{field.description}</div>
					</div>
					<input
						type="text"
						value={typeof value === 'string' ? value : ''}
						onChange={(event) => onChange(field.key, event.target.value)}
						className="w-48 rounded-md border border-border-300/15 bg-bg-100 px-2 py-1 text-sm text-text-100 focus:outline-none focus:ring-1 focus:ring-accent-100"
					/>
				</div>
			);
		}
		default:
			return null;
	}
}

function ObjectSummary({label, value}: {label: string; value: unknown}) {
	const [expanded, setExpanded] = useState(false);

	if (value === undefined || value === null) return null;

	const summary =
		typeof value === 'object' && value !== null
			? Array.isArray(value)
				? `${value.length} items`
				: `${Object.keys(value).length} keys`
			: String(value);

	return (
		<div className="py-2">
			<button
				type="button"
				onClick={() => setExpanded(!expanded)}
				className="flex items-center gap-1.5 text-sm font-medium text-text-100 hover:text-accent-100"
			>
				{expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
				{label}
				<span className="font-normal text-text-500">({summary})</span>
			</button>
			{expanded && (
				<pre className="mt-2 max-h-64 overflow-auto rounded-md border border-border-300/15 bg-bg-100 p-3 font-mono text-xs text-text-300">
					{JSON.stringify(value, null, 2)}
				</pre>
			)}
		</div>
	);
}

function FormEditor({filename, initialContent, path}: {filename: string; initialContent: string; path: string}) {
	const [data, setData] = useState<Record<string, unknown>>(() => {
		try {
			return JSON.parse(initialContent) as Record<string, unknown>;
		} catch {
			return {};
		}
	});
	const [savedData, setSavedData] = useState<Record<string, unknown>>(data);
	const [saving, setSaving] = useState(false);
	const [feedback, setFeedback] = useState<Feedback | null>(null);
	const queryClient = useQueryClient();

	const isDirty = JSON.stringify(data) !== JSON.stringify(savedData);

	const handleFieldChange = useCallback((key: string, value: unknown) => {
		setData((previous) => ({...previous, [key]: value}));
		setFeedback(null);
	}, []);

	const handleSave = useCallback(async () => {
		setSaving(true);
		setFeedback(null);
		try {
			const content = JSON.stringify(data, null, 2);
			const result = await saveSettingsFile({
				data: {filename: filename as 'settings.json' | 'settings.local.json', content},
			});
			setFeedback({type: 'success', text: `Saved to ${result.path}`});
			setSavedData({...data});
			await queryClient.invalidateQueries({queryKey: ['settings']});
		} catch (error) {
			setFeedback({type: 'error', text: (error as Error).message});
		} finally {
			setSaving(false);
		}
	}, [data, filename, queryClient]);

	const handleReset = useCallback(() => {
		setData({...savedData});
		setFeedback(null);
	}, [savedData]);

	const sectionGroups = groupFieldsBySection();
	const knownKeys = new Set(FIELD_DEFINITIONS.map((f) => f.key));
	const unknownKeys = Object.keys(data).filter((k) => !knownKeys.has(k) && k !== '$schema');

	return (
		<section className="space-y-3">
			<div>
				<h2 className="text-sm font-semibold text-text-100">{FILE_LABELS[filename] ?? filename}</h2>
				<p className="text-xs text-text-500 mt-0.5">
					{FILE_DESCRIPTIONS[filename]} <span className="font-mono">{path}</span>
				</p>
			</div>

			<div className="space-y-6">
				{Array.from(sectionGroups.entries()).map(([section, fields]) => {
					const relevantFields = fields.filter((f) => data[f.key] !== undefined);
					if (relevantFields.length === 0) return null;
					return (
						<div key={section}>
							<h3 className="text-xs font-semibold uppercase tracking-wider text-text-500 mb-1">
								{section}
							</h3>
							<div className="divide-y divide-border-300/10">
								{relevantFields.map((field) => (
									<FormField
										key={field.key}
										field={field}
										value={data[field.key]}
										onChange={handleFieldChange}
									/>
								))}
							</div>
						</div>
					);
				})}

				{unknownKeys.length > 0 && (
					<div>
						<h3 className="text-xs font-semibold uppercase tracking-wider text-text-500 mb-1">Other</h3>
						<div className="divide-y divide-border-300/10">
							{unknownKeys.map((key) => (
								<ObjectSummary
									key={key}
									label={key}
									value={data[key]}
								/>
							))}
						</div>
					</div>
				)}
			</div>

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
					disabled={saving || !isDirty}
					className="flex items-center gap-1.5 rounded-md bg-accent-100 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-accent-100/80 disabled:opacity-50"
				>
					<Save className="h-3.5 w-3.5" />
					{saving ? 'Saving...' : 'Save'}
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

type EditorTab = 'form' | 'json';

function SettingsEditPage() {
	const {data: files} = useSuspenseQuery(settingsRawQueryOptions);
	const [activeTab, setActiveTab] = useState<EditorTab>('form');

	return (
		<div className="max-w-4xl">
			<div className="flex items-center justify-between">
				<div>
					<h1 className="text-lg font-semibold">Edit Settings</h1>
					<p className="mt-1 text-sm text-text-500">
						Edit Claude Code configuration files from <code className="font-mono text-xs">~/.claude/</code>
					</p>
				</div>
				<div className="flex items-center gap-2">
					<div className="flex rounded-md border border-border-300/15">
						<button
							type="button"
							onClick={() => setActiveTab('form')}
							className={`flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium transition-colors first:rounded-l-md ${
								activeTab === 'form' ? 'bg-accent-100 text-white' : 'text-text-300 hover:bg-bg-200'
							}`}
						>
							<SlidersHorizontal className="h-3.5 w-3.5" />
							Form
						</button>
						<button
							type="button"
							onClick={() => setActiveTab('json')}
							className={`flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium transition-colors last:rounded-r-md ${
								activeTab === 'json' ? 'bg-accent-100 text-white' : 'text-text-300 hover:bg-bg-200'
							}`}
						>
							<Code className="h-3.5 w-3.5" />
							JSON
						</button>
					</div>
					<Link
						to="/settings"
						className="flex items-center gap-1.5 rounded-md border border-border-300/15 px-3 py-1.5 text-sm text-text-300 transition-colors hover:bg-bg-200"
					>
						<X className="h-3.5 w-3.5" />
						Cancel
					</Link>
				</div>
			</div>

			<div className="mt-6 space-y-10">
				{files.map((file) =>
					activeTab === 'form' ? (
						<FormEditor
							key={`form-${file.filename}`}
							filename={file.filename}
							initialContent={file.content}
							path={file.path}
						/>
					) : (
						<JsonEditor
							key={`json-${file.filename}`}
							filename={file.filename}
							initialContent={file.content}
							path={file.path}
						/>
					),
				)}
			</div>
		</div>
	);
}
