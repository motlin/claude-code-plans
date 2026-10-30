import {z} from "zod";

import {TRANSCRIPT_WIDTH_PX, type TranscriptWidth} from "./transcript-width";

/** Settings ▸ Claude Code ▸ Appearance ▸ Interface font: the bundled sans, the OS UI font, or OpenDyslexic. */
export const InterfaceFontSchema = z.enum(["sans", "system", "dyslexic"]);
export type InterfaceFont = z.infer<typeof InterfaceFontSchema>;

/** Settings ▸ Claude Code ▸ Appearance ▸ Transcript text size: Small / Medium / Large. */
export const TranscriptTextSizeSchema = z.enum(["sm", "md", "lg"]);
export type TranscriptTextSize = z.infer<typeof TranscriptTextSizeSchema>;

export const SYSTEM_FONT_STACK =
	'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';

/**
 * Transcript body font size and leading, from upstream's non-fizzy-lake `[data-chat-text-size]`
 * blocks: `--chat-body` .8125/.875/.9375rem at `--chat-leading` 1.42857 / 1.42857 / 1.46667.
 * Rem sizes and unitless leadings let a browser text zoom (a larger root font size) scale the
 * transcript as it scales upstream's. On touch (comfortable density) transcript prose steps up to
 * upstream's comfortable scale, 15/22, 16/24 and 18/27px. The composer's `--prompt-text-size` stays 13/14/15px; its
 * `--prompt-line-height` is upstream's unset fallback, `round(size * 1.4, 1px)`.
 */
export const TRANSCRIPT_TEXT_SIZES: Record<
	TranscriptTextSize,
	{
		fontSize: string;
		lineHeight: string;
		comfortableFontSize: string;
		comfortableLineHeight: string;
		promptFontSize: string;
		promptLineHeight: string;
	}
> = {
	sm: {
		fontSize: "0.8125rem",
		lineHeight: "1.42857",
		comfortableFontSize: "0.9375rem",
		comfortableLineHeight: "1.46667",
		promptFontSize: "13px",
		promptLineHeight: "18px",
	},
	md: {
		fontSize: "0.875rem",
		lineHeight: "1.42857",
		comfortableFontSize: "1rem",
		comfortableLineHeight: "1.5",
		promptFontSize: "14px",
		promptLineHeight: "20px",
	},
	lg: {
		fontSize: "0.9375rem",
		lineHeight: "1.46667",
		comfortableFontSize: "1.125rem",
		comfortableLineHeight: "1.5",
		promptFontSize: "15px",
		promptLineHeight: "21px",
	},
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
		"--transcript-text-size": size.fontSize,
		"--transcript-leading": size.lineHeight,
		"--transcript-comfortable-text-size": size.comfortableFontSize,
		"--transcript-comfortable-leading": size.comfortableLineHeight,
		"--prompt-text-size": size.promptFontSize,
		"--prompt-line-height": size.promptLineHeight,
		"--max-content-width": `${TRANSCRIPT_WIDTH_PX[transcriptWidth]}px`,
	};
}
