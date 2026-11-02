import {Info, TriangleAlert} from "lucide-react";

import {useShortcutKeys} from "../hooks/use-shortcut";

import
{
	type EffortLevel,
	type EffortOption,
	EffortLevelSchema,
	fastModeSupported,
	MAX_EFFORT_TOOLTIP,
	type LaunchPermissionMode,
	LaunchPermissionModeSchema,
	MORE_MODELS,
	modeMenuItems,
	moreModelsMenuValue,
	PRIMARY_MODELS,
	primaryModelMenuValue,
	resolveLaunchModel,
} from "../lib/launch-options";
import {effortLevelShortLabels} from "../lib/schema-choices";
import type {FastModeBlocked} from "../lib/session-fast-mode";
import
{
	BAR_EFFORT_LABEL_CLASS,
	BAR_MODEL_LABEL_CLASS,
	BAR_MODEL_NAME_CLASS,
	CHIN_EFFORT_LABEL_CLASS,
	CHIN_MODEL_LABEL_CLASS,
	CHIN_MODEL_NAME_CLASS,
	CHIN_TRIGGER_CLASS,
} from "./composer-tokens";
import
{
	MENU_HEADER_CLASS,
	Menu,
	MenuCheckboxSwitchItem,
	MenuContent,
	MenuItem,
	MenuLabel,
	MenuRadioGroup,
	MenuRadioItem,
	MenuSeparator,
	MenuSub,
	MenuSubContent,
	MenuSubTrigger,
	MenuTrigger,
} from "./ui/menu";
import {Tooltip} from "./ui/tooltip";
import {usePermissionModeGuard} from "./use-permission-mode-guard";

/*
 * The claude.ai/code chin menus (⌥⌘M mode, ⇧⌘I model, ⇧⌘E effort). A choice
 * applies to the next fork or launch as a `claude` CLI flag.
 */

const EFFORT_HELP = "Higher effort means more thorough responses, but takes longer and uses your limits faster.";
/** Upstream's Effort hint header: the footnote type at regular weight. */
const EFFORT_HELP_CLASS = "px-2 comfortable:px-2.5 py-1 text-footnote font-normal text-[var(--menu-muted)]";
/** Upstream's Max warning badge message, also the trigger's aria suffix and its Warning icon's alt. */
const MAX_WARNING_MESSAGE = "3.5× or more usage";

export type ChinMenu = "mode" | "model" | "effort";

/** Where the chin controls render: the home environment bar or a session composer chin. */
export type ChinSurface = "bar" | "chin";

interface ControlledMenuProps
{
	open: boolean;
	onOpenChange: (open: boolean) => void;
}

export function ModeMenu({
	open,
	onOpenChange,
	current,
	currentLabel,
	bypassPermissionsAllowed,
	workspace,
	onSelect,
	surface,
}: ControlledMenuProps &
{
	/** Upstream's new-session bar reads "Permissions · this session" with no digit keycaps; chins read "Mode". */
	surface: ChinSurface;
	current: string;
	currentLabel: string;
	bypassPermissionsAllowed: boolean;
	/** The consent workspace key (`consentWorkspaceKey`), or "" before a folder is known. */
	workspace: string;
	onSelect: (mode: LaunchPermissionMode) => void;
})
{
	const {guard, gate} = usePermissionModeGuard(workspace);
	const modeKeys = useShortcutKeys("open_mode_menu").keys;
	const bar = surface === "bar";
	return (
		<>
			<Menu open={open} onOpenChange={onOpenChange}>
				<Tooltip content={bar ? "Permissions" : "Mode"} shortcut={modeKeys} side="top" suppressAfterPopup>
					<MenuTrigger
						data-chin-mode=""
						className={CHIN_TRIGGER_CLASS}
						{...(bar
							?
								{
									"aria-label": `Permissions: ${currentLabel}`,
								}
							: {})}
					>
						{bar ? (
							currentLabel
						) : (
							/* Upstream's chin Mode label: a one-column grid whose cell ellipsises. */
							<span className="grid grid-cols-[minmax(0,1fr)]">
								<span className="overflow-x-clip text-ellipsis whitespace-nowrap">{currentLabel}</span>
							</span>
						)}
					</MenuTrigger>
				</Tooltip>
				<MenuContent side="top">
					<MenuRadioGroup
						label={bar ? "Permissions · this session" : "Mode"}
						value={current}
						onValueChange={(value: string) =>
						{
							const mode = LaunchPermissionModeSchema.parse(value);
							// Upstream's `Ei`: the pick (and a live pane's shift+tab presses) waits for any consent owed.
							guard(mode, () =>
							{
								onSelect(mode);
							});
						}}
					>
						{modeMenuItems(bypassPermissionsAllowed).map((item, index) => (
							<MenuRadioItem
								key={item.id}
								value={item.id}
								{...(bar
									? {}
									:
										{
											accelerator: String(index + 1),
										})}
								closeOnClick
								data-variant={item.warning ? "warning" : "default"}
								description={item.description}
							>
								<span
									data-menu-item-label=""
									{...(item.warning
										?
											{
												className: "text-warning-100",
											}
										: {})}
								>
									{item.label}
								</span>
							</MenuRadioItem>
						))}
					</MenuRadioGroup>
				</MenuContent>
			</Menu>
			{gate}
		</>
	);
}

