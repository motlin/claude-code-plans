import {describe, expect, it} from "vite-plus/test";
import {chooseVoice, type VoiceLike} from "../src/lib/speech-voice";

function voice(name: string, lang: string, extra: Partial<VoiceLike> = {}): VoiceLike {
	return {name, lang, voiceURI: name, localService: true, default: false, ...extra};
}

const SAMANTHA = voice("Samantha", "en-US", {voiceURI: "com.apple.voice.compact.en-US.Samantha", default: true});
const ZOE_PREMIUM = voice("Zoe (Premium)", "en-US", {voiceURI: "com.apple.voice.premium.en-US.Zoe"});
const EVAN_ENHANCED = voice("Evan (Enhanced)", "en-US", {voiceURI: "com.apple.voice.enhanced.en-US.Evan"});
const SERENA_PREMIUM_GB = voice("Serena (Premium)", "en-GB", {voiceURI: "com.apple.voice.premium.en-GB.Serena"});
const GOOGLE_US = voice("Google US English", "en-US", {localService: false});
const GOOGLE_UK = voice("Google UK English Female", "en-GB", {localService: false});
const ARIA_NATURAL = voice("Microsoft Aria Online (Natural) - English (United States)", "en-US", {localService: false});
const ZARVOX = voice("Zarvox", "en-US", {voiceURI: "com.apple.speech.synthesis.voice.Zarvox"});
const EDDY = voice("Eddy (English (US))", "en-US", {voiceURI: "com.apple.eloquence.en-US.Eddy"});
const THOMAS = voice("Thomas", "fr-FR", {voiceURI: "com.apple.voice.compact.fr-FR.Thomas"});
const AMELIE_PREMIUM = voice("Amélie (Premium)", "fr_CA", {voiceURI: "com.apple.voice.premium.fr-CA.Amelie"});

describe("chooseVoice", () => {
	it("prefers a premium or enhanced voice, then a natural or network voice, then the default", () => {
		expect({
			premium: chooseVoice([SAMANTHA, GOOGLE_US, EVAN_ENHANCED, ZOE_PREMIUM], "en-US")?.name,
			enhanced: chooseVoice([SAMANTHA, GOOGLE_US, EVAN_ENHANCED], "en-US")?.name,
			natural: chooseVoice([SAMANTHA, GOOGLE_US, ARIA_NATURAL], "en-US")?.name,
			network: chooseVoice([SAMANTHA, GOOGLE_US], "en-US")?.name,
			fallback: chooseVoice([ZARVOX, SAMANTHA], "en-US")?.name,
		}).toStrictEqual({
			premium: "Zoe (Premium)",
			enhanced: "Evan (Enhanced)",
			natural: "Microsoft Aria Online (Natural) - English (United States)",
			network: "Google US English",
			fallback: "Samantha",
		});
	});

	it("prefers the document's own locale within a quality tier, and any voice of its language over none", () => {
		expect({
			locale: chooseVoice([SERENA_PREMIUM_GB, ZOE_PREMIUM], "en-US")?.name,
			otherLocale: chooseVoice([SAMANTHA, SERENA_PREMIUM_GB], "en-US")?.name,
			googleLocale: chooseVoice([GOOGLE_UK, GOOGLE_US], "en-GB")?.name,
			bareLanguage: chooseVoice([THOMAS, SAMANTHA, GOOGLE_US], "en")?.name,
			underscoreLang: chooseVoice([THOMAS, AMELIE_PREMIUM], "fr-CA")?.name,
		}).toStrictEqual({
			locale: "Zoe (Premium)",
			otherLocale: "Serena (Premium)",
			googleLocale: "Google UK English Female",
			bareLanguage: "Google US English",
			underscoreLang: "Amélie (Premium)",
		});
	});

	it("never picks a novelty or Eloquence voice over an ordinary one, and returns null without a voice for the language", () => {
		expect({
			novelty: chooseVoice([ZARVOX, EDDY, voice("Fred", "en-US")], "en-US")?.name,
			onlyNovelty: chooseVoice([ZARVOX], "en-US")?.name,
			noLanguage: chooseVoice([THOMAS], "de-DE"),
			empty: chooseVoice([], "en-US"),
		}).toStrictEqual({
			novelty: "Fred",
			onlyNovelty: "Zarvox",
			noLanguage: null,
			empty: null,
		});
	});
});
