import {useMutation} from "@tanstack/react-query";
import {CornerDownLeft} from "lucide-react";
import {useId, useState, type ComponentType, type KeyboardEvent, type ReactNode} from "react";

import {
	AWAITING_TEXT_CAP,
	isQuickReplyQuestion,
	openToAnswerLabel,
	questionCount,
	questionsText,
	quickReplyDraftKey,
	readQuickReplyDraft,
	stripInlineMarkdown,
	truncateCodePoints,
	writeQuickReplyDraft,
	type AwaitingGate,
} from "../lib/awaiting-gate";
import {FORK_ANSWER_LABEL, type QuestionAnswerRoute} from "../lib/question-answer-route";
import {AwaitingBodySkeleton, AwaitingTitle} from "./session-awaiting-skeleton";
import {questionAnswerable, useAwaitingGate} from "./use-awaiting-gate";
import {useToast} from "./toast-context";

const SEND_FAILED = "Response couldn’t be sent. You can try again.";

const CHIP_CLASS =
	"h-7 max-w-full truncate rounded-control-sm bg-alpha-2 px-2 text-[14px]/[19px] text-primary transition-colors hover:bg-alpha-3 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent-100";

const FOOTER_CLASS = "text-[12px]/[15px] text-ink-muted";

/** `Claude asked · {body}`, the card's eyebrow line, three lines at most. */
function AskedLine({bodyId, children}: {bodyId: string; children: ReactNode}) {
	return (
		<div data-card-question className="line-clamp-3 min-w-0 text-primary [overflow-wrap:anywhere]">
			<span className="text-ink-muted">Claude asked</span>
			<span aria-hidden className="text-ink-muted">
				{" · "}
			</span>
			<span id={bodyId} className="whitespace-pre-line">
				{children}
			</span>
		</div>
	);
}

/** Upstream's "Awaiting input / Open the session to respond" body. */
function AwaitingFallback() {
	return (
		<div className="flex flex-col gap-0.5 px-4 py-2.5">
			<span className="font-medium text-secondary">Awaiting input</span>
			<span data-card-footer className="text-ink-muted">
				Open the session to respond
			</span>
		</div>
	);
}

/**
 * Upstream's reply box: a one-line autosizing field with an inset send button.
 * Enter sends, Shift+Enter adds a line, and every key but Escape stays in the
 * box so Escape still closes the card. Unsent text is kept for ten minutes.
 */
function ReplyBox({
	draftKey,
	describedBy,
	pending,
	sendLabel = "Send reply",
	onSend,
}: {
	draftKey: string;
	describedBy: string;
	pending: boolean;
	sendLabel?: string;
	onSend: (text: string, restore: () => void) => void;
}) {
	const [text, setText] = useState(() => readQuickReplyDraft(draftKey, Date.now()));
	const update = (next: string) => {
		setText(next);
		writeQuickReplyDraft(draftKey, next, Date.now());
	};
	const send = () => {
		const trimmed = text.trim();
		if (trimmed === "" || pending) return;
		const unsent = text;
		update("");
		onSend(trimmed, () => {
			update(unsent);
		});
	};
	const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
		if (event.key !== "Escape") event.stopPropagation();
		if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
		event.preventDefault();
		send();
	};
	return (
		<div className="relative rounded-lg bg-alpha-1 px-2 py-1 transition-colors focus-within:bg-alpha-2 hover:bg-alpha-2 has-[textarea:focus-visible]:ring-1 has-[textarea:focus-visible]:ring-accent-100">
			<textarea
				rows={1}
				value={text}
				placeholder="Reply to Claude…"
				aria-label="Reply to Claude"
				aria-describedby={describedBy}
				onChange={(event) => {
					update(event.target.value);
				}}
				onKeyDown={onKeyDown}
				style={{maxHeight: "4lh", paddingInlineEnd: "calc(28px + 8px)"}}
				className="block w-full resize-none bg-transparent text-[13px]/[19px] text-primary outline-none [field-sizing:content] placeholder:text-ink-muted"
			/>
			<div className="pointer-events-none absolute inset-0 flex items-end justify-end p-0.5">
				<button
					type="button"
					aria-label={sendLabel}
					aria-keyshortcuts="Enter"
					disabled={text.trim() === "" || pending}
					onClick={send}
					className="pointer-events-auto flex size-6 items-center justify-center rounded-r5 text-secondary hover:bg-fill-ghost-hover disabled:opacity-40 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent-100"
				>
					<CornerDownLeft aria-hidden className="size-4" />
				</button>
			</div>
		</div>
	);
}

