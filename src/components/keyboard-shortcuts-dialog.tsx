import {Dialog} from "@base-ui/react/dialog";
import {Keyboard} from "lucide-react";
import {Fragment, useCallback, useEffect, useId, useRef, useState, useSyncExternalStore, type RefObject} from "react";

import {useIsMac, useIsWindows} from "../hooks/use-is-mac";
import {useShortcut} from "../hooks/use-shortcut";
import {platformBindings} from "../lib/shortcuts/match";
import {bindingToKeys, SHORTCUT_IDS, SHORTCUTS, type ShortcutDefinition} from "../lib/shortcuts/registry";
import
{
	chordFromEvent,
	chordLabel,
	shortcutMatcher,
	type ShortcutFind,
	stripChordPrefix,
} from "../lib/shortcuts/search";
import {Kbd, Shortcut} from "./ui/shortcut";
import {shortcutSections} from "./keyboard-shortcut-sections";
import
{
	getKeyboardShortcutsOpen,
	getServerKeyboardShortcutsOpen,
	setKeyboardShortcutsOpen,
	subscribeKeyboardShortcutsOpen,
} from "./keyboard-shortcuts-open";
import {DensityScope} from "./ui/density";
import {GHOST_ICON_BUTTON} from "./ui/dialog-band";
import {DialogHeader} from "./ui/dialog-header";
import {DialogPopup} from "./ui/dialog-popup";
import {Icon} from "./ui/icon";
import {TextInput} from "./ui/text-input";

function rowKeys(definition: ShortcutDefinition, isMac: boolean, isWindows: boolean): string[]
{
	const keys = platformBindings(definition, isMac, isWindows).map(bindingToKeys);
	// Upstream hides a row whose keys resolve empty on this platform.
	if (keys.length === 0) return [];
	const {displayKeys} = definition;
	if (typeof displayKeys === "string") return [displayKeys];
	if (displayKeys !== undefined) return [isMac ? displayKeys.mac : displayKeys.nonMac];
	return definition.dialogShowsAllBindings === true ? keys : keys.slice(0, 1);
}

/** One dialog row; several bindings render as separate Shortcuts joined by upstream's "or". */
export function ShortcutRow({
	definition,
	isMac,
	isWindows,
}: {
	definition: ShortcutDefinition;
	isMac: boolean;
	isWindows: boolean;
})
{
	const keys = rowKeys(definition, isMac, isWindows);
	if (keys.length === 0) return null;
	return (
		<li className="relative flex items-center justify-between border-b-[0.5px] border-border py-2 last:border-0">
			<span className="flex items-center gap-2 text-sm text-secondary">{definition.description}</span>
			<NbspGap />
			<span className="flex items-center gap-2">
				{keys.map((rowKey, index) => (
					<Fragment key={rowKey}>
						{index > 0 && (
							<span className="text-caption text-muted-as-secondary">
								<NbspGap />
								or
								<NbspGap />
							</span>
						)}
						<Shortcut keys={rowKey} />
					</Fragment>
				))}
			</span>
		</li>
	);
}

/** Upstream's sr-only non-breaking space, so screen readers read "label, keys" apart. */
function NbspGap()
{
	return <span className="sr-only select-none">{"\u00a0"}</span>;
}

const TEXT_FIND: ShortcutFind =
{
	by: "text",
	text: "",
};
const PRESS_FIND: ShortcutFind =
{
	by: "press",
	pressed: null,
};

/**
 * Upstream's Search shortcuts toolbar (`Vt`): a text filter plus a Record keys toggle that turns the
 * next pressed chord into the filter. While recording, key events on the field are swallowed so the
 * chord never fires its shortcut; plain Escape or blur stops recording and keeps the chord.
 */
