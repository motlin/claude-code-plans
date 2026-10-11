/**
 * The longest text one utterance carries. Chrome's network voices stop after
 * about 15 seconds of speech, roughly 200 characters at the default rate.
 */
export const MAX_SPEECH_CHUNK = 200;

const sentenceSegmenter = new Intl.Segmenter(undefined, {granularity: "sentence"});

/** Break a sentence longer than one utterance, after a comma or semicolon when one fits, else at a space. */
function splitLong(sentence: string): string[] {
	const chunks: string[] = [];
	let rest = sentence;
	while (rest.length > MAX_SPEECH_CHUNK) {
		const window = rest.slice(0, MAX_SPEECH_CHUNK + 1);
		const clause = Math.max(window.lastIndexOf(", "), window.lastIndexOf("; "));
		const space = window.lastIndexOf(" ");
		const cut = clause > 0 ? clause + 1 : space > 0 ? space : MAX_SPEECH_CHUNK;
		chunks.push(rest.slice(0, cut).trim());
		rest = rest.slice(cut).trim();
	}
	if (rest !== "") chunks.push(rest);
	return chunks;
}

/**
 * Plain text as the utterances to queue: one per sentence, lines kept apart,
 * and any sentence too long for one utterance broken into several.
 */
export function speechChunks(text: string): string[] {
	return text
		.split("\n")
		.flatMap((line) => Array.from(sentenceSegmenter.segment(line), ({segment}) => segment.trim()))
		.filter((sentence) => sentence !== "")
		.flatMap(splitLong);
}
