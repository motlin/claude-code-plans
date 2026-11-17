import {Dialog} from "@base-ui/react/dialog";
import {type SubmitEvent, useEffect, useId, useRef, useState} from "react";

import {createOutputStyle, validateNewOutputStyleName} from "../lib/api/output-styles";
import {revealFileInFinder} from "../lib/api/file";
import {ConfirmDialog} from "./confirm-dialog";
import {cdsButtonClass} from "./ui/cds-button";
import {DensityScope} from "./ui/density";
import {useDialogBandBodyClass} from "./ui/dialog-band";
import {DialogHeader} from "./ui/dialog-header";
import {DIALOG_FOOTER_CLASS, useDialogPad} from "./ui/dialog-pad";
import {DialogPopup} from "./ui/dialog-popup";

/* Upstream cds `Lf` (Dialog.Description) with the dialog's `mb-4`. */
const DESCRIPTION_CLASS = "mb-4 text-body font-normal text-secondary break-words";
/* Upstream cds Field `$_` + label `a1`. */
const FIELD_CLASS = "flex flex-col gap-2 font-sans";
const LABEL_CLASS = "text-body font-medium leading-none text-primary";
/* Upstream cds `y6` / `Ef`: the field ring, hover and focus shadows, muted placeholder, disabled fade. */
const CONTROL_CLASS =
	"cds-input w-full rounded-r6 bg-fill-field shadow-field-ring px-3 py-1.5 font-sans text-body text-primary placeholder:text-t6 outline-none transition duration-150 enabled:[&:hover:not(:focus):not([aria-invalid=true])]:shadow-field-hover focus-visible:shadow-focus aria-[invalid=true]:shadow-field-invalid disabled:opacity-50";
/* Upstream `DH`: the field's error line. */
const FIELD_ERROR_CLASS = "flex items-start gap-1 text-footnote font-normal leading-snug text-danger wrap-break-word";

type NameError = "exists" | "invalid";

const NAME_ERRORS: Record<NameError, string> =
{
	exists: "A style with this name already exists.",
	invalid: "That name can’t be used — try plain words.",
};

/* Upstream `VY`, minus the desktop-only launcher, policy and config-dir outcomes local never returns. */
const FORM_ERRORS: Record<string, string> =
{
	auth_failed: "You’re signed out — sign in to your Claude account, then try again.",
	usage_limited: "Usage limit reached. Try again after your limit resets.",
	busy_creating: "A style is already being created for this session.",
	write_failed: "Couldn’t save the style file.",
	draft_failed: "Couldn’t draft the style. Try again.",
};

interface Done
{
	name: string;
	path: string;
}

/**
 * Upstream's "New output style" dialog (`UY`): describe a style and Claude drafts it into
 * `~/.claude/output-styles/`. A dirty close asks "Discard unsaved changes?"; closing mid-draft cancels it.
 * Locally a running CLI never refreshes its styles, so the done state always uses upstream's
 * "after the next style refresh" copy and has no Refresh now.
 */
