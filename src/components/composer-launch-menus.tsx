import {TriangleAlert} from "lucide-react";
import {useState} from "react";

import {useShortcutKeys} from "../hooks/use-shortcut";

import {
	EFFORT_LEVELS,
	type EffortLevel,
	EffortLevelSchema,
	type LaunchPermissionMode,
	LaunchPermissionModeSchema,
	MORE_MODELS,
	modeMenuItems,
	moreModelsMenuValue,
	PRIMARY_MODELS,
	primaryModelMenuValue,
} from "../lib/launch-options";
import {effortLevelShortLabels} from "../lib/schema-choices";
import {ConfirmDialog} from "./confirm-dialog";
import {CHIN_PRIMARY_TRIGGER_CLASS, CHIN_TRIGGER_CLASS, EFFORT_LABEL_CLASS} from "./composer-tokens";
import {
	Menu,
	MenuContent,
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

/*
 * The claude.ai/code chin menus (⌥⌘M mode, ⇧⌘I model, ⇧⌘E effort). A choice
 * applies to the next fork or launch as a `claude` CLI flag.
 */

const EFFORT_HELP = "Higher effort means more thorough responses, but takes longer and uses your limits faster.";

export type ChinMenu = "mode" | "model" | "effort";

interface ControlledMenuProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
}

export function ModeMenu({
	open,
	onOpenChange,
	current,
	currentLabel,
	bypassPermissionsAllowed,
	onSelect,
}: ControlledMenuProps & {
	current: string;
	currentLabel: string;
	bypassPermissionsAllowed: boolean;
	onSelect: (mode: LaunchPermissionMode) => void;
}) {
	const [confirmBypass, setConfirmBypass] = useState(false);
	const modeKeys = useShortcutKeys("open_mode_menu").keys;
	return (
		<>
			<Menu open={open} onOpenChange={onOpenChange}>
				<Tooltip content="Mode" shortcut={modeKeys} side="top" suppressAfterPopup>
					<MenuTrigger data-chin-mode="" className={CHIN_TRIGGER_CLASS}>
						{currentLabel}
					</MenuTrigger>
				</Tooltip>
				<MenuContent side="top">
					<MenuLabel className="px-2 py-1 text-[12px]/[15px] font-medium text-[var(--menu-muted)]">
						Mode
					</MenuLabel>
					<MenuRadioGroup
						value={current}
						onValueChange={(value: string) => {
							const mode = LaunchPermissionModeSchema.parse(value);
							if (mode === "bypassPermissions") setConfirmBypass(true);
							else onSelect(mode);
						}}
					>
						{modeMenuItems(bypassPermissionsAllowed).map((item, index) => (
							<MenuRadioItem
								key={item.id}
								value={item.id}
								accelerator={String(index + 1)}
								closeOnClick
								data-variant={item.warning ? "warning" : "default"}
								description={item.description}
							>
								<span
									data-menu-item-label=""
									{...(item.warning ? {className: "text-warning-100"} : {})}
								>
									{item.label}
								</span>
							</MenuRadioItem>
						))}
					</MenuRadioGroup>
				</MenuContent>
			</Menu>
			<ConfirmDialog
				open={confirmBypass}
				onOpenChange={setConfirmBypass}
				title="Enable bypass permissions"
				body="Claude will read, edit, and execute files without asking — including potentially destructive commands. Only use this in isolated or disposable environments."
				confirmLabel="Enable"
				variant="danger"
				onConfirm={() => {
					onSelect("bypassPermissions");
				}}
			/>
		</>
	);
}

/** Upstream's Effort list badges Medium as Recommended. */
const RECOMMENDED_EFFORT: EffortLevel = "medium";
const FABLE_TOOLTIP = "Fable is the most capable model and draws down usage much faster than Opus";
const MAX_EFFORT_TOOLTIP = "Claude thinks longer with Max effort and can consume 3.5× or more usage than Medium.";
/** Upstream's cds Badge chip, sized for the compact menu. */
const EFFORT_BADGE_CLASS =
	"inline-flex items-center gap-1 h-5 whitespace-nowrap rounded-full px-1.5 text-[11px] font-medium";

/**
 * An Effort row's label line, as upstream's: the label and its chip share one non-wrapping flex line, so the
 * Recommended and Max chips never push the row onto a second line. Ultracode's label is pro ink.
 */
