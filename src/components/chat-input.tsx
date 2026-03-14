import {useState, useRef, useEffect} from 'react';

interface ChatInputProps {
	onSend: (prompt: string) => void;
	onCancel: () => void;
	isStreaming: boolean;
	disabled?: boolean;
	projectPath?: string;
}

export function ChatInput({onSend, onCancel, isStreaming, disabled, projectPath}: ChatInputProps) {
	const [prompt, setPrompt] = useState('');
	const textareaRef = useRef<HTMLTextAreaElement>(null);

	useEffect(() => {
		if (!isStreaming && textareaRef.current) {
			textareaRef.current.focus();
		}
	}, [isStreaming]);

	function handleSubmit() {
		const trimmed = prompt.trim();
		if (!trimmed || isStreaming || disabled) return;
		onSend(trimmed);
		setPrompt('');
	}

	function handleKeyDown(e: React.KeyboardEvent) {
		if (e.key === 'Enter' && !e.shiftKey) {
			e.preventDefault();
			handleSubmit();
		}
	}

	return (
		<div className="border-t border-border-300/15 bg-bg-000 px-4 py-3">
			{projectPath && (
				<div className="mb-2 flex items-center gap-1.5 text-xs text-text-500">
					<svg
						width="12"
						height="12"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						strokeWidth="2"
						className="shrink-0"
					>
						<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
					</svg>
					<span className="truncate font-mono">{projectPath}</span>
					<span className="text-text-500/60">- will fork session</span>
				</div>
			)}
			<div className="flex items-end gap-2">
				<textarea
					ref={textareaRef}
					value={prompt}
					onChange={(e) => setPrompt(e.target.value)}
					onKeyDown={handleKeyDown}
					placeholder="Send a follow-up message..."
					disabled={isStreaming || disabled}
					rows={1}
					className="flex-1 resize-none rounded-lg border border-border-300/15 bg-bg-100 px-3 py-2 text-sm text-text-000 placeholder:text-text-500 focus:border-accent-100 focus:outline-none disabled:opacity-50"
					style={{minHeight: '38px', maxHeight: '120px'}}
					onInput={(e) => {
						const el = e.currentTarget;
						el.style.height = 'auto';
						el.style.height = Math.min(el.scrollHeight, 120) + 'px';
					}}
				/>
				{isStreaming ? (
					<button
						type="button"
						onClick={onCancel}
						className="shrink-0 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-red-700"
					>
						Cancel
					</button>
				) : (
					<button
						type="button"
						onClick={handleSubmit}
						disabled={!prompt.trim() || disabled}
						className="shrink-0 rounded-lg bg-accent-100 px-4 py-2 text-sm font-medium text-white transition-colors hover:opacity-90 disabled:opacity-50"
					>
						Send
					</button>
				)}
			</div>
		</div>
	);
}
