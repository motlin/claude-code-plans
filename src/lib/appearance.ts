import {z} from "zod";

import {FIZZY_LAKE_PARTS, type FizzyLakePart} from "./fizzy-lake";
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
 * Each interface font's family, mirroring globals.css (`--font-sans` and the OpenDyslexic rule), so the
 * fizzy `type` Interface font options can each be set in their own face like upstream's.
 */
export const INTERFACE_FONT_FAMILIES: Record<InterfaceFont, string> = {
	sans: '"Inter", system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
	system: SYSTEM_FONT_STACK,
	dyslexic: '"OpenDyslexic", system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
};

/**
 * Transcript body font size and leading, from upstream's non-fizzy-lake `[data-chat-text-size]`
 * blocks: `--chat-body` .8125/.875/.9375rem at `--chat-leading` 1.42857 / 1.42857 / 1.46667.
 * Rem sizes and unitless leadings let a browser text zoom (a larger root font size) scale the
 * transcript as it scales upstream's. In a comfortable scope transcript prose steps up to upstream's
 * comfortable `--cds-font-size-prose--textsm` / `prose` / `--textlg` scale, 15/22, 16/24 and 18/27px, with absolute
 * leadings. The composer's `--prompt-text-size` stays 13/14/15px; its `--prompt-line-height` is upstream's unset
 * fallback, `round(size * 1.4, 1px)`.
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
		comfortableLineHeight: "1.375rem",
		promptFontSize: "13px",
		promptLineHeight: "18px",
	},
	md: {
		fontSize: "0.875rem",
		lineHeight: "1.42857",
		comfortableFontSize: "1rem",
		comfortableLineHeight: "1.5rem",
		promptFontSize: "14px",
		promptLineHeight: "20px",
	},
	lg: {
		fontSize: "0.9375rem",
		lineHeight: "1.46667",
		comfortableFontSize: "1.125rem",
		comfortableLineHeight: "1.6875rem",
		promptFontSize: "15px",
		promptLineHeight: "21px",
	},
};

/**
 * Upstream fizzy-lake `type` at comfortable density drops the prose scale one step
 * (`.cds-root:is([data-cds-fizzy-lake~=type])[data-density=comfortable]`): `--cds-font-size-prose--textsm` /
 * `prose` / `--textlg` = .875/.9375/1rem at 1.25/1.3125/1.375rem. The composer editor follows it.
 */
export const TYPE_COMFORTABLE_TEXT_SIZES: Record<TranscriptTextSize, {fontSize: string; lineHeight: string}> = {
	sm: {fontSize: "0.875rem", lineHeight: "1.25rem"},
	md: {fontSize: "0.9375rem", lineHeight: "1.3125rem"},
	lg: {fontSize: "1rem", lineHeight: "1.375rem"},
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
export function appearanceCssVars(
	{interfaceFont, transcriptTextSize, transcriptWidth}: AppearancePrefs,
	fizzyLakeParts: readonly FizzyLakePart[] = FIZZY_LAKE_PARTS,
): Record<string, string | null> {
	const size = TRANSCRIPT_TEXT_SIZES[transcriptTextSize];
	const type = fizzyLakeParts.includes("type") ? TYPE_COMFORTABLE_TEXT_SIZES[transcriptTextSize] : undefined;
	return {
		"--font-sans": interfaceFont === "system" ? SYSTEM_FONT_STACK : null,
		"--transcript-text-size": size.fontSize,
		"--transcript-leading": size.lineHeight,
		"--transcript-comfortable-text-size": type?.fontSize ?? size.comfortableFontSize,
		"--transcript-comfortable-leading": type?.lineHeight ?? size.comfortableLineHeight,
		"--prompt-text-size": size.promptFontSize,
		"--prompt-line-height": size.promptLineHeight,
		"--prompt-comfortable-text-size": type?.fontSize ?? size.promptFontSize,
		"--prompt-comfortable-line-height": type?.lineHeight ?? size.promptLineHeight,
		"--max-content-width": `${TRANSCRIPT_WIDTH_PX[transcriptWidth]}px`,
	};
}
