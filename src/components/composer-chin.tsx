import {useQuery} from "@tanstack/react-query";
import {ArrowRight, SquareSlash} from "lucide-react";
import
{
	lazy,
	memo,
	type Ref,
	type RefObject,
	Suspense,
	useCallback,
	useEffect,
	useImperativeHandle,
	useRef,
	useState,
} from "react";

import
{
	type ComposerState,
	type ComposerUsage,
	contextRingPercent,
	FIVE_HOUR_LABEL,
	formatResetLabel,
	formatUsageAriaLabel,
	formatUsageTooltipRows,
	USAGE_RING_CIRCUMFERENCE,
	usageRingDashoffset,
	usageRingMode,
	usageRingPercent,
	type UsageRingSeverity,
	usageRingSeverity,
	type RateLimitWindow,
	WEEKLY_LABEL,
} from "../lib/composer-state";
import {scopedEmptyCaption} from "../lib/usage-family";
import
{
	type EffortLevel,
	EffortLevelSchema,
	effortOptionsFor,
	fastModeSupported,
	type LaunchOptions,
	type LaunchPermissionMode,
	catalogMenuValue,
	modeTriggerLabel,
	modelLabel,
	modelMenuValue,
	withModel,
	type ModeBadgeSettings,
	offeredModes,
} from "../lib/launch-options";
import {clampToAvailable} from "../lib/folder-permission-mode";
import {settingsModelMenu} from "../lib/retry-model-items";
import {useShortcutKeys} from "../hooks/use-shortcut";
import {effortLevelLabels} from "../lib/schema-choices";
import {ConnectorsLoadingItem} from "./composer-connectors-loading";
import {type ChinMenu, type ChinSurface, ModeMenu, ModelMenu, type ModelMenuFlyout} from "./composer-launch-menus";
import {type TryAutoCoachOffer, tryAutoCoachEligible} from "../lib/try-auto-coach";
import
{
	ADD_BUTTON_CLASS,
	CHIN_ICON_INK_CLASS,
	CHIN_PICKERS_CLASS,
	ENVIRONMENT_PICKERS_CLASS,
	ENVIRONMENT_SLOT_CLASS,
	USAGE_RING_CLASS,
	USAGE_RING_WRAPPER_CLASS,
} from "./composer-tokens";
import {localAccountQueryOptions} from "../lib/api/local-account";
import {settingsHash} from "../lib/settings-hash";
import {ConfirmDialog} from "./confirm-dialog";
import {Icon} from "./ui/icon";
import {ComposerChinFrame} from "./composer-chin-frame";
import {Menu, MenuContent, MenuItem, MenuTrigger} from "./ui/menu";
import {POPOVER_SCROLL_BODY_CLASS, PopoverRoot, PopoverTitle, PopoverTrigger, PopoverContent} from "./ui/popover";
import {Tooltip} from "./ui/tooltip";
import {UsagePopoverLimitRow} from "./usage-limit-row";
import type {UsageRingContext, UsagePopoverContextSection} from "./usage-popover-context";
import {loadedUsagePopoverContext, preloadUsagePopoverContext} from "./usage-popover-context-loader";
import {useRenameAfterMenuClose} from "./use-rename-after-menu-close";
import {USAGE_BARS_CROSSFADE} from "../lib/usage-bars-grow";
import {UsageBars} from "./usage-bars";

const LazyTryAutoCoachMark = lazy(async () =>
	import("./try-auto-coach-mark").then((module) => (
	{
		default: module.TryAutoCoachMark,
	})),
);

// Keeps the Customize API schemas and router hooks out of the composer's cold load.
const loadConnectorsMenu = async () =>
	import("./composer-connectors-menu").then((module) => (
	{
		default: module.ComposerConnectorsMenu,
	}));
const ComposerConnectorsMenu = lazy(loadConnectorsMenu);
const LazyUsagePopoverContextSection = lazy(async () =>
	preloadUsagePopoverContext().then((module) => (
	{
		default: module.UsagePopoverContextSection,
	})),
);

