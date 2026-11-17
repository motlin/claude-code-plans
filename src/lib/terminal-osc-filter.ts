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
export function createOscFilter(): (chunk: Uint8Array) => Uint8Array
{
	let state: State = "ground";
	let command = "";

	return (chunk) =>
	{
		const output: number[] = [];
		const flushPrefix = (): void =>
		{
			output.push(ESC, OSC_INTRODUCER);
			for (let index = 0; index < command.length; index++) output.push(command.charCodeAt(index));
			command = "";
		};

		for (let index = 0; index < chunk.length; index++)
		{
			const byte = chunk[index] ?? 0;
			let pending = true;
			while (pending)
			{
				pending = false;
				switch (state)
				{
					case "ground":
						if (byte === ESC) state = "escape";
						else output.push(byte);
						break;
					case "escape":
						if (byte === OSC_INTRODUCER)
						{
							state = "command";
						}
						else
						{
							output.push(ESC);
							state = "ground";
							pending = true;
						}
						break;
					case "command":
						if (byte >= DIGIT_0 && byte <= DIGIT_9 && command.length < MAX_COMMAND_DIGITS)
						{
							command += String.fromCharCode(byte);
						}
						else if (DROPPED_COMMANDS.has(command))
						{
							command = "";
							state = "drop";
							pending = byte !== SEPARATOR;
						}
						else
						{
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
						if (byte === STRING_TERMINATOR)
						{
							state = "ground";
						}
						else
						{
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

const FULL_RESET = 0x63; // c
const PROMPT_MARK_COMMAND = "133";
/** A sane cap on the OSC 133 payload kept for parsing; the bytes themselves always pass through. */
const MAX_PROMPT_MARK_PAYLOAD = 256;

/**
 * One piece of a terminal byte stream: bytes to write, then the OSC 133 prompt mark (`ESC ] 133 ; mark [; arg]`)
 * or full reset (`ESC c`) those bytes just ended with. `arg` is the second `;` field only, as upstream's
 * `data.split(";", 2)` reads it.
 */
export type TerminalStreamItem =
	|
	  {
			bytes: Uint8Array;
	  }
	|
	  {
			mark: string;
			arg: string | undefined;
	  }
	|
	  {
			fullReset: true;
	  };

type MarkState = "ground" | "escape" | "command" | "payload" | "string" | "string-escape";

/**
 * Returns a stateful splitter that cuts a terminal byte stream right after each OSC 133 prompt mark and each
 * full reset, so the caller can write the bytes up to that point and then read the cursor where the shell
 * put it. Every byte passes through; sequences may be split across chunks.
 */
export function createPromptMarkSplitter(): (chunk: Uint8Array) => TerminalStreamItem[]
{
	let state: MarkState = "ground";
	let command = "";
	let payload: string | null = null;

	return (chunk) =>
	{
		const items: TerminalStreamItem[] = [];
		let start = 0;
		const cut = (end: number, event: TerminalStreamItem): void =>
		{
			items.push(
				{
					bytes: chunk.slice(start, end),
				},
			);
			items.push(event);
			start = end;
		};
		const endString = (end: number): void =>
		{
			state = "ground";
			if (payload === null) return;
			const [mark = "", arg] = payload.split(";", 2);
			payload = null;
			cut(
				end,
				{
					mark,
					arg,
				},
			);
		};

		for (let index = 0; index < chunk.length; index++)
		{
			const byte = chunk[index] ?? 0;
			switch (state)
			{
				case "ground":
					if (byte === ESC) state = "escape";
					break;
				case "escape":
					if (byte === OSC_INTRODUCER)
					{
						command = "";
						state = "command";
					}
					else if (byte === ESC)
					{
						state = "escape";
					}
					else
					{
						state = "ground";
						if (byte === FULL_RESET)
						{
							cut(
								index + 1,
								{
									fullReset: true,
								},
							);
						}
					}
					break;
				case "command":
					if (byte >= DIGIT_0 && byte <= DIGIT_9 && command.length < MAX_COMMAND_DIGITS)
					{
						command += String.fromCharCode(byte);
					}
					else if (byte === SEPARATOR && command === PROMPT_MARK_COMMAND)
					{
						payload = "";
						state = "payload";
					}
					else if (byte === BEL)
					{
						endString(index + 1);
					}
					else if (byte === ESC)
					{
						state = "string-escape";
					}
					else
					{
						state = "string";
					}
					break;
				case "payload":
					if (byte === BEL) endString(index + 1);
					else if (byte === ESC) state = "string-escape";
					else if (payload !== null && payload.length < MAX_PROMPT_MARK_PAYLOAD)
						payload += String.fromCharCode(byte);
					break;
				case "string":
					if (byte === BEL) state = "ground";
					else if (byte === ESC) state = "string-escape";
					break;
				case "string-escape":
					if (byte === STRING_TERMINATOR)
					{
						endString(index + 1);
					}
					else
					{
						// Any other byte cuts the string short: the ESC starts a new escape sequence instead.
						payload = null;
						state = "escape";
						index--;
					}
					break;
			}
		}
		if (start < chunk.length || items.length === 0)
			items.push(
				{
					bytes: chunk.slice(start),
				},
			);
		return items;
	};
}
