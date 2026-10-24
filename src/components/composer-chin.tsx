import {useQuery} from "@tanstack/react-query";
import {Gauge, Paperclip, Plus, SquareSlash} from "lucide-react";
import {lazy, memo, type Ref, Suspense, useImperativeHandle, useState} from "react";

import {
	type ComposerState,
	type ComposerUsage,
	FIVE_HOUR_LABEL,
	formatUsageAriaLabel,
	formatUsageTooltipRows,
	USAGE_RING_CIRCUMFERENCE,
	usageRingDashoffset,
	usageRingPercent,
	type UsageRingSeverity,
	usageRingSeverity,
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
import {ConnectorsLoadingItem} from "./composer-connectors-loading";
import {type ChinMenu, type ChinSurface, ModeMenu, ModelMenu} from "./composer-launch-menus";
import {ADD_BUTTON_CLASS, USAGE_RING_CLASS} from "./composer-tokens";
import {localAccountQueryOptions} from "../lib/api/local-account";
import {settingsHash} from "../lib/settings-hash";
import {ConfirmDialog} from "./confirm-dialog";
import {Menu, MenuContent, MenuItem, MenuTrigger} from "./ui/menu";
import {Popover, PopoverContent} from "./ui/popover";
import {Tooltip} from "./ui/tooltip";
import {UsagePopoverLimitRow} from "./usage-limit-row";
import {useRenameAfterMenuClose} from "./use-rename-after-menu-close";

// Keeps the Customize API schemas and router hooks out of the composer's cold load.
const loadConnectorsMenu = async () =>
	import("./composer-connectors-menu").then((module) => ({default: module.ComposerConnectorsMenu}));
const ComposerConnectorsMenu = lazy(loadConnectorsMenu);

/** Upstream's 2026-10-20 usage popover: r10, and up to 640px (or the room left) tall before its own scroll. */
const POPUP_CLASS =
	"w-[360px] max-w-[calc(100vw-2rem)] max-h-[min(var(--available-height),640px)] overflow-y-auto rounded-r7 bg-[var(--menu-bg)] p-0 text-[13px]/[19px] text-primary shadow-[var(--menu-shadow)] outline-none";

function UsagePopoverBody({usage, onNavigate}: {usage: ComposerUsage | null; onNavigate: () => void}) {
	const {data: account} = useQuery(localAccountQueryOptions);
	const limits = [
		usage?.fiveHour ? {label: FIVE_HOUR_LABEL, window: usage.fiveHour} : null,
		usage?.weekly ? {label: WEEKLY_LABEL, window: usage.weekly} : null,
	].filter((limit) => limit !== null);
	const planDetail = account?.planDetail;
	return (
		<>
			<Popover.Title className="sr-only">Usage</Popover.Title>
			<div className="flex flex-col py-1.5">
				<div className="flex flex-col gap-1.5">
					<div
						data-usage-popover-header
						className="flex min-h-5 items-center justify-between gap-2 px-3 py-1"
					>
						<span className="text-[12px]/[15px] text-ink-muted">
							{planDetail === undefined ? "Plan usage limits" : `Plan usage limits · ${planDetail}`}
						</span>
						<a
							href={`#${settingsHash("usage")}`}
							aria-label="View usage in Settings"
							onClick={onNavigate}
							className="-me-1 flex size-5 items-center justify-center rounded-r4 text-ink-muted outline-none hover:bg-alpha-1 hover:text-primary focus-visible:bg-alpha-1"
						>
							<Gauge aria-hidden="true" className="size-3.5" />
						</a>
					</div>
					{limits.length > 0 && (
						<div role="group" aria-label="Usage limits" className="flex flex-col gap-2 px-3 pb-1">
							{limits.map((limit) => (
								<UsagePopoverLimitRow key={limit.label} label={limit.label} window={limit.window} />
							))}
						</div>
					)}
				</div>
			</div>
		</>
	);
}

/** Upstream's arc: --cds-fill-accent, then fill-warning at ≥75% and fill-danger at ≥90%. */
const USAGE_RING_STROKES: Record<UsageRingSeverity, string> = {
	normal: "var(--color-fill-accent)",
	warning: "var(--color-usage-warning)",
	critical: "var(--color-usage-danger)",
};

export function UsageRing({usage}: {usage: ComposerUsage | null}) {
	const [open, setOpen] = useState(false);
	const now = Date.now();
	const percent = usageRingPercent(usage);
	return (
		<Popover.Root open={open} onOpenChange={setOpen}>
			<Tooltip content={formatUsageTooltipRows(usage, now).join("\n")} multiline>
				<Popover.Trigger aria-label={formatUsageAriaLabel(usage, now)} className={USAGE_RING_CLASS}>
					<svg width="14" height="14" viewBox="0 0 14 14" className="-rotate-90" aria-hidden="true">
						<circle cx="7" cy="7" r="6" fill="none" strokeWidth="2" stroke="var(--color-alpha-4)" />
						<circle
							data-usage-ring-arc
							cx="7"
							cy="7"
							r="6"
							fill="none"
							strokeWidth="2"
							strokeLinecap="round"
							stroke={USAGE_RING_STROKES[usageRingSeverity(percent)]}
							strokeDasharray={USAGE_RING_CIRCUMFERENCE}
							strokeDashoffset={usageRingDashoffset(percent)}
							className="transition-[stroke-dashoffset] duration-300"
						/>
					</svg>
				</Popover.Trigger>
			</Tooltip>
			<PopoverContent side="top" align="end" sideOffset={6} className={POPUP_CLASS}>
				<UsagePopoverBody
					usage={usage}
					onNavigate={() => {
						setOpen(false);
					}}
				/>
			</PopoverContent>
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
	active,
}: {
	onInsertSlash: () => void;
	/** Upstream's `isPanelActive`: only the active pane's row shows the ⌘U keycap. */
	active: boolean;
	/** ⌘U "Add files or photos": opens the composer's file picker. */
	onAddFiles: () => void;
}) {
	const addFilesKeys = useShortcutKeys("add_files").keys;
	// The closing menu would hand focus back to Add, so the "/" goes in once it has closed.
	const slashAfterClose = useRenameAfterMenuClose(onInsertSlash);
	return (
		<Menu onOpenChangeComplete={slashAfterClose.onOpenChangeComplete}>
			<Tooltip content="Add" side="top" suppressAfterPopup>
				<MenuTrigger aria-label="Add" className={ADD_BUTTON_CLASS}>
					<Plus className="size-[18px]" aria-hidden="true" />
				</MenuTrigger>
			</Tooltip>
			<MenuContent side="top" sideOffset={6} finalFocus={slashAfterClose.finalFocus}>
				<MenuItem icon={<Paperclip />} onSelect={onAddFiles} {...(active ? {shortcut: addFilesKeys} : {})}>
					Add files or photos
				</MenuItem>
				<MenuItem icon={<SquareSlash />} onSelect={slashAfterClose.requestRename}>
					Slash commands
				</MenuItem>
				<Suspense fallback={<ConnectorsLoadingItem />}>
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

/** A `/effort <level>` or `/model <id>` sent from the composer, applied the way a menu pick is. */
export type ChinPick = {effort: EffortLevel} | {model: string};

export interface ChinPickHandle {
	pick: (pick: ChinPick) => void;
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
	surface,
	pickRef,
}: {
	state: ComposerState;
	launch: ChinLaunchControls;
	surface: ChinSurface;
	pickRef?: Ref<ChinPickHandle> | undefined;
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
	const selectModel = (model: string) => {
		onLaunchOptionsChange({...launchOptions, model});
	};
	useImperativeHandle(pickRef, () => ({
		pick: (pick) => {
			if ("effort" in pick) selectEffort(pick.effort);
			else selectModel(pick.model);
		},
	}));
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
					surface={surface}
					current={launchOptions.permissionMode ?? state.mode?.id ?? "default"}
					currentLabel={modeLabel}
					bypassPermissionsAllowed={launch.bypassPermissionsAllowed}
					onSelect={(permissionMode) => {
						onLaunchOptionsChange({...launchOptions, permissionMode});
					}}
				/>
			</div>
			<div className="ms-auto flex min-w-0 items-center gap-1 ps-2">
				{/* Upstream's one model + effort picker; ⇧⌘E opens it on its Effort submenu in a chin, plain on the bar */}
				<ModelMenu
					open={openMenu === "model" || openMenu === "effort"}
					onOpenChange={(open) => {
						onOpenMenuChange(open ? "model" : null);
					}}
					surface={surface}
					effortOpen={openMenu === "effort" && surface === "chin"}
					current={launchOptions.model ?? modelMenuValue(state.modelId) ?? undefined}
					currentLabel={modelText}
					currentEffort={currentEffort}
					onSelect={selectModel}
					onSelectEffort={selectEffort}
				/>
				<UsageRing usage={state.usage} />
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
