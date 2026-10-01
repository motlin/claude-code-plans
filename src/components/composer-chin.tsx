import {Popover} from "@base-ui/react/popover";
import {ArrowRight, Paperclip, Plus, SquareSlash} from "lucide-react";
import {lazy, memo, Suspense, useState} from "react";

import {
	type ComposerState,
	type ComposerUsage,
	FIVE_HOUR_LABEL,
	formatContextSummary,
	formatResetLabel,
	formatUpdatedAgo,
	formatUsageAriaLabel,
	formatUsageTooltipRows,
	type RateLimitWindow,
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
import {CHIN_BUTTON_CLASS, type ChinMenu, EffortSelector, ModeMenu, ModelMenu} from "./composer-launch-menus";
import {settingsHash} from "../lib/settings-hash";
import {ConfirmDialog} from "./confirm-dialog";
import {Menu, MenuContent, MenuItem, MenuTrigger} from "./ui/menu";
import {Tooltip} from "./ui/tooltip";

// Keeps the Customize API schemas and router hooks out of the composer's cold load.
const loadConnectorsMenu = () =>
	import("./composer-connectors-menu").then((module) => ({default: module.ComposerConnectorsMenu}));
const ComposerConnectorsMenu = lazy(loadConnectorsMenu);

/** Upstream's usage popover: r10, and up to 640px tall before its own scroll. */
const POPUP_CLASS =
	"flex max-h-[640px] w-[360px] max-w-[calc(100vw-16px)] flex-col gap-3 overflow-y-auto rounded-r7 bg-[var(--menu-bg)] p-3 text-[12px]/[16px] text-primary shadow-[var(--menu-shadow)] outline-none";

function Meter({percent, label}: {percent: number; label: string}) {
	const clamped = Math.min(100, Math.max(0, percent));
	return (
		<div
			role="progressbar"
			aria-label={label}
			aria-valuemin={0}
			aria-valuemax={100}
			aria-valuenow={Math.round(clamped)}
			className="h-1 w-full overflow-hidden rounded-r3 bg-alpha-1"
		>
			<div className="h-full rounded-r3 bg-accent-100" style={{width: `${clamped}%`}} />
		</div>
	);
}

function LimitRow({label, window}: {label: string; window: RateLimitWindow}) {
	const percent = Math.round(window.usedPercentage);
	return (
		<div className="flex flex-col gap-1">
			<div data-usage-row className="flex items-baseline gap-2">
				<span className="text-primary">{label}</span>
				<span className="text-t6">{formatResetLabel(window.resetsAt, Date.now())}</span>
				<span className="ms-auto tabular-nums text-secondary">{percent}%</span>
			</div>
			<Meter percent={window.usedPercentage} label={label} />
		</div>
	);
}

function UsagePopoverBody({usage, onNavigate}: {usage: ComposerUsage | null; onNavigate: () => void}) {
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
				<Meter percent={usage?.contextPercent ?? 0} label="Context window" />
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
							<LimitRow key={limit.label} label={limit.label} window={limit.window} />
						))}
					</div>
				</>
			)}
		</>
	);
}

function UsageRing({usage}: {usage: ComposerUsage | null}) {
	const [open, setOpen] = useState(false);
	const now = Date.now();
	return (
		<Popover.Root open={open} onOpenChange={setOpen}>
			<Tooltip content={formatUsageTooltipRows(usage, now).join("\n")} multiline>
				<Popover.Trigger
					aria-label={formatUsageAriaLabel(usage, now)}
					className={`${CHIN_BUTTON_CLASS} aspect-square`}
				>
					<svg width="12" height="12" viewBox="0 0 12 12" className="-rotate-90" aria-hidden="true">
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
						<UsagePopoverBody usage={usage} onNavigate={() => setOpen(false)} />
					</Popover.Popup>
				</Popover.Positioner>
			</Popover.Portal>
		</Popover.Root>
	);
}

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
 * The claude.ai/code composer chin: `+` and the permission mode on the left;
 * model, effort and the 12px context-usage ring on the right. Mode, model and
 * effort open menus whose choices apply to the live pane or the next fork or launch.
 */
export const ComposerChin = memo(function ComposerChin({
	state,
	onInsertSlash,
	onAddFiles,
	launch,
}: {
	state: ComposerState;
	onInsertSlash: () => void;
	/** ⌘U "Add files or photos": opens the composer's file picker. */
	onAddFiles: () => void;
	launch: ChinLaunchControls;
}) {
	const {launchOptions, onLaunchOptionsChange, openMenu, onOpenMenuChange} = launch;
	const addFilesKeys = useShortcutKeys("add_files").keys;
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
		onOpenChange: (open: boolean) => onOpenMenuChange(open ? menu : null),
	});
	const modeLabel =
		launchOptions.permissionMode === undefined
			? (state.mode?.label ?? "Manual")
			: modeTriggerLabel(launchOptions.permissionMode);
	const modelText = launchOptions.model === undefined ? state.model : modelLabel(launchOptions.model);
	return (
		<>
			<div className="flex min-w-0 items-center self-start">
				<Menu>
					<Tooltip content="Add" side="top">
						<MenuTrigger aria-label="Add" className={`${CHIN_BUTTON_CLASS} aspect-square`}>
							<Plus className="size-4" aria-hidden="true" />
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
				<ModeMenu
					{...menuProps("mode")}
					current={launchOptions.permissionMode ?? state.mode?.id ?? "default"}
					currentLabel={modeLabel}
					bypassPermissionsAllowed={launch.bypassPermissionsAllowed}
					onSelect={(permissionMode) => onLaunchOptionsChange({...launchOptions, permissionMode})}
				/>
			</div>
			<div className="ms-auto flex min-w-0 items-center gap-1 ps-2">
				<ModelMenu
					{...menuProps("model")}
					current={launchOptions.model ?? modelMenuValue(state.modelId) ?? undefined}
					currentLabel={modelText}
					onSelect={(model) => onLaunchOptionsChange({...launchOptions, model})}
				/>
				<EffortSelector {...menuProps("effort")} current={currentEffort} onSelect={selectEffort} />
				<UsageRing usage={state.usage} />
			</div>
			<ConfirmDialog
				open={effortConfirm.open}
				onOpenChange={(open) => setEffortConfirm((prev) => ({...prev, open}))}
				title="Change effort?"
				body={`This session is cached with effort set to ${effortText(currentEffort)}. Changing it to ${effortText(effortConfirm.effort)} means Claude re-reads the whole session on your next message, which uses more of your limit.`}
				confirmLabel="Change effort"
				onConfirm={() => onLaunchOptionsChange({...launchOptions, effort: effortConfirm.effort})}
			/>
		</>
	);
});
