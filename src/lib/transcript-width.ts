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

/** Shared message/dock measure. Tile shells override the desktop gutters to 32px/40px. */
export const CHAT_COLUMN_CLASS = "chat-column";