export function NewOutputStyleDialog({
	onClose,
	onCreated,
}: {
	onClose: () => void;
	/** Called once with the created style's name. */
	onCreated: (name: string) => void;
})
{
	const descriptionRef = useRef<HTMLTextAreaElement>(null);
	const nameRef = useRef<HTMLInputElement>(null);
	const nameId = useId();
	const draftRef = useRef<AbortController | null>(null);
	const [hasText, setHasText] = useState(false);
	const [drafting, setDrafting] = useState(false);
	const [nameError, setNameError] = useState<NameError | null>(null);
	const [formError, setFormError] = useState<string | null>(null);
	const [done, setDone] = useState<Done | null>(null);
	const [notFound, setNotFound] = useState(false);
	const [discarding, setDiscarding] = useState(false);
	const pad = useDialogPad();
	const bandBody = useDialogBandBodyClass();

	// Unmounting also cancels an in-flight draft.
	useEffect(
		() => () =>
		{
			draftRef.current?.abort();
		},
		[],
	);

	const close = () =>
	{
		draftRef.current?.abort();
		draftRef.current = null;
		onClose();
	};

	const requestClose = () =>
	{
		const dirty =
			(descriptionRef.current?.value.trim() ?? "") !== "" || (nameRef.current?.value.trim() ?? "") !== "";
		if (done === null && !drafting && dirty) setDiscarding(true);
		else close();
	};

	const submit = async (event: SubmitEvent<HTMLFormElement>) =>
	{
		event.preventDefault();
		const description = descriptionRef.current?.value.trim() ?? "";
		const name = nameRef.current?.value.trim() ?? "";
		if (description === "" || draftRef.current !== null) return;
		setNameError(null);
		setFormError(null);
		setDrafting(true);
		const controller = new AbortController();
		draftRef.current = controller;
		try
		{
			if (name !== "")
			{
				const check = await validateNewOutputStyleName(name);
				if (!check.ok)
				{
					setNameError(check.reason);
					return;
				}
			}
			const result = await createOutputStyle(description, name === "" ? undefined : name, controller.signal);
			if (result.outcome === "cancelled" || controller.signal.aborted) return;
			if ("name" in result)
			{
				setDone(
					{
						name: result.name,
						path: result.path,
					},
				);
				onCreated(result.name);
			}
			else if (result.outcome === "name_exists") setNameError("exists");
			else if (result.outcome === "name_invalid") setNameError("invalid");
			else setFormError(FORM_ERRORS[result.outcome] ?? FORM_ERRORS["draft_failed"] ?? null);
		}
		catch
		{
			if (!controller.signal.aborted) setFormError(FORM_ERRORS["draft_failed"] ?? null);
		}
		finally
		{
			if (draftRef.current === controller)
			{
				draftRef.current = null;
				setDrafting(false);
			}
		}
	};

	const reveal = () =>
	{
		if (done === null) return;
		revealFileInFinder(done.path).catch(() =>
		{
			setNotFound(true);
		});
	};

	return (
		<Dialog.Root
			open
			onOpenChange={(open) =>
			{
				if (!open) requestClose();
			}}
		>
			<Dialog.Portal>
				<DensityScope density="comfortable">
					<Dialog.Backdrop className="fixed inset-0 z-50 bg-backdrop backdrop-blur-[2px] transition-opacity duration-200 ease-out data-[ending-style]:opacity-0 data-[starting-style]:opacity-0 motion-reduce:transition-none" />
					<DialogPopup
						initialFocus={descriptionRef}
						className="fixed top-1/2 left-1/2 z-50 flex max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] max-w-[480px] -translate-x-1/2 -translate-y-1/2 flex-col rounded-card bg-surface-3 text-body text-primary shadow-panel-lg outline-none transition-[opacity,scale] duration-200 ease-out data-[ending-style]:scale-[0.98] data-[ending-style]:opacity-0 data-[starting-style]:scale-[0.98] data-[starting-style]:opacity-0 motion-reduce:transition-none"
					>
						<div className={`flex min-h-0 flex-1 flex-col overflow-y-auto ${pad.p} ${bandBody}`}>
							<DialogHeader title="New output style" />
							{done === null ? (
								<form
									onSubmit={(event) =>
									{
										void submit(event);
									}}
								>
									<Dialog.Description className={DESCRIPTION_CLASS}>
										Describe the style, and Claude will draft it for you.
									</Dialog.Description>
									<label className={`${FIELD_CLASS} mb-4`}>
										<span className={LABEL_CLASS}>What should the style be like?</span>
										<textarea
											ref={descriptionRef}
											rows={3}
											maxLength={2000}
											disabled={drafting}
											placeholder="Short answers first, then detail. No filler words."
											className={`${CONTROL_CLASS} resize-none`}
											onChange={(event) =>
											{
												setHasText(event.target.value.trim().length > 0);
											}}
										/>
									</label>
									<div className={FIELD_CLASS}>
										<label htmlFor={nameId} className={LABEL_CLASS}>
											Name (optional)
										</label>
										<input
											id={nameId}
											ref={nameRef}
											type="text"
											autoComplete="off"
											disabled={drafting}
											aria-invalid={nameError === null ? undefined : true}
											className={`${CONTROL_CLASS} h-control`}
											onChange={() =>
											{
												setNameError(null);
											}}
										/>
										{nameError !== null && (
											<p className={FIELD_ERROR_CLASS}>{NAME_ERRORS[nameError]}</p>
										)}
									</div>
									{formError !== null && (
										<div className="mt-3 text-body text-danger" role="alert">
											{formError}
										</div>
									)}
									<div className={DIALOG_FOOTER_CLASS}>
										<button
											type="button"
											className={cdsButtonClass("secondary")}
											onClick={requestClose}
										>
											Cancel
										</button>
										<button
											type="submit"
											disabled={!hasText}
											aria-busy={drafting ? true : undefined}
											aria-disabled={drafting ? true : undefined}
											className={cdsButtonClass("primary")}
										>
											{drafting ? "Drafting…" : "Create style"}
										</button>
									</div>
								</form>
							) : (
								<>
									<Dialog.Description className={DESCRIPTION_CLASS}>
										{`Created ${done.name}. It appears in the menu after the next style refresh — pick it there.`}
									</Dialog.Description>
									<div className={DIALOG_FOOTER_CLASS}>
										<button
											type="button"
											className={cdsButtonClass("secondary")}
											disabled={notFound}
											onClick={reveal}
										>
											{notFound ? "File not found" : "Show in Finder"}
										</button>
										<button type="button" className={cdsButtonClass("primary")} onClick={onClose}>
											Done
										</button>
									</div>
								</>
							)}
						</div>
						<ConfirmDialog
							open={discarding}
							onOpenChange={setDiscarding}
							title="Discard unsaved changes?"
							body="Your changes haven’t been saved and will be lost."
							cancelLabel="Keep editing"
							confirmLabel="Discard"
							variant="danger"
							onConfirm={close}
						/>
					</DialogPopup>
				</DensityScope>
			</Dialog.Portal>
		</Dialog.Root>
	);
}
