import {Check, Copy, Gauge, TriangleAlert} from "lucide-react";
import {type ReactNode, useId, useState} from "react";

import
{
	type ApiErrorCategory,
	apiErrorCategory,
	autoCompactFailed,
	errorCopy,
	refusalPassthrough,
	SIGNED_IN_AGAIN_LABEL,
} from "../lib/api-error-category";
import {parseApiErrorDetails, trailingRequestIds} from "../lib/api-error-details";
import {categoryRecoveryHelps, fallbackModel, type RecoveryAction, recoveryActions} from "../lib/api-error-recovery";
import {writeClipboardText} from "../lib/clipboard";
import {type AutoResumeEntry, fireAtSeconds, formatResumeTime} from "../lib/limit-auto-resume";
import {retryModelItems, type RetryModelOptions} from "../lib/retry-model-items";
import {type UsageLimit, usageLimitCard} from "../lib/usage-limit-notice";
import {ErrorCardShell} from "./error-card-shell";
import type {RecoveryHandlers} from "./error-recovery-actions";
import {DeferredErrorRecoveryActions} from "./error-recovery-actions-entry";
import {CdsCheckbox} from "./ui/checkbox";
import * as Collapsible from "./ui/collapsible";
import {useTimedFlag} from "../hooks/use-timed-flag";

/** How long upstream's Copy details button shows "Copied" with a check. */
const COPIED_MS = 1200;

export interface ApiErrorCardProps
{
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
	/** The record's `apiErrorType`, the API's own error type. */
	errorType?: string;
	/** The record's `apiErrorCode`, the API's own error code, e.g. `oauth_not_allowed_for_organization`. */
	errorCode?: string;
	/** The assistant message's `stop_reason`; `refusal` is a safeguards flag. */
	stopReason?: string;
	/** The live session's recovery handlers; only the transcript's last entry gets them. */
	recovery?: ApiErrorRecovery;
}

/** What the session can do from the card; a missing handler hides its action. */
export interface ApiErrorRecovery
{
	/** False when the retry was refused, which leaves the card unlatched. */
	onRetry?: () => boolean;
	onCompact?: () => void;
	onRewind?: () => void;
	/** Switches the session to a model (a primary alias) and retries; false when the switch failed. */
	onRetryWithModel?: (model: string) => Promise<boolean>;
	/** The running model's id, e.g. `claude-opus-5-5`. */
	currentModel?: string;
	/** How Switch model and retry dresses its rows: the catalog, restrictions, settings default and deprecation. */
	modelMenu?: RetryModelOptions;
}

function numericStatus(status: number | string | undefined): number | undefined
{
	if (typeof status === "number") return status;
	if (status === undefined || !/^\d+$/.test(status)) return undefined;
	return Number(status);
}

