import {afterEach, describe, expect, it, onTestFinished, vi} from "vite-plus/test";
import type {ToastOptions} from "../src/components/toast-context";
import
{
	attachContext,
	attachPendingUpload,
	attachReply,
	composePrompt,
	formatReply,
	isReplyChip,
	MAX_STAGED_REPLIES,
	REPLY_CAP_MESSAGE,
	ContextAttachmentKindSchema,
	contextChipLabel,
	formatAttachContext,
	formatContextAttachment,
	getContextChips,
	registerComposer,
	removeContextChip,
	resolvePendingUpload,
	dropPendingUpload,
	takeContextChips,
	waitForPendingUploads,
	formatDiffAnnotations,
	recordSentAttachments,
	restoreRejectedAttachments,
	takeBackSend,
	joinPrefill,
	prefillComposer,
	requestComposerShellLine,
	prefillEmptyComposer,
	prefillEmptyVerdict,
	type ContextAttachment,
	type PrefillResult,
} from "../src/lib/context-attach";
import
{
	clearDiffComments,
	getDiffComments,
	openDiffCommentDraft,
	saveDiffComment,
	takeQueuedDiffComments,
} from "../src/lib/diff-comments";
import {schemaChoiceRegistry} from "../src/lib/schema-choices";
import {installLocalStorage} from "./fake-storage";

describe("formatAttachContext", () =>
{
	it("formats a file, a line, a line range and a fenced selection", () =>
	{
		expect(
			{
				file: formatAttachContext(
					{
						path: "src/greet.ts",
					},
				),
				line: formatAttachContext(
					{
						path: "src/greet.ts",
						range:
						{
							start: 4,
							end: 4,
						},
					},
				),
				range: formatAttachContext(
					{
						path: "src/greet.ts",
						range:
						{
							start: 2,
							end: 5,
						},
					},
				),
				selection: formatAttachContext(
					{
						path: "src/greet.ts",
						range:
						{
							start: 2,
							end: 3,
						},
						text: 'const greeting = "hello";\nreturn greeting;',
						language: "typescript",
					},
				),
			},
		).toStrictEqual(
			{
				file: "@src/greet.ts",
				line: "@src/greet.ts#L4",
				range: "@src/greet.ts#L2-5",
				selection: '@src/greet.ts#L2-3\n```typescript\nconst greeting = "hello";\nreturn greeting;\n```',
			},
		);
	});
});

describe("diff annotations", () =>
{
	it("serializes a comment as upstream's In `path` at line N block, fenced snippet, then body, before the prompt", () =>
	{
		expect(
			formatDiffAnnotations(
				[
					{
						path: "src/demo.ts",
						side: "additions",
						line: 3,
						text: "Rename",
						snippet: "const answer = 42;",
						lang: "ts",
					},
				],
				"Go",
			),
		).toBe("In `src/demo.ts` at line 3:\n```ts\nconst answer = 42;\n```\nRename\n\n\nGo");
	});

	it("marks a deletions range (before changes) and skips an absent snippet", () =>
	{
		expect(
			formatDiffAnnotations(
				[
					{
						path: "src/demo.ts",
						side: "deletions",
						line: 5,
						endLine: 7,
						text: "Why?",
					},
				],
				"",
			),
		).toBe("In `src/demo.ts` at lines 5-7 (before changes):\nWhy?");
	});

	it("groups by file in first-seen order, sorts each file by line, and joins blocks with a blank line", () =>
	{
		expect(
			formatDiffAnnotations(
				[
					{
						path: "b.ts",
						side: "additions",
						line: 9,
						text: "Nine",
					},
					{
						path: "a.ts",
						side: "additions",
						line: 1,
						text: "One",
					},
					{
						path: "b.ts",
						side: "additions",
						line: 2,
						endLine: 2,
						text: "Two",
					},
				],
				"",
			),
		).toBe("In `b.ts` at line 2:\nTwo\n\nIn `b.ts` at line 9:\nNine\n\nIn `a.ts` at line 1:\nOne");
	});

	it("fences a snippet one backtick longer than its longest run, sanitizes the path and collapses body blank lines", () =>
	{
		expect(
			formatDiffAnnotations(
				[
					{
						path: "we`ird\nname.md",
						side: "additions",
						line: 4,
						text: "a\n\n\n\nb",
						snippet: "```js\nx\n```",
					},
				],
				"",
			),
		).toBe("In `we'ird name.md` at line 4:\n````\n```js\nx\n```\n````\na\n\nb");
	});

	it("puts the comments ahead of context chips and the prompt, or sends them alone", () =>
	{
		const comments = [
			{
				path: "src/greet.ts",
				side: "additions",
				line: 3,
				text: "Use a constant",
			},
		] as const;
		const context = [
			{
				kind: "file",
				path: "src/alice.ts",
			},
			{
				kind: "terminal",
				text: "bob",
			},
		] as const;
		expect(
			{
				all: composePrompt("Please look", context, comments),
				alone: composePrompt("", [], comments),
				contextOnly: composePrompt("", context, []),
				none: composePrompt("Just a prompt", [], []),
			},
		).toStrictEqual(
			{
				all: "In `src/greet.ts` at line 3:\nUse a constant\n\n\n@src/alice.ts\n\n```\nbob\n```\n\nPlease look",
				alone: "In `src/greet.ts` at line 3:\nUse a constant",
				contextOnly: "@src/alice.ts\n\n```\nbob\n```",
				none: "Just a prompt",
			},
		);
	});
});

