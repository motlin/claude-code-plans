// ANSI color code to CSS color mapping
const BASIC_COLORS: Record<number, string> = {
	30: "#000000", // black
	31: "#cc0000", // red
	32: "#00cc00", // green
	33: "#cccc00", // yellow
	34: "#0000ee", // blue
	35: "#cc00cc", // magenta
	36: "#00cccc", // cyan
	37: "#ffffff", // white
	90: "#666666", // bright black
	91: "#ff0000", // bright red
	92: "#00ff00", // bright green
	93: "#ffff00", // bright yellow
	94: "#5555ff", // bright blue
	95: "#ff00ff", // bright magenta
	96: "#00ffff", // bright cyan
	97: "#ffffff", // bright white
};

const BG_COLORS: Record<number, string> = {
	40: "#000000",
	41: "#cc0000",
	42: "#00cc00",
	43: "#cccc00",
	44: "#0000ee",
	45: "#cc00cc",
	46: "#00cccc",
	47: "#ffffff",
	100: "#666666",
	101: "#ff0000",
	102: "#00ff00",
	103: "#ffff00",
	104: "#5555ff",
	105: "#ff00ff",
	106: "#00ffff",
	107: "#ffffff",
};

interface StyledPart {
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

	// Split by ANSI escape sequences (ESC = 0x1b)
	// eslint-disable-next-line no-control-regex -- ESC (0x1b) needed for ANSI codes
	const ansiRegex = /\u001b\[([0-9;]*)m/g;
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
		const codeStr = match[1] ?? "";
		const codes = codeStr.split(";").map((c) => parseInt(c || "0", 10));

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
							currentFg = BASIC_COLORS[30 + (colorIdx % 8)] ?? "#ffffff";
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
							currentBg = BG_COLORS[40 + (colorIdx % 8)] ?? "#000000";
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
