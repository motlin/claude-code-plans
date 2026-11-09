import type {ToastOptions} from "../components/toast-context";
import {sendHerdrPrompt} from "./api/herdr";

/** Upstream's `uf`: a `!` and whitespace before the command is how a typed shell command looks outside bash mode. */
const SHELL_COMMAND_TEXT = /^!\s+\S/;

/** Upstream `zR`: text that would run as a shell command, sent from a composer that can't run one. */
export function isShellCommandText(text: string): boolean {
	return SHELL_COMMAND_TEXT.test(text);
}

/**
 * Upstream's refusal: feQzH0 for a local session without a runner (a local CLI session with no live pane),
 * AYbIPZ before any session exists.
 */
export function shellCommandUnavailableMessage(variant: "session" | "home"): string {
	return variant === "home"
		? "Start a local session first to run shell commands."
		: "Shell command runner unavailable.";
}

/** Upstream WeHyjY: a bash-mode command with hidden characters is refused rather than run. */
export const HIDDEN_CHARACTERS_REFUSAL =
	"This command contains hidden characters, so it wasn’t run. Retype it to run it.";

// Upstream c052f2a6a `E`/`D`, with shared-0 `Ak` (minus its right-to-left script ranges) and `mZ`.
const SKIN_TONE = String.raw`[\u{1F3FB}-\u{1F3FF}]`;
const KEYCAP_FLAG = String.raw`\p{Regional_Indicator}{2}|[#*0-9]\uFE0F?\u20E3|\u{1F3F4}\u{E0067}\u{E0062}(?:\u{E0065}\u{E006E}\u{E0067}|\u{E0073}\u{E0063}\u{E0074}|\u{E0077}\u{E006C}\u{E0073})\u{E007F}`;
const ZWJ_PART = String.raw`(?:${KEYCAP_FLAG}|(?!\p{Regional_Indicator})\p{Emoji_Presentation}\uFE0F?${SKIN_TONE}?|\p{Extended_Pictographic}(?:\uFE0F${SKIN_TONE}?|${SKIN_TONE}))`;
const LONE_EMOJI = String.raw`(?:${KEYCAP_FLAG}|\p{Extended_Pictographic}[\uFE0E\uFE0F]?${SKIN_TONE}?)`;
const EMOJI_SEQUENCE = new RegExp(String.raw`${ZWJ_PART}(?:\u200D${ZWJ_PART})+|${LONE_EMOJI}`, "gu");
const RGI_ZWJ_SEQUENCE = ((): RegExp | null => {
	try {
		return new RegExp(String.raw`^\p{RGI_Emoji_ZWJ_Sequence}$`, "v");
	} catch {
		return null;
	}
})();
const ZWJ = "\u200D";
// oxlint-disable-next-line no-control-regex -- upstream `Ak` flags C0/C1 controls as hidden characters
const INVISIBLE = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]|\p{Default_Ignorable_Code_Point}|\p{Cf}/u;
const ODD_SPACE = /(?:[^\P{Zs} ]|[\u{2800}\u{fffc}\u{1d159}\u{13441}\u{13442}\u{16910}\u{16fe4}])/u;

/** Upstream `D`: zero-width, bidi-control and look-alike space characters, newlines read as spaces and RGI emoji spared. */
export function hasHiddenCharacters(text: string): boolean {
	const stripped = text
		.replace(/\r?\n/g, " ")
		.replace(EMOJI_SEQUENCE, (match) =>
			!match.includes(ZWJ) || RGI_ZWJ_SEQUENCE?.test(match) === true ? "" : match,
		);
	return INVISIBLE.test(stripped) || ODD_SPACE.test(stripped);
}

interface RunShellCommandDependencies {
	post?: (sessionId: string, prompt: string) => Promise<void>;
	toast: (options: ToastOptions) => void;
}

/**
 * Types `!<command>` into the session's live pane through the guarded prompt write path, so the CLI runs it in its
 * own bash mode. Resolves false (after a toast) when the write was refused, so the composer can hand it back.
 */
export async function runShellCommandInPane(
	sessionId: string,
	command: string,
	{post = async (id, prompt) => sendHerdrPrompt(id, prompt), toast}: RunShellCommandDependencies,
): Promise<boolean> {
	try {
		await post(sessionId, `!${command}`);
		return true;
	} catch (error) {
		toast({
			kind: "error",
			message: "Couldn’t run the shell command",
			description: error instanceof Error ? error.message : String(error),
		});
		return false;
	}
}
