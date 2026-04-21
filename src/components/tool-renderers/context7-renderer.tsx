import {BookOpen, FileText, Search} from 'lucide-react';
import type {ToolRendererProps} from './types';
import {CollapsibleSection} from './shared';
import {MarkdownArticle} from '../markdown-article';
import {looksLikeMarkdown} from '../../lib/client-markdown';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function tryParseJson(text: string): unknown {
	try {
		return JSON.parse(text);
	} catch {
		return null;
	}
}

function ResultPreview({text, maxLines = 10}: {text: string; maxLines?: number}) {
	if (!text) return null;
	const lines = text.split('\n');
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

// ---------------------------------------------------------------------------
// Sub-renderers
// ---------------------------------------------------------------------------

function ResolveLibraryRenderer({input, resultText}: {input: Record<string, unknown>; resultText: string}) {
	const libraryName = (input['libraryName'] as string) ?? '';
	const parsed = tryParseJson(resultText);
	const resolvedId =
		parsed && typeof parsed === 'object' && 'libraryId' in (parsed as Record<string, unknown>)
			? String((parsed as Record<string, unknown>)['libraryId'])
			: null;

	return (
		<div className="px-2 py-2 space-y-2">
			<div className="flex items-center gap-2">
				<Search className="h-4 w-4 text-blue-500" />
				<span className="text-sm text-foreground">Resolve library</span>
				{libraryName && <span className="text-sm font-mono text-muted-foreground">{libraryName}</span>}
				{resolvedId && (
					<span className="text-xs px-1.5 py-0.5 rounded bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300">
						{resolvedId}
					</span>
				)}
			</div>
			<CollapsibleSection label="Result">
				<ResultPreview text={resultText} />
			</CollapsibleSection>
		</div>
	);
}

function QueryDocsRenderer({input, resultText}: {input: Record<string, unknown>; resultText: string}) {
	const libraryId = (input['libraryId'] as string) ?? '';
	const query = (input['query'] as string) ?? '';
	const lineCount = resultText ? resultText.split('\n').length : 0;

	return (
		<div className="px-2 py-2 space-y-2">
			<div className="flex items-center gap-2">
				<BookOpen className="h-4 w-4 text-purple-500" />
				<span className="text-sm text-foreground">Query docs</span>
				{libraryId && <span className="text-sm font-mono text-muted-foreground">{libraryId}</span>}
			</div>
			{query && (
				<div className="text-xs text-muted-foreground">
					<FileText className="h-3 w-3 inline mr-1" />
					{query}
				</div>
			)}
			<CollapsibleSection label={`Documentation (${lineCount} lines)`}>
				{looksLikeMarkdown(resultText) ? (
					<div className="text-xs text-text-100 leading-relaxed max-h-64 overflow-auto">
						<MarkdownArticle markdown={resultText} />
					</div>
				) : (
					<ResultPreview
						text={resultText}
						maxLines={20}
					/>
				)}
			</CollapsibleSection>
		</div>
	);
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export function Context7Renderer({toolCall}: ToolRendererProps) {
	const tool = toolCall.name.split('__').slice(2).join('__');
	const resultText = toolCall.result ?? '';
	const input = toolCall.input as Record<string, unknown>;

	switch (tool) {
		case 'resolve-library-id':
			return (
				<ResolveLibraryRenderer
					input={input}
					resultText={resultText}
				/>
			);
		case 'query-docs':
			return (
				<QueryDocsRenderer
					input={input}
					resultText={resultText}
				/>
			);
		default:
			return <ResultPreview text={resultText} />;
	}
}
