import {Dialog} from "@base-ui/react/dialog";
import {type FocusEvent, type RefObject, type SubmitEvent, useRef, useState} from "react";
import {DensityScope} from "./ui/density";

const BUTTON_BASE_CLASS =
	"h-8 rounded-r6 px-3 text-body font-medium transition-colors hide-focus-ring focus-visible:outline-hidden focus-visible:shadow-focus";

/**
 * claude.ai/code's small "Rename session" dialog (`vo`, opened from the ⌘K row card as
 * `CodeSessionRenameDialog`): no close X, one name field holding the current title with initial focus and
 * its text selected on first focus, Cancel, and a primary Save disabled while the name is blank. Saving a
 * blank or unchanged name only closes it.
 */
export function SessionRenameDialog({
	open,
	initialName,
	onClose,
	onRename,
	onClosed,
	finalFocus,
}: {
	open: boolean;
	initialName: string;
	onClose: () => void;
	/** Called with the trimmed name when it is non-blank and differs from `initialName`. */
	onRename: (name: string) => void;
	/** Called once the close animation has finished. */
	onClosed?: () => void;
	/** Where focus goes once the dialog closes. */
	finalFocus?: RefObject<HTMLElement | null>;
}) {
	const [name, setName] = useState(initialName);
	const inputRef = useRef<HTMLInputElement>(null);
	const selectedRef = useRef(false);
	const trimmed = name.trim();

	const submit = (event: SubmitEvent<HTMLFormElement>) => {
		event.preventDefault();
		if (trimmed === "") return;
		if (trimmed !== initialName) onRename(trimmed);
		onClose();
	};

	const selectOnFirstFocus = (event: FocusEvent<HTMLInputElement>) => {
		if (selectedRef.current) return;
		selectedRef.current = true;
		event.currentTarget.select();
	};

	return (
		<Dialog.Root
			open={open}
			onOpenChange={(isOpen) => {
				if (!isOpen) onClose();
			}}
			onOpenChangeComplete={(isOpen) => {
				if (!isOpen) onClosed?.();
			}}
		>
			<Dialog.Portal>
				<DensityScope density="comfortable">
					<Dialog.Backdrop className="fixed inset-0 z-50 bg-backdrop backdrop-blur-[2px] transition-opacity duration-200 ease-out data-[ending-style]:opacity-0 data-[starting-style]:opacity-0 motion-reduce:transition-none" />
					<Dialog.Popup
						initialFocus={inputRef}
						{...(finalFocus === undefined ? {} : {finalFocus})}
						className="fixed top-1/2 left-1/2 z-50 flex max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] max-w-[400px] -translate-x-1/2 -translate-y-1/2 flex-col rounded-card bg-surface-3 text-body text-primary shadow-panel-lg outline-none transition-[opacity,scale] duration-200 ease-out data-[ending-style]:scale-[0.98] data-[ending-style]:opacity-0 data-[starting-style]:scale-[0.98] data-[starting-style]:opacity-0 motion-reduce:transition-none"
					>
						<form className="flex min-h-0 flex-1 flex-col p-6" onSubmit={submit}>
							<Dialog.Title className="mb-4 text-[17px] leading-6 font-semibold break-words text-primary">
								Rename session
							</Dialog.Title>
							<div className="grid gap-2">
								<input
									ref={inputRef}
									type="text"
									data-testid="name-session"
									dir="auto"
									value={name}
									onChange={(event) => {
										setName(event.target.value);
									}}
									onFocus={selectOnFirstFocus}
									aria-label="Rename session"
									autoComplete="off"
									className="h-8 w-full rounded-r6 border border-strong bg-surface-1 px-2.5 text-body text-primary outline-none placeholder:text-t6 focus:border-accent-100/60"
								/>
							</div>
							<div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
								<button
									type="button"
									onClick={onClose}
									className={`${BUTTON_BASE_CLASS} border border-strong text-primary hover:bg-fill-ghost-hover`}
								>
									Cancel
								</button>
								<button
									type="submit"
									data-testid="name-session-submit"
									disabled={trimmed === ""}
									className={`${BUTTON_BASE_CLASS} bg-fill-primary text-on-primary hover:bg-fill-primary-hover disabled:pointer-events-none disabled:opacity-50`}
								>
									Save
								</button>
							</div>
						</form>
					</Dialog.Popup>
				</DensityScope>
			</Dialog.Portal>
		</Dialog.Root>
	);
}
