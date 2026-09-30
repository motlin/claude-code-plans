import type {CSSProperties} from "react";
import {z} from "zod";

/** Settings ▸ Transcript width, as on claude.ai/code: Narrow / Medium / Wide. */
export const TranscriptWidthSchema = z.enum(["narrow", "medium", "wide"]);
export type TranscriptWidth = z.infer<typeof TranscriptWidthSchema>;

export const TRANSCRIPT_WIDTH_PX: Record<TranscriptWidth, number> = {
	narrow: 768,
	medium: 960,
	wide: 1280,
};

/** Sets the chat column measure for every transcript row and the dock below it. */
export function transcriptWidthStyle(width: TranscriptWidth): CSSProperties {
	return {"--max-content-width": `${TRANSCRIPT_WIDTH_PX[width]}px`} as CSSProperties;
}

/**
 * The column shared by transcript rows and the composer dock, so the composer
 * lines up with the messages: the content measure plus 32px gutters.
 */
export const CHAT_COLUMN_CLASS = "mx-auto w-full max-w-[calc(var(--max-content-width,768px)+64px)] px-8";
