import {Collapsible as BaseCollapsible} from "@base-ui/react/collapsible";
import {type ReactNode, useState} from "react";

import {formatModelName} from "../lib/model-name";
import {ApprovalActionButton} from "./approval-action-button";
import {type HardBlockHost, hardBlockOpenMemory} from "./hard-block-host";
import {NOTICE_SURFACE_CLASS} from "./notice-banner-classes";
import * as Collapsible from "./ui/collapsible";
import {Icon} from "./ui/icon";

/** Upstream `Rn.blocked` (yKz9sP). */
const MESSAGE_BLOCKED_TITLE = "Message blocked";
/** Upstream /dodrm and pAReVE. */
const EDIT_AND_RETRY_LABEL = "Edit and retry";
const EDIT_AND_RETRY_BUSY_LABEL = "Rewinding…";
/** Upstream's flagged copy with the model named (`T_` with `chatsWords`), or `Qi.flagged` with none. */
const FLAGGED_TAIL = "safeguards flagged this message. This sometimes happens with safe, normal conversations.";

function flaggedCopy(model: string): string
{
	const name = model === "" ? null : (formatModelName(model) ?? model);
	return name === null ? `This model's ${FLAGGED_TAIL}` : `${name}’s ${FLAGGED_TAIL}`;
}

const ROOT_CLASS = "flex items-start gap-xs !py-lg font-sans text-body font-normal break-words px-lg rounded-card";
const TOGGLE_CLASS =
	"cds-reset flex min-w-0 grow select-none items-center gap-x-[2px] border-0 text-start outline-none focus-visible:shadow-focus focus-visible:outline-hidden rounded transition-shadow duration-fast";
/** Upstream's caret: `duration-fast` motion, then `-rotate-90 page-rtl:rotate-90` while closed, ink last. */
const CARET_MOTION = "transition-transform duration-fast motion-reduce:transition-none";

/**
 * Upstream's hard-block card (c3fef5c6f `j_`): a neutral cds Banner with a Warning icon whose title
 * "Message blocked" is a disclosure. The newest refusal, when no card holds the session, is live: it
 * opens expanded and offers Edit and retry while its prompt is still the last rewindable one. Older
 * refusals collapse. A row with no block draws `fallback`, the legacy "Message flagged" card.
 */
export function MessageBlockedCard({
	host,
	uuid,
	fallback,
}: {
	host: HardBlockHost;
	uuid: string;
	fallback: ReactNode;
}): ReactNode
{
	const newest = host.latest?.uuid === uuid;
	const live = newest && !host.held;
	const block = newest ? host.latest : host.blockAt(uuid);
	// Upstream `W = p ?? d`: a remembered choice wins, else the card is open exactly while it is live.
	const [choice, setChoice] = useState(() => hardBlockOpenMemory.get(uuid));
	const open = choice ?? live;
	if (block === null) return fallback;
	const model = block.model ?? "";
	const onEditRetry = host.onEditRetry;
	const canEditRetry = live && onEditRetry !== undefined && block.hasMessage;
	const toggle = (next: boolean) =>
	{
		hardBlockOpenMemory.set(uuid, next);
		setChoice(next);
	};
	return (
		<div className="contents">
			<div
				data-cds="Banner"
				data-prose-box=""
				data-icon-layout="first-line"
				data-cta-layout="inline"
				data-action-align="first-line"
				data-testid="hard-block-card"
				data-banner-variant="neutral"
				className={`${ROOT_CLASS} ${NOTICE_SURFACE_CLASS}`}
			>
				<span className={`flex min-h-[1lh] shrink-0 items-center text-secondary`}>
					<Icon name="Warning" size="auto" className="text-warning" />
				</span>
				<div className="flex min-w-0 flex-1 flex-col">
					<Collapsible.Root open={open} onOpenChange={toggle} className="contents">
						<div className="flex min-w-0 flex-wrap items-start gap-y-sm gap-x-md">
							<BaseCollapsible.Trigger className={TOGGLE_CLASS} aria-disabled={false}>
								<div className="min-w-0">{MESSAGE_BLOCKED_TITLE}</div>
								<Icon
									name="CaretDownFilled"
									size="sm"
									className={
										open
											? `${CARET_MOTION} text-secondary`
											: `${CARET_MOTION} -rotate-90 page-rtl:rotate-90 text-secondary`
									}
								/>
							</BaseCollapsible.Trigger>
						</div>
						<Collapsible.Panel className="w-full text-secondary">
							<div className="pt-[var(--cds-gap-xs)]">
								<div className="flex flex-col items-start gap-sm">
									<p>{flaggedCopy(model)}</p>
									{canEditRetry && (
										<div className="flex flex-wrap items-center gap-sm">
											<ApprovalActionButton
												variant="secondary"
												busy={host.editRetryBusyFor === uuid}
												busyLabel={EDIT_AND_RETRY_BUSY_LABEL}
												onClick={() =>
												{
													onEditRetry(uuid);
												}}
											>
												{EDIT_AND_RETRY_LABEL}
											</ApprovalActionButton>
										</div>
									)}
								</div>
							</div>
						</Collapsible.Panel>
					</Collapsible.Root>
				</div>
			</div>
		</div>
	);
}