/** The context section, synchronously once its chunk is in hand (a context-mode ring preloads it on mount). */
function ContextSection(props: Parameters<typeof UsagePopoverContextSection>[0])
{
	const loaded = loadedUsagePopoverContext();
	if (loaded !== null) return <loaded.UsagePopoverContextSection {...props} />;
	return (
		<Suspense fallback={null}>
			<LazyUsagePopoverContextSection {...props} />
		</Suspense>
	);
}

/** Upstream's 2026-10-20 usage popover: r10, and up to 640px (or the room left) tall before its own scroll. */
const POPUP_CLASS =
	"w-[360px] max-w-[calc(100vw-2rem)] max-h-[min(var(--available-height),640px)] rounded-r7 bg-[var(--menu-bg)] p-0 text-body text-primary shadow-[var(--menu-shadow)] outline-none";

function UsagePopoverBody({
	usage,
	onNavigate,
	context,
}: {
	usage: ComposerUsage | null;
	onNavigate: () => void;
	context: UsagePopoverContextProps;
})
{
	const {data: account} = useQuery(localAccountQueryOptions);
	const now = Date.now();
	const windowRow = (key: string, label: string, window: RateLimitWindow) => (
	{
		key,
		label,
		usedPercentage: window.usedPercentage,
		caption: formatResetLabel(window.resetsAt, now),
	});
	// Upstream's `Gn`: the session and week, then the cached per-model rows of the model's family.
	const limits = [
		...(usage?.fiveHour ? [windowRow("session", FIVE_HOUR_LABEL, usage.fiveHour)] : []),
		...(usage?.weekly ? [windowRow("weekly_all", WEEKLY_LABEL, usage.weekly)] : []),
		...(usage?.scoped ?? []).map((meter) => (
		{
			key: meter.key,
			label: meter.label,
			usedPercentage: meter.usedPercentage,
			caption: meter.resetsAt === null ? scopedEmptyCaption(meter) : formatResetLabel(meter.resetsAt, now),
		})),
	];
	const planDetail = account?.planDetail;
	return (
		<>
			<PopoverTitle className="sr-only">Usage</PopoverTitle>
			<div className="flex flex-col py-1.5">
				{usage !== null && usageRingMode(usage) === "context" ? (
					<ContextSection usage={usage} {...context} />
				) : (
					<UsageBars surface="popover" enabled={USAGE_BARS_CROSSFADE}>
						<div className="flex flex-col gap-1.5">
							<div
								data-usage-popover-header
								className="flex min-h-5 items-center justify-between gap-2 px-3 py-1"
							>
								<span className="text-[12px]/[15px] text-muted-as-secondary">
									{planDetail === undefined
										? "Plan usage limits"
										: `Plan usage limits · ${planDetail}`}
								</span>
								{/* Upstream's `DT`: a ghost xxs "See all" button, flush end with a pad-sm outset. */}
								<a
									href={`#${settingsHash("usage")}`}
									aria-label="See all usage in Settings"
									onClick={onNavigate}
									className="-me-1 inline-flex h-5 items-center gap-1 rounded-r4 px-1.5 text-[12px]/[15px] text-primary outline-none hover:bg-alpha-1 focus-visible:bg-alpha-1"
								>
									See all
									<ArrowRight aria-hidden="true" className="-me-1 size-3 rtl:-scale-x-100" />
								</a>
							</div>
							{limits.length > 0 && (
								<div role="group" aria-label="Usage limits" className="flex flex-col gap-1.5">
									<div className="flex flex-col gap-2 px-3 pb-1">
										{limits.map((limit) => (
											<UsagePopoverLimitRow
												key={limit.key}
												label={limit.label}
												usedPercentage={limit.usedPercentage}
												caption={limit.caption}
											/>
										))}
									</div>
								</div>
							)}
						</div>
					</UsageBars>
				)}
			</div>
		</>
	);
}

/** Upstream's arc: --cds-fill-accent, then fill-warning at ≥75% and fill-danger at ≥90%. */
const USAGE_RING_STROKES: Record<UsageRingSeverity, string> =
{
	normal: "var(--color-fill-accent)",
	warning: "var(--color-usage-warning)",
	critical: "var(--color-usage-danger)",
};

