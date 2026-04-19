import {type ReactNode, useState} from 'react';

// ANSI color code to CSS color mapping
const BASIC_COLORS: Record<number, string> = {
	30: '#000000', // black
	31: '#cc0000', // red
	32: '#00cc00', // green
	33: '#cccc00', // yellow
	34: '#0000ee', // blue
	35: '#cc00cc', // magenta
	36: '#00cccc', // cyan
	37: '#ffffff', // white
	90: '#666666', // bright black
	91: '#ff0000', // bright red
	92: '#00ff00', // bright green
	93: '#ffff00', // bright yellow
	94: '#5555ff', // bright blue
	95: '#ff00ff', // bright magenta
	96: '#00ffff', // bright cyan
	97: '#ffffff', // bright white
};

const BG_COLORS: Record<number, string> = {
	40: '#000000',
	41: '#cc0000',
	42: '#00cc00',
	43: '#cccc00',
	44: '#0000ee',
	45: '#cc00cc',
	46: '#00cccc',
	47: '#ffffff',
	100: '#666666',
	101: '#ff0000',
	102: '#00ff00',
	103: '#ffff00',
	104: '#5555ff',
	105: '#ff00ff',
	106: '#00ffff',
	107: '#ffffff',
};

export interface StyledPart {
	text: string;
	fg?: string;
	bg?: string;
	bold?: boolean;
	dim?: boolean;
	italic?: boolean;
	underline?: boolean;
}