describe("context attachments", () =>
{
	it("formats each kind as a mention, a fenced excerpt, or both", () =>
	{
		expect(
			{
				file: formatContextAttachment(
					{
						kind: "file",
						path: "src/greet.ts",
					},
				),
				folder: formatContextAttachment(
					{
						kind: "file",
						path: "src/",
					},
				),
				selection: formatContextAttachment(
					{
						kind: "selection",
						path: "src/greet.ts",
						range:
						{
							start: 2,
							end: 3,
						},
						text: "const alice = 1;\nconst bob = 2;",
						language: "typescript",
					},
				),
				unnumbered: formatContextAttachment(
					{
						kind: "selection",
						path: "README.md",
						text: "Hello",
						language: null,
					},
				),
				terminal: formatContextAttachment(
					{
						kind: "terminal",
						text: "$ echo ```\n```",
					},
				),
			},
		).toStrictEqual(
			{
				file: "@src/greet.ts",
				folder: "@src/",
				selection: "@src/greet.ts#L2-3\n```typescript\nconst alice = 1;\nconst bob = 2;\n```",
				unnumbered: "@README.md\n```\nHello\n```",
				terminal: "````\n$ echo ```\n```\n````",
			},
		);
	});

	it("labels each chip by file name, line range, or terminal", () =>
	{
		expect([
			contextChipLabel(
				{
					kind: "file",
					path: "src/greet.ts",
				},
			),
			contextChipLabel(
				{
					kind: "file",
					path: "src/lib/",
				},
			),
			contextChipLabel(
				{
					kind: "selection",
					path: "src/greet.ts",
					range:
					{
						start: 4,
						end: 4,
					},
				},
			),
			contextChipLabel(
				{
					kind: "selection",
					path: "src/greet.ts",
					range:
					{
						start: 2,
						end: 5,
					},
				},
			),
			contextChipLabel(
				{
					kind: "selection",
					path: "README.md",
					text: "Hello",
				},
			),
			contextChipLabel(
				{
					kind: "terminal",
					text: "$ ls",
				},
			),
		]).toStrictEqual(["greet.ts", "lib/", "greet.ts:4", "greet.ts:2-5", "README.md", "Terminal output"]);
	});

	it("inlines pasted text as is on send and labels it by line count", () =>
	{
		expect(
			{
				formatted: formatContextAttachment(
					{
						kind: "pasted-text",
						text: "a\n```\nb",
					},
				),
				oneLine: contextChipLabel(
					{
						kind: "pasted-text",
						text: "abc",
					},
				),
				threeLines: contextChipLabel(
					{
						kind: "pasted-text",
						text: "a\nb\nc",
					},
				),
				composed: composePrompt(
					"hi",
					[
						{
							kind: "pasted-text",
							text: "x\ny",
						},
					],
					[],
				),
			},
		).toStrictEqual(
			{
				formatted: "a\n```\nb",
				oneLine: "Pasted text · 1 line",
				threeLines: "Pasted text · 3 lines",
				composed: "x\ny\n\nhi",
			},
		);
	});

	it("sends a saved draft verbatim before the typed text, escaping numbered reply markers (upstream Te)", () =>
	{
		expect(
			{
				label: contextChipLabel(
					{
						kind: "saved-draft",
						text: "X",
					},
				),
				composed: composePrompt(
					"go",
					[
						{
							kind: "saved-draft",
							text: "X",
						},
					],
					[],
				),
				escaped: composePrompt(
					"",
					[
						{
							kind: "saved-draft",
							text: "a\n<!-- reply 2 -->\nb <!-- attach -->",
						},
					],
					[],
				),
			},
		).toStrictEqual(
			{
				label: "Saved draft",
				composed: "X\n\ngo",
				escaped: "a\n&lt;!-- reply 2 -->\nb <!-- attach -->",
			},
		);
	});

	it("formats an excerpt as upstream's attach marker and quote, splitting on CR, LF and U+2028/9", () =>
	{
		expect(
			{
				twoLines: formatContextAttachment(
					{
						kind: "excerpt",
						text: "a\nb",
					},
				),
				separators: formatContextAttachment(
					{
						kind: "excerpt",
						text: "a\r\nb\rc\u2028d\u2029e",
					},
				),
				emptyLine: formatContextAttachment(
					{
						kind: "excerpt",
						text: "a\n\nb",
					},
				),
				label: contextChipLabel(
					{
						kind: "excerpt",
						text: "Hermit crabs",
					},
				),
				composed: composePrompt(
					"hi",
					[
						{
							kind: "excerpt",
							text: "x",
						},
						{
							kind: "excerpt",
							text: "y",
						},
					],
					[],
				),
			},
		).toStrictEqual(
			{
				twoLines: "<!-- attach -->\n> a\n> b",
				separators: "<!-- attach -->\n> a\n> b\n> c\n> d\n> e",
				emptyLine: "<!-- attach -->\n> a\n> \n> b",
				label: "Excerpt",
				composed: "<!-- attach -->\n> x\n\n<!-- attach -->\n> y\n\nhi",
			},
		);
	});
});

