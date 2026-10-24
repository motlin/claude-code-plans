import {Dialog} from "@base-ui/react/dialog";
import {X} from "lucide-react";
import {useCallback, useRef, useState} from "react";

import {type RewindTurn, rewindLabel} from "../lib/rewind-picker";

export interface RewindPickerProps {
	open: boolean;
	/** The prompts to offer, oldest first. */
	turns: readonly RewindTurn[];
	onClose: () => void;
	/** Runs after the picker closes, with the picked prompt's uuid and full text. */
	onSelect: (uuid: string, text: string) => void;
}

const OPTION_CLASS = "rounded-r4 px-[6px] py-[5px]";

/**
 * claude.ai/code's Rewind picker (`rce`): a "Rewind session" dialog listing
 * the session's prompts with the newest selected. ArrowUp/ArrowDown move the
 * selection (clamped) and focus the list, Enter picks while focus is in it,
 * hovering selects and clicking picks.
 */
export function RewindPicker({open, turns, onClose, onSelect}: RewindPickerProps) {
	const last = Math.max(turns.length - 1, 0);
	const [selected, setSelected] = useState(last);
	const listRef = useRef<HTMLUListElement>(null);

	// Each opening starts on the newest prompt; a transcript update while open keeps the selection.
	const [wasOpen, setWasOpen] = useState(open);
	if (wasOpen !== open) {
		setWasOpen(open);
		if (open) setSelected(last);
	}

	// The selected row scrolls into view as it mounts with the dialog and on each move.
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
			setSelected((index) => Math.min(index + 1, last));
		} else if (event.key === "ArrowUp") {
			event.preventDefault();
			listRef.current?.focus();
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
				<Dialog.Popup
					aria-label="Rewind session"
					data-cds="Dialog"
					initialFocus={listRef}
					onKeyDown={onKeyDown}
					className="epitaxy-root fixed top-1/2 left-1/2 z-50 flex max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] max-w-[32rem] -translate-x-1/2 -translate-y-1/2 flex-col break-words rounded-card bg-surface-3 text-body text-primary shadow-panel-lg outline-none transition-[opacity,scale] duration-200 ease-out data-[ending-style]:scale-[0.98] data-[ending-style]:opacity-0 data-[starting-style]:scale-[0.98] data-[starting-style]:opacity-0 motion-reduce:transition-none motion-reduce:data-[ending-style]:scale-100 motion-reduce:data-[starting-style]:scale-100"
				>
					<div className="isolate flex min-h-0 flex-1 flex-col overflow-y-auto rounded-[inherit] p-5">
						<div className="mb-3 flex items-start gap-2">
							<div className="-mt-1 flex min-w-0 flex-1 flex-col gap-1">
								<Dialog.Title className="text-[20px]/[25px] font-semibold break-words text-primary">
									Rewind
								</Dialog.Title>
								<Dialog.Description className="text-body text-secondary">
									Restore the session to an earlier message.
								</Dialog.Description>
							</div>
							<Dialog.Close
								aria-label="Close"
								className="-me-[6px] -mt-[6px] flex aspect-square h-8 w-8 shrink-0 items-center justify-center rounded-r6 text-primary transition-colors hover:bg-fill-ghost-hover hide-focus-ring focus-visible:outline-hidden focus-visible:shadow-focus"
							>
								<X aria-hidden="true" className="h-5 w-5" />
							</Dialog.Close>
						</div>
						<ul
							ref={listRef}
							role="listbox"
							aria-activedescendant={turns.length === 0 ? undefined : `rewind-opt-${current}`}
							tabIndex={-1}
							className="-mx-5 -mb-5 flex max-h-[calc(50vh+20px)] flex-col gap-[3px] overflow-y-auto px-5 pb-5 outline-none"
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
										data-idx={index}
										role="option"
										aria-selected={index === current}
										ref={index === current ? scrollSelectedIntoView : undefined}
										className={`${OPTION_CLASS} ${index === current ? "bg-fill-ghost-hover text-primary" : "text-secondary"}`}
										onMouseEnter={() => {
											setSelected(index);
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
				</Dialog.Popup>
			</Dialog.Portal>
		</Dialog.Root>
	);
}
