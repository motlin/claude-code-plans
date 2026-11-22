import {Collapsible as BaseCollapsible} from "@base-ui/react/collapsible";
import {type ReactNode, useContext, useState} from "react";

import {useRefusalOptOut} from "../hooks/use-refusal-opt-out";
import {formatModelName} from "../lib/model-name";
import {ApprovalActionButton} from "./approval-action-button";
import {ExternalTextLink} from "./external-text-link";
import {NOTICE_SURFACE_CLASS} from "./notice-banner-classes";
import
{
	type ModelSwitchedRecord,
	modelSwitchedOpenMemory,
	type RefusalFallbackHost,
	RefusalFallbackHostContext,
	type RefusalSettingsLink,
} from "./refusal-fallback-host";
import * as Collapsible from "./ui/collapsible";
import {Icon} from "./ui/icon";

/** Upstream's learn-more article for a safeguards flag (shared-41 `Id` → `tG`), as the approval card uses. */
const REFUSAL_LEARN_MORE_URL = "https://support.claude.com/en/articles/8106465";
/** Upstream `zuPE8I`, or `cm.flagged` when there is no model name. */
const FLAGGED_TAIL = "safeguards flagged this message. This sometimes happens with safe, normal conversations.";

function modelName(model: string): string
{
	return formatModelName(model) ?? model;
}

const ROOT_CLASS = "flex items-start gap-xs py-md font-sans text-body font-normal break-words px-lg rounded-card";
const TOGGLE_CLASS =
	"cds-reset flex min-w-0 grow select-none items-center gap-x-[2px] border-0 text-start outline-none focus-visible:shadow-focus focus-visible:outline-hidden rounded transition-shadow duration-fast";
const CARET_CLASS = "shrink-0 text-secondary transition-transform motion-reduce:transition-none";

/** Upstream `my`: the API's explanation, else the flagged copy naming the refused model. */
function bodyCopy(record: ModelSwitchedRecord): string
{
	const explanation = record.apiRefusalExplanation?.trim() ?? "";
	if (explanation !== "") return explanation;
	return record.originalModel === ""
		? `This model's ${FLAGGED_TAIL}`
		: `${modelName(record.originalModel)}’s ${FLAGGED_TAIL}`;
}

function cardAction(record: ModelSwitchedRecord, host: RefusalFallbackHost): ReactNode
{
	const live = host.live !== null && host.live.uuid === record.uuid && !host.held ? host.live : null;
	if (live === null) return null;
	const {onNewSession, onEditRetry} = host;
	if (live.strike >= 2)
	{
		return onNewSession === undefined ? null : (
			<ApprovalActionButton
				variant="secondary"
				onClick={() =>
				{
					onNewSession(live.streakOriginalModel);
				}}
			>
				Start a new session
			</ApprovalActionButton>
		);
	}
	return onEditRetry === undefined ? null : (
		<ApprovalActionButton
			variant="secondary"
			onClick={() =>
			{
				onEditRetry();
			}}
		>
			Rewind and retry
		</ApprovalActionButton>
	);
}

/**
 * Upstream's in-transcript model-switched card (c01e7498d `vy` → shared-41 `Dj` with `inTranscript`):
 * at a safeguards refusal that moved the turn to a fallback, a neutral Banner with no icon whose title
 * "Switched to {fallback}" is a details disclosure. The details hold the API's explanation (or the
 * flagged copy naming the refused model), Learn more, the settings sentence while automatic switching
 * is on, and the raw category. Only the live fallback, when no card holds the session, gets an action:
 * escalated (strike 2+) "Start a new session" on the streak's original model, else "Rewind and retry".
 * It opens on arrival (the live one) and remembers a toggled choice. No dismiss X, no opt-out button.
 */
export function ModelSwitchedCard({
	record,
	host,
	settings,
}: {
	record: ModelSwitchedRecord;
	host: RefusalFallbackHost;
	settings: RefusalSettingsLink;
}): ReactNode
{
	const arrived = host.live?.uuid === record.uuid;
	const [choice, setChoice] = useState(() => modelSwitchedOpenMemory.get(record.uuid));
	const open = choice ?? arrived;
	const toggle = (next: boolean) =>
	{
		modelSwitchedOpenMemory.set(record.uuid, next);
		setChoice(next);
	};
	const action = cardAction(record, host);
	const category = record.apiRefusalCategory?.trim() ?? "";
	return (
		<div className="contents">
			<div
				data-cds="Banner"
				data-prose-box=""
				data-icon-layout="first-line"
				data-cta-layout="inline"
				data-action-align="first-line"
				data-testid="code-model-switched-card"
				role="none"
				className={`${ROOT_CLASS} ${NOTICE_SURFACE_CLASS}`}
			>
				<div className="flex min-w-0 flex-1 flex-col">
					<Collapsible.Root open={open} onOpenChange={toggle} className="contents">
						<div className="flex min-w-0 flex-wrap items-start gap-y-sm gap-x-md">
							<BaseCollapsible.Trigger className={TOGGLE_CLASS}>
								<span className="min-w-0">Switched to {modelName(record.fallbackModel)}</span>
								<Icon
									name="CaretDownFilled"
									size="sm"
									className={`${CARET_CLASS} ${open ? "rotate-0" : "-rotate-90 rtl:rotate-90"}`}
								/>
							</BaseCollapsible.Trigger>
							{action !== null && <div className="flex flex-wrap items-center gap-sm">{action}</div>}
						</div>
						<Collapsible.Panel className="w-full text-secondary">
							<div className="pt-[var(--cds-gap-sm)] stacks:pt-[var(--cds-gap-xs)]">
								<p>
									{bodyCopy(record)}{" "}
									<ExternalTextLink rel="noreferrer" href={REFUSAL_LEARN_MORE_URL}>
										Learn more
									</ExternalTextLink>
									.
									{settings.view === "offer" && (
										<>
											{" "}
											You can turn off automatic model switching in{" "}
											<button
												type="button"
												data-cds="TextLink"
												className="cds-reset text-link inline cursor-pointer"
												onClick={() =>
												{
													settings.openSettings();
												}}
											>
												settings
											</button>
											.
										</>
									)}
									{category !== "" && (
										<span className="block pt-1">
											Details: <code className="font-mono-ui break-all">[{category}]</code>
										</span>
									)}
								</p>
							</div>
						</Collapsible.Panel>
					</Collapsible.Root>
				</div>
			</div>
		</div>
	);
}

function BoundModelSwitchedCard({record, host}: {record: ModelSwitchedRecord; host: RefusalFallbackHost})
{
	const {view, openSettings} = useRefusalOptOut();
	return (
		<ModelSwitchedCard
			record={record}
			host={host}
			settings={
			{
				view,
				openSettings,
			}}
		/>
	);
}

/**
 * Upstream `Ty`: a `model_refusal_fallback` row draws the card while the session page publishes its
 * host, else nothing. It reads the CLI's settings.json for the settings sentence only once a fallback
 * row renders, so opening a session without one costs no settings fetch.
 */
export function ModelSwitchedCardForLine({record}: {record: ModelSwitchedRecord}): ReactNode
{
	const host = useContext(RefusalFallbackHostContext);
	return host === null ? null : <BoundModelSwitchedCard record={record} host={host} />;
}
