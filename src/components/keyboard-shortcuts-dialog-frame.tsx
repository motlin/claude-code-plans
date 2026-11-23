import {Dialog} from "@base-ui/react/dialog";
import {type ReactNode, type RefObject, useSyncExternalStore} from "react";

import
{
	getKeyboardShortcutsOpen,
	getServerKeyboardShortcutsOpen,
	setKeyboardShortcutsOpen,
	subscribeKeyboardShortcutsOpen,
} from "./keyboard-shortcuts-open";
import {DensityScope} from "./ui/density";
import {useDialogPad} from "./ui/dialog-pad";
import {DialogHeader} from "./ui/dialog-header";
import {DialogPopup} from "./ui/dialog-popup";
import {Skeleton} from "./ui/skeleton";

/**
 * The ⌘/ modal's shell (upstream `jh`, outside its lazy chunk): the backdrop, the popup, its scroller and the
 * "Keyboard shortcuts" band, around the list body.
 */
export function KeyboardShortcutsDialogFrame({
	onOpenChange,
	initialFocus,
	children,
}: {
	onOpenChange: (open: boolean) => void;
	initialFocus?: RefObject<HTMLElement | null>;
	children: ReactNode;
})
{
	const isOpen = useSyncExternalStore(
		subscribeKeyboardShortcutsOpen,
		getKeyboardShortcutsOpen,
		getServerKeyboardShortcutsOpen,
	);
	const {ring} = useDialogPad();
	return (
		<Dialog.Root open={isOpen} onOpenChange={onOpenChange}>
			<Dialog.Portal>
				<DensityScope density="comfortable">
					<Dialog.Backdrop className="fixed inset-0 z-50 bg-backdrop transition-opacity duration-200 ease-out data-[ending-style]:opacity-0 data-[starting-style]:opacity-0 motion-reduce:transition-none" />
					<DialogPopup
						{...(initialFocus === undefined
							? {}
							:
								{
									initialFocus,
								})}
						tabIndex={-1}
						data-perf-overlay="keyboard_shortcuts_dialog"
						className="fixed top-1/2 left-1/2 z-50 flex h-dvh max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] max-w-[520px] -translate-x-1/2 -translate-y-1/2 flex-col rounded-card bg-surface-3 text-body text-primary shadow-panel-lg outline-none transition-[opacity,scale,filter] duration-200 ease-out data-[ending-style]:scale-[0.98] data-[ending-style]:opacity-0 data-[starting-style]:scale-[0.98] data-[starting-style]:opacity-0 motion-reduce:transition-none motion-reduce:data-[ending-style]:scale-100 motion-reduce:data-[starting-style]:scale-100"
					>
						<div
							className={`isolate flex min-h-0 flex-1 flex-col overflow-y-auto scroll-fade-y rounded-[inherit] p-4 ${ring} [timeline-scope:--sc-dialog-scroll] [:where([data-cds-tall-window])_&]:scroll-pt-[56px] panels-fine:[:where([data-cds-tall-window])_&]:scroll-pt-[52px]`}
						>
							{/* Upstream forces data-density="comfortable" on this dialog for every user, so the band
								shows at every density; local keeps it whatever the panels flag. Its bottom line fades in
								once the list region scrolls (its scroll-timeline, hoisted by timeline-scope). */}
							<DialogHeader title="Keyboard shortcuts" band />
							{children}
						</div>
					</DialogPopup>
				</DensityScope>
			</Dialog.Portal>
		</Dialog.Root>
	);
}

/** The shell drawn while the list's chunk downloads, closing through the shared open store. */
export function KeyboardShortcutsLoadingFrame({children}: {children: ReactNode})
{
	return (
		<KeyboardShortcutsDialogFrame onOpenChange={setKeyboardShortcutsOpen}>{children}</KeyboardShortcutsDialogFrame>
	);
}

const ROW_WIDTHS = [176, 132, 208, 152, 120, 188];

/**
 * Upstream `OV`: the list body's skeleton, a search-field bar and three sections of six iconless rows
 * (`Skeleton.Rows rows:[6,6,6]`) in a decorative group that fills the popup.
 */
export function KeyboardShortcutsBodySkeleton()
{
	return (
		<div data-cds="SkeletonGroup" data-motion="wave" aria-hidden="true" className="min-h-0 flex-1 overflow-hidden">
			<Skeleton decorative className="my-1 h-7 w-full" />
			{[0, 1, 2].map((section) => (
				<div key={section} className="mt-5">
					{ROW_WIDTHS.map((width) => (
						<div key={width} className="flex h-9 items-center">
							<Skeleton
								decorative
								className="h-4"
								style={
								{
									width,
								}}
							/>
						</div>
					))}
				</div>
			))}
		</div>
	);
}
