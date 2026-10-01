import {Popover} from "@base-ui/react/popover";
import {type KeyboardEvent, useState} from "react";

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
import {effortLevelLabels} from "../lib/schema-choices";
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

/*
 * The claude.ai/code chin menus (⌥⌘M mode, ⇧⌘I model, ⇧⌘E effort). A choice
 * applies to the next fork or launch as a `claude` CLI flag.
 */

export const CHIN_BUTTON_CLASS =
	"flex h-5 min-w-0 items-center justify-center rounded-r5 text-secondary transition-colors hover:bg-fill-ghost-hover hover:text-primary focus-visible:shadow-[0_0_0_2px_var(--accent-100)] focus-visible:outline-none";

const CHIN_TRIGGER_CLASS = `${CHIN_BUTTON_CLASS} truncate px-1.5`;

const EFFORT_POPUP_CLASS =
	"flex w-[220px] max-w-[320px] flex-col gap-2 rounded-card bg-[var(--menu-bg)] p-3 text-[12px]/[16px] text-primary shadow-[var(--menu-shadow)] outline-none";

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
	return (
		<>
			<Menu open={open} onOpenChange={onOpenChange}>
				<MenuTrigger data-chin-mode="" className={CHIN_TRIGGER_CLASS}>
					{currentLabel}
				</MenuTrigger>
				<MenuContent side="top" className="w-[280px]">
					<MenuLabel>Mode</MenuLabel>
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
	return (
		<Menu open={open} onOpenChange={onOpenChange}>
			<MenuTrigger data-cds="ModelSelector" aria-label={`Model: ${currentLabel}`} className={CHIN_TRIGGER_CLASS}>
				{currentLabel}
			</MenuTrigger>
			<MenuContent side="top" align="end">
				<MenuRadioGroup
					value={primaryModelMenuValue(current)}
					onValueChange={(value: string) => onSelect(value)}
				>
					{PRIMARY_MODELS.map((model, index) => (
						<MenuRadioItem key={model.id} value={model.id} accelerator={String(index + 1)} closeOnClick>
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
			<Popover.Trigger
				data-cds="ModelSelectorEffort"
				aria-label={`Effort: ${label}`}
				className={CHIN_TRIGGER_CLASS}
			>
				{label}
			</Popover.Trigger>
			<Popover.Portal>
				<Popover.Positioner side="top" align="end" sideOffset={6} className="z-[130]">
					<Popover.Popup
						data-cds="ModelSelectorEffort"
						className={EFFORT_POPUP_CLASS}
						onKeyDown={handleKeyDown}
					>
						<div className="flex items-baseline gap-1.5">
							<Popover.Title className="font-normal text-[var(--menu-muted)]">Effort</Popover.Title>
							<span data-effort-current="" className="font-medium">
								{label}
							</span>
						</div>
						<div
							data-effort-captions=""
							className="flex justify-between text-[12px]/[15px] text-[var(--menu-muted)]"
						>
							<span>Faster</span>
							<span>Smarter</span>
						</div>
						<input
							type="range"
							aria-label="Effort"
							min={0}
							max={EFFORT_LEVELS.length - 1}
							step={1}
							value={index}
							aria-valuetext={label}
							onChange={(event) => {
								const picked = EFFORT_LEVELS[Number(event.target.value)];
								if (picked !== undefined) onSelect(picked);
							}}
							className="w-full accent-[var(--accent-100)]"
						/>
					</Popover.Popup>
				</Popover.Positioner>
			</Popover.Portal>
		</Popover.Root>
	);
}
