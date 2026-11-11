import {useDirection} from "@base-ui/react/direction-provider";
import {type CSSProperties, useEffect, useEffectEvent, useRef, useState} from "react";

import {RTL_LETTER} from "./bidi-lines";
import styles from "./reveal-text.module.css";

/** Upstream's per-grapheme stagger (`Y_`), in ms. */
const STAGGER_MS = 30;
/** Extra stagger slots before a reveal counts as settled (`qC`). */
const SETTLE_SLOTS = 4;
/** How long the old text takes to fade out (`Hk`), in ms. */
const FADE_OUT_MS = 200;
const FADE_TRANSITION = `opacity ${FADE_OUT_MS}ms ease-out, filter ${FADE_OUT_MS}ms ease-out`;
/** The outgoing text's style (`b5`). */
const FADING_OUT: CSSProperties = {opacity: 0, filter: "blur(6px)", transition: FADE_TRANSITION};
/** The style while the old text comes back (`eL`). */
const RECOVERING: CSSProperties = {transition: FADE_TRANSITION};

let segmenter: Intl.Segmenter | null | undefined;

/** The text's graphemes (upstream `U5`), or its code points where `Intl.Segmenter` is missing. */
function splitGraphemes(text: string): string[] {
	if (segmenter === undefined) {
		try {
			segmenter = new Intl.Segmenter(undefined, {granularity: "grapheme"});
		} catch {
			segmenter = null;
		}
	}
	if (segmenter !== null) return Array.from(segmenter.segment(text), ({segment}) => segment);
	return Array.from(text);
}

interface GraphemeSlot {
	text: string;
	/** The stagger slot: its grapheme index, so a run's delay follows its first grapheme. */
	slot: number;
}

/** Right-to-left text keeps its words whole, in alternating word and space runs (upstream `ga$`). */
function wordRuns(graphemes: readonly string[]): GraphemeSlot[] {
	const runs: GraphemeSlot[] = [];
	for (const [slot, grapheme] of graphemes.entries()) {
		const last = runs.at(-1);
		if (last !== undefined && (grapheme.trim() === "") === (last.text.trim() === "")) last.text += grapheme;
		else runs.push({text: grapheme, slot});
	}
	return runs;
}

type RevealPhase = "initial" | "out" | "idle" | "recover";

interface RevealTextProps {
	text: string;
	/** Draw the first text as plain text; only later changes reveal. */
	skipInitialReveal?: boolean;
}

/**
 * Upstream claude.ai/code's text reveal (shared-20 `CR`). When the text changes, the old text fades
 * out over 200ms and the new one fades in grapheme by grapheme, 30ms apart, under `data-revealing`
 * until it settles. A screen reader reads the current text from a sibling `sr-only` span.
 */
export function RevealText({text, skipInitialReveal = false}: RevealTextProps) {
	const rtl = useDirection() === "rtl";
	const [shown, setShown] = useState(text);
	const [phase, setPhase] = useState<RevealPhase>("initial");
	const [settledText, setSettledText] = useState<string | null>(null);
	const graphemes = splitGraphemes(shown);
	const keepsWords = rtl || RTL_LETTER.test(shown);
	const slots = keepsWords
		? wordRuns(graphemes)
		: graphemes.map((grapheme, slot) => ({text: grapheme === " " ? " " : grapheme, slot}));
	const slotCount = (slots.at(-1)?.slot ?? -1) + 1;

	useEffect(() => {
		const timer = setTimeout(
			() => {
				setSettledText(shown);
			},
			(slotCount + SETTLE_SLOTS) * STAGGER_MS,
		);
		return () => {
			clearTimeout(timer);
		};
	}, [shown, slotCount]);

	const settled = settledText === shown;
	// A new text waits for the current reveal to settle, then fades the old one out.
	if (text !== shown && phase !== "out" && (phase === "initial" || settled)) setPhase("out");

	const finishFadeOut = useEffectEvent(() => {
		if (text === shown) {
			setPhase("recover");
			return;
		}
		setShown(text);
		setPhase("idle");
	});
	useEffect(() => {
		if (phase !== "out") return undefined;
		const timer = setTimeout(() => {
			finishFadeOut();
		}, FADE_OUT_MS);
		return () => {
			clearTimeout(timer);
		};
	}, [phase]);

	if (skipInitialReveal && phase === "initial") return text;
	const style =
		phase === "initial" || phase === "idle"
			? undefined
			: phase === "out" && text !== shown
				? FADING_OUT
				: RECOVERING;
	return (
		<>
			<span className="sr-only">{text}</span>
			<span
				key={shown}
				aria-hidden="true"
				data-revealing={settled ? undefined : ""}
				className={keepsWords ? undefined : "inline-flex"}
				style={style}
			>
				{slots.map(({text: part, slot}) => (
					<span key={slot} className={styles["grapheme"]} style={{"--i": `${slot}`}}>
						{part}
					</span>
				))}
			</span>
		</>
	);
}

/** How long after a title change the reveal is remounted as plain text (upstream `NA`), in ms. */
const TITLE_REKEY_MS = 1500;

/**
 * A chapter title (upstream `NA`): plain on first paint, revealed when it changes (a rename), and
 * drawn plain again 1.5s after the change.
 */
export function ChapterTitleReveal({text}: {text: string}) {
	const lastTextRef = useRef(text);
	const [generation, setGeneration] = useState(0);
	useEffect(() => {
		if (text === lastTextRef.current) return undefined;
		lastTextRef.current = text;
		const timer = window.setTimeout(() => {
			setGeneration((current) => current + 1);
		}, TITLE_REKEY_MS);
		return () => {
			window.clearTimeout(timer);
		};
	}, [text]);
	return <RevealText key={generation} text={text} skipInitialReveal />;
}
