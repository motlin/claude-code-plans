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

export const CHIN_BUTTON_CLASS =
	"flex h-6 min-w-0 items-center justify-center rounded-r4 leading-[20px] text-secondary transition-colors hover:bg-fill-ghost-hover hover:text-primary focus-visible:shadow-[0_0_0_2px_var(--accent-100)] focus-visible:outline-none";

const CHIN_TRIGGER_CLASS = `${CHIN_BUTTON_CLASS} truncate px-1.5`;

/** Upstream reads the model and effort in primary ink; +, mode and usage stay secondary. */
const CHIN_PRIMARY_TRIGGER_CLASS = CHIN_TRIGGER_CLASS.replace("text-secondary", "text-primary");

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
				<Tooltip content="Mode" shortcut={modeKeys} side="top">
					<MenuTrigger data-chin-mode="" className={CHIN_TRIGGER_CLASS}>
						{currentLabel}
					</MenuTrigger>
				</Tooltip>
				<MenuContent side="top" className="w-[280px]">
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
							>
								<span className="flex min-w-0 flex-col">
									<span
										data-menu-item-label=""
										className={item.warning ? "truncate text-warning-100" : "truncate"}
									>
										{item.label}
									</span>
									<span
										data-menu-item-description=""
										className="truncate text-[12px]/[15px] text-[var(--menu-muted)]"
									>
										{item.description}
									</span>
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

/**
 * claude.ai/code's single model + effort picker: the trigger reads "Opus 5.5 High", and its menu lists
 * the primary models with digit keys, an Effort submenu (upstream's hint, then Low … Max with the
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
				{/* Upstream mutes the effort and drops it when the chin is under 280px. */}
				<span className="shrink-0 whitespace-pre text-ink-muted @max-[280px]:hidden"> {effortLabel}</span>
			</MenuTrigger>
			<MenuContent side="top" align="end">
				<MenuRadioGroup
					value={primary}
					onValueChange={(value: string) => {
						onSelect(value);
					}}
				>
					{PRIMARY_MODELS.map((model, index) => (
						<MenuRadioItem
							key={model.id}
							value={model.id}
							{...(model.id === primary ? {} : {accelerator: String(index + 1)})}
							closeOnClick
						>
							<span data-menu-item-label="">{model.label}</span>
						</MenuRadioItem>
					))}
				</MenuRadioGroup>
				<MenuSeparator />
				<MenuSub defaultOpen={effortOpen}>
					<MenuSubTrigger value={effortLabel}>Effort</MenuSubTrigger>
					<MenuSubContent className="w-[320px]">
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
							{EFFORT_LEVELS.map((effort) => (
								<MenuRadioItem key={effort} value={effort} closeOnClick>
									<span data-menu-item-label="">{effortLevelShortLabels[effort]}</span>
									{effort === RECOMMENDED_EFFORT && (
										<span
											data-effort-recommended=""
											className="ms-1.5 rounded-r3 bg-alpha-2 px-1 text-[11px]/[15px] text-secondary"
										>
											Recommended
										</span>
									)}
									{effort === "max" && (
										<span
											data-effort-warning=""
											className="ms-1.5 flex items-center gap-1 text-[12px]/[15px] text-warning-000"
										>
											<TriangleAlert aria-hidden="true" className="size-3.5" />
											3.5× or more usage
										</span>
									)}
								</MenuRadioItem>
							))}
						</MenuRadioGroup>
					</MenuSubContent>
				</MenuSub>
				<MenuSeparator />
				<MenuSub>
					<MenuSubTrigger>More models</MenuSubTrigger>
					<MenuSubContent>
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
