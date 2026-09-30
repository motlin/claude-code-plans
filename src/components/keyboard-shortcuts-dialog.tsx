import {Dialog} from "@base-ui/react/dialog";
import {X} from "lucide-react";
import {useCallback, useRef, useSyncExternalStore} from "react";

import {useIsMac, useIsWindows} from "../hooks/use-is-mac";
import {useShortcut} from "../hooks/use-shortcut";
import {bindingsFor} from "../lib/shortcuts/match";
import {bindingToKeys, SHORTCUT_IDS, SHORTCUTS, type ShortcutGroup, type ShortcutId} from "../lib/shortcuts/registry";
import {Shortcut} from "./ui/shortcut";

const SECTION_TITLES = {
	general: "General",
	panes: "Panes",
	composer: "Composer",
} as const satisfies Record<ShortcutGroup, string>;

const SECTION_ORDER = Object.keys(SECTION_TITLES) as ShortcutGroup[];

export interface ShortcutSection {
	title: string;
	ids: ShortcutId[];
}

/** Registry ids grouped General → Panes → Composer in registry order, skipping empty groups. */
export function shortcutSections(ids: readonly ShortcutId[], include: (id: ShortcutId) => boolean): ShortcutSection[] {
	return SECTION_ORDER.map((group) => ({
		title: SECTION_TITLES[group],
		ids: ids.filter((id) => SHORTCUTS[id].group === group && include(id)),
	})).filter((section) => section.ids.length > 0);
}

let open = false;
const listeners = new Set<() => void>();

export function setKeyboardShortcutsOpen(next: boolean): void {
	if (open === next) return;
	open = next;
	for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
	listeners.add(listener);
	return () => listeners.delete(listener);
}

function getOpen(): boolean {
	return open;
}

function getServerOpen(): boolean {
	return false;
}

function ShortcutRow({id, isMac, isWindows}: {id: ShortcutId; isMac: boolean; isWindows: boolean}) {
	const definition = SHORTCUTS[id];
	const binding = bindingsFor(id, isMac, isWindows)[0];
	const keys =
		"displayKeys" in definition
			? definition.displayKeys
			: binding === undefined
				? undefined
				: bindingToKeys(binding);
	return (
		<div className="flex items-center justify-between border-b-[0.5px] border-border py-2 last:border-0">
			<span className="flex items-center gap-2 text-sm text-secondary">{definition.description}</span>
			<span className="flex items-center gap-2">{keys === undefined ? null : <Shortcut keys={keys} />}</span>
		</div>
	);
}

/** The upstream ⌘/ Keyboard shortcuts modal, listing only shortcuts wired locally. */
export function KeyboardShortcutsDialog() {
	const isOpen = useSyncExternalStore(subscribe, getOpen, getServerOpen);
	const isMac = useIsMac();
	const isWindows = useIsWindows();
	const returnFocusRef = useRef<HTMLElement | null>(null);

	if (isOpen && returnFocusRef.current === null) {
		const active = document.activeElement;
		if (active instanceof HTMLElement && active !== document.body) returnFocusRef.current = active;
	}

	useShortcut(
		"shortcuts_modal",
		(event) => {
			event.stopImmediatePropagation();
			event.stopPropagation();
			setKeyboardShortcutsOpen(true);
		},
		{allowInModal: true},
	);

	const finalFocus = useCallback(() => {
		const target = returnFocusRef.current;
		returnFocusRef.current = null;
		return target !== null && target.isConnected ? target : true;
	}, []);

	const sections = shortcutSections(
		SHORTCUT_IDS,
		(id) => SHORTCUTS[id].enabled && !("hiddenFromDialog" in SHORTCUTS[id]),
	);

	return (
		<Dialog.Root open={isOpen} onOpenChange={setKeyboardShortcutsOpen}>
			<Dialog.Portal>
				<Dialog.Backdrop className="fixed inset-0 z-50 bg-backdrop backdrop-blur-[2px] transition-opacity duration-200 ease-out data-[ending-style]:opacity-0 data-[starting-style]:opacity-0 motion-reduce:transition-none" />
				<Dialog.Popup
					finalFocus={finalFocus}
					className="fixed top-1/2 left-1/2 z-50 flex max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] max-w-[520px] -translate-x-1/2 -translate-y-1/2 flex-col rounded-card bg-surface-3 text-body text-primary shadow-panel-lg outline-none transition-[opacity,scale] duration-200 ease-out data-[ending-style]:scale-[0.98] data-[ending-style]:opacity-0 data-[starting-style]:scale-[0.98] data-[starting-style]:opacity-0 motion-reduce:transition-none motion-reduce:data-[ending-style]:scale-100 motion-reduce:data-[starting-style]:scale-100"
				>
					<div className="isolate flex min-h-0 flex-1 flex-col overflow-y-auto rounded-[inherit] p-6">
						<div className="-mx-6 -mt-6 mb-3 flex h-[47px] shrink-0 items-center gap-1 border-b-[0.5px] border-strong bg-alpha-1 px-2">
							<Dialog.Title className="min-w-0 truncate px-1.5 text-[15px] leading-5 font-[580] text-primary">
								Keyboard shortcuts
							</Dialog.Title>
							<div className="flex-1" />
							<Dialog.Close
								aria-label="Close"
								className="flex aspect-square h-8 w-8 shrink-0 items-center justify-center rounded-r6 text-primary transition-colors hover:bg-fill-ghost-hover focus-visible:shadow-[0_0_0_2px_var(--accent-100)] focus-visible:outline-none"
							>
								<X aria-hidden="true" className="h-5 w-5" />
							</Dialog.Close>
						</div>
						<div
							role="region"
							aria-label="Keyboard shortcuts"
							tabIndex={0}
							className="-mx-6 -mb-6 min-h-0 flex-1 overflow-y-auto rounded-b-[inherit] px-6 pb-6 focus-visible:ring-2 focus-visible:ring-[var(--accent-100)] focus-visible:outline-none focus-visible:ring-inset"
						>
							{sections.map((section) => (
								<div key={section.title}>
									<div className="mt-5 py-2 text-body">{section.title}</div>
									{section.ids.map((id) => (
										<ShortcutRow key={id} id={id} isMac={isMac} isWindows={isWindows} />
									))}
								</div>
							))}
						</div>
					</div>
				</Dialog.Popup>
			</Dialog.Portal>
		</Dialog.Root>
	);
}