const FABLE_TOOLTIP = "Fable is the most capable model and draws down usage much faster than Opus";
/** Upstream's cds Badge chip, sized for the compact menu. */
const EFFORT_BADGE_CLASS =
	"inline-flex items-center gap-1 h-5 whitespace-nowrap rounded-full px-1.5 text-[11px] font-medium";

/**
 * An Effort row's label line, as upstream's `ON`: the name, then the catalog badge (a neutral Recommended, or the
 * warning "3.5× or more usage"), on one non-wrapping flex line. A tooltipped row without a warning badge (every Max
 * but Opus 5.5's) ends in a muted 12px Info glyph instead.
 */
function EffortRowLabel({option}: {option: EffortOption})
{
	return (
		<span className="flex min-w-0 items-center gap-1">
			<span data-menu-item-label="" className="truncate">
				{effortLevelShortLabels[option.id]}
			</span>
			{option.recommended && (
				<span data-effort-recommended="" className={`${EFFORT_BADGE_CLASS} bg-alpha-1 text-secondary`}>
					Recommended
				</span>
			)}
			{option.maxWarning && (
				<span
					data-effort-warning=""
					className={`${EFFORT_BADGE_CLASS} min-w-0 shrink bg-[var(--warning-tint)] text-warning-000`}
				>
					<TriangleAlert aria-hidden="true" className="size-3 shrink-0" />
					{MAX_WARNING_MESSAGE}
				</span>
			)}
			{!option.maxWarning && option.tooltip !== undefined && (
				<Info data-effort-info-icon="" aria-hidden="true" className="size-3 shrink-0 text-ink-muted" />
			)}
		</span>
	);
}

/**
 * claude.ai/code's single model + effort picker: the trigger reads "Opus 5.5 High", and its menu lists
 * the primary models with digit keys, an Effort submenu (upstream's hint, then Low … Max and Ultracode with the
 * Recommended badge and Max's usage warning) and More models. ⇧⌘E opens it with Effort open in a session
 * chin, and plain on the home bar (upstream maps the bar's effort field to the model menu).
 */
