import {Dialog} from "@base-ui/react/dialog";
import {type SubmitEvent, useRef, useState} from "react";
import {DensityScope} from "./ui/density";
import {useDialogBandBodyClass} from "./ui/dialog-band";
import {DialogHeader} from "./ui/dialog-header";
import {DIALOG_FOOTER_CLASS, useDialogPad} from "./ui/dialog-pad";
import {DialogPopup} from "./ui/dialog-popup";

const BUTTON_BASE_CLASS =
	"h-8 rounded-r6 px-3 text-body font-medium transition-colors hide-focus-ring focus-visible:outline-hidden focus-visible:shadow-focus";

/**
 * claude.ai/code's small "New section" dialog (upstream's sections vocabulary `Cg`): no close X, one
 * "Section name" input with initial focus, a note that the section is listed above the other
 * sessions, and a "Create section" button disabled while the name is blank.
 */
export function NewGroupDialog({
	open,
	onOpenChange,
	onCreate,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	/** Called with the trimmed, non-blank name. */
	onCreate: (name: string) => void;
}) {
	const [name, setName] = useState("");
	const inputRef = useRef<HTMLInputElement>(null);
	const trimmed = name.trim();
	const pad = useDialogPad();
	const bandBody = useDialogBandBodyClass();

	const submit = (event: SubmitEvent<HTMLFormElement>) => {
		event.preventDefault();
		if (trimmed === "") return;
		onCreate(trimmed);
		onOpenChange(false);
	};

	return (
		<Dialog.Root
			open={open}
			onOpenChange={onOpenChange}
			onOpenChangeComplete={(isOpen) => {
				if (!isOpen) setName("");
			}}
		>
			<Dialog.Portal>
				<DensityScope density="comfortable">
					<Dialog.Backdrop className="fixed inset-0 z-50 bg-backdrop backdrop-blur-[2px] transition-opacity duration-200 ease-out data-[ending-style]:opacity-0 data-[starting-style]:opacity-0 motion-reduce:transition-none" />
					<DialogPopup
						initialFocus={inputRef}
						className="fixed top-1/2 left-1/2 z-50 flex max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] max-w-[400px] -translate-x-1/2 -translate-y-1/2 flex-col rounded-card bg-surface-3 text-body text-primary shadow-panel-lg outline-none transition-[opacity,scale] duration-200 ease-out data-[ending-style]:scale-[0.98] data-[ending-style]:opacity-0 data-[starting-style]:scale-[0.98] data-[starting-style]:opacity-0 motion-reduce:transition-none"
					>
						<form
							className={`flex min-h-0 flex-1 flex-col overflow-y-auto ${pad.p} ${bandBody}`}
							onSubmit={submit}
						>
							<DialogHeader
								title="New section"
								showClose={false}
								offHeaderClassName="mb-4 flex items-start gap-2"
								offTitleClassName="text-[17px] leading-6 font-semibold break-words text-primary"
							/>
							<div className="grid gap-2">
								<input
									ref={inputRef}
									type="text"
									value={name}
									onChange={(event) => {
										setName(event.target.value);
									}}
									placeholder="Section name"
									aria-label="Section name"
									autoComplete="off"
									className="h-8 w-full rounded-r6 border border-strong bg-surface-1 px-2.5 text-body text-primary outline-none placeholder:text-t6 focus:border-accent-100/60"
								/>
								<p className="text-[12px]/[16px] text-secondary">
									The new section is listed above your other sessions.
								</p>
							</div>
							<div className={DIALOG_FOOTER_CLASS}>
								<Dialog.Close
									type="button"
									className={`${BUTTON_BASE_CLASS} border border-strong text-primary hover:bg-fill-ghost-hover`}
								>
									Cancel
								</Dialog.Close>
								<button
									type="submit"
									disabled={trimmed === ""}
									className={`${BUTTON_BASE_CLASS} bg-fill-primary text-on-primary hover:bg-fill-primary-hover disabled:pointer-events-none disabled:opacity-50`}
								>
									Create section
								</button>
							</div>
						</form>
					</DialogPopup>
				</DensityScope>
			</Dialog.Portal>
		</Dialog.Root>
	);
}