export function parseAnsiCodes(text: string): StyledPart[] {
	const parts: StyledPart[] = [];

	// Current style state
	let currentFg: string | undefined;
	let currentBg: string | undefined;
	let currentBold = false;
	let currentDim = false;
	let currentItalic = false;
	let currentUnderline = false;

	// Split by ANSI escape sequences
	const ansiRegex = /\x1b\[([0-9;]*)m/g;
	let lastIndex = 0;
	let match: RegExpExecArray | null;

	while ((match = ansiRegex.exec(text)) !== null) {
		// Add text before this escape code
		if (match.index > lastIndex) {
			const textContent = text.slice(lastIndex, match.index);
			if (textContent) {
				const part: StyledPart = {text: textContent};
				if (currentFg) part.fg = currentFg;
				if (currentBg) part.bg = currentBg;
				if (currentBold) part.bold = true;
				if (currentDim) part.dim = true;
				if (currentItalic) part.italic = true;
				if (currentUnderline) part.underline = true;
				parts.push(part);
			}
		}

		// Parse the escape code
		const codeStr = match[1] ?? '';
		const codes = codeStr.split(';').map((c) => parseInt(c || '0', 10));

		for (let i = 0; i < codes.length; i++) {
			const code = codes[i] ?? 0;
			if (code === 0) {
				// Reset all
				currentFg = undefined;
				currentBg = undefined;
				currentBold = false;
				currentDim = false;
				currentItalic = false;
				currentUnderline = false;
			} else if (code === 1) {
				currentBold = true;
			} else if (code === 2) {
				currentDim = true;
			} else if (code === 3) {
				currentItalic = true;
			} else if (code === 4) {
				currentUnderline = true;
			} else if (code === 22) {
				currentBold = false;
				currentDim = false;
			} else if (code === 23) {
				currentItalic = false;
			} else if (code === 24) {
				currentUnderline = false;
			} else if (code >= 30 && code <= 37) {
				currentFg = BASIC_COLORS[code];
			} else if (code >= 40 && code <= 47) {
				currentBg = BG_COLORS[code];
			} else if (code >= 90 && code <= 97) {
				currentFg = BASIC_COLORS[code];
			} else if (code >= 100 && code <= 107) {
				currentBg = BG_COLORS[code];
			} else if (code === 38) {
				// 256-color or RGB
				// Format: 38;5;N or 38;2;R;G;B
				const mode = codes[i + 1];
				if (mode === 5) {
					const colorIdx = codes[i + 2];
					if (colorIdx !== undefined) {
						if (colorIdx >= 0 && colorIdx <= 15) {
							currentFg = BASIC_COLORS[30 + (colorIdx % 8)] || '#ffffff';
						} else if (colorIdx >= 16 && colorIdx <= 231) {
							// Standard 216-color cube
							const idx = colorIdx - 16;
							const r = Math.floor(idx / 36) * 51;
							const g = Math.floor((idx % 36) / 6) * 51;
							const b = (idx % 6) * 51;
							currentFg = `rgb(${r},${g},${b})`;
						} else {
							// Grayscale
							const gray = 8 + (colorIdx - 232) * 10;
							currentFg = `rgb(${gray},${gray},${gray})`;
						}
						i += 2; // Skip the next two codes
					}
				} else if (mode === 2) {
					const r = codes[i + 2];
					const g = codes[i + 3];
					const b = codes[i + 4];
					if (r !== undefined && g !== undefined && b !== undefined) {
						currentFg = `rgb(${r},${g},${b})`;
						i += 4; // Skip the next four codes
					}
				}
			} else if (code === 48) {
				// Background 256-color or RGB
				const mode = codes[i + 1];
				if (mode === 5) {
					const colorIdx = codes[i + 2];
					if (colorIdx !== undefined) {
						if (colorIdx >= 0 && colorIdx <= 15) {
							currentBg = BG_COLORS[40 + (colorIdx % 8)] || '#000000';
						} else if (colorIdx >= 16 && colorIdx <= 231) {
							const idx = colorIdx - 16;
							const r = Math.floor(idx / 36) * 51;
							const g = Math.floor((idx % 36) / 6) * 51;
							const b = (idx % 6) * 51;
							currentBg = `rgb(${r},${g},${b})`;
						} else {
							const gray = 8 + (colorIdx - 232) * 10;
							currentBg = `rgb(${gray},${gray},${gray})`;
						}
						i += 2; // Skip the next two codes
					}
				} else if (mode === 2) {
					const r = codes[i + 2];
					const g = codes[i + 3];
					const b = codes[i + 4];
					if (r !== undefined && g !== undefined && b !== undefined) {
						currentBg = `rgb(${r},${g},${b})`;
						i += 4; // Skip the next four codes
					}
				}
			}
		}

		lastIndex = match.index + match[0].length;
	}

	// Add remaining text
	if (lastIndex < text.length) {
		const textContent = text.slice(lastIndex);
		if (textContent) {
			const part: StyledPart = {text: textContent};
			if (currentFg) part.fg = currentFg;
			if (currentBg) part.bg = currentBg;
			if (currentBold) part.bold = true;
			if (currentDim) part.dim = true;
			if (currentItalic) part.italic = true;
			if (currentUnderline) part.underline = true;
			parts.push(part);
		}
	}

	return parts;
}

export function AnsiText({content}: {content: string}) {
	const parts = parseAnsiCodes(content);

	return (
		<>
			{parts.map((part, i) => (
				<span
					key={i}
					style={{
						color: part.fg,
						backgroundColor: part.bg,
						fontWeight: part.bold ? 'bold' : undefined,
						opacity: part.dim ? 0.7 : undefined,
						fontStyle: part.italic ? 'italic' : undefined,
						textDecoration: part.underline ? 'underline' : undefined,
					}}
				>
					{part.text}
				</span>
			))}
		</>
	);
}

export function FilePath({path}: {path: string}) {
	return <code className="text-xs font-mono bg-bg-200 px-1.5 py-0.5 rounded truncate">{path}</code>;
}

export function DiffStats({added, removed}: {added: number; removed: number}) {
	return (
		<span className="inline-flex gap-1 font-mono text-xs shrink-0">
			{added > 0 && <span className="text-success-000">+{added}</span>}
			{removed > 0 && <span className="text-danger-000">-{removed}</span>}
		</span>
	);
}

export function ErrorBorder({isError, children}: {isError?: boolean | undefined; children: ReactNode}) {
	if (!isError) return <>{children}</>;
	return <div className="border-l-2 border-danger-100 pl-2">{children}</div>;
}

export function TerminalOutput({content, maxLines = 20}: {content: string; maxLines?: number}) {
	// Extract exit code if present at the start of the content
	const exitCodeMatch = content.match(/^Exit code (\d+)\n?/);
	const exitCode = exitCodeMatch?.[1] ? parseInt(exitCodeMatch[1], 10) : null;
	const contentWithoutExitCode = exitCodeMatch ? content.replace(/^Exit code \d+\n?/, '') : content;
	const lineCount = contentWithoutExitCode.split('\n').length;

	return (
		<div>
			{exitCode !== null && (
				<div className="mb-2 flex items-center gap-2">
					<span className="inline-flex items-center gap-1.5 bg-danger-900 text-danger-000 px-2.5 py-1 rounded text-xs font-bold">
						Exit code <span className="font-mono">{exitCode}</span>
					</span>
				</div>
			)}
			<ExpandableBlock
				lineCount={lineCount}
				maxLines={maxLines}
			>
				<pre className="bg-bg-200 text-text-100 rounded text-xs leading-relaxed p-2 whitespace-pre-wrap break-all">
					<AnsiText content={contentWithoutExitCode} />
				</pre>
			</ExpandableBlock>
		</div>
	);
}

/**
 * Wraps tall content in a soft cap: shows up to `maxLines` worth of height,
 * with a gradient fade + "Show all N lines" button when overflow. Click to
 * reveal the rest inline — no inner scrollbar.
 */
export function ExpandableBlock({
	lineCount,
	maxLines = 20,
	children,
}: {
	lineCount: number;
	maxLines?: number;
	children: ReactNode;
}) {
	const [expanded, setExpanded] = useState(false);
	const needsCap = lineCount > maxLines;

	if (!needsCap || expanded) {
		return <div>{children}</div>;
	}

	// ~1.4rem per line of text-xs leading-relaxed. Keep this tight so the
	// fade/button appear just below the cutoff.
	const maxHeight = `${maxLines * 1.4}rem`;

	return (
		<div>
			<div
				className="relative overflow-hidden"
				style={{maxHeight}}
			>
				{children}
				<div className="absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-bg-000 to-transparent pointer-events-none" />
			</div>
			<button
				type="button"
				onClick={() => setExpanded(true)}
				className="mt-1 text-xs text-text-500 hover:text-text-100 transition cursor-pointer"
			>
				Show all {lineCount} lines
			</button>
		</div>
	);
}

export function CollapsibleSection({
	label,
	defaultOpen = false,
	children,
}: {
	label: ReactNode;
	defaultOpen?: boolean;
	children: ReactNode;
}) {
	const [open, setOpen] = useState(defaultOpen);

	return (
		<div>
			<button
				type="button"
				onClick={() => setOpen(!open)}
				className="flex items-center gap-1 text-xs text-text-500 hover:text-text-100 cursor-pointer"
			>
				<svg
					width="14"
					height="14"
					viewBox="0 0 20 20"
					fill="none"
					className="shrink-0 transition-transform duration-200"
					style={{transform: open ? 'rotate(0deg)' : 'rotate(-90deg)'}}
				>
					<path
						d="M14.128 7.165a.625.625 0 0 1 .707-.038l.128.098a.625.625 0 0 1 .037.844l-4.5 5-.157.131a.625.625 0 0 1-.686 0L9.5 13.069l-4.5-5-.07-.107a.625.625 0 0 1 .07-.737l.107-.098a.625.625 0 0 1 .765.038L10 11.585l4.128-4.42Z"
						fill="currentColor"
					/>
				</svg>
				{label}
			</button>
			<div className={`grid ${open ? 'grid-rows-expand' : 'grid-rows-collapse'}`}>
				<div className="overflow-hidden">
					<div className="mt-1">{children}</div>
				</div>
			</div>
		</div>
	);
}

export function ToolMeta({children}: {children: ReactNode}) {
	return <span className="text-xs text-text-500">{children}</span>;
}

export function formatDuration(ms: number): string {
	if (ms < 1000) return '< 1s';
	if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
	const mins = Math.floor(ms / 60000);
	const secs = Math.round((ms % 60000) / 1000);
	return `${mins}m ${secs}s`;
}

export function DurationBadge({duration}: {duration: number}) {
	return <span className="text-xs text-text-500 ml-1.5">{formatDuration(duration)}</span>;
}
