/** The fields of a `SpeechSynthesisVoice` the choice reads. */
export interface VoiceLike {
	name: string;
	lang: string;
	voiceURI: string;
	localService: boolean;
	default: boolean;
}

/** macOS joke voices, which read prose as song, whisper or robot noise. */
const NOVELTY_VOICES = new Set([
	"albert",
	"bad news",
	"bahh",
	"bells",
	"boing",
	"bubbles",
	"cellos",
	"good news",
	"jester",
	"organ",
	"superstar",
	"trinoids",
	"whisper",
	"wobble",
	"zarvox",
]);

/**
 * How natural a voice sounds, from what its name and URI say: macOS Premium,
 * Siri and neural or "Natural" voices first, then Enhanced, then Chrome's
 * network voices ("Google US English"), then ordinary local voices, and last
 * the novelty and Eloquence voices (Eddy, Flo, Grandma…).
 */
function quality(voice: VoiceLike): number {
	const label = `${voice.name} ${voice.voiceURI}`.toLowerCase();
	if (NOVELTY_VOICES.has(voice.name.toLowerCase()) || label.includes("com.apple.eloquence")) return 0;
	if (/premium|siri|neural|natural/.test(label)) return 4;
	if (label.includes("enhanced")) return 3;
	if (!voice.localService && voice.name.startsWith("Google")) return 2;
	return 1;
}

function normalizeLang(lang: string): string {
	return lang.replaceAll("_", "-").toLowerCase();
}

function baseLang(lang: string): string {
	return lang.split("-")[0] ?? lang;
}

/**
 * The best installed voice for `lang` (a BCP 47 tag such as the document's
 * `en-US`), or null to leave the engine's default: only voices of the same
 * language qualify, ranked by quality, then an exact locale match, then the
 * engine's own default.
 */
export function chooseVoice<V extends VoiceLike>(voices: readonly V[], lang: string): V | null {
	const wanted = normalizeLang(lang);
	const candidates = voices.filter((voice) => baseLang(normalizeLang(voice.lang)) === baseLang(wanted));
	let best: V | null = null;
	let bestRank: readonly number[] = [];
	for (const voice of candidates) {
		const rank = [quality(voice), normalizeLang(voice.lang) === wanted ? 1 : 0, voice.default ? 1 : 0];
		if (best === null || isHigher(rank, bestRank)) {
			best = voice;
			bestRank = rank;
		}
	}
	return best;
}

function isHigher(rank: readonly number[], than: readonly number[]): boolean {
	for (let index = 0; index < rank.length; index++) {
		if (rank[index] !== than[index]) return (rank[index] ?? -Infinity) > (than[index] ?? -Infinity);
	}
	return false;
}
