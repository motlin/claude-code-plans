import {SquareTerminal} from "lucide-react";
import {useCallback, useState} from "react";
import {useStartHerdrTerminal} from "../hooks/use-herdr-terminal";
import {ApprovalActionButton} from "./approval-card";

interface OpenHerdrTerminal {
	open: (cwd: string | null) => Promise<void>;
	pending: boolean;
	error: string;
}

/** `useStartHerdrTerminal` with its pending state and failure message, for a button to show. */
function useOpenHerdrTerminal(): OpenHerdrTerminal {
	const start = useStartHerdrTerminal();
	const [pending, setPending] = useState(false);
	const [error, setError] = useState("");

	const open = useCallback(
		async (cwd: string | null) => {
			setPending(true);
			setError("");
			try {
				await start(cwd);
			} catch (cause) {
				setError(cause instanceof Error ? cause.message : String(cause));
			} finally {
				setPending(false);
			}
		},
		[start],
	);

	return {open, pending, error};
}

const DIRECTORY_INPUT =
	"h-7 min-w-0 flex-1 rounded-r6 border border-border bg-transparent px-2 text-body text-primary placeholder:text-t6 focus-visible:outline-hidden focus-visible:shadow-focus";

/**
 * The Terminals page's "New terminal": a directory field (blank for the home
 * directory) and Start, which opens a login shell there in a new herdr tab.
 */
export function NewTerminalControl() {
	const [expanded, setExpanded] = useState(false);
	const [directory, setDirectory] = useState("");
	const {open, pending, error} = useOpenHerdrTerminal();

	if (!expanded) {
		return (
			<ApprovalActionButton
				variant="secondary"
				size="sm"
				onClick={() => {
					setExpanded(true);
				}}
			>
				<SquareTerminal aria-hidden="true" className="size-3.5" />
				New terminal
			</ApprovalActionButton>
		);
	}

	const start = (): void => {
		const cwd = directory.trim();
		void open(cwd === "" ? null : cwd);
	};

	return (
		<form
			aria-label="New terminal"
			className="flex w-full flex-wrap items-center gap-2 sm:w-auto"
			onSubmit={(event) => {
				event.preventDefault();
				start();
			}}
		>
			<input
				type="text"
				aria-label="Directory"
				placeholder="Home directory"
				value={directory}
				// oxlint-disable-next-line jsx-a11y/no-autofocus -- the field is what "New terminal" just revealed
				autoFocus
				spellCheck={false}
				onChange={(event) => {
					setDirectory(event.target.value);
				}}
				className={`${DIRECTORY_INPUT} sm:w-64`}
			/>
			<ApprovalActionButton
				variant="primary"
				size="sm"
				busy={pending}
				busyLabel="Starting terminal"
				onClick={start}
			>
				Start terminal
			</ApprovalActionButton>
			<ApprovalActionButton
				variant="secondary"
				size="sm"
				onClick={() => {
					setExpanded(false);
				}}
			>
				Cancel
			</ApprovalActionButton>
			{error !== "" && (
				<p role="alert" className="basis-full text-caption text-danger-000">
					{error}
				</p>
			)}
		</form>
	);
}

/** "Open terminal here": a login shell in a new herdr tab at `cwd`, opened in its live terminal. */
export function OpenTerminalHereButton({cwd}: {cwd: string}) {
	const {open, pending, error} = useOpenHerdrTerminal();
	return (
		<div className="flex items-center gap-2">
			{error !== "" && (
				<p role="alert" className="text-caption text-danger-000">
					{error}
				</p>
			)}
			<ApprovalActionButton
				variant="secondary"
				size="sm"
				busy={pending}
				busyLabel="Opening terminal"
				title={`Open a shell in ${cwd}`}
				onClick={() => void open(cwd)}
			>
				<SquareTerminal aria-hidden="true" className="size-3.5" />
				Open terminal here
			</ApprovalActionButton>
		</div>
	);
}