export function ModelMenu({
	open,
	onOpenChange,
	effortOpen,
	current,
	currentLabel,
	currentEffort,
	onSelect,
	onSelectEffort,
	effortOptions,
	ultracode,
	onUltracodeChange,
	fastMode,
	fastModeBlocked,
	onFastModeChange,
	settingsOverride,
	surface,
}: ControlledMenuProps &
{
	/** Upstream's new-session bar pins a "Model · this session" header; session chins have none. */
	surface: ChinSurface;
	/** Opened from ⇧⌘E: show the Effort submenu straight away. */
	effortOpen: boolean;
	current: string | undefined;
	currentLabel: string;
	currentEffort: string;
	onSelect: (model: string) => void;
	onSelectEffort: (effort: EffortLevel) => void;
	/** The current model's catalog effort rows; the Effort submenu is hidden when it offers none. */
	effortOptions: readonly EffortOption[];
	/** Upstream's Ultracode switch, a thinking mode that combines with the effort. */
	ultracode: boolean;
	onUltracodeChange: (on: boolean) => void;
	/** Already false while blocked. */
	fastMode: boolean;
	/** The CLI can't use fast mode here: upstream's greyed row with this line and reason tooltip. */
	fastModeBlocked: FastModeBlocked | null;
	onFastModeChange: (on: boolean) => void;
	/** The pick differs from the settings.json model: accent label, "(settings: X)" tooltip, "Use settings’ X". */
	settingsOverride:
	{
		label: string;
		onUse: () => void;
	} | null;
})
{
	/** Upstream's checked row shows its ✓ in place of its digit; the others keep their position's digit. */
	const primary = primaryModelMenuValue(current);
	const level = EffortLevelSchema.safeParse(currentEffort);
	const effortLabel = level.success ? effortLevelShortLabels[level.data] : currentEffort;
	/** Upstream's trigger has no effort word (nor Max's warning) for a model with no effort levels. */
	const effortShown = effortOptions.length > 0;
	const ultracodeShown = effortShown && ultracode;
	/** Only a catalog warning badge (Opus 5.5's Max) gets the trigger icon, aria suffix, tooltip and hint icon. */
	const maxWarning =
		effortShown && effortOptions.find((option) => level.success && option.id === level.data)?.maxWarning === true;
	const modelKeys = useShortcutKeys("open_model_menu").keys;
	const fastShown = fastMode && current !== undefined && fastModeSupported(current);
	const chin = surface === "chin";
	const tailClass = chin ? CHIN_EFFORT_LABEL_CLASS : BAR_EFFORT_LABEL_CLASS;
	const name = <span className={chin ? CHIN_MODEL_NAME_CLASS : BAR_MODEL_NAME_CLASS}>{currentLabel}</span>;
	const trigger = (
		<MenuTrigger
			data-cds="ModelSelector"
			{...(chin
				?
					{
						"data-collapse": "name",
					}
				: {})}
			aria-label={`Model: ${currentLabel}${fastShown ? " Fast" : ""}${effortShown ? ` ${effortLabel}` : ""}${ultracodeShown ? " · Ultracode" : ""}${maxWarning ? ` ${MAX_WARNING_MESSAGE}` : ""}`}
			className={CHIN_TRIGGER_CLASS}
		>
			<span className={chin ? CHIN_MODEL_LABEL_CLASS : BAR_MODEL_LABEL_CLASS}>
				{settingsOverride === null ? (
					name
				) : (
					<span data-overridden="" className="flex min-w-0 items-center gap-1 text-accent-100">
						{name}
					</span>
				)}
				{/* Upstream's tail order: the " Fast" word, the effort, then the Ultracode toggle. */}
				{fastShown && (
					<span data-fast-label="" className={tailClass}>
						{" Fast"}
					</span>
				)}
				{effortShown && <span className={tailClass}> {effortLabel}</span>}
				{ultracodeShown && (
					<span
						data-ultracode-label=""
						className={`${chin ? "shrink-0 whitespace-pre ms-1" : "shrink-0 whitespace-pre"} font-medium text-[var(--text-pro)]`}
					>
						{" · Ultracode"}
					</span>
				)}
			</span>
			{maxWarning && (
				<TriangleAlert
					data-effort-warning-icon=""
					role="img"
					aria-label={MAX_WARNING_MESSAGE}
					className="ms-1 size-3 shrink-0 text-warning-100"
				/>
			)}
		</MenuTrigger>
	);
	/** Upstream's `content = tooltip ?? (warning ? effort tooltip : undefined)`. */
	const tooltip =
		surface === "bar" || settingsOverride !== null
			?
				{
					content:
						settingsOverride === null
							? "Model"
							: `Model for this session (settings: ${settingsOverride.label})`,
					shortcut: modelKeys,
				}
			: maxWarning
				?
					{
						content: MAX_EFFORT_TOOLTIP,
						shortcut: undefined,
					}
				: null;
	const effortHint = ultracodeShown ? `${effortLabel} · Ultracode` : effortLabel;
	return (
		<Menu open={open} onOpenChange={onOpenChange}>
			{/* Upstream's new-session bar tooltips the model "Model ⇧⌘I"; session chins only when overridden or warned. */}
			{tooltip === null ? (
				trigger
			) : (
				<Tooltip
					content={tooltip.content}
					{...(tooltip.shortcut === undefined
						? {}
						:
							{
								shortcut: tooltip.shortcut,
							})}
					side="top"
					suppressAfterPopup
				>
					{trigger}
				</Tooltip>
			)}
			<MenuContent
				side="top"
				align="end"
				sheetSize="base"
				cds="ModelSelector"
				{...(surface === "bar"
					?
						{
							header: (
								<div role="presentation" className={MENU_HEADER_CLASS}>
									Model · this session
								</div>
							),
						}
					: {})}
			>
				<MenuRadioGroup
					value={primary}
					onValueChange={(value: string) =>
					{
						onSelect(value);
					}}
				>
					{PRIMARY_MODELS.map((model, index) =>
					{
						const row = (
							<MenuRadioItem
								key={model.id}
								value={model.id}
								data-model-id={resolveLaunchModel(model.id)}
								accelerator={String(index + 1)}
								acceleratorInSlot
								closeOnClick
							>
								<span data-menu-item-label="">{model.label}</span>
							</MenuRadioItem>
						);
						return model.id === "fable" ? (
							<Tooltip key={model.id} content={FABLE_TOOLTIP} side="left" portal className="flex w-full">
								{row}
							</Tooltip>
						) : (
							row
						);
					})}
				</MenuRadioGroup>
				{effortShown && (
					<>
						<MenuSeparator />
						<MenuSub defaultOpen={effortOpen}>
							<MenuSubTrigger
								value={effortHint}
								{...(maxWarning
									?
										{
											trailing: (
												<span
													data-effort-warning-hint=""
													className="flex items-center gap-1 text-footnote text-[var(--menu-muted)]"
												>
													<span className="max-w-[160px] truncate">{effortHint}</span>
													<TriangleAlert
														aria-hidden="true"
														className="size-3 shrink-0 text-warning-100"
													/>
												</span>
											),
										}
									: {})}
							>
								Effort
							</MenuSubTrigger>
							<MenuSubContent align="end" className="w-[320px]">
								<MenuLabel className={EFFORT_HELP_CLASS}>{EFFORT_HELP}</MenuLabel>
								<MenuRadioGroup
									value={level.success ? level.data : ""}
									onValueChange={(value: unknown) =>
									{
										const picked = EffortLevelSchema.safeParse(value);
										if (!picked.success) return;
										onSelectEffort(picked.data);
										onOpenChange(false);
									}}
								>
									{effortOptions.map((option) =>
									{
										const row = (
											<MenuRadioItem
												key={option.id}
												value={option.id}
												data-effort-id={option.id}
												closeOnClick
											>
												<EffortRowLabel option={option} />
											</MenuRadioItem>
										);
										return option.tooltip === undefined ? (
											row
										) : (
											<Tooltip
												key={option.id}
												content={option.tooltip}
												side="right"
												portal
												className="flex w-full"
											>
												{row}
											</Tooltip>
										);
									})}
								</MenuRadioGroup>
								<MenuSeparator />
								{/* Upstream's `CU`: a keep-open switch row, a thinking mode that combines with any effort. */}
								<MenuCheckboxSwitchItem
									decorative
									checked={ultracode}
									onCheckedChange={onUltracodeChange}
								>
									Ultracode
								</MenuCheckboxSwitchItem>
							</MenuSubContent>
						</MenuSub>
					</>
				)}
				<MenuSeparator />
				<MenuSub>
					<MenuSubTrigger>More models</MenuSubTrigger>
					<MenuSubContent className="max-h-[min(50vh,var(--available-height))]">
						<MenuRadioGroup
							value={moreModelsMenuValue(current)}
							onValueChange={(value: string) =>
							{
								onSelect(value);
								onOpenChange(false);
							}}
						>
							{MORE_MODELS.map((model) => (
								<MenuRadioItem key={model.id} value={model.id} data-model-id={model.id} closeOnClick>
									<span data-menu-item-label="">{model.label}</span>
								</MenuRadioItem>
							))}
						</MenuRadioGroup>
					</MenuSubContent>
				</MenuSub>
				{/* Upstream's Fast mode block, only on models whose catalog entry offers the toggle. */}
				{current !== undefined && fastModeSupported(current) && (
					<>
						<MenuSeparator />
						<div role="presentation" className={MENU_HEADER_CLASS}>
							<span className="flex items-center gap-1">Fast mode</span>
						</div>
						{/* Upstream's blocked row: greyed, with the reason line and tooltip; blocked already forces it off. */}
						<MenuCheckboxSwitchItem
							decorative
							checked={fastMode}
							onCheckedChange={onFastModeChange}
							{...(fastModeBlocked === null
								? {}
								:
									{
										disabled: true,
										description: fastModeBlocked.line,
										disabledReason: fastModeBlocked.reason,
									})}
						>
							Enable fast mode
						</MenuCheckboxSwitchItem>
					</>
				)}
				{settingsOverride !== null && (
					<>
						<MenuSeparator />
						<MenuItem onSelect={settingsOverride.onUse}>Use settings’ {settingsOverride.label}</MenuItem>
					</>
				)}
			</MenuContent>
		</Menu>
	);
}