/** Upstream's ghost icon-only "Copy details" (cb1a6e506 `C`): Check + "Copied" for 1200ms. */
function CopyDetailsButton({details}: {details: string})
{
	const [copied, showCopied] = useTimedFlag(COPIED_MS);
	const label = copied ? "Copied" : "Copy details";
	const Icon = copied ? Check : Copy;
	return (
		<span className="absolute top-1 end-1 flex">
			<button
				type="button"
				aria-label={label}
				className="inline-flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-r5 text-ink-muted transition-colors hover:bg-fill-ghost-hover hover:text-primary hide-focus-ring focus-visible:outline-hidden focus-visible:shadow-focus"
				onMouseDown={(event) =>
				{
					event.preventDefault();
				}}
				onClick={() =>
				{
					void writeClipboardText(details).then((ok) =>
					{
						if (!ok) return;
						showCopied();
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
 * Copy details copies the raw error text (upstream's `jW({details})`), or the
 * lines when there is none.
 */
export function ErrorDetails({
	details,
	inCard,
	actions,
}: {
	/** Undefined hides View details; the row still shows for the actions. */
	details: ErrorDetailsContent | undefined;
	/** In the card the row and panel carry the card's padding; the marker's sit flush with `pt-2`. */
	inCard: boolean;
	/** Upstream's action group, pushed to the row's trailing edge. */
	actions?: ReactNode;
})
{
	const {body, raw, status, errorType, errorCode, requestId, messageId} = details ?? {};
	const [open, setOpen] = useState(false);
	const facts =
		status === undefined && requestId === undefined
			? []
			: [
					...(status === undefined ? [] : [`Status: ${status}`]),
					...(errorType === undefined ? [] : [`Error type: ${errorType}`]),
					...(errorCode === undefined ? [] : [`Error code: ${errorCode}`]),
					...(requestId === undefined ? [] : [`Request ID: ${requestId}`]),
					...(messageId === undefined ? [] : [`Message ID: ${messageId}`]),
				];
	const copyText = raw ?? facts.join("\n");
	return (
		<Collapsible.Root open={open} onOpenChange={setOpen} className="flex flex-col self-stretch">
			<div
				className={`flex min-w-0 max-w-full flex-wrap items-center gap-x-3 gap-y-2${inCard ? " px-3 pb-3 pt-2" : ""}`}
			>
				{details !== undefined && (
					<Collapsible.Trigger
						caretPosition="end"
						className="shrink-0 whitespace-nowrap text-footnote text-secondary hover:text-primary"
					>
						<span className="text-current-control">View details</span>
					</Collapsible.Trigger>
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
			{details !== undefined && (
				<Collapsible.Panel className="contain-inline-size">
					<div data-api-error-details="" className={inCard ? "border-t px-3 py-3" : "pt-2"}>
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
				</Collapsible.Panel>
			)}
		</Collapsible.Root>
	);
}

/** What View details shows. */
export interface ErrorDetailsContent
{
	/** The parsed body (upstream's `eX`): no API Error prefix, a JSON body unwrapped. */
	body?: string;
	/** The unparsed error text, which Copy details copies. */
	raw?: string;
	status?: number | string;
	/** The record's `apiErrorType`; beyond upstream, shown beside the status. */
	errorType?: string;
	/** The record's `apiErrorCode`; beyond upstream, shown beside the status. */
	errorCode?: string;
	requestId?: string;
	messageId?: string;
}

interface ResolvedApiError
{
	category: ApiErrorCategory;
	status?: number;
	rewindHelps: boolean;
	headline: string;
	markerLabel: string;
	hint: string;
	icon: "warning" | "gauge";
	learnMoreUrl?: string;
	/** The View details props, or undefined when upstream shows no View details. */
	details?: ErrorDetailsContent;
}

/**
 * Classifies the error and picks what upstream shows for it. Without a live
 * session the viewer can't rewind, retry or send, so the hint is the
 * no-composer variant; with one, it follows what the card offers. A `drop`
 * verdict hides the body and keeps View details only for a status or
 * request id. The status falls back to the one in the text's prefix.
 */
function resolveApiError({
	text,
	details,
	status,
	requestId,
	messageId,
	code,
	errorType,
	errorCode,
	stopReason,
	hint: hintContext =
	{
		canRewind: false,
		canRetry: false,
		hasComposer: false,
	},
}: ApiErrorCardProps &
{
	hint?: Parameters<typeof errorCopy>[1];
}): ResolvedApiError
{
	const numeric = numericStatus(status);
	const category = apiErrorCategory(
		{
			text,
			status,
			code,
			errorType,
			stopReason,
		},
	);
	const copy = errorCopy(
		category,
		{
			...hintContext,
			text,
		},
	);
	// Upstream's passthrough: a refusal's own text replaces the hint, drops Learn more, and leaves View details.
	const passthrough = category === "usage_policy" && stopReason === "refusal" ? refusalPassthrough(text) : undefined;
	const raw = details ?? (text === "" ? undefined : text);
	const parsed = raw === undefined ? undefined : parseApiErrorDetails(raw);
	const parsedBody = parsed?.body === "" ? raw : parsed?.body;
	const body = copy.detailsVerdict === "drop" || passthrough !== undefined ? undefined : parsedBody;
	const detailsStatus = status ?? parsed?.status;
	const showDetails = body !== undefined || detailsStatus !== undefined || requestId !== undefined;
	const learnMoreUrl = passthrough === undefined ? copy.learnMoreUrl : undefined;
	return {
		category,
		...(numeric !== undefined &&
		{
			status: numeric,
		}),
		rewindHelps: copy.rewindHelps,
		headline: copy.headline,
		markerLabel: copy.markerLabel,
		hint: passthrough?.body ?? copy.hint,
		icon: category === "rate_limit" ? "gauge" : "warning",
		...(learnMoreUrl !== undefined &&
		{
			learnMoreUrl,
		}),
		...(showDetails &&
		{
			details:
			{
				...(body !== undefined &&
				{
					body,
				}),
				...(raw !== undefined &&
				{
					raw,
				}),
				...(detailsStatus !== undefined &&
				{
					status: detailsStatus,
				}),
				...(errorType !== undefined &&
				{
					errorType,
				}),
				...(errorCode !== undefined &&
				{
					errorCode,
				}),
				...(requestId !== undefined &&
				{
					requestId,
				}),
				...(messageId !== undefined &&
				{
					messageId,
				}),
			},
		}),
	};
}

/** Upstream's transcript API-error card (c44e562e8 `DW` over the shared card): the headline, hint and View details. */
export function ApiErrorCard(props: ApiErrorCardProps)
{
	const [retried, setRetried] = useState(false);
	const {recovery} = props;
	const canRetry = recovery?.onRetry !== undefined && !retried;
	const error = resolveApiError(
		{
			...props,
			hint:
			{
				canRewind: recovery?.onRewind !== undefined,
				canRetry,
				hasComposer: recovery !== undefined,
				compactOffered: recovery?.onCompact !== undefined,
				autoCompactTried: autoCompactFailed(props.text),
			},
		},
	);
	const {actions, handlers} =
		recovery === undefined
			?
				{
					actions: [],
					handlers: undefined,
				}
			: cardRecovery(error, recovery, retried);
	return (
		<ErrorCardShell
			data={
			{
				"data-api-error-card": "",
			}}
			headline={error.headline}
			hint={error.hint}
			icon={error.icon}
			{...(error.learnMoreUrl !== undefined &&
			{
				learnMoreUrl: error.learnMoreUrl,
			})}
			{...(recovery !== undefined &&
			{
				status: retried ? error.hint : "",
			})}
		>
			{(error.details !== undefined || actions.length > 0) && (
				<ErrorDetails
					details={error.details}
					inCard={true}
					{...(handlers !== undefined &&
						actions.length > 0 &&
						{
							actions: (
								<DeferredErrorRecoveryActions
									actions={actions}
									handlers={handlers}
									onActed={() =>
									{
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

/** The session's auto-resume entry for a usage-limit card, and its checkbox's toggle. */
export interface AutoResumeControl
{
	entry: AutoResumeEntry;
	onToggle: (checked: boolean) => void;
}

/**
 * Upstream's usage-limit error card (c3fef5c6f `x_` for a usage-limit `rate_limit`): the shared shell with a
 * danger gauge, the limit's headline and hint, and the recovery row's Try again on the live last entry. For a
 * 5-hour limit with an auto-resume entry, the options row holds the xs "Auto-continue when limits reset"
 * checkbox until Try again is pressed; while it is armed, the hint is "Auto-resuming at {reset + 90 s}" and
 * describes the checkbox. Upstream's Open usage settings is left out: the settings fix is billing.
 */
export function UsageLimitErrorCard({
	limit,
	text,
	recovery,
	autoResume,
}: {
	limit: UsageLimit | undefined;
	text: string;
	recovery?: ApiErrorRecovery | undefined;
	autoResume?: AutoResumeControl | undefined;
})
{
	const [retried, setRetried] = useState(false);
	const hintId = useId();
	const canRetry = recovery?.onRetry !== undefined && !retried;
	const card = usageLimitCard(limit, text, Date.now(), undefined, canRetry);
	if (card === null) return null;
	const offer = canRetry ? autoResume : undefined;
	const armedEntry = offer?.entry.armed === true ? offer.entry : undefined;
	const armed = armedEntry !== undefined;
	const {actions, handlers} =
		recovery === undefined
			?
				{
					actions: [],
					handlers: undefined,
				}
			: cardRecovery(
					{
						category: "rate_limit",
						rewindHelps: errorCopy(
							"rate_limit",
							{
								canRewind: false,
								canRetry,
								hasComposer: true,
							},
						).rewindHelps,
					},
					recovery,
					retried,
				);
	return (
		<ErrorCardShell
			data={
			{
				"data-usage-limit-card": "",
			}}
			headline={card.headline}
			hint={
				armedEntry === undefined ? (
					card.hint
				) : (
					<span id={hintId}>{`Auto-resuming at ${formatResumeTime(fireAtSeconds(armedEntry) * 1000)}`}</span>
				)
			}
			icon="gauge"
			{...(offer !== undefined &&
			{
				options: (
					<CdsCheckbox
						size="xs"
						checked={armed}
						onCheckedChange={offer.onToggle}
						label="Auto-continue when limits reset"
						{...(armed &&
						{
							"aria-describedby": hintId,
						})}
					/>
				),
			})}
			{...(recovery !== undefined &&
			{
				status: retried ? card.hint : "",
			})}
		>
			{handlers !== undefined && actions.length > 0 && (
				<ErrorDetails
					details={undefined}
					inCard={true}
					actions={
						<DeferredErrorRecoveryActions
							actions={actions}
							handlers={handlers}
							onActed={() =>
							{
								setRetried(true);
							}}
						/>
					}
				/>
			)}
		</ErrorCardShell>
	);
}

/** The card's inputs to upstream's recovery-row decision, and the handlers its buttons call. */
function cardRecovery(
	error: Pick<ResolvedApiError, "category" | "status" | "rewindHelps">,
	recovery: ApiErrorRecovery,
	retried: boolean,
):
{
	actions: RecoveryAction[];
	handlers: RecoveryHandlers;
}
{
	const {currentModel, onRetry, onCompact, onRewind, onRetryWithModel, modelMenu} = recovery;
	const modelItems = retryModelItems(
		{
			...modelMenu,
			current: currentModel,
		},
	);
	const rows = [
		...(modelItems.pinned === undefined ? [] : [modelItems.pinned]),
		...modelItems.main,
		...modelItems.more,
	];
	const fallback = currentModel === undefined ? undefined : fallbackModel(currentModel);
	const actions = recoveryActions(
		{
			...categoryRecoveryHelps(error.category, error.status),
			rewindHelps: error.rewindHelps,
			retried,
			canRetry: onRetry !== undefined,
			canRewind: onRewind !== undefined,
			canCompact: onCompact !== undefined,
			canFallback: onRetryWithModel !== undefined && fallback !== undefined,
			// Upstream's `retryModelLabel`: the checked row's name, or the pinned row's.
			currentModelLabel: rows.find((row) => row.checked)?.label ?? "",
			...(fallback !== undefined &&
			{
				fallbackModelLabel: fallback.label,
			}),
			...(onRetryWithModel !== undefined &&
				currentModel !== undefined &&
				{
					modelItems: rows,
				}),
		},
	);
	const handlers: RecoveryHandlers =
	{
		...(onRetry !== undefined &&
		{
			onRetry,
		}),
		...(onCompact !== undefined &&
		{
			onCompact,
		}),
		...(onRewind !== undefined &&
		{
			onRewind,
		}),
		...(onRetryWithModel !== undefined &&
		{
			onRetryWithModel,
		}),
		...(fallback !== undefined &&
		{
			fallbackAlias: fallback.alias,
		}),
		modelItems,
	};
	return {
		actions,
		handlers,
	};
}

const MARKER_ICON_CLASS = "size-4 shrink-0 text-danger-000";

/** Upstream's `xmXPKq` copy for a `prompt_injection_risk` stop. */
const PROMPT_INJECTION_STOP_HEADLINE =
	"Claude stopped because the page content may contain a prompt injection. Review the page before continuing.";

/**
 * Upstream's `stop_warning` item (cbb2d9547 `tX`): the shared error card with only a headline.
 * It has no hint, Dismiss, announce, details or actions, and it is never collapsed into a marker.
 */
export function StopWarningCard({stopReason}: {stopReason: "prompt_injection_risk"})
{
	return (
		<ErrorCardShell
			data={
			{
				"data-stop-warning": stopReason,
			}}
			headline={PROMPT_INJECTION_STOP_HEADLINE}
			icon="warning"
		/>
	);
}

/** The marker's danger warning icon, shared with the hook-blocked prompt marker. */
export function MarkerWarningIcon()
{
	return <TriangleAlert aria-hidden="true" className={MARKER_ICON_CLASS} />;
}

/** Upstream's earlier-error marker root (`Ek`), inset like assistant text. */
export const MARKER_ROOT_CLASS =
	"flex w-full max-w-[480px] flex-col items-start gap-1 self-start ps-[var(--cds-assistant-message-text-inset,0px)]";

/**
 * Upstream's collapsed form for an error that is not the last error of the
 * last entry (c44e562e8 `$U`, gated by `G_e`): the danger icon, the past-tense
 * marker label (else the headline), and View details without the card chrome.
 */
export function ApiErrorMarker(props: ApiErrorCardProps)
{
	const error = resolveApiError(props);
	const Icon = error.icon === "gauge" ? Gauge : TriangleAlert;
	return (
		<div data-api-error-marker="" className={MARKER_ROOT_CLASS}>
			<div className="flex max-w-full min-w-0 items-center gap-1.25 select-text">
				<Icon aria-hidden="true" className={MARKER_ICON_CLASS} />
				<span className="min-w-0 text-body text-secondary break-words">{error.markerLabel}</span>
			</div>
			{error.details !== undefined && <ErrorDetails details={error.details} inCard={false} />}
		</div>
	);
}

/**
 * Upstream's "Signed in again" marker (`kk` over the marker shell): an auth error older than a successful
 * `/login` keeps only the label, with no icon, and View details shows just the trailing request-id block
 * (`viewDetails: false`), so an error without one has no View details at all.
 */
export function SignedInAgainMarker({text}: {text: string})
{
	const ids = trailingRequestIds(text);
	return (
		<div data-api-error-marker="" data-signed-in-again="" className={MARKER_ROOT_CLASS}>
			<div className="flex max-w-full min-w-0 items-center gap-1.25 select-text">
				<span className="min-w-0 text-body text-secondary break-words">{SIGNED_IN_AGAIN_LABEL}</span>
			</div>
			{ids.requestId !== undefined && <ErrorDetails details={ids} inCard={false} />}
		</div>
	);
}
