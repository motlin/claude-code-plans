import {Check} from 'lucide-react';
import type {ToolRendererProps} from './types';

export function AskUserQuestionRenderer({toolCall}: ToolRendererProps) {
	const question = (toolCall.input['question'] as string) ?? '';
	const options = toolCall.input['options'] as Array<{label: string; description?: string}> | undefined;
	const {result} = toolCall;

	if (!options || options.length === 0) {
		return (
			<div>
				<p className="text-sm font-medium">{question}</p>
				{result && <p className="text-sm text-text-500 mt-1">{result}</p>}
			</div>
		);
	}

	return (
		<div>
			<p className="text-sm font-medium mb-2">{question}</p>
			<div className="flex flex-col gap-1.5">
				{options.map((opt) => {
					const selected = result?.includes(opt.label);
					return (
						<div
							key={opt.label}
							className={`rounded border px-2.5 py-1.5 text-xs ${
								selected
									? 'bg-blue-50 border-blue-300 dark:bg-blue-950/30 dark:border-blue-600'
									: 'bg-white border-gray-200 dark:bg-gray-800 dark:border-gray-700'
							}`}
						>
							<div className="flex items-center gap-1.5">
								{selected && (
									<Check
										size={14}
										className="text-blue-600 shrink-0"
									/>
								)}
								<span className="font-medium">{opt.label}</span>
							</div>
							{opt.description && <p className="text-text-500 mt-0.5">{opt.description}</p>}
						</div>
					);
				})}
			</div>
		</div>
	);
}
