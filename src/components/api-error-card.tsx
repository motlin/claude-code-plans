import {Check, Copy, Gauge, TriangleAlert} from "lucide-react";
import {type ReactNode, useEffect, useId, useRef, useState} from "react";

import {type ApiErrorCategory, classifyApiError, errorCopy, refusalPassthrough} from "../lib/api-error-category";
import {categoryRecoveryHelps, fallbackModel, type RecoveryAction, recoveryActions} from "../lib/api-error-recovery";
import {modelLabel, primaryModelMenuValue, PRIMARY_MODELS} from "../lib/launch-options";
import {writeClipboardText} from "../lib/clipboard";
import {ErrorCardShell} from "./error-card-shell";
import type {RecoveryHandlers} from "./error-recovery-actions";
import {DeferredErrorRecoveryActions} from "./error-recovery-actions-entry";
import {ChevronIcon} from "./tool-renderers/shared";

/** How long upstream's Copy details button shows "Copied" with a check. */
const COPIED_MS = 1200;

export interface ApiErrorCardProps {
	/** The error message's text, e.g. "API Error: 529 Overloaded…". */
	text: string;
	/** The JSONL record's `errorDetails`, shown in place of the text when present. */
	details?: string;
	status?: number | string;
	requestId?: string;
	/** The record's `message.id`, upstream's "Message ID" line. */
	messageId?: string;
	/** The record's string `error` code. */
	code?: string;
	/** The assistant message's `stop_reason`; `refusal` is a safeguards flag. */
	stopReason?: string;
	/** The live session's recovery handlers; only the transcript's last entry gets them. */
	recovery?: ApiErrorRecovery;
}

/** What the session can do from the card; a missing handler hides its action. */
export interface ApiErrorRecovery {
	onRetry?: () => void;
	onCompact?: () => void;
	onRewind?: () => void;
	/** Switches the session to a model (a primary alias) and retries; false when the switch failed. */
	onRetryWithModel?: (model: string) => Promise<boolean>;
	/** The running model's id, e.g. `claude-opus-5-5`. */
	currentModel?: string;
}

function numericStatus(status: number | string | undefined): number | undefined {
	if (typeof status === "number") return status;
	if (status === undefined || !/^\d+$/.test(status)) return undefined;
	return Number(status);
}

/** Upstream's ghost icon-only "Copy details" (cb1a6e506 `C`): Check + "Copied" for 1200ms. */
function CopyDetailsButton({details}: {details: string}) {
	const [copied, setCopied] = useState(false);
	const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
	useEffect(
		() => () => {
			clearTimeout(timer.current);
		},
		[],
	);
	const label = copied ? "Copied" : "Copy details";
	const Icon = copied ? Check : Copy;
	return (
		<span className="absolute top-1 end-1 flex">
			<button
				type="button"
				aria-label={label}
				className="inline-flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-r5 text-ink-muted transition-colors hover:bg-fill-ghost-hover hover:text-primary hide-focus-ring focus-visible:outline-hidden focus-visible:shadow-focus"
				onMouseDown={(event) => {
					event.preventDefault();
				}}
				onClick={() => {
					void writeClipboardText(details).then((ok) => {
						if (!ok) return;
						setCopied(true);
						clearTimeout(timer.current);
						timer.current = setTimeout(() => {
							setCopied(false);
						}, COPIED_MS);
					});
				}}
			>
				<Icon aria-hidden="true" className="size-4" />
			</button>
			<span className="sr-only" role="status">
				{copied ? "Copied" : ""}
			</span>
		</span>
	);
}

/**
 * Upstream's in-card details disclosure (cb1a6e506 `D` with `k`): "View
 * details" opens a tinted box with the raw error body, then the Status,
 * Request ID and Message ID lines, and a Copy details button in its corner.
 * Like upstream, the lines show only when there is a status or request id.
 * Upstream builds its copy text in a chunk the dumps don't include, so this
 * joins the body and the lines with newlines.
 */