function ShortcutsSearch({
	find,
	onFind,
	inputRef,
	isMac,
}: {
	find: ShortcutFind;
	onFind: (next: ShortcutFind) => void;
	inputRef: RefObject<HTMLInputElement | null>;
	isMac: boolean;
})
{
	const [recording, setRecording] = useState(false);
	const hintId = useId();
	const chord = find.by === "press" ? find.pressed?.all[0] : undefined;
	const chordText = chord === undefined ? "" : chordLabel(chord, isMac);
	const value = find.by === "text" ? find.text : chordText;

	useEffect(() =>
	{
		const input = inputRef.current;
		if (input === null) return undefined;
		const onKey = (event: KeyboardEvent) =>
		{
			if (!recording)
			{
				// The first Escape clears a query; Base UI's dismiss only sees it once the field is empty.
				if (event.type === "keydown" && event.key === "Escape" && input.value !== "")
				{
					event.preventDefault();
					event.stopPropagation();
					onFind(TEXT_FIND);
				}
				return;
			}
			const modified = event.metaKey || event.ctrlKey || event.altKey;
			if (event.target !== input || event.isComposing || (event.key === "Tab" && !modified)) return;
			event.preventDefault();
			event.stopImmediatePropagation();
			if (event.type !== "keydown" || event.repeat) return;
			if (event.key === "Escape" && !modified && !event.shiftKey)
			{
				setRecording(false);
				return;
			}
			const pressed = chordFromEvent(event, isMac);
			if (pressed !== null)
				onFind(
					{
						by: "press",
						pressed,
					},
				);
		};
		input.addEventListener("keydown", onKey, true);
		input.addEventListener("keyup", onKey, true);
		return () =>
		{
			input.removeEventListener("keydown", onKey, true);
			input.removeEventListener("keyup", onKey, true);
		};
	}, [recording, isMac, onFind, inputRef]);

	return (
		/* Upstream's cds Toolbar has plainWhileEmpty, but this one always holds its search input, so the role never drops; a static role matches. */
		<div
			data-cds="Toolbar"
			data-flush=""
			role="toolbar"
			aria-label="Search"
			className="flex shrink-0 items-center gap-1 py-2"
		>
			<div className="flex min-w-0 flex-1 items-center gap-1 self-stretch">
				<TextInput
					ref={inputRef}
					type="search"
					autoComplete="off"
					aria-label="Search shortcuts"
					aria-describedby={recording ? hintId : undefined}
					placeholder={recording ? "Press a shortcut" : "Search shortcuts"}
					value={value}
					onChange={(event) =>
					{
						setRecording(false);
						onFind(
							{
								by: "text",
								text: stripChordPrefix(
									event.target.value,
									chordText,
									event.target.selectionStart ?? undefined,
								),
							},
						);
					}}
					onBlur={() =>
					{
						setRecording(false);
					}}
					className="flex-1"
					slotStart={<Icon name="Search" size="sm" />}
					slotEnd={
						recording ? (
							<span id={hintId} className="flex items-center gap-2 text-caption">
								<Kbd>Esc</Kbd> to stop
							</span>
						) : undefined
					}
					clearable
					onClear={() =>
					{
						onFind(recording ? PRESS_FIND : TEXT_FIND);
					}}
				/>
			</div>
			<button
				type="button"
				aria-label="Record keys"
				aria-pressed={recording}
				className={`${GHOST_ICON_BUTTON} -me-1 size-7 rounded-r6 aria-pressed:bg-upstream-accent-pressed aria-pressed:text-upstream-accent`}
				onMouseDown={(event) =>
				{
					event.preventDefault();
				}}
				onClick={() =>
				{
					if (!recording) onFind(PRESS_FIND);
					setRecording(!recording);
					inputRef.current?.focus();
				}}
			>
				<Keyboard aria-hidden="true" className="size-5" />
			</button>
		</div>
	);
}

