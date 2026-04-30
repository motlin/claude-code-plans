import type {ToolRendererProps} from './types';
import {ErrorBorder, KeyValueCard} from './shared';
import {MarkdownArticle} from '../markdown-article';
import {looksLikeMarkdown} from '../../lib/client-markdown';

export function Context7Renderer({toolCall}: ToolRendererProps) {
	const {input, result, isError} = toolCall;
	const entries = Object.entries(input).filter(([k]) => k !== 'type');

	const params = entries.map(([key, value]) => ({
		key,
		value: typeof value === 'string' ? value : JSON.stringify(value),
	}));

	const resultText = result ?? '';
	const isMarkdownResult = resultText.length > 0 && looksLikeMarkdown(resultText);

	return (
		<ErrorBorder isError={isError}>
			<KeyValueCard
				params={params}
				result={isMarkdownResult ? undefined : resultText || undefined}
			>
				{isMarkdownResult && (
					<div className="text-xs text-text-100 leading-relaxed max-h-64 overflow-auto">
						<MarkdownArticle markdown={resultText} />
					</div>
				)}
			</KeyValueCard>
		</ErrorBorder>
	);
}