function ErrorDetails({
	details,
	inCard,
	actions,
}: {
	/** Undefined hides View details; the row still shows for the actions. */
	details: ResolvedApiError["details"];
	/** In the card the row and panel carry the card's padding; the marker's sit flush with `pt-2`. */
	inCard: boolean;
	/** Upstream's action group, pushed to the row's trailing edge. */
	actions?: ReactNode;
}) {
	const {body, status, requestId, messageId} = details ?? {};
	const [open, setOpen] = useState(false);
	const panelId = useId();
	const facts =
		status === undefined && requestId === undefined
			? []
			: [
					...(status === undefined ? [] : [`Status: ${status}`]),
					...(requestId === undefined ? [] : [`Request ID: ${requestId}`]),
					...(messageId === undefined ? [] : [`Message ID: ${messageId}`]),
				];
	const copyText = [...(body === undefined ? [] : [body]), ...facts].join("\n");
	return (
		<>
			<div
				className={`flex min-w-0 max-w-full flex-wrap items-center gap-x-3 gap-y-2${inCard ? " px-3 pb-3 pt-2" : ""}`}
			>
				{details !== undefined && (
					<button
						type="button"
						aria-expanded={open}
						aria-controls={panelId}
						className="inline-flex shrink-0 cursor-pointer items-center gap-0.5 whitespace-nowrap text-footnote text-secondary hover:text-primary"
						onClick={() => {
							setOpen(!open);
						}}
					>
						<span>View details</span>
						<ChevronIcon expanded={open} />
					</button>
				)}
				{actions !== undefined && (
					<div
						data-api-error-actions=""
						className="ms-auto flex min-w-0 max-w-full flex-wrap items-center justify-end gap-2"
					>
						{actions}
					</div>
				)}
			</div>
			{open && (
				<div id={panelId} data-api-error-details="" className={inCard ? "border-t px-3 py-3" : "pt-2"}>
					<div className="relative flex min-h-[32px] flex-col gap-1.5 rounded-card bg-alpha-1 py-1.5 ps-2 pe-[34px] text-footnote text-secondary">
						{body !== undefined && (
							<span className="whitespace-pre-wrap break-words select-text">{body}</span>
						)}
						{facts.length > 0 && (
							<div className="flex flex-col text-ink-muted break-all select-text">
								{facts.map((fact) => (
									<span key={fact}>{fact}</span>
								))}
							</div>
						)}
						<CopyDetailsButton details={copyText} />
					</div>
				</div>
			)}
		</>
	);
}

interface ResolvedApiError {
	category: ApiErrorCategory;
	status?: number;
	rewindHelps: boolean;
	headline: string;
	markerLabel: string;
	hint: string;
	icon: "warning" | "gauge";
	learnMoreUrl?: string;
	/** The View details props, or undefined when upstream shows no View details. */
	details?: {
		body?: string;
		status?: number | string;
		requestId?: string;
		messageId?: string;
	};
}

/**
 * Classifies the error and picks what upstream shows for it. Without a live
 * session the viewer can't rewind, retry or send, so the hint is the
 * no-composer variant; with one, it follows what the card offers. A `drop`
 * verdict hides the raw body and keeps View details only for a status or
 * request id.
 */
function resolveApiError({
	text,
	details,
	status,
	requestId,
	messageId,
	code,
	stopReason,
	hint: hintContext = {canRewind: false, canRetry: false, hasComposer: false},
}: ApiErrorCardProps & {
	hint?: Parameters<typeof errorCopy>[1];
}): ResolvedApiError {
	const numeric = numericStatus(status);
	const category = classifyApiError({
		text,
		...(code !== undefined && {code}),
		...(stopReason !== undefined && {stopReason}),
		...(numeric !== undefined && {status: numeric}),
	});
	const copy = errorCopy(category, hintContext);
	// Upstream's passthrough: a refusal's own text replaces the hint, drops Learn more, and leaves View details.
	const passthrough = category === "usage_policy" && stopReason === "refusal" ? refusalPassthrough(text) : undefined;
	const raw = details ?? (text === "" ? undefined : text);
	const body = copy.detailsVerdict === "drop" || passthrough !== undefined ? undefined : raw;
	const showDetails = body !== undefined || status !== undefined || requestId !== undefined;
	const learnMoreUrl = passthrough === undefined ? copy.learnMoreUrl : undefined;
	return {
		category,
		...(numeric !== undefined && {status: numeric}),
		rewindHelps: copy.rewindHelps,
		headline: copy.headline,
		markerLabel: copy.markerLabel,
		hint: passthrough?.body ?? copy.hint,
		icon: category === "rate_limit" ? "gauge" : "warning",
		...(learnMoreUrl !== undefined && {learnMoreUrl}),
		...(showDetails && {
			details: {
				...(body !== undefined && {body}),
				...(status !== undefined && {status}),
				...(requestId !== undefined && {requestId}),
				...(messageId !== undefined && {messageId}),
			},
		}),
	};
}

