import {useState} from "react";

import {assertNever} from "../lib/assert-never";
import type {RecoveryAction} from "../lib/api-error-recovery";
import {PRIMARY_MODELS} from "../lib/launch-options";
import {ApprovalActionButton} from "./approval-card";
import {Menu, MenuContent, MenuGroup, MenuLabel, MenuRadioGroup, MenuRadioItem, MenuTrigger} from "./ui/menu";
import {SplitDropdownButton} from "./ui/split-dropdown-button";
import {Tooltip} from "./ui/tooltip";

const SWITCH_MODEL_AND_RETRY = "Switch model and retry";

/** Upstream's ghost model trigger (`TriggerButton variant="ghost"`), in local tokens. */
const MODEL_TRIGGER_CLASS =
	"inline-flex h-6 shrink min-w-0 max-w-[9rem] cursor-pointer items-center justify-start rounded-r5 px-2 text-[13px]/[19px] text-ink-muted hover:text-primary hover:bg-alpha-2 aria-expanded:bg-alpha-2 hide-focus-ring focus-visible:outline-hidden focus-visible:shadow-focus";

export interface RecoveryHandlers {
	onRetry?: () => void;
	onCompact?: () => void;
	onRewind?: () => void;
	/** Switches the session to a model (a primary alias) and retries. */
	onRetryWithModel?: (model: string) => void;
	/** The fallback model's alias, for "Try again with {label}". */
	fallbackAlias?: string;
	/** The primary alias the running model checks in the model menu. */
	currentModelValue?: string;
}

/** Upstream's "Switch model and retry" menu (`Vt`): a ghost trigger with the current model and a tooltip. */
function SwitchModelMenu({
	label,
	current,
	onSelect,
}: {
	label: string;
	current: string | undefined;
	onSelect: (model: string) => void;
}) {
	const [open, setOpen] = useState(false);
	return (
		<Menu open={open} onOpenChange={setOpen}>
			<Tooltip content={SWITCH_MODEL_AND_RETRY} suppressAfterPopup>
				<MenuTrigger className={MODEL_TRIGGER_CLASS}>
					<span className="truncate">{label}</span>
				</MenuTrigger>
			</Tooltip>
			<MenuContent side="bottom" align="start" className="break-words">
				<MenuGroup>
					<MenuLabel>{SWITCH_MODEL_AND_RETRY}</MenuLabel>
					<MenuRadioGroup
						value={current ?? ""}
						onValueChange={(value: string) => {
							setOpen(false);
							onSelect(value);
						}}
					>
						{PRIMARY_MODELS.map((model) => (
							<MenuRadioItem key={model.id} value={model.id} closeOnClick>
								<span data-menu-item-label="">{model.label}</span>
							</MenuRadioItem>
						))}
					</MenuRadioGroup>
				</MenuGroup>
			</MenuContent>
		</Menu>
	);
}

/**
 * The card's recovery buttons in `recoveryActions` order: the primary is a black
 * button at the trailing edge, the rest are secondary. `onActed` runs after any
 * press, for the card's retried latch.
 */
export function ErrorRecoveryActions({
	actions,
	handlers,
	onActed,
}: {
	actions: readonly RecoveryAction[];
	handlers: RecoveryHandlers;
	onActed: () => void;
}) {
	const act = (handler: (() => void) | undefined) => () => {
		handler?.();
		onActed();
	};
	return actions.map((action) => {
		const variant = action.primary ? "primary" : "secondary";
		switch (action.key) {
			case "rewind":
				return (
					<ApprovalActionButton key={action.key} variant={variant} onClick={act(handlers.onRewind)}>
						{action.label}
					</ApprovalActionButton>
				);
			case "compact":
				return (
					<ApprovalActionButton key={action.key} variant={variant} onClick={act(handlers.onCompact)}>
						{action.label}
					</ApprovalActionButton>
				);
			case "compact-split":
				return (
					<SplitDropdownButton
						key={action.key}
						variant={variant}
						label={action.label}
						menuLabel="More recovery options"
						onPrimaryClick={act(handlers.onCompact)}
						items={[{label: "Rewind", onSelect: act(handlers.onRewind)}]}
					/>
				);
			case "retry":
				return (
					<ApprovalActionButton key={action.key} variant={variant} onClick={act(handlers.onRetry)}>
						{action.label}
					</ApprovalActionButton>
				);
			case "fallback": {
				const {fallbackAlias, onRetryWithModel} = handlers;
				return (
					<ApprovalActionButton
						key={action.key}
						variant={variant}
						onClick={act(
							fallbackAlias === undefined || onRetryWithModel === undefined
								? undefined
								: () => {
										onRetryWithModel(fallbackAlias);
									},
						)}
					>
						{action.label}
					</ApprovalActionButton>
				);
			}
			case "switch-model":
				return (
					<SwitchModelMenu
						key={action.key}
						label={action.label}
						current={handlers.currentModelValue}
						onSelect={(model) => {
							handlers.onRetryWithModel?.(model);
							onActed();
						}}
					/>
				);
			default:
				return assertNever(action.key);
		}
	});
}