function EffortRowLabel({effort}: {effort: EffortLevel}) {
	return (
		<span className="flex min-w-0 items-center gap-1">
			<span
				data-menu-item-label=""
				className={effort === "ultracode" ? "truncate font-medium text-[var(--text-pro)]" : "truncate"}
			>
				{effortLevelShortLabels[effort]}
			</span>
			{effort === RECOMMENDED_EFFORT && (
				<span data-effort-recommended="" className={`${EFFORT_BADGE_CLASS} bg-alpha-1 text-secondary`}>
					Recommended
				</span>
			)}
			{effort === "max" && (
				<span
					data-effort-warning=""
					className={`${EFFORT_BADGE_CLASS} min-w-0 shrink bg-[var(--warning-tint)] text-warning-000`}
				>
					<TriangleAlert aria-hidden="true" className="size-3 shrink-0" />
					3.5× or more usage
				</span>
			)}
		</span>
	);
}

/**
 * claude.ai/code's single model + effort picker: the trigger reads "Opus 5.5 High", and its menu lists
 * the primary models with digit keys, an Effort submenu (upstream's hint, then Low … Max and Ultracode with the
 * Recommended badge and Max's usage warning) and More models. ⇧⌘E opens it with Effort open.
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
}: ControlledMenuProps & {
	/** Opened from ⇧⌘E: show the Effort submenu straight away. */
	effortOpen: boolean;
	current: string | undefined;
	currentLabel: string;
	currentEffort: string;
	onSelect: (model: string) => void;
	onSelectEffort: (effort: EffortLevel) => void;
}) {
	/** Upstream's checked row shows its ✓ in place of its digit; the others keep their position's digit. */
	const primary = primaryModelMenuValue(current);
	const level = EffortLevelSchema.safeParse(currentEffort);
	const effortLabel = level.success ? effortLevelShortLabels[level.data] : currentEffort;
	return (
		<Menu open={open} onOpenChange={onOpenChange}>
			<MenuTrigger
				data-cds="ModelSelector"
				aria-label={`Model: ${currentLabel}, Effort: ${effortLabel}`}
				className={CHIN_PRIMARY_TRIGGER_CLASS}
			>
				<span className="truncate">{currentLabel}</span>
				<span className={EFFORT_LABEL_CLASS}> {effortLabel}</span>
			</MenuTrigger>
			<MenuContent side="top" align="end" sheetSize="base">
				<MenuRadioGroup
					value={primary}
					onValueChange={(value: string) => {
						onSelect(value);
					}}
				>
					{PRIMARY_MODELS.map((model, index) => {
						const row = (
							<MenuRadioItem
								key={model.id}
								value={model.id}
								accelerator={String(index + 1)}
								hideAccelerator={model.id === primary}
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
				<MenuSeparator />
				<MenuSub defaultOpen={effortOpen}>
					<MenuSubTrigger value={effortLabel}>Effort</MenuSubTrigger>
					<MenuSubContent side="inline-start" align="end" className="w-[320px]">
						<MenuLabel className="px-2 pt-1.5 pb-1 text-[12px]/[16px] text-[var(--menu-muted)]">
							{EFFORT_HELP}
						</MenuLabel>
						<MenuRadioGroup
							value={level.success ? level.data : ""}
							onValueChange={(value: unknown) => {
								const picked = EffortLevelSchema.safeParse(value);
								if (!picked.success) return;
								onSelectEffort(picked.data);
								onOpenChange(false);
							}}
						>
							{EFFORT_LEVELS.map((effort) => {
								const row = (
									<MenuRadioItem key={effort} value={effort} data-effort-id={effort} closeOnClick>
										<EffortRowLabel effort={effort} />
									</MenuRadioItem>
								);
								return effort === "max" ? (
									<Tooltip
										key={effort}
										content={MAX_EFFORT_TOOLTIP}
										side="right"
										portal
										className="flex w-full"
									>
										{row}
									</Tooltip>
								) : (
									row
								);
							})}
						</MenuRadioGroup>
					</MenuSubContent>
				</MenuSub>
				<MenuSeparator />
				<MenuSub>
					<MenuSubTrigger>More models</MenuSubTrigger>
					<MenuSubContent side="inline-start">
						<MenuRadioGroup
							value={moreModelsMenuValue(current)}
							onValueChange={(value: string) => {
								onSelect(value);
								onOpenChange(false);
							}}
						>
							{MORE_MODELS.map((model) => (
								<MenuRadioItem key={model.id} value={model.id} closeOnClick>
									<span data-menu-item-label="">{model.label}</span>
								</MenuRadioItem>
							))}
						</MenuRadioGroup>
					</MenuSubContent>
				</MenuSub>
			</MenuContent>
		</Menu>
	);
}