/** Upstream's transcript API-error card (c44e562e8 `DW` over the shared card): the headline, hint and View details. */
export function ApiErrorCard(props: ApiErrorCardProps) {
	const [retried, setRetried] = useState(false);
	const {recovery} = props;
	const canRetry = recovery?.onRetry !== undefined && !retried;
	const error = resolveApiError({
		...props,
		hint: {
			canRewind: recovery?.onRewind !== undefined,
			canRetry,
			hasComposer: recovery !== undefined,
		},
	});
	const {actions, handlers} =
		recovery === undefined ? {actions: [], handlers: undefined} : cardRecovery(error, recovery, retried);
	return (
		<ErrorCardShell
			data={{"data-api-error-card": ""}}
			headline={error.headline}
			hint={error.hint}
			icon={error.icon}
			{...(error.learnMoreUrl !== undefined && {
				learnMoreUrl: error.learnMoreUrl,
			})}
			{...(recovery !== undefined && {status: retried ? error.hint : ""})}
		>
			{(error.details !== undefined || actions.length > 0) && (
				<ErrorDetails
					details={error.details}
					inCard={true}
					{...(handlers !== undefined &&
						actions.length > 0 && {
							actions: (
								<DeferredErrorRecoveryActions
									actions={actions}
									handlers={handlers}
									onActed={() => {
										setRetried(true);
									}}
								/>
							),
						})}
				/>
			)}
		</ErrorCardShell>
	);
}

/** The card's inputs to upstream's recovery-row decision, and the handlers its buttons call. */
function cardRecovery(
	error: ResolvedApiError,
	recovery: ApiErrorRecovery,
	retried: boolean,
): {actions: RecoveryAction[]; handlers: RecoveryHandlers} {
	const {currentModel, onRetry, onCompact, onRewind, onRetryWithModel} = recovery;
	const current = primaryModelMenuValue(currentModel);
	const fallback = currentModel === undefined ? undefined : fallbackModel(currentModel);
	const actions = recoveryActions({
		...categoryRecoveryHelps(error.category, error.status),
		rewindHelps: error.rewindHelps,
		retried,
		canRetry: onRetry !== undefined,
		canRewind: onRewind !== undefined,
		canCompact: onCompact !== undefined,
		canFallback: onRetryWithModel !== undefined && fallback !== undefined,
		currentModelLabel: current === "" ? (currentModel ?? "") : modelLabel(current),
		...(fallback !== undefined && {fallbackModelLabel: fallback.label}),
		...(onRetryWithModel !== undefined &&
			currentModel !== undefined && {
				modelItems: PRIMARY_MODELS.map((model) => ({value: model.id, checked: model.id === current})),
			}),
	});
	const handlers: RecoveryHandlers = {
		...(onRetry !== undefined && {onRetry}),
		...(onCompact !== undefined && {onCompact}),
		...(onRewind !== undefined && {onRewind}),
		...(onRetryWithModel !== undefined && {onRetryWithModel}),
		...(fallback !== undefined && {fallbackAlias: fallback.alias}),
		...(current !== "" && {currentModelValue: current}),
	};
	return {actions, handlers};
}

const MARKER_ICON_CLASS = "size-4 shrink-0 text-danger-000";

/**
 * Upstream's collapsed form for an error that is not the last error of the
 * last entry (c44e562e8 `$U`, gated by `G_e`): the danger icon, the past-tense
 * marker label (else the headline), and View details without the card chrome.
 */
export function ApiErrorMarker(props: ApiErrorCardProps) {
	const error = resolveApiError(props);
	const Icon = error.icon === "gauge" ? Gauge : TriangleAlert;
	return (
		<div data-api-error-marker="" className="flex w-full max-w-[480px] flex-col items-start gap-1 self-start">
			<div className="flex max-w-full min-w-0 items-center gap-1.25 select-text">
				<Icon aria-hidden="true" className={MARKER_ICON_CLASS} />
				<span className="min-w-0 text-body text-secondary break-words">{error.markerLabel}</span>
			</div>
			{error.details !== undefined && <ErrorDetails details={error.details} inCard={false} />}
		</div>
	);
}
