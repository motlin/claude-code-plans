import {Dialog} from "@base-ui/react/dialog";
import {X} from "lucide-react";
import {Fragment, useCallback, useRef, useSyncExternalStore} from "react";

import {useIsMac, useIsWindows} from "../hooks/use-is-mac";
import {useShortcut} from "../hooks/use-shortcut";
import {platformBindings} from "../lib/shortcuts/match";
import {bindingToKeys, SHORTCUT_IDS, SHORTCUTS, type ShortcutDefinition} from "../lib/shortcuts/registry";
import {Shortcut} from "./ui/shortcut";
import {shortcutSections} from "./keyboard-shortcut-sections";
import {
	getKeyboardShortcutsOpen,
	getServerKeyboardShortcutsOpen,
	setKeyboardShortcutsOpen,
	subscribeKeyboardShortcutsOpen,
} from "./keyboard-shortcuts-open";
import {DensityScope} from "./ui/density";

function rowKeys(definition: ShortcutDefinition, isMac: boolean, isWindows: boolean): string[] {
	if (definition.displayKeys !== undefined) return [definition.displayKeys];
	const keys = platformBindings(definition, isMac, isWindows).map(bindingToKeys);
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
}) {
	return (
		<div className="flex items-center justify-between border-b-[0.5px] border-border py-2 last:border-0">
			<span className="flex items-center gap-2 text-sm text-secondary">{definition.description}</span>
			<span className="flex items-center gap-2">
				{rowKeys(definition, isMac, isWindows).map((keys, index) => (
					<Fragment key={keys}>
						{index > 0 && (
							<span aria-hidden="true" className="text-xs text-muted-as-secondary">
								or
							</span>
						)}
						<Shortcut keys={keys} />
					</Fragment>
				))}
			</span>
		</div>
	);
}

/** The upstream ⌘/ Keyboard shortcuts modal, listing only shortcuts wired locally. */
export function KeyboardShortcutsDialog() {
	const isOpen = useSyncExternalStore(
		subscribeKeyboardShortcutsOpen,
		getKeyboardShortcutsOpen,
		getServerKeyboardShortcutsOpen,
	);
	const isMac = useIsMac();
	const isWindows = useIsWindows();
	const returnFocusRef = useRef<HTMLElement | null>(null);
	const popupRef = useRef<HTMLDivElement>(null);

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
		return target?.isConnected === true ? target : true;
	}, []);

	const sections = shortcutSections(
		SHORTCUT_IDS,
		(id) => SHORTCUTS[id].enabled && !("hiddenFromDialog" in SHORTCUTS[id]),
	);

	return (
		<Dialog.Root open={isOpen} onOpenChange={setKeyboardShortcutsOpen}>
			<Dialog.Portal>
				<DensityScope density="comfortable">
					<Dialog.Backdrop className="fixed inset-0 z-50 bg-backdrop transition-opacity duration-200 ease-out data-[ending-style]:opacity-0 data-[starting-style]:opacity-0 motion-reduce:transition-none" />
					<Dialog.Popup
						ref={popupRef}
						initialFocus={popupRef}
						finalFocus={finalFocus}
						tabIndex={-1}
						data-cds="Dialog"
						data-perf-overlay="keyboard_shortcuts_dialog"
						className="fixed top-1/2 left-1/2 z-50 flex h-dvh max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] max-w-[520px] -translate-x-1/2 -translate-y-1/2 flex-col rounded-card bg-surface-3 text-body text-primary shadow-panel-lg outline-none transition-[opacity,scale] duration-200 ease-out data-[ending-style]:scale-[0.98] data-[ending-style]:opacity-0 data-[starting-style]:scale-[0.98] data-[starting-style]:opacity-0 motion-reduce:transition-none motion-reduce:data-[ending-style]:scale-100 motion-reduce:data-[starting-style]:scale-100"
					>
						<div className="isolate flex min-h-0 flex-1 flex-col overflow-y-auto rounded-[inherit] p-6">
							{/* Upstream forces data-density="comfortable" on this dialog for every user, so
								these fixed 24/12/8/32px values hold at the default density too. */}
							<div className="mb-3 flex items-start gap-2">
								<div className="-mt-1 flex min-w-0 flex-1 flex-col gap-1">
									<Dialog.Title className="text-[22px]/[28px] font-[580] break-words text-primary">
										Keyboard shortcuts
									</Dialog.Title>
								</div>
								<Dialog.Close
									aria-label="Close"
									className="-me-2 -mt-2 flex aspect-square h-8 w-8 shrink-0 items-center justify-center rounded-r6 text-primary transition-colors hover:bg-fill-ghost-hover hide-focus-ring focus-visible:outline-hidden focus-visible:shadow-focus"
								>
									<X aria-hidden="true" className="h-5 w-5" />
								</Dialog.Close>
							</div>
							<div
								role="region"
								aria-label="Keyboard shortcuts"
								// oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- a scrollable region needs focus for keyboard scrolling
								tabIndex={0}
								className="-mx-6 -mb-6 min-h-0 flex-1 overflow-y-auto rounded-b-[inherit] px-6 pb-6 hide-focus-ring focus-visible:outline-hidden focus-visible:shadow-[inset_0_0_0_1px_var(--color-accent-100),inset_0_0_6px_1px_color-mix(in_srgb,var(--color-accent-100)_20%,transparent)]"
							>
								{sections.map((section) => (
									<div key={section.title}>
										<div className="mt-5 py-2 text-body">{section.title}</div>
										{section.ids.map((id) => (
											<ShortcutRow
												key={id}
												definition={SHORTCUTS[id]}
												isMac={isMac}
												isWindows={isWindows}
											/>
										))}
									</div>
								))}
							</div>
						</div>
					</Dialog.Popup>
				</DensityScope>
			</Dialog.Portal>
		</Dialog.Root>
	);
}