type UsagePopoverContextProps = Omit<Parameters<typeof UsagePopoverContextSection>[0], "usage">;

/** Opens the ring's popover with its Context window section expanded (upstream's `openRequest {menu: "context"}`). */
export interface UsageRingHandle
{
	openContext: () => void;
}

export function UsageRing({
	usage,
	context,
	ref,
}: {
	usage: ComposerUsage | null;
	/** The session's breakdown and compact action for the context-mode popover; the home ring has none. */
	context?: UsageRingContext | undefined;
	ref?: Ref<UsageRingHandle> | undefined;
})
{
	const [open, setOpen] = useState(false);
	const [contextExpanded, setContextExpanded] = useState(false);
	const now = Date.now();
	const contextMode = usageRingMode(usage) === "context";
	const percent = contextMode ? (contextRingPercent(usage) ?? 0) : usageRingPercent(usage);
	useEffect(() =>
	{
		if (contextMode) void preloadUsagePopoverContext();
	}, [contextMode]);
	// Upstream's `Le`: closing the popover collapses the section again.
	const onOpenChange = (next: boolean) =>
	{
		setOpen(next);
		if (!next) setContextExpanded(false);
	};
	useImperativeHandle(ref, () => (
	{
		openContext: () =>
		{
			setOpen(true);
			setContextExpanded(true);
		},
	}));
	return (
		<PopoverRoot open={open} onOpenChange={onOpenChange}>
			<Tooltip content={formatUsageTooltipRows(usage, now).join("\n")} multiline>
				<PopoverTrigger
					data-cds="Button"
					aria-label={formatUsageAriaLabel(usage, now)}
					className={USAGE_RING_CLASS}
				>
					<svg width="14" height="14" viewBox="0 0 14 14" className="-rotate-90" aria-hidden="true">
						<circle
							data-ring-track=""
							cx="7"
							cy="7"
							r="6"
							fill="none"
							strokeWidth="2"
							stroke="var(--color-alpha-3)"
						/>
						<circle
							data-ring-arc=""
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
				</PopoverTrigger>
			</Tooltip>
			<PopoverContent side="top" align="end" sideOffset={6} className={POPUP_CLASS}>
				<div className={POPOVER_SCROLL_BODY_CLASS}>
					<UsagePopoverBody
						usage={usage}
						onNavigate={() =>
						{
							setOpen(false);
						}}
						context={
						{
							context,
							expanded: contextExpanded,
							onToggle: () =>
							{
								setContextExpanded((value) => !value);
							},
							onCompact: () =>
							{
								onOpenChange(false);
								context?.compact?.onCompact();
							},
						}}
					/>
				</div>
			</PopoverContent>
		</PopoverRoot>
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
	cwd,
	sessionId,
}: {
	onInsertSlash: () => void;
	/** The composer's folder: the Connectors submenu lists only this project's servers. */
	cwd?: string | undefined;
	/** A session composer's session: the Connectors submenu marks the servers that failed to connect in it. */
	sessionId?: string | undefined;
	/** Upstream's `isPanelActive`: only the active pane's row shows the ⌘U keycap. */
	active: boolean;
	/** ⌘U "Add files or photos": opens the composer's file picker. */
	onAddFiles: () => void;
})
{
	const addFilesKeys = useShortcutKeys("add_files").keys;
	// The closing menu would hand focus back to Add, so the "/" goes in once it has closed.
	const slashAfterClose = useRenameAfterMenuClose(onInsertSlash);
	return (
		<Menu onOpenChangeComplete={slashAfterClose.onOpenChangeComplete}>
			<Tooltip content="Add" side="top" suppressAfterPopup>
				<MenuTrigger aria-label="Add" className={ADD_BUTTON_CLASS}>
					<Icon name="Add" size="auto" className={CHIN_ICON_INK_CLASS} />
				</MenuTrigger>
			</Tooltip>
			<MenuContent side="top" sideOffset={6} finalFocus={slashAfterClose.finalFocus}>
				<MenuItem
					icon={<Icon name="Attachment" size="auto" />}
					onSelect={onAddFiles}
					{...(active
						?
							{
								shortcut: addFilesKeys,
							}
						: {})}
				>
					Add files or photos
				</MenuItem>
				<MenuItem icon={<SquareSlash />} onSelect={slashAfterClose.requestRename}>
					Slash commands
				</MenuItem>
				<Suspense fallback={<ConnectorsLoadingItem />}>
					<ComposerConnectorsMenu cwd={cwd} sessionId={sessionId} />
				</Suspense>
			</MenuContent>
		</Menu>
	);
});

