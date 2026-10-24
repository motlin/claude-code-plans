import {Dialog} from "@base-ui/react/dialog";
import {useRef, useState} from "react";

import type {RewindChoice, RewindPreview} from "../hooks/use-rewind-request";
import {DiffStats} from "./tool-renderers/shared";
import {DensityScope} from "./ui/density";
import {Select} from "./ui/select";

/** Upstream's `ece`: the quote card shows the prompt's first 600 characters. */
const QUOTE_LIMIT = 600;

const BUTTON_BASE_CLASS =
	"h-8 rounded-r6 px-3 text-body font-medium transition-colors hide-focus-ring focus-visible:outline-hidden focus-visible:shadow-focus disabled:cursor-default disabled:opacity-50";

const CHOICE_LABELS = {
	both: "Code and conversation",
	conversation: "Conversation only",
	code: "Code only",
} as const satisfies Record<RewindChoice, string>;

const ALL_CHOICES: readonly RewindChoice[] = ["both", "conversation", "code"];

export interface RewindConfirmProps {
	/** The prompt being rewound to, quoted in the card. */
	text: string;
	preview: RewindPreview;
	/** The conversation can be rewound (a live terminal); without it only "Code only" is possible. */
	conversation: boolean;
	onClose: () => void;
	onConfirm: (choice: RewindChoice) => Promise<void>;
}

function fileCount(count: number): string {
	return `${count} ${count === 1 ? "file" : "files"}`;
}

/**
 * claude.ai/code's "Rewind to this message?" confirm (`tce`): the prompt in a
 * quote card and, when there is code to restore, upstream's styled Restore select with the
 * dry run's file count. Cancel takes the initial focus; closing is blocked
 * while the rewind runs.
 */
export function RewindConfirm({text, preview, conversation, onClose, onConfirm}: RewindConfirmProps) {
	const [choice, setChoice] = useState<RewindChoice>(conversation ? "both" : "code");
	const [running, setRunning] = useState(false);
	const cancelRef = useRef<HTMLButtonElement>(null);
	const pending = preview === "pending";
	const files = typeof preview === "object" ? preview : null;
	const choices = conversation ? ALL_CHOICES : (["code"] as const);
	const confirm = () => {
		setRunning(true);
		void onConfirm(files === null ? (conversation ? "conversation" : "code") : choice).finally(() => {
			setRunning(false);
		});
	};

	return (
		<Dialog.Root
			open
			onOpenChange={(open) => {
				if (!open && !running) onClose();
			}}
		>
			<Dialog.Portal>
				<DensityScope density="comfortable">
					<Dialog.Backdrop className="fixed inset-0 z-50 bg-backdrop transition-opacity duration-200 ease-out data-[ending-style]:opacity-0 data-[starting-style]:opacity-0 motion-reduce:transition-none" />
					<Dialog.Popup
						data-cds="Dialog"
						initialFocus={cancelRef}
						className="epitaxy-root fixed top-1/2 left-1/2 z-50 flex max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] max-w-[400px] -translate-x-1/2 -translate-y-1/2 flex-col break-words rounded-card bg-surface-3 p-6 text-body text-primary shadow-panel-lg outline-none transition-[opacity,scale] duration-200 ease-out data-[ending-style]:scale-[0.98] data-[ending-style]:opacity-0 data-[starting-style]:scale-[0.98] data-[starting-style]:opacity-0 motion-reduce:transition-none"
					>
						<Dialog.Title className="text-[17px] leading-6 font-semibold break-words text-primary">
							Rewind to this message?
						</Dialog.Title>
						<div className="mt-3 flex flex-col gap-3">
							<div className="rounded-card bg-alpha-1 px-4 py-3 text-[15px]/[20px] text-primary">
								<span className="sr-only">You</span>
								<p className="line-clamp-2 whitespace-pre-wrap">{text.trim().slice(0, QUOTE_LIMIT)}</p>
							</div>
							{preview !== "none" && (
								<>
									{choices.length > 1 && (
										<Select
											label="Restore"
											items={choices.map((value) => ({value, label: CHOICE_LABELS[value]}))}
											value={choice}
											disabled={running || pending}
											onChange={setChoice}
										/>
									)}
									<div
										aria-live="polite"
										className={`flex flex-col gap-1 text-body text-secondary${files !== null && choice === "conversation" ? " invisible" : ""}`}
									>
										<span>
											{files === null ? (
												"Checking for file changes…"
											) : files.insertions > 0 || files.deletions > 0 ? (
												<>
													{fileCount(files.filesChanged.length)} ·{" "}
													<span className="align-middle">
														<DiffStats added={files.insertions} removed={files.deletions} />
													</span>
												</>
											) : (
												fileCount(files.filesChanged.length)
											)}
										</span>
										<span className={`text-muted-as-secondary${pending ? " invisible" : ""}`}>
											Changes made through shell commands aren’t reverted. Commits stay in place.
										</span>
									</div>
								</>
							)}
						</div>
						<div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
							<button
								ref={cancelRef}
								type="button"
								data-initial-focus=""
								disabled={running}
								onClick={onClose}
								className={`${BUTTON_BASE_CLASS} border border-strong text-primary hover:bg-fill-ghost-hover`}
							>
								Cancel
							</button>
							<button
								type="button"
								disabled={pending}
								aria-busy={running ? true : undefined}
								onClick={() => {
									if (!running) confirm();
								}}
								className={`${BUTTON_BASE_CLASS} bg-fill-primary text-on-primary hover:bg-fill-primary-hover`}
							>
								{running ? "Rewinding…" : "Rewind"}
							</button>
						</div>
					</Dialog.Popup>
				</DensityScope>
			</Dialog.Portal>
		</Dialog.Root>
	);
}
