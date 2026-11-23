import {Check, Copy} from "lucide-react";
import {type ReactNode, useState} from "react";

import {writeClipboardText} from "../lib/clipboard";
import * as Collapsible from "./ui/collapsible";
import {useTimedFlag} from "../hooks/use-timed-flag";

/** How long upstream's Copy details button shows "Copied" with a check. */
const COPIED_MS = 1200;

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
	defaultOpen = false,
}: {
	/** Undefined hides View details; the row still shows for the actions. */
	details: ErrorDetailsContent | undefined;
	/** In the card the row and panel carry the card's padding; the marker's sit flush with `pt-sm`. */
	inCard: boolean;
	/** Upstream's action group, pushed to the row's trailing edge. */
	actions?: ReactNode;
	/** Upstream's send-rejected card opens its details by default; the API error cards start folded. */
	defaultOpen?: boolean;
})
{
	const {body, raw, status, errorType, errorCode, requestId, messageId} = details ?? {};
	const [open, setOpen] = useState(defaultOpen);
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
				className={`flex min-w-0 max-w-full flex-wrap items-center gap-x-lg gap-y-sm${inCard ? " px-lg pb-lg pt-md" : ""}`}
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
					<div data-api-error-details="" className={inCard ? "border-t px-lg py-lg" : "pt-sm"}>
						<div className="relative flex flex-col gap-xs rounded-card bg-alpha-1 py-sm ps-md text-footnote text-secondary min-h-[calc(var(--cds-h-control)+--spacing(2))] pe-[calc(var(--cds-h-control)+--spacing(1)+var(--cds-pad-sm))]">
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