/** Option chips and the reply box answering the session's one single-select question. */
function QuestionQuickReply({
	sessionId,
	gate,
	route,
	summaryText,
	bodyId,
}: {
	sessionId: string;
	gate: Extract<AwaitingGate, {kind: "question"}>;
	route: QuestionAnswerRoute;
	summaryText: string;
	bodyId: string;
}) {
	const toast = useToast();
	const question = gate.questions[0];
	const answer = useMutation({
		mutationFn: async (reply: string) => {
			const {submitQuestionAnswer} = await import("../lib/question-answer-submit");
			return submitQuestionAnswer(route, {
				sessionId,
				toolUseId: gate.toolUseId,
				questions: gate.questions,
				answers: [{question: question?.question ?? "", answer: reply}],
			});
		},
	});
	const submit = (reply: string, restore?: () => void) => {
		if (answer.isPending) return;
		answer.mutate(reply, {
			onError: () => {
				restore?.();
				toast({kind: "error", message: SEND_FAILED});
			},
		});
	};
	const options = (question?.options ?? []).flatMap((option, index) =>
		option.label === "" ? [] : [{index, value: option.label, label: stripInlineMarkdown(option.label)}],
	);
	if (answer.isSuccess) {
		return (
			<p role="status" data-card-sent className={FOOTER_CLASS}>
				Reply sent
			</p>
		);
	}
	return (
		<>
			{route === "fork" && (
				<span data-card-fork className={FOOTER_CLASS}>
					Session stopped: replies answer in a new fork
				</span>
			)}
			{options.length > 0 && (
				<div className="flex flex-wrap gap-0.75">
					{options.map((option) => (
						<button
							key={option.index}
							type="button"
							data-card-option
							disabled={answer.isPending}
							onClick={() => {
								submit(option.value);
							}}
							className={CHIP_CLASS}
						>
							{option.label}
						</button>
					))}
				</div>
			)}
			<ReplyBox
				draftKey={quickReplyDraftKey(sessionId, summaryText)}
				describedBy={bodyId}
				pending={answer.isPending}
				sendLabel={route === "fork" ? FORK_ANSWER_LABEL : "Send reply"}
				onSend={(text, restore) => {
					submit(text, restore);
				}}
			/>
		</>
	);
}

function QuestionBody({
	sessionId,
	gate,
	route,
}: {
	sessionId: string;
	gate: Extract<AwaitingGate, {kind: "question"}>;
	route: QuestionAnswerRoute;
}) {
	const bodyId = useId();
	const summaryText = questionsText(gate.questions);
	if (summaryText === "") return <AwaitingFallback />;
	return (
		<div className="flex flex-col gap-1.25 px-4 pt-1 pb-2.5">
			<AskedLine bodyId={bodyId}>{truncateCodePoints(summaryText, AWAITING_TEXT_CAP)}</AskedLine>
			{questionAnswerable(gate, route) ? (
				<QuestionQuickReply
					sessionId={sessionId}
					gate={gate}
					route={route}
					summaryText={summaryText}
					bodyId={bodyId}
				/>
			) : (
				<span data-card-footer className={FOOTER_CLASS}>
					{isQuickReplyQuestion(gate.questions)
						? "Open the session to respond"
						: openToAnswerLabel(questionCount(gate.questions))}
				</span>
			)}
		</div>
	);
}

/** The lazy body of a Needs input row's hover card, by what the session waits on. */
function AwaitingBody({
	sessionId,
	title,
	titleId,
	gate,
	route,
}: {
	sessionId: string;
	title: string;
	titleId: string;
	summary: string | null;
	gate: AwaitingGate;
	route: QuestionAnswerRoute;
}) {
	return (
		<>
			<AwaitingTitle title={title} titleId={titleId} />
			{gate.kind === "question" ? (
				<QuestionBody sessionId={sessionId} gate={gate} route={route} />
			) : (
				<AwaitingFallback />
			)}
		</>
	);
}

/** The shell's popup, which takes the pointer only while the card can answer in place. */
export type AwaitingPopupShell = ComponentType<{interactive: boolean; children: ReactNode}>;

/**
 * The open Needs input card, which reads what the session waits on. It takes
 * the pointer only when it can answer in place; otherwise the pointer passes
 * through and the card closes once it leaves the row.
 */
export function AwaitingPopup({
	sessionId,
	title,
	titleId,
	summary,
	shell: Shell,
}: {
	sessionId: string;
	title: string;
	titleId: string;
	summary: string | null;
	shell: AwaitingPopupShell;
}) {
	const awaiting = useAwaitingGate(sessionId);
	return (
		<Shell interactive={awaiting.interactive}>
			{awaiting.interactive && <span className="sr-only">Quick reply and approval controls available</span>}
			{awaiting.gate === null ? (
				<AwaitingBodySkeleton title={title} titleId={titleId} />
			) : (
				<AwaitingBody
					sessionId={sessionId}
					title={title}
					titleId={titleId}
					summary={summary}
					gate={awaiting.gate}
					route={awaiting.route}
				/>
			)}
		</Shell>
	);
}