describe("attachContext", () =>
{
	const SESSION = "carol-session";
	afterEach(() =>
	{
		for (const chip of getContextChips(SESSION)) removeContextChip(SESSION, chip.id);
	});

	it("adds nothing when no composer is mounted for the session", () =>
	{
		expect(
			{
				delivered: attachContext(
					SESSION,
					{
						kind: "file",
						path: "a.ts",
					},
				),
				chips: getContextChips(SESSION),
			},
		).toStrictEqual(
			{
				delivered: false,
				chips: [],
			},
		);
	});

	it("queues chips in attach order, removes one, and empties on take", () =>
	{
		const focused: string[] = [];
		const stop = registerComposer(
			SESSION,
			{
				insertText: () =>
				{
				},
				focus: () => focused.push("focus"),
			},
		);
		const delivered = [
			attachContext(
				SESSION,
				{
					kind: "file",
					path: "alice.ts",
				},
			),
			attachContext(
				SESSION,
				{
					kind: "terminal",
					text: "bob",
				},
			),
			attachContext(
				SESSION,
				{
					kind: "file",
					path: "carol.ts",
				},
			),
		];
		const [, middle] = getContextChips(SESSION);
		if (middle === undefined) throw new Error("no chip");
		removeContextChip(SESSION, middle.id);
		const afterRemove = getContextChips(SESSION).map(({id: _id, ...rest}) => rest);
		const taken = takeContextChips(SESSION).map(({id: _id, ...rest}) => rest);
		stop();

		expect(
			{
				delivered,
				focused,
				afterRemove,
				taken,
				after: getContextChips(SESSION),
			},
		).toStrictEqual(
			{
				delivered: [true, true, true],
				focused: ["focus", "focus", "focus"],
				afterRemove: [
					{
						kind: "file",
						path: "alice.ts",
					},
					{
						kind: "file",
						path: "carol.ts",
					},
				],
				taken: [
					{
						kind: "file",
						path: "alice.ts",
					},
					{
						kind: "file",
						path: "carol.ts",
					},
				],
				after: [],
			},
		);
	});

	it("swaps a pending upload chip in place, and leaves it out of a take", () =>
	{
		const stop = registerComposer(
			SESSION,
			{
				insertText: () =>
				{
				},
				focus: () =>
				{
				},
			},
		);
		attachContext(
			SESSION,
			{
				kind: "file",
				path: "alice.ts",
			},
		);
		const id = attachPendingUpload(
			SESSION,
			{
				kind: "image",
				name: "shot.png",
				previewUrl: "blob:shot",
			},
		);
		attachContext(
			SESSION,
			{
				kind: "file",
				path: "carol.ts",
			},
		);
		if (id === undefined) throw new Error("no pending chip");
		const pending = getContextChips(SESSION).map(({id: _id, ...rest}) => rest);
		const resolved = resolvePendingUpload(
			SESSION,
			id,
			{
				kind: "image",
				path: "/cache/0001.png",
				name: "shot.png",
				previewUrl: "blob:shot",
			},
		);
		const after = getContextChips(SESSION).map((chip) => (
		{
			...chip,
			id: chip.id === id ? "same" : "other",
		}));
		stop();

		expect(
			{
				pending,
				resolved,
				after,
			},
		).toStrictEqual(
			{
				pending: [
					{
						kind: "file",
						path: "alice.ts",
					},
					{
						kind: "image",
						name: "shot.png",
						previewUrl: "blob:shot",
						status: "pending",
					},
					{
						kind: "file",
						path: "carol.ts",
					},
				],
				resolved: true,
				after: [
					{
						kind: "file",
						path: "alice.ts",
						id: "other",
					},
					{
						kind: "image",
						path: "/cache/0001.png",
						name: "shot.png",
						previewUrl: "blob:shot",
						id: "same",
					},
					{
						kind: "file",
						path: "carol.ts",
						id: "other",
					},
				],
			},
		);
	});

	it("takes only settled chips, leaving pending uploads in the strip", () =>
	{
		const stop = registerComposer(
			SESSION,
			{
				insertText: () =>
				{
				},
				focus: () =>
				{
				},
			},
		);
		const id = attachPendingUpload(
			SESSION,
			{
				kind: "file",
				name: "notes.md",
			},
		);
		attachContext(
			SESSION,
			{
				kind: "file",
				path: "alice.ts",
			},
		);
		const taken = takeContextChips(SESSION).map(({id: _id, ...rest}) => rest);
		const left = getContextChips(SESSION).map((chip) => chip.id === id);
		stop();

		expect(
			{
				taken,
				left,
			},
		).toStrictEqual(
			{
				taken: [
					{
						kind: "file",
						path: "alice.ts",
					},
				],
				left: [true],
			},
		);
	});

	it("adds nothing when a removed or dropped pending upload resolves", () =>
	{
		const stop = registerComposer(
			SESSION,
			{
				insertText: () =>
				{
				},
				focus: () =>
				{
				},
			},
		);
		const removed = attachPendingUpload(
			SESSION,
			{
				kind: "image",
				name: "a.png",
			},
		);
		const dropped = attachPendingUpload(
			SESSION,
			{
				kind: "image",
				name: "b.png",
			},
		);
		if (removed === undefined || dropped === undefined) throw new Error("no pending chip");
		removeContextChip(SESSION, removed);
		dropPendingUpload(SESSION, dropped);
		const resolved = [
			resolvePendingUpload(
				SESSION,
				removed,
				{
					kind: "image",
					path: "/cache/a.png",
					name: "a.png",
				},
			),
			resolvePendingUpload(
				SESSION,
				dropped,
				{
					kind: "image",
					path: "/cache/b.png",
					name: "b.png",
				},
			),
		];
		stop();

		expect(
			{
				resolved,
				chips: getContextChips(SESSION),
			},
		).toStrictEqual(
			{
				resolved: [false, false],
				chips: [],
			},
		);
	});

	it("waits until every pending upload in the session has settled", async () =>
	{
		const stop = registerComposer(
			SESSION,
			{
				insertText: () =>
				{
				},
				focus: () =>
				{
				},
			},
		);
		const first = attachPendingUpload(
			SESSION,
			{
				kind: "image",
				name: "a.png",
			},
		);
		const second = attachPendingUpload(
			SESSION,
			{
				kind: "file",
				name: "b.md",
			},
		);
		if (first === undefined || second === undefined) throw new Error("no pending chip");
		const events: string[] = [];
		const waited = waitForPendingUploads(SESSION).then(() => events.push("settled"));
		resolvePendingUpload(
			SESSION,
			first,
			{
				kind: "image",
				path: "/cache/a.png",
				name: "a.png",
			},
		);
		await Promise.resolve();
		events.push("one left");
		dropPendingUpload(SESSION, second);
		await waited;
		await waitForPendingUploads(SESSION);
		events.push("none pending resolves at once");
		stop();

		expect(events).toStrictEqual(["one left", "settled", "none pending resolves at once"]);
	});

	it("puts a rejected send's saved draft back as a saved-draft chip, handing back only the typed text", () =>
	{
		const stop = registerComposer(
			SESSION,
			{
				insertText: () =>
				{
				},
				focus: () =>
				{
				},
			},
		);
		attachContext(
			SESSION,
			{
				kind: "saved-draft",
				text: "Grace's draft",
			},
		);
		const sent = takeContextChips(SESSION);
		const composed = composePrompt("go", sent, []);
		recordSentAttachments(SESSION, composed, "go", sent);

		const restored = restoreRejectedAttachments(SESSION, composed);
		const chips = getContextChips(SESSION).map(({id: _id, ...rest}) => rest);
		takeContextChips(SESSION);
		stop();

		expect(
			{
				composed,
				restored,
				chips,
			},
		).toStrictEqual(
			{
				composed: "Grace's draft\n\ngo",
				restored: "go",
				chips: [
					{
						kind: "saved-draft",
						text: "Grace's draft",
					},
				],
			},
		);
	});

	it("appends a rejected send's tiles after the strip and hands back its typed text, once", () =>
	{
		const stop = registerComposer(
			SESSION,
			{
				insertText: () =>
				{
				},
				focus: () =>
				{
				},
			},
		);
		attachContext(
			SESSION,
			{
				kind: "file",
				path: "alice.ts",
			},
		);
		attachContext(
			SESSION,
			{
				kind: "image",
				path: "/cache/bob.png",
				name: "bob.png",
			},
		);
		const sent = takeContextChips(SESSION);
		const composed = composePrompt("hi", sent, []);
		recordSentAttachments(SESSION, composed, "hi", sent);
		attachContext(
			SESSION,
			{
				kind: "terminal",
				text: "carol",
			},
		);

		const restored = restoreRejectedAttachments(SESSION, composed);
		const chips = getContextChips(SESSION).map(({id: _id, ...rest}) => rest);
		const freshIds = getContextChips(SESSION).every((chip) => !sent.some((each) => each.id === chip.id));
		const again = restoreRejectedAttachments(SESSION, composed);
		const unknown = restoreRejectedAttachments(SESSION, "never sent");
		stop();

		expect(
			{
				restored,
				chips,
				freshIds,
				again,
				unknown,
			},
		).toStrictEqual(
			{
				restored: "hi",
				chips: [
					{
						kind: "terminal",
						text: "carol",
					},
					{
						kind: "file",
						path: "alice.ts",
					},
					{
						kind: "image",
						path: "/cache/bob.png",
						name: "bob.png",
					},
				],
				freshIds: true,
				again: null,
				unknown: null,
			},
		);
	});

	it("restores a rejected send's images through the 5-image cap, warning once", () =>
	{
		const stop = registerComposer(
			SESSION,
			{
				insertText: () =>
				{
				},
				focus: () =>
				{
				},
			},
		);
		attachContext(
			SESSION,
			{
				kind: "image",
				path: "/cache/alice.png",
				name: "alice.png",
			},
		);
		attachContext(
			SESSION,
			{
				kind: "image",
				path: "/cache/bob.png",
				name: "bob.png",
			},
		);
		attachContext(
			SESSION,
			{
				kind: "file",
				path: "carol.ts",
			},
		);
		const sent = takeContextChips(SESSION);
		const composed = composePrompt("hi", sent, []);
		recordSentAttachments(SESSION, composed, "hi", sent);
		for (const name of ["d", "e", "f", "g"])
			attachContext(
				SESSION,
				{
					kind: "image",
					path: `/cache/${name}.png`,
					name,
				},
			);
		const notify = vi.fn<(options: ToastOptions) => void>();

		const restored = restoreRejectedAttachments(SESSION, composed, notify);
		const chips = getContextChips(SESSION).map(({id: _id, ...rest}) => rest);
		stop();

		expect(
			{
				restored,
				chips,
				toasts: notify.mock.calls,
			},
		).toStrictEqual(
			{
				restored: "hi",
				chips: [
					{
						kind: "image",
						path: "/cache/d.png",
						name: "d",
					},
					{
						kind: "image",
						path: "/cache/e.png",
						name: "e",
					},
					{
						kind: "image",
						path: "/cache/f.png",
						name: "f",
					},
					{
						kind: "image",
						path: "/cache/g.png",
						name: "g",
					},
					{
						kind: "image",
						path: "/cache/alice.png",
						name: "alice.png",
					},
					{
						kind: "file",
						path: "carol.ts",
					},
				],
				toasts: [
					[
						{
							kind: "warning",
							message: "Maximum of 5 images allowed.",
							durationMs: 8000,
						},
					],
				],
			},
		);
	});

	it("takes a sent prompt back as its typed text plus its tiles", () =>
	{
		const takenBack: string[] = [];
		const stop = registerComposer(
			SESSION,
			{
				insertText: () =>
				{
				},
				focus: () =>
				{
				},
				takeBack: (text) =>
				{
					takenBack.push(text);
					return true;
				},
			},
		);
		attachContext(
			SESSION,
			{
				kind: "file",
				path: "alice.ts",
			},
		);
		const sent = takeContextChips(SESSION);
		const composed = composePrompt("hi", sent, []);
		recordSentAttachments(SESSION, composed, "hi", sent);
		attachContext(
			SESSION,
			{
				kind: "terminal",
				text: "bob",
			},
		);

		const taken = takeBackSend(SESSION, composed);
		const chips = getContextChips(SESSION).map(({id: _id, ...rest}) => rest);
		const unrecorded = takeBackSend(SESSION, "plain prompt");
		const after = getContextChips(SESSION).map(({id: _id, ...rest}) => rest);
		stop();

		expect(
			{
				taken,
				takenBack,
				chips,
				unrecorded,
				after,
			},
		).toStrictEqual(
			{
				taken: true,
				takenBack: ["hi", "plain prompt"],
				chips: [
					{
						kind: "terminal",
						text: "bob",
					},
					{
						kind: "file",
						path: "alice.ts",
					},
				],
				unrecorded: true,
				after: [
					{
						kind: "terminal",
						text: "bob",
					},
					{
						kind: "file",
						path: "alice.ts",
					},
				],
			},
		);
	});

	it("keeps the record and adds no tiles when the composer refuses a take-back", () =>
	{
		let accept = false;
		const takenBack: string[] = [];
		const stop = registerComposer(
			SESSION,
			{
				insertText: () =>
				{
				},
				focus: () =>
				{
				},
				takeBack: (text) =>
				{
					takenBack.push(text);
					return accept;
				},
			},
		);
		attachContext(
			SESSION,
			{
				kind: "file",
				path: "alice.ts",
			},
		);
		const sent = takeContextChips(SESSION);
		const composed = composePrompt("hi", sent, []);
		recordSentAttachments(SESSION, composed, "hi", sent);

		const refused = takeBackSend(SESSION, composed);
		const chipsAfterRefusal = getContextChips(SESSION).length;
		accept = true;
		const accepted = takeBackSend(SESSION, composed);
		const chips = getContextChips(SESSION).map(({id: _id, ...rest}) => rest);
		stop();

		expect(
			{
				refused,
				chipsAfterRefusal,
				accepted,
				takenBack,
				chips,
			},
		).toStrictEqual(
			{
				refused: false,
				chipsAfterRefusal: 0,
				accepted: true,
				takenBack: ["hi", "hi"],
				chips: [
					{
						kind: "file",
						path: "alice.ts",
					},
				],
			},
		);
	});

	it("re-queues a rejected send's diff comments and hands back only its typed text", () =>
	{
		// The diff comment store persists to localStorage; without a fake, Node's own unconfigured global prints an
		// ExperimentalWarning into the test run.
		const original = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
		installLocalStorage();
		onTestFinished(() =>
		{
			if (original === undefined) Reflect.deleteProperty(globalThis, "localStorage");
			else Object.defineProperty(globalThis, "localStorage", original);
		});
		clearDiffComments(SESSION);
		const draftId = openDiffCommentDraft(
			SESSION,
			{
				path: "a.ts",
				side: "additions",
				line: 3,
			},
		);
		saveDiffComment(SESSION, draftId, "Rename this");
		const queued = getDiffComments(SESSION).queued;
		const comments = takeQueuedDiffComments(SESSION);
		const composed = composePrompt("hi", [], comments);
		recordSentAttachments(SESSION, composed, "hi", [], comments);

		const restored = restoreRejectedAttachments(SESSION, composed);
		const after = getDiffComments(SESSION).queued;
		clearDiffComments(SESSION);

		expect(
			{
				restored,
				after,
			},
		).toStrictEqual(
			{
				restored: "hi",
				after: queued,
			},
		);
	});

	it("records nothing for a send without tiles", () =>
	{
		recordSentAttachments(SESSION, "hi", "hi", []);

		expect(
			{
				restored: restoreRejectedAttachments(SESSION, "hi"),
				chips: getContextChips(SESSION),
			},
		).toStrictEqual(
			{
				restored: null,
				chips: [],
			},
		);
	});

	it("registers every kind in the schema choice registry", () =>
	{
		expect(
			{
				options: ContextAttachmentKindSchema.options,
				registry: schemaChoiceRegistry["ContextAttachmentKindSchema"],
			},
		).toStrictEqual(
			{
				options: ["file", "selection", "terminal", "image", "message", "excerpt", "pasted-text", "saved-draft"],
				registry:
				{
					file: "File",
					selection: "Selection",
					terminal: "Terminal output",
					image: "Image",
					message: "Message",
					excerpt: "Excerpt",
					"pasted-text": "Pasted text",
					"saved-draft": "Saved draft",
				},
			},
		);
	});
});

