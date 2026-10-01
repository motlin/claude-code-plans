import {Popover} from "@base-ui/react/popover";
import {PreviewCard} from "@base-ui/react/preview-card";
import {CircleQuestionMark} from "lucide-react";
import {type KeyboardEvent, useState} from "react";

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
import {effortLevelLabels, effortLevelShortLabels} from "../lib/schema-choices";
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
	"flex h-5 min-w-0 items-center justify-center rounded-r4 leading-[17px] text-secondary transition-colors hover:bg-fill-ghost-hover hover:text-primary focus-visible:shadow-[0_0_0_2px_var(--accent-100)] focus-visible:outline-none";

const CHIN_TRIGGER_CLASS = `${CHIN_BUTTON_CLASS} truncate px-1.5`;

/** Upstream reads the model and effort in primary ink; +, mode and usage stay secondary. */
const CHIN_PRIMARY_TRIGGER_CLASS = CHIN_TRIGGER_CLASS.replace("text-secondary", "text-primary");

const EFFORT_POPUP_CLASS =
	"flex w-[220px] max-w-[320px] flex-col gap-2 rounded-r7 bg-[var(--menu-bg)] p-3 text-[12px]/[16px] text-primary shadow-[var(--menu-shadow)] outline-none";

/** claude.ai/code captions this stop "Recommended" and appends it to the slider's value text. */
const RECOMMENDED_EFFORT: EffortLevel = "high";

const EFFORT_HELP = "Higher effort means more thorough responses, but takes longer and uses your limits faster.";

/** Thumb width; stops are inset by half of it so the thumb stays on the track at both ends. */
const EFFORT_THUMB_PX = 16;

/** The CSS `left` of stop `index` along the slider. */
function effortStopLeft(index: number): string {
	const fraction = index / (EFFORT_LEVELS.length - 1);
	return `calc(${EFFORT_THUMB_PX / 2}px + (100% - ${EFFORT_THUMB_PX}px) * ${fraction})`;
}

export type ChinMenu = "mode" | "model" | "effort";

interface ControlledMenuProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
}

/** 1-based digit of a plain keypress, or null. */
function digitOf(event: KeyboardEvent): number | null {
	if (event.metaKey || event.ctrlKey || event.altKey) return null;
	return /^[1-9]$/.test(event.key) ? Number(event.key) : null;
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
				onConfirm={() => onSelect("bypassPermissions")}
			/>
		</>
	);
}

