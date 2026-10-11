import {useEffect, useRef, useState, useSyncExternalStore} from "react";
import {markdownToPlainText} from "../lib/markdown-plain-text";

/**
 * Upstream's read-aloud states: a press starts, pauses or resumes. Speech is
 * loading from the press until the engine reports it started.
 */
export type ReadAloudStatus = "idle" | "loading" | "playing" | "paused";

function subscribeNever(): () => void {
	return () => {};
}

function hasSpeechSynthesis(): boolean {
	return typeof speechSynthesis !== "undefined" && typeof SpeechSynthesisUtterance !== "undefined";
}

/** The mounted record or footer owns speech, not its temporary menu portal. */
export function useReadAloud(text: string) {
	const supported = useSyncExternalStore(subscribeNever, hasSpeechSynthesis, () => false);
	const [status, setStatus] = useState<ReadAloudStatus>("idle");
	const statusRef = useRef<ReadAloudStatus>("idle");
	useEffect(
		() => () => {
			if (statusRef.current !== "idle") speechSynthesis.cancel();
		},
		[],
	);
	const settle = (value: ReadAloudStatus) => {
		statusRef.current = value;
		setStatus(value);
	};
	const toggle = () => {
		if (status === "playing") {
			speechSynthesis.pause();
			settle("paused");
			return;
		}
		if (status === "paused") {
			speechSynthesis.resume();
			settle("playing");
			return;
		}
		speechSynthesis.cancel();
		if (status === "loading") {
			settle("idle");
			return;
		}
		const utterance = new SpeechSynthesisUtterance(markdownToPlainText(text));
		utterance.onstart = () => {
			if (statusRef.current === "loading") settle("playing");
		};
		utterance.onend = () => settle("idle");
		utterance.onerror = () => settle("idle");
		settle("loading");
		speechSynthesis.speak(utterance);
	};
	return {status, toggle: supported && text !== "" ? toggle : undefined};
}
