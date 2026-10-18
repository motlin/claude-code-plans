import {Popover} from "@base-ui/react/popover";
import {ArrowRight, Paperclip, Plus, SquareSlash} from "lucide-react";
import {lazy, memo, Suspense, useState} from "react";

import {
	type ComposerState,
	type ComposerUsage,
	FIVE_HOUR_LABEL,
	formatContextSummary,
	formatUpdatedAgo,
	formatUsageAriaLabel,
	formatUsageTooltipRows,
	USAGE_RING_CIRCUMFERENCE,
	usageRingDashoffset,
	WEEKLY_LABEL,
} from "../lib/composer-state";
import {
	type EffortLevel,
	EffortLevelSchema,
	type LaunchOptions,
	modeTriggerLabel,
	modelLabel,
	modelMenuValue,
} from "../lib/launch-options";
import {useShortcutKeys} from "../hooks/use-shortcut";
import {effortLevelLabels} from "../lib/schema-choices";
import {type ChinMenu, ModeMenu, ModelMenu} from "./composer-launch-menus";
import {ADD_BUTTON_CLASS, USAGE_RING_CLASS} from "./composer-tokens";
import {settingsHash} from "../lib/settings-hash";
import {ConfirmDialog} from "./confirm-dialog";
import {Menu, MenuContent, MenuItem, MenuTrigger} from "./ui/menu";
import {Tooltip} from "./ui/tooltip";
import {UsageLimitRow, UsageMeter} from "./usage-limit-row";

// Keeps the Customize API schemas and router hooks out of the composer's cold load.
const loadConnectorsMenu = async () =>
	import("./composer-connectors-menu").then((module) => ({default: module.ComposerConnectorsMenu}));
const ComposerConnectorsMenu = lazy(loadConnectorsMenu);

/** Upstream's usage popover: r10, and up to 640px tall before its own scroll. */
const POPUP_CLASS =
	"flex max-h-[640px] w-[360px] max-w-[calc(100vw-16px)] flex-col gap-3 overflow-y-auto rounded-r7 bg-[var(--menu-bg)] p-3 text-[12px]/[16px] text-primary shadow-[var(--menu-shadow)] outline-none";

function UsagePopoverBody({
	usage,
	onNavigate,
	onShowBreakdown,
}: {
	usage: ComposerUsage | null;
	onNavigate: () => void;
	/** Session composers only: upstream hides the button on new-session. */
	onShowBreakdown: (() => void) | undefined;
}) {
	const limits = [
		usage?.fiveHour ? {label: FIVE_HOUR_LABEL, window: usage.fiveHour} : null,
		usage?.weekly ? {label: WEEKLY_LABEL, window: usage.weekly} : null,
	].filter((limit) => limit !== null);
	return (
		<>
			<Popover.Title className="sr-only">Usage</Popover.Title>
			<div className="flex flex-col gap-1.5">
				<div data-usage-context className="flex items-baseline justify-between gap-2">
					<span className="font-medium">Context window</span>
					<span className="tabular-nums text-secondary">{formatContextSummary(usage)}</span>
				</div>
				<UsageMeter percent={usage?.contextPercent ?? 0} label="Context window" />
				{usage?.updatedAt && (
					<p data-usage-updated className="text-t6">
						Last updated {formatUpdatedAgo(usage.updatedAt, Date.now())}. Send a message to refresh.
					</p>
				)}
			</div>
			{limits.length > 0 && (
				<>
					<div className="h-px bg-alpha-2" />
					<div className="flex flex-col gap-2">
						<div className="flex items-center justify-between gap-2">
							<span className="font-medium">Plan usage limits</span>
							<a
								href={`#${settingsHash("usage")}`}
								aria-label="View usage in Settings"
								onClick={onNavigate}
								className="flex size-5 items-center justify-center rounded-r4 p-1 text-t6 outline-none hover:bg-alpha-1 hover:text-primary focus-visible:bg-alpha-1"
							>
								<ArrowRight aria-hidden="true" className="size-3" />
							</a>
						</div>
						{limits.map((limit) => (
							<UsageLimitRow key={limit.label} label={limit.label} window={limit.window} />
						))}
					</div>
				</>
			)}
			{onShowBreakdown && (
				<>
					<div className="h-px bg-alpha-2" />
					<button
						type="button"
						onClick={onShowBreakdown}
						className="-mx-1 -my-1 flex h-6 items-center rounded-r4 px-1 text-start text-secondary outline-none hover:bg-alpha-1 hover:text-primary focus-visible:bg-alpha-1"
					>
						See detailed breakdown
					</button>
				</>
			)}
		</>
	);
}