export function ModelMenu({
	open,
	onOpenChange,
	current,
	currentLabel,
	onSelect,
}: ControlledMenuProps & {
	current: string | undefined;
	currentLabel: string;
	onSelect: (model: string) => void;
}) {
	/** Upstream's checked row shows its ✓ in place of its digit; the others keep their position's digit. */
	const primary = primaryModelMenuValue(current);
	return (
		<Menu open={open} onOpenChange={onOpenChange}>
			<MenuTrigger
				data-cds="ModelSelector"
				aria-label={`Model: ${currentLabel}`}
				className={CHIN_PRIMARY_TRIGGER_CLASS}
			>
				{currentLabel}
			</MenuTrigger>
			<MenuContent side="top" align="end">
				<MenuRadioGroup value={primary} onValueChange={(value: string) => onSelect(value)}>
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

export function EffortSelector({
	open,
	onOpenChange,
	current,
	onSelect,
}: ControlledMenuProps & {
	current: string;
	onSelect: (effort: EffortLevel) => void;
}) {
	const level = EffortLevelSchema.safeParse(current);
	const label = level.success ? effortLevelLabels[level.data] : current;
	const index = level.success ? EFFORT_LEVELS.indexOf(level.data) : EFFORT_LEVELS.indexOf("high");

	function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
		const digit = digitOf(event);
		const picked = digit === null ? undefined : EFFORT_LEVELS[digit - 1];
		if (picked === undefined) return;
		event.preventDefault();
		event.stopPropagation();
		onSelect(picked);
		onOpenChange(false);
	}

	return (
		<Popover.Root open={open} onOpenChange={onOpenChange}>
			<Tooltip content="Effort" side="top">
				<Popover.Trigger
					data-cds="ModelSelectorEffort"
					aria-label={`Effort: ${label}`}
					className={CHIN_PRIMARY_TRIGGER_CLASS}
				>
					{label}
				</Popover.Trigger>
			</Tooltip>
			<Popover.Portal>
				<Popover.Positioner side="top" align="end" sideOffset={6} className="z-[130]">
					<Popover.Popup
						data-cds="ModelSelectorEffort"
						className={EFFORT_POPUP_CLASS}
						onKeyDown={handleKeyDown}
					>
						<div className="flex items-center gap-1.5">
							<Popover.Title className="font-normal text-[var(--menu-muted)]">Effort</Popover.Title>
							<span data-effort-current="" className="font-medium">
								{label}
							</span>
							<EffortHelp />
						</div>
						<div
							data-effort-captions=""
							className="flex justify-between text-[12px]/[15px] text-[var(--menu-muted)]"
						>
							<span>Faster</span>
							<span>Smarter</span>
						</div>
						<EffortSlider
							index={index}
							valueText={
								level.success && level.data === RECOMMENDED_EFFORT ? `${label} (Recommended)` : label
							}
							onSelect={onSelect}
						/>
					</Popover.Popup>
				</Popover.Positioner>
			</Popover.Portal>
		</Popover.Root>
	);
}

function EffortHelp() {
	return (
		<PreviewCard.Root>
			<PreviewCard.Trigger
				render={<button type="button" />}
				aria-label="About effort"
				className="ml-auto inline-flex size-4 shrink-0 items-center justify-center rounded-full text-[var(--menu-muted)] outline-none hover:text-primary focus-visible:shadow-[0_0_0_2px_var(--accent-100)] pointer-coarse:hidden"
			>
				<CircleQuestionMark aria-hidden="true" className="size-4" />
			</PreviewCard.Trigger>
			<PreviewCard.Portal>
				<PreviewCard.Positioner side="top" sideOffset={6} className="z-[140]">
					<PreviewCard.Popup
						data-effort-help=""
						className="flex w-[220px] flex-col gap-1 rounded-r7 bg-[var(--menu-bg)] p-3 text-[12px]/[15px] text-primary shadow-[var(--menu-shadow)] outline-none"
					>
						<p className="font-medium">Effort</p>
						<p className="text-[var(--menu-muted)]">{EFFORT_HELP}</p>
					</PreviewCard.Popup>
				</PreviewCard.Positioner>
			</PreviewCard.Portal>
		</PreviewCard.Root>
	);
}

/**
 * Upstream's stepped slider: a native range input (arrow keys, dragging) stretched invisibly over a drawn track
 * with a 3px dot per stop, each naming its level on hover and picking it on press, a 16px pill thumb, and a
 * "Recommended" caption under High.
 */
function EffortSlider({
	index,
	valueText,
	onSelect,
}: {
	index: number;
	valueText: string;
	onSelect: (effort: EffortLevel) => void;
}) {
	const thumbLeft = effortStopLeft(index);
	return (
		<div className="flex flex-col">
			<div data-effort-slider="" className="relative h-6 w-full">
				<div className="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-alpha-2" />
				<div
					className="absolute left-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-[var(--accent-100)]"
					style={{width: thumbLeft}}
				/>
				<input
					type="range"
					aria-label="Effort"
					min={0}
					max={EFFORT_LEVELS.length - 1}
					step={1}
					value={index}
					aria-valuetext={valueText}
					onChange={(event) => {
						const picked = EFFORT_LEVELS[Number(event.target.value)];
						if (picked !== undefined) onSelect(picked);
					}}
					className="peer absolute inset-0 m-0 size-full cursor-pointer opacity-0"
				/>
				<span
					aria-hidden="true"
					className="pointer-events-none absolute top-1/2 h-5 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white shadow-[0_0_0_0.5px_rgb(11_11_11/0.15),0_1px_3px_rgb(11_11_11/0.2)] peer-focus-visible:shadow-[0_0_0_2px_var(--accent-100)]"
					style={{left: thumbLeft}}
				/>
				{EFFORT_LEVELS.map((stop, stopIndex) => (
					<span
						key={stop}
						className={`absolute top-1/2 -translate-x-1/2 -translate-y-1/2 ${stopIndex === index ? "pointer-events-none" : ""}`}
						style={{left: effortStopLeft(stopIndex)}}
					>
						<Tooltip content={effortLevelShortLabels[stop]}>
							<span
								data-effort-tick=""
								aria-hidden="true"
								onPointerDown={(event) => {
									event.preventDefault();
									onSelect(stop);
								}}
								className="flex size-3 cursor-pointer items-center justify-center"
							>
								<span
									className={`size-[3px] rounded-full bg-current opacity-25 ${stopIndex === index ? "invisible" : ""}`}
								/>
							</span>
						</Tooltip>
					</span>
				))}
			</div>
			<div className="relative h-[15px]">
				<span
					data-effort-recommended=""
					className="absolute top-0 -translate-x-1/2 text-[12px]/[15px] whitespace-nowrap text-[var(--menu-muted)]"
					style={{left: effortStopLeft(EFFORT_LEVELS.indexOf(RECOMMENDED_EFFORT))}}
				>
					Recommended
				</span>
			</div>
		</div>
	);
}
