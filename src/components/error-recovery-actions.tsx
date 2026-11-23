import {type ReactNode, useState} from "react";

import {assertNever} from "../lib/assert-never";
import type {RecoveryAction} from "../lib/api-error-recovery";
import type {RetryModelItem, RetryModelItems} from "../lib/retry-model-items";
import {ApprovalActionButton} from "./approval-action-button";
import {MENU_BADGE_CLASS, MENU_BADGE_TEXT_CLASS} from "./ui/badge-classes";
import
{
	Menu,
	MenuContent,
	MenuGroup,
	MenuLabel,
	MenuRadioGroup,
	MenuRadioItem,
	MenuSeparator,
	MenuSub,
	MenuSubContent,
	MenuSubTrigger,
	MenuTrigger,
} from "./ui/menu";
import {SplitDropdownButton} from "./ui/split-dropdown-button";
import {Tooltip} from "./ui/tooltip";

const SWITCH_MODEL_AND_RETRY = "Switch model and retry";
const MORE_MODELS_LABEL = "More models";

const NO_MODEL_ITEMS: RetryModelItems =
{
	main: [],
	more: [],
};

/** Upstream's ghost model trigger (`TriggerButton variant="ghost"`), in local tokens. */
const MODEL_TRIGGER_CLASS =
	"inline-flex h-6 shrink min-w-0 max-w-[9rem] cursor-pointer items-center justify-start rounded-r5 px-2 text-body text-ink-muted hover:text-primary hover:bg-alpha-2 aria-expanded:bg-alpha-2 hide-focus-ring focus-visible:outline-hidden focus-visible:shadow-focus";

export interface RecoveryHandlers
{
	/** False when the retry was refused, which leaves the card unlatched. */
	onRetry?: () => boolean;
	onCompact?: () => void;
	onRewind?: () => void;
	/** Switches the session to a model (a primary alias) and retries; false when the switch failed. */
	onRetryWithModel?: (model: string) => Promise<boolean>;
	/** The fallback model's alias, for "Try again with {label}". */
	fallbackAlias?: string;
	/** Switch model and retry's rows: upstream's classic list. */
	modelItems?: RetryModelItems;
}

/** A row's title: the name, upstream's muted suffix, then the settings model's trailing badge. */
function RetryModelTitle({item, pinned}: {item: RetryModelItem; pinned: boolean})
{
	let title: ReactNode = <span data-menu-item-label="">{item.label}</span>;
	if (item.suffix !== undefined)
	{
		// Upstream's pinned row appends " Unavailable"; a restricted row lays name and suffix out in a gap-sm line.
		title = pinned ? (
			<>
				<span data-menu-item-label="">{item.label}</span>
				<span className="text-muted-as-secondary">{` ${item.suffix}`}</span>
			</>
		) : (
			<span className="inline-flex min-w-0 items-center gap-sm">
				<span data-menu-item-label="" className="truncate">
					{item.label}
				</span>
				<span className="text-muted-as-secondary">{item.suffix}</span>
			</span>
		);
	}
	if (item.badge === undefined) return title;
	return (
		<span className="flex min-w-0 items-center gap-1">
			{title}
			<span className="contents">
				<span
					data-cds="Badge"
					data-size="xxs"
					className={`${MENU_BADGE_CLASS} min-w-0 truncate bg-alpha-1 text-secondary pointer-events-none`}
				>
					<span className={MENU_BADGE_TEXT_CLASS}>{item.badge}</span>
				</span>
			</span>
		</span>
	);
}

/**
 * Upstream's classic row: a disabled row's reason is its second line, and picking any row, the checked one too,
 * switches to it and retries.
 */
function RetryModelRow({
	item,
	pinned = false,
	onPick,
}: {
	item: RetryModelItem;
	pinned?: boolean;
	onPick: (model: string) => void;
})
{
	return (
		<MenuRadioItem
			value={item.value}
			closeOnClick
			{...(item.disabled === true &&
			{
				disabled: true,
			})}
			{...(item.description !== undefined &&
			{
				description: item.description,
			})}
			onClick={() =>
			{
				onPick(item.value);
			}}
		>
			<RetryModelTitle item={item} pinned={pinned} />
		</MenuRadioItem>
	);
}

function checkedValue(items: readonly RetryModelItem[]): string
{
	return items.find((item) => item.checked)?.value ?? "";
}

/**
 * Upstream's "Switch model and retry" menu (`Ln`): a ghost trigger with the current model and a tooltip, then the
 * classic list: the pinned current row, the main rows, and More models after a separator.
 */
function SwitchModelMenu({
	label,
	items,
	onSelect,
}: {
	label: string;
	items: RetryModelItems;
	onSelect: (model: string) => void;
})
{
	const [open, setOpen] = useState(false);
	const pick = (model: string) =>
	{
		setOpen(false);
		onSelect(model);
	};
	const {pinned, main, more} = items;
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
					<MenuRadioGroup value={checkedValue(pinned === undefined ? main : [pinned, ...main])}>
						{pinned !== undefined && <RetryModelRow item={pinned} pinned onPick={pick} />}
						{main.map((item) => (
							<RetryModelRow key={item.value} item={item} onPick={pick} />
						))}
					</MenuRadioGroup>
					{more.length > 0 && (
						<>
							<MenuSeparator />
							<MenuSub>
								<MenuSubTrigger>{MORE_MODELS_LABEL}</MenuSubTrigger>
								<MenuSubContent className="break-words">
									<MenuRadioGroup value={checkedValue(more)}>
										{more.map((item) => (
											<RetryModelRow key={item.value} item={item} onPick={pick} />
										))}
									</MenuRadioGroup>
								</MenuSubContent>
							</MenuSub>
						</>
					)}
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
})
{
	const act = (handler: (() => void) | undefined) => () =>
	{
		handler?.();
		onActed();
	};
	// Upstream `Ce`: a refused retry (false) leaves the card unlatched, so Try again stays.
	const retry = () =>
	{
		if (handlers.onRetry?.() !== false) onActed();
	};
	// Upstream latches only when the model switch went through (`onSelect()!==false`).
	const retryWithModel = (model: string) =>
	{
		void handlers.onRetryWithModel?.(model).then((switched) =>
		{
			if (switched) onActed();
		});
	};
	return actions.map((action) =>
	{
		const variant = action.primary ? "primary" : "secondary";
		switch (action.key)
		{
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
						items={[
							{
								label: "Rewind",
								onSelect: act(handlers.onRewind),
							},
						]}
					/>
				);
			case "retry":
				return (
					<ApprovalActionButton key={action.key} variant={variant} onClick={retry}>
						{action.label}
					</ApprovalActionButton>
				);
			case "fallback":
			{
				const {fallbackAlias} = handlers;
				return (
					<ApprovalActionButton
						key={action.key}
						variant={variant}
						onClick={() =>
						{
							if (fallbackAlias !== undefined) retryWithModel(fallbackAlias);
						}}
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
						items={handlers.modelItems ?? NO_MODEL_ITEMS}
						onSelect={retryWithModel}
					/>
				);
			default:
				return assertNever(action.key);
		}
	});
}
