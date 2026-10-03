import {useEffect, useRef, useState, useSyncExternalStore} from "react";
import {markdownToPlainText} from "../lib/markdown-plain-text";

function subscribeNever(): () => void {
	return () => {};
}

function hasSpeechSynthesis(): boolean {
	return typeof speechSynthesis !== "undefined" && typeof SpeechSynthesisUtterance !== "undefined";
}

/** The mounted record or footer owns speech, not its temporary menu portal. */
export function useReadAloud(text: string) {
	const supported = useSyncExternalStore(subscribeNever, hasSpeechSynthesis, () => false);
	const [speaking, setSpeaking] = useState(false);
	const speakingRef = useRef(false);
	useEffect(
		() => () => {
			if (speakingRef.current) speechSynthesis.cancel();
		},
		[],
	);
	const settle = (value: boolean) => {
		speakingRef.current = value;
		setSpeaking(value);
	};
	const toggle = () => {
		speechSynthesis.cancel();
		if (speaking) {
			settle(false);
			return;
		}
		const utterance = new SpeechSynthesisUtterance(markdownToPlainText(text));
		utterance.onend = () => settle(false);
		utterance.onerror = () => settle(false);
		speechSynthesis.speak(utterance);
		settle(true);
	};
	return {speaking, toggle: supported && text !== "" ? toggle : undefined};
}