describe("joinPrefill", () =>
{
	it("appends with no separator, spacing only after an unspaced @mention token", () =>
	{
		expect([
			joinPrefill("", "orig"),
			joinPrefill("abc", "orig"),
			joinPrefill("see @src/a.ts", "orig"),
			joinPrefill("mail a@b.com", "x"),
			joinPrefill("see @a ", "orig"),
			joinPrefill("@a", " orig"),
		]).toStrictEqual(["orig", "abcorig", "see @src/a.ts orig", "mail a@b.comx", "see @a orig", "@a orig"]);
	});
});

describe("prefillComposer", () =>
{
	it("is false with no composer mounted", () =>
	{
		expect(prefillComposer("prefill-none", "orig")).toBe(false);
	});

	it("passes on a refusal from the mounted composer", () =>
	{
		const prefill = vi.fn<(text: string) => boolean>(() => false);
		const unregister = registerComposer(
			"prefill-refused",
			{
				insertText: () =>
				{
				},
				focus: () =>
				{
				},
				prefill,
			},
		);
		expect(
			{
				result: prefillComposer("prefill-refused", "orig"),
				calls: prefill.mock.calls,
			},
		).toStrictEqual(
			{
				result: false,
				calls: [["orig"]],
			},
		);
		unregister();
	});

	it("is true when the composer took it", () =>
	{
		const unregister = registerComposer(
			"prefill-ok",
			{
				insertText: () =>
				{
				},
				focus: () =>
				{
				},
				prefill: () => true,
			},
		);
		expect(prefillComposer("prefill-ok", "orig")).toBe(true);
		unregister();
	});
});