export interface ChinLaunchControls
{
	launchOptions: LaunchOptions;
	onLaunchOptionsChange: (next: LaunchOptions) => void;
	openMenu: ChinMenu | null;
	onOpenMenuChange: (menu: ChinMenu | null) => void;
	bypassPermissionsAllowed: boolean;
	/** What the Mode menu's Default / Recommended badges read. */
	modeBadges?: ModeBadgeSettings | undefined;
	/** The home draft's Auto lock for its picked model (`autoModeLockNote`); a pick of Auto shows clamped while set. */
	autoLockNote?: string | null | undefined;
	/** The folder the Bypass ack is kept for (`consentWorkspaceKey`), or "" before one is known. */
	permissionWorkspace: string;
	/** A Mode menu pick that passed the consent guard, for the folder's remembered mode. */
	onPermissionModePick?: ((mode: LaunchPermissionMode) => void) | undefined;
	/** A live session is cached at its effort, so changing it asks first. */
	confirmEffortChange?: boolean;
	/** The home draft's try-auto coach mark offer; the mark shows once the Mode pick is an explicit Manual. */
	tryAutoCoach?: TryAutoCoachOffer | undefined;
	/** The grouped "/" menu's Model row: the model menu opens beside it instead of above its own trigger. */
	modelFlyout?: ModelMenuFlyout | null | undefined;
}

/** A `/effort <level>`, `/model <id>` or `/fast` sent from the composer, applied the way a menu pick is. */
export type ChinPick =
	|
	  {
			effort: EffortLevel;
	  }
	|
	  {
			model: string;
	  }
	|
	  {
			fastMode: boolean;
	  };

export interface ChinPickHandle
{
	pick: (pick: ChinPick) => void;
	/** The chin's fast state; `canToggle` is false when the current model has no Fast mode section or it is blocked. */
	fastState: () =>
	{
		on: boolean;
		canToggle: boolean;
	};
	/** Opens the usage ring's popover with its Context window section expanded. */
	openContext: () => void;
}

function effortText(effort: string): string
{
	const level = EffortLevelSchema.safeParse(effort);
	return level.success ? effortLevelLabels[level.data] : effort;
}

/**
 * The claude.ai/code composer chin: an empty leading slot, then the trailing model + effort picker, the permission
 * mode and the 14px usage ring, in that order on both the session chin and the new-session bar. Mode, model and
 * effort open menus whose choices apply to the live pane or the next fork or launch.
 */
