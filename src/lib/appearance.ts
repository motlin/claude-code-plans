import {z} from "zod";

import {TRANSCRIPT_WIDTH_PX, type TranscriptWidth} from "./transcript-width";

/** Settings ▸ Claude Code ▸ Appearance ▸ Interface font: the bundled sans, or the OS UI font. */
export const InterfaceFontSchema = z.enum(["sans", "system"]);
export type InterfaceFont = z.infer<typeof InterfaceFontSchema>;

/** Settings ▸ Claude Code ▸ Appearance ▸ Transcript text size: Small / Medium / Large. */
export const TranscriptTextSizeSchema = z.enum(["sm", "md", "lg"]);
export type TranscriptTextSize = z.infer<typeof TranscriptTextSizeSchema>;

export const SYSTEM_FONT_STACK =
	'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';

/** Transcript body font size and line height in pixels; Medium is the upstream 14/20 body. */
export const TRANSCRIPT_TEXT_SIZES: Record<TranscriptTextSize, {fontSize: number; lineHeight: number}> = {
	sm: {fontSize: 13, lineHeight: 18},
	md: {fontSize: 14, lineHeight: 20},
	lg: {fontSize: 16, lineHeight: 24},
};

interface AppearancePrefs {
	interfaceFont: InterfaceFont;
	transcriptTextSize: TranscriptTextSize;
	transcriptWidth: TranscriptWidth;
}

/**
 * The CSS custom properties the appearance prefs set on `<html>`. A null
 * value removes the property so the stylesheet default applies.
 */
export function appearanceCssVars({
	interfaceFont,
	transcriptTextSize,
	transcriptWidth,
}: AppearancePrefs): Record<string, string | null> {
	const size = TRANSCRIPT_TEXT_SIZES[transcriptTextSize];
	return {
		"--font-sans": interfaceFont === "system" ? SYSTEM_FONT_STACK : null,
		"--transcript-text-size": `${size.fontSize}px`,
		"--transcript-leading": `${size.lineHeight}px`,
		"--max-content-width": `${TRANSCRIPT_WIDTH_PX[transcriptWidth]}px`,
	};
}