describe("requestComposerShellLine (upstream prefillEmptyShellLine)", () =>
{
	function shellHandle(prefillShell?: (command: string, ignoreStrayEnter: boolean) => PrefillResult)
	{
		return {
			insertText: () =>
			{
			},
			focus: () =>
			{
			},
			...(prefillShell === undefined
				? {}
				:
					{
						prefillShell,
					}),
		};
	}

	it("is unavailable with no composer mounted", () =>
	{
		expect(requestComposerShellLine("shell-none", "ls")).toBe("unavailable");
	});

	it("passes the composer's result and the stray-Enter flag through", () =>
	{
		const prefillShell = vi.fn<(command: string, ignoreStrayEnter: boolean) => PrefillResult>(() => "has_draft");
		const unregister = registerComposer("shell-draft", shellHandle(prefillShell));
		expect(
			{
				plain: requestComposerShellLine("shell-draft", "ls"),
				guarded: requestComposerShellLine(
					"shell-draft",
					"ls",
					{
						ignoreStrayEnter: true,
					},
				),
				calls: prefillShell.mock.calls,
			},
		).toStrictEqual(
			{
				plain: "has_draft",
				guarded: "has_draft",
				calls: [
					["ls", false],
					["ls", true],
				],
			},
		);
		unregister();
	});

	it("is unavailable when the mounted composer can't take a shell line, like the home composer", () =>
	{
		const unregister = registerComposer("shell-home", shellHandle());
		expect(requestComposerShellLine("shell-home", "ls")).toBe("unavailable");
		unregister();
	});

	it("stops at the first composer that inserted it", () =>
	{
		const first = vi.fn<(command: string, ignoreStrayEnter: boolean) => PrefillResult>(() => "inserted");
		const second = vi.fn<(command: string, ignoreStrayEnter: boolean) => PrefillResult>(() => "inserted");
		const stopFirst = registerComposer("shell-two", shellHandle(first));
		const stopSecond = registerComposer("shell-two", shellHandle(second));
		expect(
			{
				result: requestComposerShellLine("shell-two", "ls"),
				first: first.mock.calls,
				second: second.mock.calls,
			},
		).toStrictEqual(
			{
				result: "inserted",
				first: [["ls", false]],
				second: [],
			},
		);
		stopFirst();
		stopSecond();
	});

	it("maps a throwing composer to unavailable, as upstream's resolver maps a throw to no_shell", () =>
	{
		const unregister = registerComposer(
			"shell-throw",
			shellHandle(() =>
			{
				throw new Error("boom");
			}),
		);
		expect(requestComposerShellLine("shell-throw", "ls")).toBe("unavailable");
		unregister();
	});
});