export const ComposerChin = memo(function ComposerChin({
	state,
	launch,
	surface,
	pickRef,
	usageContext,
	pickersRef,
	modeRef,
}: {
	state: ComposerState;
	launch: ChinLaunchControls;
	surface: ChinSurface;
	pickRef?: Ref<ChinPickHandle> | undefined;
	/** The bar's pickers group, measured by the environment bar's icon-only collapse. */
	pickersRef?: RefObject<HTMLDivElement | null> | undefined;
	/** The bar's mode slot, whose resizes the collapse also watches. */
	modeRef?: RefObject<HTMLDivElement | null> | undefined;
	/** The session's context breakdown and compact action for the usage ring's context-mode popover. */
	usageContext?: UsageRingContext | undefined;
})
{
	const ringRef = useRef<UsageRingHandle>(null);
	const [modeSlot, setModeSlot] = useState<HTMLDivElement | null>(null);
	const attachModeSlot = useCallback(
		(el: HTMLDivElement | null) =>
		{
			setModeSlot(el);
			if (modeRef !== undefined) modeRef.current = el;
		},
		[modeRef],
	);
	const {launchOptions, onLaunchOptionsChange, openMenu, onOpenMenuChange} = launch;
	// Keeps the picked level while the confirm fades out, so its copy doesn't flicker.
	const [effortConfirm, setEffortConfirm] = useState<
	{
		effort: EffortLevel;
		open: boolean;
	}>(
		{
			effort: "high",
			open: false,
		},
	);
	const currentEffort = launchOptions.effort ?? state.effort.id;
	const selectEffort = (effort: EffortLevel) =>
	{
		if (launch.confirmEffortChange !== true)
		{
			onLaunchOptionsChange(
				{
					...launchOptions,
					effort,
				},
			);
		}
		else if (effort !== currentEffort)
		{
			onOpenMenuChange(null);
			setEffortConfirm(
				{
					effort,
					open: true,
				},
			);
		}
	};
	const ultracode = launchOptions.ultracode ?? false;
	const selectUltracode = (on: boolean) =>
	{
		onLaunchOptionsChange(
			{
				...launchOptions,
				ultracode: on,
			},
		);
	};
	const selectModel = (model: string) =>
	{
		onLaunchOptionsChange(withModel(launchOptions, model));
	};
	const {catalog, restrictionFor, defaultModel} = settingsModelMenu(state);
	// A session model neither list has stays the current value: upstream's checked "Unsupported model" row.
	const currentModel = launchOptions.model ?? catalogMenuValue(state.modelId, catalog) ?? state.modelId;
	// Upstream's `fastModeOn = !blocked && value`; a blocked session can't pick it either.
	const fastModeBlocked = state.fastModeBlocked;
	const fastMode = fastModeBlocked === null && (launchOptions.fastMode ?? state.fastMode);
	const selectFastMode = (on: boolean) =>
	{
		if (fastModeBlocked !== null) return;
		onLaunchOptionsChange(
			{
				...launchOptions,
				fastMode: on,
			},
		);
	};
	useImperativeHandle(pickRef, () => (
	{
		pick: (pick) =>
		{
			if ("effort" in pick) selectEffort(pick.effort);
			else if ("model" in pick) selectModel(pick.model);
			else selectFastMode(pick.fastMode);
		},
		fastState: () => (
		{
			on: fastMode,
			canToggle: fastModeBlocked === null && fastModeSupported(currentModel),
		}),
		openContext: () =>
		{
			ringRef.current?.openContext();
		},
	}));
	const menuProps = (menu: ChinMenu) => (
	{
		open: openMenu === menu,
		onOpenChange: (open: boolean) =>
		{
			onOpenMenuChange(open ? menu : null);
		},
	});
	const autoLockNote = launch.autoLockNote ?? null;
	// Upstream's derived demotion: the stored pick keeps Auto, so a model that runs Auto brings it back.
	const modePick =
		launchOptions.permissionMode === undefined || autoLockNote === null
			? launchOptions.permissionMode
			: clampToAvailable(
					launchOptions.permissionMode,
					offeredModes(launch.bypassPermissionsAllowed, autoLockNote),
				);
	const modeLabel = modePick === undefined ? (state.mode?.label ?? "Manual") : modeTriggerLabel(modePick);
	const modelText = launchOptions.model === undefined ? state.model : modelLabel(launchOptions.model);
	// Upstream's environment baseline; locally the settings.json model is what a pick overrides.
	const settingsModel = modelMenuValue(state.settingsModelId) ?? state.settingsModelId;
	const overridden =
		launchOptions.model !== undefined &&
		(modelMenuValue(launchOptions.model) ?? launchOptions.model) !== settingsModel;
	const clearModel = () =>
	{
		const {model: _cleared, ...rest} = launchOptions;
		onLaunchOptionsChange(rest);
	};
	const modelMenu = (
		/* Upstream's one model + effort picker; ⇧⌘E opens it on its Effort submenu in a chin, plain on the bar */
		<ModelMenu
			open={openMenu === "model" || openMenu === "effort"}
			onOpenChange={(open) =>
			{
				onOpenMenuChange(open ? "model" : null);
			}}
			surface={surface}
			effortOpen={openMenu === "effort" && surface === "chin"}
			current={currentModel}
			currentLabel={modelText}
			currentEffort={currentEffort}
			onSelect={selectModel}
			catalog={catalog}
			restrictionFor={restrictionFor}
			defaultModel={defaultModel}
			settingsOverride={
				overridden
					?
						{
							label: modelLabel(settingsModel),
							onUse: clearModel,
						}
					: null
			}
			onSelectEffort={selectEffort}
			effortOptions={effortOptionsFor(currentModel)}
			ultracode={ultracode}
			onUltracodeChange={selectUltracode}
			fastMode={fastMode}
			fastModeBlocked={fastModeBlocked}
			onFastModeChange={selectFastMode}
			flyout={launch.modelFlyout ?? null}
		/>
	);
	const modeMenu = (
		<ModeMenu
			{...menuProps("mode")}
			surface={surface}
			current={modePick ?? state.mode?.id ?? "default"}
			currentLabel={modeLabel}
			bypassPermissionsAllowed={launch.bypassPermissionsAllowed}
			badges={launch.modeBadges}
			autoLockNote={autoLockNote}
			workspace={launch.permissionWorkspace}
			onSelect={(permissionMode) =>
			{
				launch.onPermissionModePick?.(permissionMode);
				onLaunchOptionsChange(
					{
						...launchOptions,
						permissionMode,
					},
				);
			}}
		/>
	);
	const ring = (
		<span className={USAGE_RING_WRAPPER_CLASS}>
			<UsageRing usage={state.usage} context={usageContext} ref={ringRef} />
		</span>
	);
	return (
		<>
			{surface === "chin" ? (
				<ComposerChinFrame
					/* Upstream's leading slot, an empty marker while the mode menu shows. */
					leading={<span aria-hidden="true" />}
					trailing={
						<div className={CHIN_PICKERS_CLASS}>
							{modelMenu}
							<span className="inline-flex min-w-0">{modeMenu}</span>
							{ring}
							{/* Upstream's session chin announces the fast state at rest on every model. */}
							<span data-fast-mode-status="" role="status" aria-live="polite" className="sr-only">
								{fastMode ? "Fast mode on" : "Fast mode off"}
							</span>
						</div>
					}
				/>
			) : (
				/* The new-session bar's pickers group; it has no live region. */
				<div ref={pickersRef} className={ENVIRONMENT_PICKERS_CLASS}>
					<div data-testid="environment-bar-model" className="flex items-center gap-1 empty:hidden">
						<div className={ENVIRONMENT_SLOT_CLASS}>{modelMenu}</div>
					</div>
					<div
						ref={attachModeSlot}
						data-testid="environment-bar-mode"
						className={`${ENVIRONMENT_SLOT_CLASS} shrink-0`}
					>
						{modeMenu}
					</div>
					<div className={ENVIRONMENT_SLOT_CLASS}>{ring}</div>
				</div>
			)}
			{/* Downloaded only once a Manual pick makes the mark eligible; it unmounts when the pick moves on. */}
			{surface === "bar" && tryAutoCoachEligible(modePick, launch.tryAutoCoach) && (
				<Suspense fallback={null}>
					<LazyTryAutoCoachMark eligible anchor={modeSlot} />
				</Suspense>
			)}
			<ConfirmDialog
				open={effortConfirm.open}
				onOpenChange={(open) =>
				{
					setEffortConfirm((prev) => (
					{
						...prev,
						open,
					}));
				}}
				title="Change effort?"
				body={`This session is cached with effort set to ${effortText(currentEffort)}. Changing it to ${effortText(effortConfirm.effort)} means Claude re-reads the whole session on your next message, which uses more of your limit.`}
				confirmLabel="Change effort"
				onConfirm={() =>
				{
					onLaunchOptionsChange(
						{
							...launchOptions,
							effort: effortConfirm.effort,
						},
					);
				}}
			/>
		</>
	);
});
