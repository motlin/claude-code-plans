import {Check, Copy} from "lucide-react";
import {useEffect, useId, useRef, useState} from "react";

import {classifyApiError, errorCopy} from "../lib/api-error-category";
import {writeClipboardText} from "../lib/clipboard";
import {ErrorCardShell} from "./error-card-shell";
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
	body,
	status,
	requestId,
	messageId,
}: {
	body?: string;
	status?: number | string;
	requestId?: string;
	messageId?: string;
}) {
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
			<div className="flex min-w-0 max-w-full flex-wrap items-center gap-x-3 gap-y-2 px-3 pb-3 pt-2">
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
			</div>
			{open && (
				<div id={panelId} data-api-error-details="" className="border-t px-3 py-3">
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

/**
 * Upstream's transcript API-error card (c44e562e8 `DW` over the shared card):
 * the category's headline and hint, then View details. The viewer can't
 * rewind, retry or send, so the hint is the no-composer variant. A `drop`
 * verdict hides the raw body and keeps View details only for a status or
 * request id.
 */
export function ApiErrorCard({text, details, status, requestId, messageId, code, stopReason}: ApiErrorCardProps) {
	const numeric = numericStatus(status);
	const category = classifyApiError({
		text,
		...(code !== undefined && {code}),
		...(stopReason !== undefined && {stopReason}),
		...(numeric !== undefined && {status: numeric}),
	});
	const copy = errorCopy(category, {canRewind: false, canRetry: false, hasComposer: false});
	const raw = details ?? (text === "" ? undefined : text);
	const body = copy.detailsVerdict === "drop" ? undefined : raw;
	const showDetails = body !== undefined || status !== undefined || requestId !== undefined;
	return (
		<ErrorCardShell
			data={{"data-api-error-card": ""}}
			headline={copy.headline}
			hint={copy.hint}
			icon={category === "rate_limit" ? "gauge" : "warning"}
			{...(copy.learnMoreUrl !== undefined && {learnMoreUrl: copy.learnMoreUrl})}
		>
			{showDetails && (
				<ErrorDetails
					{...(body !== undefined && {body})}
					{...(status !== undefined && {status})}
					{...(requestId !== undefined && {requestId})}
					{...(messageId !== undefined && {messageId})}
				/>
			)}
		</ErrorCardShell>
	);
}
