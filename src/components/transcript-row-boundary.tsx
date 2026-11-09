import {type ReactNode, useCallback, useId, useRef, useState} from "react";

import {isStaleChunkError} from "../lib/stale-chunk-reload";
import {ApprovalActionButton} from "./approval-card";
import {NoticeBanner} from "./notice-banner";
import {RenderErrorBoundary} from "./render-error-boundary";
import {PART_CRASHED_COPY} from "./tool-card-boundary";
import {Icon} from "./ui/icon";

/** Upstream TranscriptRow's `kind`: an assistant reply, or any other row. */
export type TranscriptRowCrashKind = "reply" | "row";

/** Upstream `WH` messages. */
const ROW_CRASH_COPY = {
	row: PART_CRASHED_COPY,
	reply: "This response didn’t load.",
	retry: "Try again",
} as const;

/* Upstream `Cp`: a retry that crashes again this soon, with the same row data, hides Try again. */
const REPEAT_WINDOW_MS = 10_000;

/** Upstream `AG`: a hash of the first seven stack lines. */
function stackHash(error: Error): string {
	let hash = 5381;
	for (const line of (error.stack ?? "").split("\n").slice(0, 7))
		for (let i = 0; i < line.length; i += 1) hash = (Math.imul(hash, 33) + line.charCodeAt(i)) | 0;
	return (hash >>> 0).toString(36);
}

/* Upstream `Rw`: a crash already logged from any row isn't logged again. */
const reportedCrashes = new Set<string>();

function reportRowCrash(error: unknown) {
	if (error instanceof Error) {
		const key = `${error.name}:${stackHash(error)}`;
		if (reportedCrashes.has(key)) return;
		reportedCrashes.add(key);
	}
	console.error("[transcript-row]", error);
}

/** Upstream `KN`: whether the boundary crashed again soon after a retry with the same `resetOn`. */
function useRepeatWindow(resetOn: unknown) {
	const lastRetry = useRef<{at: number; shown: unknown} | null>(null);
	const [again, setAgain] = useState(false);
	const onError = useCallback(() => {
		const retry = lastRetry.current;
		setAgain(retry !== null && retry.shown === resetOn && performance.now() - retry.at < REPEAT_WINDOW_MS);
	}, [resetOn]);
	const noteRetry = useCallback(() => {
		lastRetry.current = {at: performance.now(), shown: resetOn};
	}, [resetOn]);
	return {again, onError, noteRetry};
}

/** Upstream `Lp`: after a retry, focus falls back to the row article that held it. */
function withFocusReturn(onRetry: () => void): () => void {
	return () => {
		const view = document.defaultView;
		const article = document.activeElement
			?.closest("[data-transcript-row-crashed]")
			?.parentElement?.closest<HTMLElement>("[tabindex]");
		onRetry();
		view?.requestAnimationFrame(() => {
			const active = document.activeElement;
			if (active === null || active === document.body) article?.focus({preventScroll: true});
		});
	};
}

/** Upstream `l8`: the crashed row's one-line neutral banner; a repeat crash drops Try again. */
function TranscriptRowCrashed({
	kind,
	again,
	onRetry,
}: {
	kind: TranscriptRowCrashKind;
	again: boolean;
	onRetry: () => void;
}) {
	const messageId = useId();
	return (
		<div data-transcript-row-crashed={kind} className="py-sm">
			<NoticeBanner
				keyline={null}
				role="status"
				icon={<Icon name="WarningCircle" size="auto" />}
				action={
					again ? undefined : (
						<ApprovalActionButton
							variant="secondary"
							aria-describedby={messageId}
							onClick={withFocusReturn(onRetry)}
						>
							{ROW_CRASH_COPY.retry}
						</ApprovalActionButton>
					)
				}
			>
				<span id={messageId}>{ROW_CRASH_COPY[kind]}</span>
			</NoticeBanner>
		</div>
	);
}

/**
 * Upstream's TranscriptRow boundary (`mH` over `N8`): a render crash replaces only its row with a
 * banner; a stale-chunk error escalates to the route's reload. New row data (`resetOn`) redraws it.
 */
export function TranscriptRowBoundary({
	kind,
	resetOn,
	children,
}: {
	kind: TranscriptRowCrashKind;
	resetOn: unknown;
	children: ReactNode;
}) {
	const {again, onError, noteRetry} = useRepeatWindow(resetOn);
	return (
		<RenderErrorBoundary
			resetOn={resetOn}
			report={reportRowCrash}
			reportEveryCatch
			onError={onError}
			fallback={(error, redraw) => {
				if (isStaleChunkError(error)) throw error;
				return (
					<TranscriptRowCrashed
						kind={kind}
						again={again}
						onRetry={() => {
							noteRetry();
							redraw();
						}}
					/>
				);
			}}
		>
			{children}
		</RenderErrorBoundary>
	);
}