function UsageRing({usage, onShowBreakdown}: {usage: ComposerUsage | null; onShowBreakdown: (() => void) | undefined}) {
	const [open, setOpen] = useState(false);
	const now = Date.now();
	return (
		<Popover.Root open={open} onOpenChange={setOpen}>
			<Tooltip content={formatUsageTooltipRows(usage, now).join("\n")} multiline>
				<Popover.Trigger aria-label={formatUsageAriaLabel(usage, now)} className={USAGE_RING_CLASS}>
					<svg width="14" height="14" viewBox="0 0 12 12" className="-rotate-90" aria-hidden="true">
						<circle cx="6" cy="6" r="5" fill="none" strokeWidth="2" stroke="var(--color-alpha-2)" />
						<circle
							data-usage-ring-arc
							cx="6"
							cy="6"
							r="5"
							fill="none"
							strokeWidth="2"
							strokeLinecap="round"
							stroke="var(--accent-100)"
							strokeDasharray={USAGE_RING_CIRCUMFERENCE}
							strokeDashoffset={usageRingDashoffset(usage?.contextPercent ?? null)}
						/>
					</svg>
				</Popover.Trigger>
			</Tooltip>
			<Popover.Portal>
				<Popover.Positioner side="top" align="end" sideOffset={6} className="z-[130]">
					<Popover.Popup className={POPUP_CLASS}>
						<UsagePopoverBody
							usage={usage}
							onNavigate={() => {
								setOpen(false);
							}}
							onShowBreakdown={
								onShowBreakdown &&
								(() => {
									setOpen(false);
									onShowBreakdown();
								})
							}
						/>
					</Popover.Popup>
				</Popover.Positioner>
			</Popover.Portal>
		</Popover.Root>
	);
}

/**
 * Upstream's + menu at the composer card's left edge: Add files or photos (⌘U), Slash commands
 * and the connectors submenu.
 */
export const ComposerAddMenu = memo(function ComposerAddMenu({
	onInsertSlash,
	onAddFiles,
}: {
	onInsertSlash: () => void;
	/** ⌘U "Add files or photos": opens the composer's file picker. */
	onAddFiles: () => void;
}) {
	const addFilesKeys = useShortcutKeys("add_files").keys;
	return (
		<Menu>
			<Tooltip content="Add" side="top">
				<MenuTrigger aria-label="Add" className={ADD_BUTTON_CLASS}>
					<Plus className="size-[18px]" aria-hidden="true" />
				</MenuTrigger>
			</Tooltip>
			<MenuContent side="top">
				<MenuItem icon={<Paperclip />} onSelect={onAddFiles} shortcut={addFilesKeys}>
					Add files or photos
				</MenuItem>
				<MenuItem icon={<SquareSlash />} onSelect={onInsertSlash}>
					Slash commands
				</MenuItem>
				<Suspense fallback={null}>
					<ComposerConnectorsMenu />
				</Suspense>
			</MenuContent>
		</Menu>
	);
});

export interface ChinLaunchControls {
	launchOptions: LaunchOptions;
	onLaunchOptionsChange: (next: LaunchOptions) => void;
	openMenu: ChinMenu | null;
	onOpenMenuChange: (menu: ChinMenu | null) => void;
	bypassPermissionsAllowed: boolean;
	/** A live session is cached at its effort, so changing it asks first. */
	confirmEffortChange?: boolean;
}

