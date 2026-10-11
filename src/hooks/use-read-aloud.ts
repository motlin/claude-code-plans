import {useEffect, useRef, useState, useSyncExternalStore} from "react";
import {markdownToPlainText} from "../lib/markdown-plain-text";
import {chooseVoice} from "../lib/speech-voice";

/** How long to wait for an engine that has not listed its voices yet before speaking with its default. */
const VOICE_LIST_WAIT_MS = 1000;

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

function documentLang(): string {
	return document.documentElement.lang || navigator.language || "en";
}

/**
 * Hand `speak` the engine's voices: at once when it has listed them, otherwise
 * once its `voiceschanged` event fires (Chrome loads the list lazily) or the
 * wait runs out. The returned function abandons a pending wait.
 */
function withVoices(speak: (voices: readonly SpeechSynthesisVoice[]) => void): () => void {
	const voices = speechSynthesis.getVoices();
	if (voices.length > 0) {
		speak(voices);
		return () => {};
	}
	const done = () => {
		cleanup();
		speak(speechSynthesis.getVoices());
	};
	const timer = setTimeout(done, VOICE_LIST_WAIT_MS);
	const cleanup = () => {
		clearTimeout(timer);
		speechSynthesis.removeEventListener("voiceschanged", done);
	};
	speechSynthesis.addEventListener("voiceschanged", done);
	return cleanup;
}

/** The mounted record or footer owns speech, not its temporary menu portal. */
export function useReadAloud(text: string) {
	const supported = useSyncExternalStore(subscribeNever, hasSpeechSynthesis, () => false);
	const [status, setStatus] = useState<ReadAloudStatus>("idle");
	const statusRef = useRef<ReadAloudStatus>("idle");
	const abandonVoiceWait = useRef<() => void>(() => {});
	/** Counts readings, so a cancelled reading's late events cannot settle the next one. */
	const reading = useRef(0);
	useEffect(
		() => () => {
			abandonVoiceWait.current();
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
		abandonVoiceWait.current();
		const current = ++reading.current;
		speechSynthesis.cancel();
		if (status === "loading") {
			settle("idle");
			return;
		}
		const spoken = markdownToPlainText(text);
		if (spoken === "") return;
		settle("loading");
		const settleCurrent = (value: ReadAloudStatus) => {
			if (reading.current === current) settle(value);
		};
		abandonVoiceWait.current = withVoices((voices) => {
			const lang = documentLang();
			const voice = chooseVoice(voices, lang);
			const utterance = new SpeechSynthesisUtterance(spoken);
			utterance.lang = voice?.lang ?? lang;
			if (voice !== null) utterance.voice = voice;
			utterance.onstart = () => settleCurrent("playing");
			utterance.onend = () => settleCurrent("idle");
			utterance.onerror = () => settleCurrent("idle");
			speechSynthesis.speak(utterance);
		});
	};
	return {status, toggle: supported && text !== "" ? toggle : undefined};
}
