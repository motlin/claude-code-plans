import {PreviewCard} from "@base-ui/react/preview-card";
import {useMutation, useQuery} from "@tanstack/react-query";
import {ArrowUp} from "lucide-react";
import {useState, type ReactElement, type ReactNode} from "react";

import {postAnswerQuestion} from "../lib/api/answer-question";
import {approvalsQueryOptions, type PendingApprovalItem} from "../lib/api/approvals";

/** claude.ai/code's attention hover card: blocked rows open sooner, wider, with reply controls. */
const SESSION_HOVER_CARD = {
	blocked: {delay: 400, width: 440},
	other: {delay: 500, width: 340},
} as const;

const CLOSE_DELAY_MS = 150;

type HoverCardKind = keyof typeof SESSION_HOVER_CARD;

interface SessionHoverCardProps {
	sessionId: string;
	title: string;
	summary: string | null;
	/** Needs input: the card offers quick reply and approval controls. */
	blocked: boolean;
	onOpen: (sessionId: string) => void;
	/** The row element that triggers the card; `children` render inside it. */
	render: ReactElement<Record<string, unknown>>;
	side?: "right" | "bottom";
	align?: "start" | "end";
	children: ReactNode;
}

/**
 * Hover preview for a session row: after 400ms a blocked row shows a 440px card
 * that answers its pending question in place; after 500ms any other row shows a
 * 340px card with the title and summary.
 */
export function SessionHoverCard({
	sessionId,
	title,
	summary,
	blocked,
	onOpen,
	render,
	side = "right",
	align = "start",
	children,
}: Readonly<SessionHoverCardProps>) {
	const kind: HoverCardKind = blocked ? "blocked" : "other";
	const {delay, width} = SESSION_HOVER_CARD[kind];
	return (
		<PreviewCard.Root>
			<PreviewCard.Trigger render={render} data-hover-card-trigger="" delay={delay} closeDelay={CLOSE_DELAY_MS}>
				{children}
			</PreviewCard.Trigger>
			<PreviewCard.Portal>
				<PreviewCard.Positioner side={side} align={align} sideOffset={8} className="z-[100]">
					<PreviewCard.Popup
						data-session-hover-card
						data-kind={kind}
						style={{width: `${width}px`}}
						className="flex max-w-[calc(100vw-32px)] flex-col gap-2 rounded-card bg-[var(--menu-bg)] p-3 text-[13px] leading-[19px] text-primary shadow-[var(--menu-shadow)] outline-none"
					>
						{blocked ? (
							<BlockedCardBody sessionId={sessionId} title={title} summary={summary} onOpen={onOpen} />
						) : (
							<>
								<CardTitle title={title} />
								<p data-card-summary className="line-clamp-6 text-ink-muted">
									{summary ?? "No summary yet."}
								</p>
							</>
						)}
					</PreviewCard.Popup>
				</PreviewCard.Positioner>
			</PreviewCard.Portal>
		</PreviewCard.Root>
	);
}

function CardTitle({title}: {title: string}) {
	return (
		<p data-card-title className="line-clamp-2 font-medium">
			{title}
		</p>
	);
}

function BlockedCardBody({
	sessionId,
	title,
	summary,
	onOpen,
}: {
	sessionId: string;
	title: string;
	summary: string | null;
	onOpen: (sessionId: string) => void;
}) {
	const {data} = useQuery(approvalsQueryOptions());
	const approval = data?.approvals.find((entry) => entry.sessionId === sessionId);
	const answerable =
		approval?.toolName === "AskUserQuestion" && approval.questionPreview !== null
			? {...approval, questionPreview: approval.questionPreview}
			: undefined;

	return (
		<>
			<div className="flex min-w-0 items-center gap-2">
				<span className="flex shrink-0 items-center gap-1.5">
					<span className="size-[5px] rounded-full bg-[var(--status-dot-awaiting)]" />
					<span className="text-[12px] leading-[15px] text-warning-000">Needs input</span>
				</span>
			</div>
			<CardTitle title={title} />
			{answerable === undefined ? (
				<>
					<p data-card-summary className="line-clamp-4 text-ink-muted">
						{approval?.toolName === "ExitPlanMode"
							? `Waiting on plan approval${approval.planFilename === null ? "" : `: ${approval.planFilename}`}`
							: (summary ?? "Waiting for your input.")}
					</p>
					<OpenSessionButton onClick={() => onOpen(sessionId)} />
				</>
			) : (
				<QuickReply approval={answerable} />
			)}
		</>
	);
}

function OpenSessionButton({onClick}: {onClick: () => void}) {
	return (
		<div className="flex justify-end">
			<button
				type="button"
				onClick={onClick}
				className="h-7 rounded-md bg-alpha-1 px-2.5 text-[12px] text-primary hover:bg-alpha-2 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent-100"
			>
				Open session
			</button>
		</div>
	);
}

function QuickReply({approval}: {approval: PendingApprovalItem & {questionPreview: string}}) {
	const [draft, setDraft] = useState("");
	const answer = useMutation({
		mutationFn: (text: string) =>
			postAnswerQuestion({
				sessionId: approval.sessionId,
				toolUseId: approval.toolUseId,
				answers: [{question: approval.questionPreview, answer: text}],
			}),
	});

	const send = (text: string) => {
		const trimmed = text.trim();
		if (!trimmed || answer.isPending || answer.isSuccess) return;
		answer.mutate(trimmed);
	};

	return (
		<>
			<p data-card-question className="line-clamp-4 text-secondary">
				{approval.questionPreview}
			</p>
			<span data-card-note className="sr-only">
				Quick reply and approval controls available
			</span>
			{answer.isSuccess ? (
				<p data-card-sent role="status" className="text-[12px] text-ink-muted">
					Reply sent
				</p>
			) : (
				<>
					{approval.questionOptions.length > 0 && (
						<div className="flex flex-wrap gap-1.5">
							{approval.questionOptions.map((option) => (
								<button
									key={option}
									type="button"
									data-card-option
									disabled={answer.isPending}
									onClick={() => send(option)}
									className="h-7 max-w-full truncate rounded-md border border-subtle px-2.5 text-[12px] text-primary hover:bg-alpha-2 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent-100"
								>
									{option}
								</button>
							))}
						</div>
					)}
					<div className="flex items-end gap-1.5 rounded-lg bg-alpha-1 p-1.5">
						<textarea
							aria-label="Quick reply"
							placeholder="Reply…"
							rows={1}
							value={draft}
							disabled={answer.isPending}
							onChange={(event) => setDraft(event.target.value)}
							onKeyDown={(event) => {
								if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
								event.preventDefault();
								send(draft);
							}}
							className="max-h-24 min-h-7 flex-1 resize-none bg-transparent px-1 py-1 text-[13px] leading-[19px] text-primary outline-none placeholder:text-ink-muted"
						/>
						<button
							type="button"
							aria-label="Send reply"
							disabled={answer.isPending || draft.trim() === ""}
							onClick={() => send(draft)}
							className="flex size-7 shrink-0 items-center justify-center rounded-md bg-accent-100 text-white disabled:opacity-40 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent-100"
						>
							<ArrowUp aria-hidden="true" className="size-4" />
						</button>
					</div>
					{answer.isError && (
						<p role="alert" className="text-[12px] text-danger-000">
							{answer.error.message}
						</p>
					)}
				</>
			)}
		</>
	);
}