describe("prefillEmptyVerdict (upstream FNe)", () =>
{
	const idle =
	{
		bashMode: false,
		sending: false,
	};

	it("writes into an empty or blank box, or over the replaceable text, and only focuses on the same text", () =>
	{
		expect(
			{
				empty: prefillEmptyVerdict("", "/goal fake goal", "/goal clear", idle),
				blank: prefillEmptyVerdict("  \n", "/goal fake goal", "/goal clear", idle),
				replaceable: prefillEmptyVerdict(" /goal clear ", "/goal fake goal", "/goal clear", idle),
				same: prefillEmptyVerdict("/goal fake goal  ", " /goal fake goal", "/goal clear", idle),
			},
		).toStrictEqual(
			{
				empty: "write",
				blank: "write",
				replaceable: "write",
				same: "focus",
			},
		);
	});

	it("refuses another draft, bash mode and a send in flight as has_draft", () =>
	{
		expect(
			{
				draft: prefillEmptyVerdict("other fake draft", "/goal clear", "/goal fake goal", idle),
				noReplaceable: prefillEmptyVerdict("/goal fake goal", "/goal clear", undefined, idle),
				bashMode: prefillEmptyVerdict(
					"",
					"/goal clear",
					undefined,
					{
						bashMode: true,
						sending: false,
					},
				),
				sending: prefillEmptyVerdict(
					"/goal clear",
					"/goal clear",
					undefined,
					{
						bashMode: false,
						sending: true,
					},
				),
			},
		).toStrictEqual(
			{
				draft: "has_draft",
				noReplaceable: "has_draft",
				bashMode: "has_draft",
				sending: "has_draft",
			},
		);
	});
});

