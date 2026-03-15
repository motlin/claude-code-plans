import {Check, Circle, MessageCircleQuestion} from 'lucide-react';
import type {ToolRendererProps} from './types';

interface QuestionData {
	question: string;
	options: Array<{label: string; description?: string}>;
}

function QuestionBlock({question, options, result}: QuestionData & {result?: string | undefined}) {
	const selectedLabel = result?.trim();
	const matchesAny = options.some((opt) => opt.label === selectedLabel);
	const isOther = selectedLabel && !matchesAny;

	return (
		<div>
			<div className="flex items-start gap-1.5 mb-2">
				<MessageCircleQuestion
					size={14}
					className="text-text-500 shrink-0 mt-0.5"
				/>
				<p className="text-sm font-medium">{question}</p>
			</div>
			<div className="flex flex-col gap-1.5 ml-5">
				{options.map((opt) => {
					const selected = opt.label === selectedLabel;
					return (
						<div
							key={opt.label}
							className={`rounded border px-2.5 py-1.5 text-xs ${
								selected
									? 'bg-blue-50 border-blue-300 dark:bg-blue-950/30 dark:border-blue-600 border-l-2 border-l-blue-500'
									: 'border-border-300/15 opacity-60'
							}`}
						>
							<div className="flex items-center gap-1.5">
								{selected ? (
									<Check
										size={14}
										className="text-blue-600 shrink-0"
									/>
								) : (
									<Circle
										size={14}
										className="text-text-500 shrink-0"
									/>
								)}
								<span className="font-medium">{opt.label}</span>
							</div>
							{opt.description && <p className="text-text-500 mt-0.5 ml-5">{opt.description}</p>}
						</div>
					);
				})}
				{isOther && (
					<div className="rounded border border-amber-300 dark:border-amber-600 bg-amber-50 dark:bg-amber-950/30 px-2.5 py-1.5 text-xs border-l-2 border-l-amber-500">
						<div className="flex items-center gap-1.5">
							<Check
								size={14}
								className="text-amber-600 shrink-0"
							/>
							<span className="font-medium">Other</span>
						</div>
						<p className="text-text-500 mt-0.5 ml-5">{selectedLabel}</p>
					</div>
				)}
			</div>
		</div>
	);
}

export function AskUserQuestionRenderer({toolCall}: ToolRendererProps) {
	const questions = toolCall.input['questions'] as QuestionData[] | undefined;
	const singleQuestion = (toolCall.input['question'] as string) ?? '';
	const singleOptions = toolCall.input['options'] as Array<{label: string; description?: string}> | undefined;
	const {result} = toolCall;

	if (questions && questions.length > 0) {
		return (
			<div className="flex flex-col gap-3">
				{questions.map((q, i) => (
					<QuestionBlock
						key={i}
						question={q.question}
						options={q.options}
						result={result}
					/>
				))}
			</div>
		);
	}

	if (!singleOptions || singleOptions.length === 0) {
		return (
			<div>
				<div className="flex items-start gap-1.5">
					<MessageCircleQuestion
						size={14}
						className="text-text-500 shrink-0 mt-0.5"
					/>
					<p className="text-sm font-medium">{singleQuestion}</p>
				</div>
				{result && <p className="text-sm text-text-500 mt-1 ml-5">{result}</p>}
			</div>
		);
	}

	return (
		<QuestionBlock
			question={singleQuestion}
			options={singleOptions}
			result={result}
		/>
	);
}
