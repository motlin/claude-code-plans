import {Dialog} from "@base-ui/react/dialog";
import {useCallback, useRef, useState} from "react";

import {usePointerHoverSelect} from "../hooks/use-pointer-hover-select";
import {type RewindTurn, rewindLabel} from "../lib/rewind-picker";
import {useDialogBandBodyClass} from "./ui/dialog-band";
import {DialogHeader} from "./ui/dialog-header";
import {useDialogPad} from "./ui/dialog-pad";
import {DialogPopup} from "./ui/dialog-popup";

export interface RewindPickerProps {
	open: boolean;
	/** The prompts to offer, oldest first. */
	turns: readonly RewindTurn[];
	onClose: () => void;
	/** Runs after the picker closes, with the picked prompt's uuid and full text. */
	onSelect: (uuid: string, text: string) => void;
}

// `last:scroll-mb-(--cds-pad-xl)` = 16px under panels (`_z`), 20px pre-rollout: a keyboard move to the
// last row keeps the list's bottom padding in view.
const optionClass = (scrollMb: string) => `rounded-r4 px-[6px] py-[5px] ${scrollMb}`;

/**
 * claude.ai/code's Rewind picker (`rce`): a "Rewind session" dialog listing
 * the session's prompts with the newest selected. ArrowUp/ArrowDown move the
 * selection (clamped) and focus the list, Enter picks while focus is in it,
 * a pointer that has moved selects (without scrolling) and clicking picks.
 */
export function RewindPicker({open, turns, onClose, onSelect}: RewindPickerProps) {
	const last = Math.max(turns.length - 1, 0);
	const [selected, setSelected] = useState(last);
	// Upstream's `reveal`: the initial open and keyboard moves scroll the selection into view; hovers don't.
	const [reveal, setReveal] = useState(true);
	const listRef = useRef<HTMLUListElement>(null);
	const pad = useDialogPad({compactOrigin: true});
	const bandBody = useDialogBandBodyClass();

	// Each opening starts on the newest prompt; a transcript update while open keeps the selection.
	const [wasOpen, setWasOpen] = useState(open);
	if (wasOpen !== open) {
		setWasOpen(open);
		if (open) {
			setSelected(last);
			setReveal(true);
		}
	}
	const hoverSelect = useCallback((index: number) => {
		setSelected(index);
		setReveal(false);
	}, []);
	const pointer = usePointerHoverSelect(hoverSelect);

	// The selected row scrolls into view as it mounts with the dialog and on each keyboard move.
	const scrollSelectedIntoView = useCallback((row: HTMLLIElement | null) => {
		row?.scrollIntoView({block: "nearest"});
	}, []);

	const pick = (index: number) => {
		const turn = turns[index];
		onClose();
		if (turn !== undefined) onSelect(turn.uuid, turn.text);
	};

	const onKeyDown = (event: React.KeyboardEvent) => {
		if (event.key === "ArrowDown") {
			event.preventDefault();
			listRef.current?.focus();
			setReveal(true);
			setSelected((index) => Math.min(index + 1, last));
		} else if (event.key === "ArrowUp") {
			event.preventDefault();
			listRef.current?.focus();
			setReveal(true);
			setSelected((index) => Math.max(index - 1, 0));
		} else if (event.key === "Enter") {
			if (!(event.target instanceof Node && listRef.current?.contains(event.target))) return;
			event.preventDefault();
			pick(Math.min(selected, last));
		}
	};

	const current = Math.min(selected, last);
	return (
		<Dialog.Root
			open={open}
			onOpenChange={(next) => {
				if (!next) onClose();
			}}
		>
			<Dialog.Portal>
				<Dialog.Backdrop className="fixed inset-0 z-50 bg-backdrop transition-opacity duration-200 ease-out data-[ending-style]:opacity-0 data-[starting-style]:opacity-0 motion-reduce:transition-none" />
				<DialogPopup
					aria-label="Rewind session"
					initialFocus={listRef}
					onKeyDown={onKeyDown}
					className="epitaxy-root fixed top-1/2 left-1/2 z-50 flex max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] max-w-[32rem] -translate-x-1/2 -translate-y-1/2 flex-col break-words rounded-card bg-surface-3 text-body text-primary shadow-panel-lg outline-none transition-[opacity,scale] duration-200 ease-out data-[ending-style]:scale-[0.98] data-[ending-style]:opacity-0 data-[starting-style]:scale-[0.98] data-[starting-style]:opacity-0 motion-reduce:transition-none motion-reduce:data-[ending-style]:scale-100 motion-reduce:data-[starting-style]:scale-100"
				>
					<div
						className={`isolate flex min-h-0 flex-1 flex-col overflow-y-auto rounded-[inherit] ${pad.p} ${bandBody}`}
					>
						<DialogHeader
							title="Rewind"
							description="Restore the session to an earlier message."
							offTitleClassName="text-[20px]/[25px] font-semibold break-words text-primary"
						/>
						<ul
							ref={listRef}
							role="listbox"
							aria-activedescendant={turns.length === 0 ? undefined : `rewind-opt-${current}`}
							tabIndex={-1}
							onMouseMove={pointer.recordPointer}
							onMouseLeave={pointer.forgetPointer}
							className={`${pad.mx} ${pad.mb} flex ${pad.maxHList} flex-col gap-[3px] overflow-y-auto ${pad.px} ${pad.pb} outline-none`}
						>
							{turns.length === 0 ? (
								<li
									role="presentation"
									className="text-body text-muted-as-secondary italic px-[6px] py-[5px]"
								>
									Nothing to rewind to yet
								</li>
							) : (
								turns.map((turn, index) => (
									// oxlint-disable-next-line jsx-a11y/click-events-have-key-events -- the listbox handles the keys, as upstream's does
									<li
										key={turn.uuid}
										id={`rewind-opt-${index}`}
										role="option"
										aria-selected={index === current}
										ref={reveal && index === current ? scrollSelectedIntoView : undefined}
										className={`${optionClass(pad.scrollMb)} ${index === current ? "bg-fill-ghost-hover text-primary" : "text-secondary"}`}
										onMouseMove={(event) => {
											pointer.hoverSelect(index, event);
										}}
										onClick={() => {
											pick(index);
										}}
									>
										<div className="text-body truncate">{rewindLabel(turn.text)}</div>
									</li>
								))
							)}
						</ul>
					</div>
				</DialogPopup>
			</Dialog.Portal>
		</Dialog.Root>
	);
}