describe("prefillEmptyComposer (upstream prefillEmptyComposer)", () =>
{
	it("is unavailable with no composer mounted, or one that can't take it", () =>
	{
		const unregister = registerComposer(
			"empty-home",
			{
				insertText: () =>
				{
				},
				focus: () =>
				{
				},
			},
		);
		expect(
			{
				none: prefillEmptyComposer("empty-none", "/goal clear"),
				home: prefillEmptyComposer("empty-home", "/goal clear"),
			},
		).toStrictEqual(
			{
				none: "unavailable",
				home: "unavailable",
			},
		);
		unregister();
	});

	it("passes the text, replaceable text and stray-Enter flag through, and the composer's result back", () =>
	{
		const prefillEmpty = vi.fn<
			(text: string, replaceable: string | undefined, ignoreStrayEnter: boolean) => PrefillResult
		>(() => "has_draft");
		const unregister = registerComposer(
			"empty-draft",
			{
				insertText: () =>
				{
				},
				focus: () =>
				{
				},
				prefillEmpty,
			},
		);
		expect(
			{
				plain: prefillEmptyComposer("empty-draft", "/goal clear"),
				full: prefillEmptyComposer(
					"empty-draft",
					"/goal clear",
					{
						replaceable: "/goal fake goal",
						ignoreStrayEnter: true,
					},
				),
				calls: prefillEmpty.mock.calls,
			},
		).toStrictEqual(
			{
				plain: "has_draft",
				full: "has_draft",
				calls: [
					["/goal clear", undefined, false],
					["/goal clear", "/goal fake goal", true],
				],
			},
		);
		unregister();
	});
});

