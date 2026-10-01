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
 * lines up with the messages: the content measure plus upstream's 32px gutters
 * (16px on phones). The session page cancels the page padding around it
 * ({@link CHAT_COLUMN_BLEED_CLASS}) so these gutters are the only inset.
 */
export const CHAT_COLUMN_CLASS = "mx-auto w-full max-w-[calc(var(--max-content-width,768px)+64px)] px-4 sm:px-8";

/** Cancels the root layout's `px-4 sm:px-8` so the chat column spans the whole panel. */
export const CHAT_COLUMN_BLEED_CLASS = "-mx-4 sm:-mx-8";