function effortText(effort: string): string {
	const level = EffortLevelSchema.safeParse(effort);
	return level.success ? effortLevelLabels[level.data] : effort;
}

/**
 * The claude.ai/code composer chin: the permission mode on the left; the model +
 * effort picker and the 14px context-usage ring on the right. Mode, model and
 * effort open menus whose choices apply to the live pane or the next fork or launch.
 */
export const ComposerChin = memo(function ComposerChin({
	state,
	launch,
	onShowUsageBreakdown,
}: {
	state: ComposerState;
	launch: ChinLaunchControls;
	/** "See detailed breakdown": insert the Usage card into the transcript. */
	onShowUsageBreakdown?: (() => void) | undefined;
}) {
	const {launchOptions, onLaunchOptionsChange, openMenu, onOpenMenuChange} = launch;
	// Keeps the picked level while the confirm fades out, so its copy doesn't flicker.
	const [effortConfirm, setEffortConfirm] = useState<{effort: EffortLevel; open: boolean}>({
		effort: "high",
		open: false,
	});
	const currentEffort = launchOptions.effort ?? state.effort.id;
	const selectEffort = (effort: EffortLevel) => {
		if (launch.confirmEffortChange !== true) {
			onLaunchOptionsChange({...launchOptions, effort});
		} else if (effort !== currentEffort) {
			onOpenMenuChange(null);
			setEffortConfirm({effort, open: true});
		}
	};
	const menuProps = (menu: ChinMenu) => ({
		open: openMenu === menu,
		onOpenChange: (open: boolean) => {
			onOpenMenuChange(open ? menu : null);
		},
	});
	const modeLabel =
		launchOptions.permissionMode === undefined
			? (state.mode?.label ?? "Manual")
			: modeTriggerLabel(launchOptions.permissionMode);
	const modelText = launchOptions.model === undefined ? state.model : modelLabel(launchOptions.model);
	return (
		<>
			<div className="flex min-w-0 items-center self-start">
				<ModeMenu
					{...menuProps("mode")}
					current={launchOptions.permissionMode ?? state.mode?.id ?? "default"}
					currentLabel={modeLabel}
					bypassPermissionsAllowed={launch.bypassPermissionsAllowed}
					onSelect={(permissionMode) => {
						onLaunchOptionsChange({...launchOptions, permissionMode});
					}}
				/>
			</div>
			<div className="ms-auto flex min-w-0 items-center gap-1 ps-2">
				{/* Upstream's one model + effort picker; ⇧⌘E opens it on its Effort submenu */}
				<ModelMenu
					open={openMenu === "model" || openMenu === "effort"}
					onOpenChange={(open) => {
						onOpenMenuChange(open ? "model" : null);
					}}
					effortOpen={openMenu === "effort"}
					current={launchOptions.model ?? modelMenuValue(state.modelId) ?? undefined}
					currentLabel={modelText}
					currentEffort={currentEffort}
					onSelect={(model) => {
						onLaunchOptionsChange({...launchOptions, model});
					}}
					onSelectEffort={selectEffort}
				/>
				<UsageRing usage={state.usage} onShowBreakdown={onShowUsageBreakdown} />
			</div>
			<ConfirmDialog
				open={effortConfirm.open}
				onOpenChange={(open) => {
					setEffortConfirm((prev) => ({...prev, open}));
				}}
				title="Change effort?"
				body={`This session is cached with effort set to ${effortText(currentEffort)}. Changing it to ${effortText(effortConfirm.effort)} means Claude re-reads the whole session on your next message, which uses more of your limit.`}
				confirmLabel="Change effort"
				onConfirm={() => {
					onLaunchOptionsChange({...launchOptions, effort: effortConfirm.effort});
				}}
			/>
		</>
	);
});