/** The upstream ⌘/ Keyboard shortcuts modal, listing only shortcuts wired locally. */
export function KeyboardShortcutsDialog()
{
	const isOpen = useSyncExternalStore(
		subscribeKeyboardShortcutsOpen,
		getKeyboardShortcutsOpen,
		getServerKeyboardShortcutsOpen,
	);
	const isMac = useIsMac();
	const isWindows = useIsWindows();
	const inputRef = useRef<HTMLInputElement>(null);
	const [find, setFind] = useState<ShortcutFind>(TEXT_FIND);

	useShortcut(
		"shortcuts_modal",
		(event) =>
		{
			event.stopImmediatePropagation();
			event.stopPropagation();
			setKeyboardShortcutsOpen(true);
		},
		{
			allowInModal: true,
		},
	);

	const onOpenChange = useCallback((open: boolean) =>
	{
		setKeyboardShortcutsOpen(open);
		if (!open) setFind(TEXT_FIND);
	}, []);

	const sections = shortcutSections(
		SHORTCUT_IDS,
		(id) =>
			SHORTCUTS[id].enabled &&
			!("hiddenFromDialog" in SHORTCUTS[id]) &&
			rowKeys(SHORTCUTS[id], isMac, isWindows).length > 0,
	);
	const matcher = shortcutMatcher(find, isMac);
	const visible = (id: (typeof SHORTCUT_IDS)[number]) =>
	{
		const definition = SHORTCUTS[id];
		const typedOnly = platformBindings(definition, isMac, isWindows)[0]?.code === undefined;
		return matcher === null || matcher(definition.description, rowKeys(definition, isMac, isWindows), typedOnly);
	};
	const filtered = sections.map((section) => (
	{
		...section,
		visibleIds: section.ids.filter(visible),
	}));
	const count = filtered.reduce((total, section) => total + section.visibleIds.length, 0);
	const chord = find.by === "press" ? find.pressed?.all[0] : undefined;

	return (
		<Dialog.Root open={isOpen} onOpenChange={onOpenChange}>
			<Dialog.Portal>
				<DensityScope density="comfortable">
					<Dialog.Backdrop className="fixed inset-0 z-50 bg-backdrop transition-opacity duration-200 ease-out data-[ending-style]:opacity-0 data-[starting-style]:opacity-0 motion-reduce:transition-none" />
					<DialogPopup
						initialFocus={inputRef}
						tabIndex={-1}
						data-perf-overlay="keyboard_shortcuts_dialog"
						className="fixed top-1/2 left-1/2 z-50 flex h-dvh max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] max-w-[520px] -translate-x-1/2 -translate-y-1/2 flex-col rounded-card bg-surface-3 text-body text-primary shadow-panel-lg outline-none transition-[opacity,scale,filter] duration-200 ease-out data-[ending-style]:scale-[0.98] data-[ending-style]:opacity-0 data-[starting-style]:scale-[0.98] data-[starting-style]:opacity-0 motion-reduce:transition-none motion-reduce:data-[ending-style]:scale-100 motion-reduce:data-[starting-style]:scale-100"
					>
						<div className="isolate flex min-h-0 flex-1 flex-col overflow-y-auto scroll-fade-y rounded-[inherit] p-4 [timeline-scope:--sc-dialog-scroll] [:where([data-cds-tall-window])_&]:scroll-pt-[56px] panels-fine:[:where([data-cds-tall-window])_&]:scroll-pt-[52px]">
							{/* Upstream forces data-density="comfortable" on this dialog for every user, so the band
								shows at every density; local keeps it whatever the panels flag. Its bottom line fades in
								once the list region scrolls (its scroll-timeline, hoisted by timeline-scope). */}
							<DialogHeader title="Keyboard shortcuts" band />
							<ShortcutsSearch find={find} onFind={setFind} inputRef={inputRef} isMac={isMac} />
							<div
								role="region"
								aria-label="Shortcuts"
								// oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- a scrollable region needs focus for keyboard scrolling
								tabIndex={count === 0 ? undefined : 0}
								className="-mx-4 -mb-4 min-h-0 flex-1 overflow-y-auto rounded-b-[inherit] [scroll-timeline:--sc-dialog-scroll_block] px-4 pb-4 hide-focus-ring focus-visible:outline-hidden focus-visible:shadow-[inset_0_0_0_1px_var(--color-accent-100),inset_0_0_6px_1px_color-mix(in_srgb,var(--color-accent-100)_20%,transparent)] scroll-fade-y focus-visible:scroll-fade-hide-top focus-visible:scroll-fade-hide-bottom"
							>
								<div role="status">
									{matcher !== null && (
										<>
											{chord !== undefined && (
												<p className="sr-only">
													<Shortcut keys={chord} />
												</p>
											)}
											{count === 0 ? (
												<p className="pt-7 pb-2 text-body text-muted-as-secondary">
													No matching shortcuts
												</p>
											) : (
												<p className="sr-only">
													{count} {count === 1 ? "shortcut" : "shortcuts"} found
												</p>
											)}
										</>
									)}
								</div>
								{filtered.map((section) => (
									<div
										key={section.title}
										hidden={matcher !== null && section.visibleIds.length === 0}
									>
										<h3 className="text-body-regular mt-5 py-2">{section.title}</h3>
										<ul role="list">
											{section.visibleIds.map((id) => (
												<ShortcutRow
													key={id}
													definition={SHORTCUTS[id]}
													isMac={isMac}
													isWindows={isWindows}
												/>
											))}
										</ul>
									</div>
								))}
							</div>
						</div>
					</DialogPopup>
				</DensityScope>
			</Dialog.Portal>
		</Dialog.Root>
	);
}
