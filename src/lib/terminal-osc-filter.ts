const ESC = 0x1b;
const BEL = 0x07;
const OSC_INTRODUCER = 0x5d; // ]
const STRING_TERMINATOR = 0x5c; // \
const SEPARATOR = 0x3b; // ;
const DIGIT_0 = 0x30;
const DIGIT_9 = 0x39;
const MAX_COMMAND_DIGITS = 5;

/**
 * OSC commands ghostty-vt does not implement and logs as "invalid OSC
 * command" for every occurrence: iTerm2 shell integration (1337) and
 * iTerm2 tab colour (6), both emitted on each zsh prompt.
 */
const DROPPED_COMMANDS: ReadonlySet<string> = new Set(["1337", "6"]);

type State = "ground" | "escape" | "command" | "drop" | "drop-escape";

/**
 * Returns a stateful byte filter that strips the OSC sequences in
 * {@link DROPPED_COMMANDS} before they reach ghostty-vt. Every other byte
 * passes through unchanged. Sequences may be split across chunks; the bytes
 * of an undecided prefix (`ESC`, `ESC ]`, `ESC ] 13`) are held until the
 * command number is known.
 */
export function createOscFilter(): (chunk: Uint8Array) => Uint8Array {
	let state: State = "ground";
	let command = "";

	return (chunk) => {
		const output: number[] = [];
		const flushPrefix = (): void => {
			output.push(ESC, OSC_INTRODUCER);
			for (let index = 0; index < command.length; index++) output.push(command.charCodeAt(index));
			command = "";
		};

		for (let index = 0; index < chunk.length; index++) {
			const byte = chunk[index] ?? 0;
			let pending = true;
			while (pending) {
				pending = false;
				switch (state) {
					case "ground":
						if (byte === ESC) state = "escape";
						else output.push(byte);
						break;
					case "escape":
						if (byte === OSC_INTRODUCER) {
							state = "command";
						} else {
							output.push(ESC);
							state = "ground";
							pending = true;
						}
						break;
					case "command":
						if (byte >= DIGIT_0 && byte <= DIGIT_9 && command.length < MAX_COMMAND_DIGITS) {
							command += String.fromCharCode(byte);
						} else if (DROPPED_COMMANDS.has(command)) {
							command = "";
							state = "drop";
							pending = byte !== SEPARATOR;
						} else {
							flushPrefix();
							state = "ground";
							pending = true;
						}
						break;
					case "drop":
						if (byte === BEL) state = "ground";
						else if (byte === ESC) state = "drop-escape";
						break;
					case "drop-escape":
						if (byte === STRING_TERMINATOR) {
							state = "ground";
						} else {
							state = "escape";
							pending = true;
						}
						break;
				}
			}
		}
		return Uint8Array.from(output);
	};
}
