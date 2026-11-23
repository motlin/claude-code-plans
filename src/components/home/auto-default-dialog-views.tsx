import {Dialog} from "@base-ui/react/dialog";
import {type ReactNode, type RefObject, useEffect, useRef, useState} from "react";

import {MODE_LABELS} from "../../lib/composer-state";
import {ExternalTextLink} from "../external-text-link";
import {cdsButtonClass} from "../ui/cds-button";
import {DensityScope} from "../ui/density";
import {DIALOG_BODY_CLASS} from "../ui/dialog-classes";
import {useDialogPad} from "../ui/dialog-pad";
import {DialogPopup} from "../ui/dialog-popup";

/** Upstream AkxPGx, shared by the notice, the nudge and the CLI's own copies. */
const AUTO_MODE_BODY =
	"Auto mode lets Claude handle permission prompts automatically. Claude checks each tool call for risky actions and prompt injection before executing, runs the ones it assesses as lower-risk, and blocks the rest.";
const PERMISSION_MODES_URL = "https://code.claude.com/docs/en/permission-modes";

/** Upstream's cds Dialog popup with qge/q's `epitaxy-root break-words max-w-[28rem]`. */
const POPUP_CLASS =
	"epitaxy-root fixed top-1/2 left-1/2 z-50 flex max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] max-w-[28rem] -translate-x-1/2 -translate-y-1/2 flex-col break-words rounded-dialog bg-surface-popover text-body font-normal text-primary shadow-panel-lg outline-none transition-[opacity,scale] duration-200 ease-out data-[ending-style]:scale-[0.98] data-[ending-style]:opacity-0 data-[starting-style]:scale-[0.98] data-[starting-style]:opacity-0 motion-reduce:transition-none";
/** cds `Dialog.Footer`: `align="end"` for the notice, `"between"` for the nudge. */
const FOOTER_CLASS =
{
	end: "mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end",
	between: "mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-between",
} as const;

/**
 * The shell both dialogs share: title, the AkxPGx body and the permission-modes footnote (MoO6B/) in a `gap-sm`
 * stack, over a footer. Escape and the backdrop close it like its buttons do.
 */
function AutoDefaultDialogShell({
	open,
	onOpenChange,
	title,
	initialFocus,
	align,
	children,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	title: string;
	initialFocus: RefObject<HTMLButtonElement | null>;
	align: keyof typeof FOOTER_CLASS;
	children: ReactNode;
})
{
	const pad = useDialogPad();
	return (
		<Dialog.Root open={open} onOpenChange={onOpenChange}>
			<Dialog.Portal>
				<DensityScope density="comfortable">
					<Dialog.Backdrop className="fixed inset-0 z-50 bg-backdrop transition-opacity duration-200 ease-out data-[ending-style]:opacity-0 data-[starting-style]:opacity-0 motion-reduce:transition-none" />
					<DialogPopup role="alertdialog" initialFocus={initialFocus} className={POPUP_CLASS}>
						<div className={`${DIALOG_BODY_CLASS} ${pad.p}`}>
							<div className="flex flex-col gap-3">
								<Dialog.Title className="text-[15px] leading-5 font-[520] break-words text-primary">
									{title}
								</Dialog.Title>
								<Dialog.Description className="mt-0 text-body font-normal break-words text-secondary">
									{AUTO_MODE_BODY}
								</Dialog.Description>
								<p className="text-footnote text-muted-as-secondary">
									{"Learn more about "}
									<ExternalTextLink href={PERMISSION_MODES_URL} rel="noopener">
										permission modes
									</ExternalTextLink>
									.
								</p>
							</div>
							<div className={FOOTER_CLASS[align]}>{children}</div>
						</div>
					</DialogPopup>
				</DensityScope>
			</Dialog.Portal>
		</Dialog.Root>
	);
}

/** Calls `onVisible` once, on the first commit where the tab is visible (upstream `WI`: never while hidden). */
function useOnceVisible(onVisible: () => void): void
{
	const callback = useRef(onVisible);
	callback.current = onVisible;
	useEffect(() =>
	{
		let done = false;
		const check = () =>
		{
			if (done || document.visibilityState !== "visible") return;
			done = true;
			callback.current();
		};
		check();
		document.addEventListener("visibilitychange", check);
		return () =>
		{
			document.removeEventListener("visibilitychange", check);
		};
	}, []);
}

/** Upstream qge: "Got it" only; marked seen when first painted, as the CLI's startup notice is. */
export function AutoDefaultNoticeDialog({onShown}: {onShown: () => void})
{
	const [open, setOpen] = useState(true);
	const gotItRef = useRef<HTMLButtonElement>(null);
	useOnceVisible(onShown);
	return (
		<AutoDefaultDialogShell
			open={open}
			onOpenChange={setOpen}
			title="Auto mode is now Claude Code’s default permission mode"
			initialFocus={gotItRef}
			align="end"
		>
			<button
				ref={gotItRef}
				type="button"
				className={cdsButtonClass("primary")}
				onClick={() =>
				{
					setOpen(false);
				}}
			>
				Got it
			</button>
		</AutoDefaultDialogShell>
	);
}

/** Upstream q: Keep {mode} (initial focus) or Switch to auto; Escape and the backdrop decline. */
export function AutoDefaultNudgeDialog({
	mode,
	onAnswer,
}: {
	mode: string;
	onAnswer: (choice: "accept" | "decline") => void;
})
{
	const [open, setOpen] = useState(true);
	const keepRef = useRef<HTMLButtonElement>(null);
	const answer = (choice: "accept" | "decline") =>
	{
		if (!open) return;
		setOpen(false);
		onAnswer(choice);
	};
	return (
		<AutoDefaultDialogShell
			open={open}
			onOpenChange={(next) =>
			{
				if (!next) answer("decline");
			}}
			title="Make auto mode your default permission mode?"
			initialFocus={keepRef}
			align="between"
		>
			<div className="flex items-center gap-3">
				<button
					ref={keepRef}
					type="button"
					className={cdsButtonClass("secondary")}
					onClick={() =>
					{
						answer("decline");
					}}
				>
					Keep {MODE_LABELS[mode] ?? mode}
				</button>
			</div>
			<div className="flex items-center gap-3">
				<button
					type="button"
					className={cdsButtonClass("primary")}
					onClick={() =>
					{
						answer("accept");
					}}
				>
					Switch to auto
				</button>
			</div>
		</AutoDefaultDialogShell>
	);
}
