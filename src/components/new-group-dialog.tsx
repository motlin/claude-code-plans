import {Dialog} from "@base-ui/react/dialog";
import {type FormEvent, useRef, useState} from "react";

const BUTTON_BASE_CLASS =
	"h-8 rounded-r6 px-3 text-body font-medium transition-colors focus-visible:shadow-[0_0_0_2px_var(--accent-100)] focus-visible:outline-none";

/**
 * claude.ai/code's small "New group" dialog: no close X, one "Group name"
 * input with initial focus, and a primary button disabled while the name is
 * blank. Outside Custom groups mode it says the list will switch, and the
 * button reads "Create and group by custom".
 */
export function NewGroupDialog({
	open,
	onOpenChange,
	switchesGroupBy,
	onCreate,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	/** Group by is not Custom groups, so creating switches it. */
	switchesGroupBy: boolean;
	/** Called with the trimmed, non-blank name. */
	onCreate: (name: string) => void;
}) {
	const [name, setName] = useState("");
	const inputRef = useRef<HTMLInputElement>(null);
	const trimmed = name.trim();

	const submit = (event: FormEvent) => {
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
				<Dialog.Backdrop className="fixed inset-0 z-50 bg-backdrop backdrop-blur-[2px] transition-opacity duration-200 ease-out data-[ending-style]:opacity-0 data-[starting-style]:opacity-0 motion-reduce:transition-none" />
				<Dialog.Popup
					initialFocus={inputRef}
					className="fixed top-1/2 left-1/2 z-50 flex max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] max-w-[400px] -translate-x-1/2 -translate-y-1/2 flex-col rounded-card bg-surface-3 text-body text-primary shadow-panel-lg outline-none transition-[opacity,scale] duration-200 ease-out data-[ending-style]:scale-[0.98] data-[ending-style]:opacity-0 data-[starting-style]:scale-[0.98] data-[starting-style]:opacity-0 motion-reduce:transition-none"
				>
					<form className="flex min-h-0 flex-1 flex-col p-6" onSubmit={submit}>
						<Dialog.Title className="mb-4 text-[17px] leading-6 font-semibold break-words text-primary">
							New group
						</Dialog.Title>
						<div className="grid gap-2">
							<input
								ref={inputRef}
								type="text"
								value={name}
								onChange={(event) => setName(event.target.value)}
								placeholder="Group name"
								aria-label="Group name"
								autoComplete="off"
								className="h-8 w-full rounded-r6 border border-strong bg-surface-1 px-2.5 text-body text-primary outline-none placeholder:text-t6 focus:border-accent-100/60"
							/>
							{switchesGroupBy && (
								<p className="text-[12px]/[16px] text-secondary">
									The list will switch to Custom groups to show it.
								</p>
							)}
						</div>
						<div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
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
								{switchesGroupBy ? "Create and group by custom" : "Create group"}
							</button>
						</div>
					</form>
				</Dialog.Popup>
			</Dialog.Portal>
		</Dialog.Root>
	);
}
