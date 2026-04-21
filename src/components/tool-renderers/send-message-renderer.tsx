import {Send} from 'lucide-react';
import type {ToolRendererProps} from './types';
import {ErrorBorder} from './shared';

export function SendMessageRenderer({toolCall}: ToolRendererProps) {
	const recipient = (toolCall.input['to'] as string) ?? (toolCall.input['recipient'] as string) ?? '';
	const message =
		(toolCall.input['message'] as string) ??
		(toolCall.input['content'] as string) ??
		(toolCall.input['prompt'] as string) ??
		'';
	const summary = (toolCall.input['summary'] as string) ?? '';

	return (
		<ErrorBorder isError={toolCall.isError}>
			<div className="flex items-start gap-2">
				<Send
					size={14}
					className="text-accent-100 mt-0.5 shrink-0"
				/>
				<div className="min-w-0">
					<div className="flex items-center gap-2">
						<span className="text-xs font-medium text-accent-100">Send Message</span>
						{recipient && <span className="text-xs text-text-500">to {recipient}</span>}
					</div>
					{summary && <div className="text-xs text-text-100 mt-0.5">{summary}</div>}
					{message && <div className="text-xs text-text-500 mt-0.5 line-clamp-3">{message}</div>}
				</div>
			</div>
		</ErrorBorder>
	);
}