describe("attachReply (upstream attachReply + the 99-reply cap)", () =>
{
	const SESSION = "erin-session";
	afterEach(() =>
	{
		for (const chip of getContextChips(SESSION)) removeContextChip(SESSION, chip.id);
	});

	function mountComposer(): () => void
	{
		return registerComposer(
			SESSION,
			{
				insertText: () =>
				{
				},
				focus: () =>
				{
				},
			},
		);
	}

	it("stages a blank comment as a plain Excerpt and a real one as a reply chip, untrimmed", () =>
	{
		const stop = mountComposer();
		const notify = vi.fn<(options: ToastOptions) => void>();
		const results = [attachReply(SESSION, "q", "  ", notify), attachReply(SESSION, "q", " fix it ", notify)];
		const chips = getContextChips(SESSION).map(({id: _id, ...rest}) => rest);
		stop();

		expect(
			{
				results,
				chips,
				replies: chips.map(isReplyChip),
				toasts: notify.mock.calls,
			},
		).toStrictEqual(
			{
				results: [true, true],
				chips: [
					{
						kind: "excerpt",
						text: "q",
					},
					{
						kind: "excerpt",
						text: "q",
						comment: " fix it ",
					},
				],
				replies: [false, true],
				toasts: [],
			},
		);
	});

	it("refuses the 100th reply with upstream's 8 s cap toast, yet still takes a blank-comment Excerpt", () =>
	{
		const stop = mountComposer();
		const notify = vi.fn<(options: ToastOptions) => void>();
		for (let index = 0; index < MAX_STAGED_REPLIES; index++) attachReply(SESSION, `q${index}`, `c${index}`, notify);
		const refused = attachReply(SESSION, "q99", "c99", notify);
		const excerpt = attachReply(SESSION, "plain", "", notify);
		const chips = getContextChips(SESSION);
		stop();

		expect(
			{
				max: MAX_STAGED_REPLIES,
				refused,
				excerpt,
				replies: chips.filter(isReplyChip).length,
				last: chips.at(-1)?.text,
				toasts: notify.mock.calls,
			},
		).toStrictEqual(
			{
				max: 99,
				refused: false,
				excerpt: true,
				replies: 99,
				last: "plain",
				toasts: [
					[
						{
							kind: "warning",
							message: "Your prompt can hold up to 99 replies. Send it, then add more.",
							durationMs: 8000,
						},
					],
				],
			},
		);
		expect(REPLY_CAP_MESSAGE).toBe("Your prompt can hold up to 99 replies. Send it, then add more.");
	});

	it("only counts excerpt chips with a non-blank string comment as replies (upstream R)", () =>
	{
		expect(
			[
				{
					kind: "excerpt",
					text: "q",
					comment: "c",
				},
				{
					kind: "excerpt",
					text: "q",
					comment: " \n ",
				},
				{
					kind: "excerpt",
					text: "q",
				},
				{
					kind: "terminal",
					text: "q",
					comment: "c",
				},
				{
					kind: "excerpt",
					comment: "c",
				},
			].map((chip) => isReplyChip(chip as Parameters<typeof isReplyChip>[0])),
		).toStrictEqual([true, false, false, false, false]);
	});
});

describe("reply chips on send (upstream Ie/Re/De)", () =>
{
	function reply(text: string, comment: string): ContextAttachment
	{
		return {
			kind: "excerpt",
			text,
			comment,
		};
	}

	const excerpt: ContextAttachment =
	{
		kind: "excerpt",
		text: "e",
	};

	it("formats one reply as a quoted block over its trimmed comment", () =>
	{
		expect(formatReply("a\nb", " hi ")).toBe("<!-- reply -->\n> a\n> b\n\nhi");
	});

	it("leads with the numbered reply blocks, then the attach blocks and the typed text", () =>
	{
		expect(composePrompt("p", [reply("q1", "c1"), excerpt, reply("q2", "c2")], [])).toBe(
			"<!-- reply 2 -->\n> q1\n\nc1\n\n<!-- reply -->\n> q2\n\nc2\n\n\n<!-- attach -->\n> e\n\np",
		);
	});

	it("keeps file mentions in front of the replies", () =>
	{
		const file: ContextAttachment =
		{
			kind: "file",
			path: "alice.ts",
		};
		expect(composePrompt("p", [reply("q", "c"), file], [])).toBe(
			`${formatContextAttachment(file)}\n\n<!-- reply 1 -->\n> q\n\nc\n\n\np`,
		);
	});

	it("escapes reply markers in comments and collapses runs of blank lines", () =>
	{
		expect(composePrompt("", [reply("q", "<!-- reply -->\na\n\n\n\nb")], [])).toBe(
			"<!-- reply 1 -->\n> q\n\n&lt;!-- reply -->\na\n\nb",
		);
	});

	it("sends replies past 99 as plain quote text after the attach blocks, numbered markers escaped", () =>
	{
		const replies = Array.from(
			{
				length: 100,
			},
			(_, index) => reply(`q${index + 1}`, `c${index + 1}`),
		);
		replies[99] = reply("q100", " c100 <!-- reply 3 --> ");
		const composed = composePrompt("p <!-- reply 7 -->", [...replies, excerpt], []);
		const lead = replies
			.slice(0, 99)
			.map(
				({text, comment}, index) =>
					`${index === 0 ? "<!-- reply 99 -->" : "<!-- reply -->"}\n> ${text}\n\n${comment}`,
			)
			.join("\n\n");
		expect(composed).toBe(
			`${lead}\n\n\n<!-- attach -->\n> e\n\n> q100\n\nc100 &lt;!-- reply 3 -->\n\np &lt;!-- reply 7 -->`,
		);
	});
});
