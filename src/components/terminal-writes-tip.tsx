import {createContext, type ReactNode, useContext, useState} from "react";
import {READ_ONLY_ANSWER_HINT} from "../lib/question-answer-route";
import {Spinner} from "./ui/spinner";

type EnableWrites = () => Promise<void>;

/** Turns on terminal writes for the session view, or null when the cards should only point at the terminal. */
const TerminalWritesTipContext = createContext<EnableWrites | null>(null);

export function TerminalWritesTipProvider({
	enableWrites,
	children,
}: {
	enableWrites: EnableWrites | null;
	children: ReactNode;
}) {
	return <TerminalWritesTipContext.Provider value={enableWrites}>{children}</TerminalWritesTipContext.Provider>;
}

/**
 * The read-only card footnote. When the session has a live pane but terminal writes are off,
 * it also offers a button that turns writes on so the card becomes answerable in place.
 */
export function ReadOnlyAnswerHint({className}: {className?: string}) {
	const enableWrites = useContext(TerminalWritesTipContext);
	const [pending, setPending] = useState(false);

	const turnOn = async () => {
		if (enableWrites === null || pending) return;
		setPending(true);
		try {
			await enableWrites();
		} finally {
			setPending(false);
		}
	};

	return (
		<p data-approval-read-only="" className={className}>
			{READ_ONLY_ANSWER_HINT}
			{enableWrites !== null && (
				<>
					{" · "}
					<button
						type="button"
						disabled={pending}
						onClick={() => void turnOn()}
						className="inline-flex items-center gap-1 text-primary underline-offset-2 hover:underline disabled:opacity-60"
					>
						{pending && <Spinner />}
						Turn on terminal writes
					</button>
				</>
			)}
		</p>
	);
}
