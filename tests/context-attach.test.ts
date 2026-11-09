import {afterEach, describe, expect, it, vi} from "vite-plus/test";
import type {ToastOptions} from "../src/components/toast-context";
import {
	attachContext,
	attachPendingUpload,
	composePrompt,
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
	formatReviewComment,
	formatReviewComments,
	recordSentAttachments,
	restoreRejectedAttachments,
	takeBackSend,
	joinPrefill,
	prefillComposer,
} from "../src/lib/context-attach";
import {
	clearDiffComments,
	getDiffComments,
	openDiffCommentDraft,
	saveDiffComment,
	takeQueuedDiffComments,
} from "../src/lib/diff-comments";
import {schemaChoiceRegistry} from "../src/lib/schema-choices";

describe("formatAttachContext", () => {
	it("formats a file, a line, a line range and a fenced selection", () => {
		expect({
			file: formatAttachContext({path: "src/greet.ts"}),
			line: formatAttachContext({path: "src/greet.ts", range: {start: 4, end: 4}}),
			range: formatAttachContext({path: "src/greet.ts", range: {start: 2, end: 5}}),
			selection: formatAttachContext({
				path: "src/greet.ts",
				range: {start: 2, end: 3},
				text: 'const greeting = "hello";\nreturn greeting;',
				language: "typescript",
			}),
		}).toStrictEqual({
			file: "@src/greet.ts",
			line: "@src/greet.ts#L4",
			range: "@src/greet.ts#L2-5",
			selection: '@src/greet.ts#L2-3\n```typescript\nconst greeting = "hello";\nreturn greeting;\n```',
		});
	});
});

describe("review comments", () => {
	it("formats a comment as a path:line block, with a line range when it spans lines", () => {
		expect({
			line: formatReviewComment({path: "src/greet.ts", line: 3, text: "Use a constant"}),
			range: formatReviewComment({
				path: "src/greet.ts",
				line: 3,
				endLine: 5,
				text: "Extract this\ninto a helper",
			}),
		}).toStrictEqual({
			line: "src/greet.ts:3 — Use a constant",
			range: "src/greet.ts:3-5 — Extract this\ninto a helper",
		});
	});

	it("separates comment blocks with a blank line", () => {
		expect(
			formatReviewComments([
				{path: "src/greet.ts", line: 3, text: "Use a constant"},
				{path: "README.md", line: 1, endLine: 1, text: "Typo in the title"},
			]),
		).toBe("src/greet.ts:3 — Use a constant\n\nREADME.md:1 — Typo in the title");
	});

	it("prepends queued comments to the prompt, or sends them alone", () => {
		const comments = [{path: "src/greet.ts", line: 3, text: "Use a constant"}];
		expect({
			withPrompt: composePrompt("Please address these", [], comments),
			alone: composePrompt("", [], comments),
			none: composePrompt("Just a prompt", [], []),
		}).toStrictEqual({
			withPrompt: "src/greet.ts:3 — Use a constant\n\nPlease address these",
			alone: "src/greet.ts:3 — Use a constant",
			none: "Just a prompt",
		});
	});
});

describe("context attachments", () => {
	it("formats each kind as a mention, a fenced excerpt, or both", () => {
		expect({
			file: formatContextAttachment({kind: "file", path: "src/greet.ts"}),
			folder: formatContextAttachment({kind: "file", path: "src/"}),
			selection: formatContextAttachment({
				kind: "selection",
				path: "src/greet.ts",
				range: {start: 2, end: 3},
				text: "const alice = 1;\nconst bob = 2;",
				language: "typescript",
			}),
			unnumbered: formatContextAttachment({
				kind: "selection",
				path: "README.md",
				text: "Hello",
				language: null,
			}),
			terminal: formatContextAttachment({kind: "terminal", text: "$ echo ```\n```"}),
		}).toStrictEqual({
			file: "@src/greet.ts",
			folder: "@src/",
			selection: "@src/greet.ts#L2-3\n```typescript\nconst alice = 1;\nconst bob = 2;\n```",
			unnumbered: "@README.md\n```\nHello\n```",
			terminal: "````\n$ echo ```\n```\n````",
		});
	});

	it("labels each chip by file name, line range, or terminal", () => {
		expect([
			contextChipLabel({kind: "file", path: "src/greet.ts"}),
			contextChipLabel({kind: "file", path: "src/lib/"}),
			contextChipLabel({kind: "selection", path: "src/greet.ts", range: {start: 4, end: 4}}),
			contextChipLabel({kind: "selection", path: "src/greet.ts", range: {start: 2, end: 5}}),
			contextChipLabel({kind: "selection", path: "README.md", text: "Hello"}),
			contextChipLabel({kind: "terminal", text: "$ ls"}),
		]).toStrictEqual(["greet.ts", "lib/", "greet.ts:4", "greet.ts:2-5", "README.md", "Terminal output"]);
	});

	it("inlines pasted text as is on send and labels it by line count", () => {
		expect({
			formatted: formatContextAttachment({kind: "pasted-text", text: "a\n```\nb"}),
			oneLine: contextChipLabel({kind: "pasted-text", text: "abc"}),
			threeLines: contextChipLabel({kind: "pasted-text", text: "a\nb\nc"}),
			composed: composePrompt("hi", [{kind: "pasted-text", text: "x\ny"}], []),
		}).toStrictEqual({
			formatted: "a\n```\nb",
			oneLine: "Pasted text · 1 line",
			threeLines: "Pasted text · 3 lines",
			composed: "x\ny\n\nhi",
		});
	});

	it("formats an excerpt as upstream's attach marker and quote, splitting on CR, LF and U+2028/9", () => {
		expect({
			twoLines: formatContextAttachment({kind: "excerpt", text: "a\nb"}),
			separators: formatContextAttachment({kind: "excerpt", text: "a\r\nb\rc\u2028d\u2029e"}),
			emptyLine: formatContextAttachment({kind: "excerpt", text: "a\n\nb"}),
			label: contextChipLabel({kind: "excerpt", text: "Hermit crabs"}),
			composed: composePrompt(
				"hi",
				[
					{kind: "excerpt", text: "x"},
					{kind: "excerpt", text: "y"},
				],
				[],
			),
		}).toStrictEqual({
			twoLines: "<!-- attach -->\n> a\n> b",
			separators: "<!-- attach -->\n> a\n> b\n> c\n> d\n> e",
			emptyLine: "<!-- attach -->\n> a\n> \n> b",
			label: "Excerpt",
			composed: "<!-- attach -->\n> x\n\n<!-- attach -->\n> y\n\nhi",
		});
	});

	it("serializes context, then review comments, then the prompt", () => {
		const context = [
			{kind: "file", path: "src/alice.ts"},
			{kind: "terminal", text: "bob"},
		] as const;
		const comments = [{path: "src/greet.ts", line: 3, text: "Use a constant"}];
		expect({
			all: composePrompt("Please look", context, comments),
			contextOnly: composePrompt("", context, []),
			none: composePrompt("Just a prompt", [], []),
		}).toStrictEqual({
			all: "@src/alice.ts\n\n```\nbob\n```\n\nsrc/greet.ts:3 — Use a constant\n\nPlease look",
			contextOnly: "@src/alice.ts\n\n```\nbob\n```",
			none: "Just a prompt",
		});
	});
});

describe("attachContext", () => {
	const SESSION = "carol-session";
	afterEach(() => {
		for (const chip of getContextChips(SESSION)) removeContextChip(SESSION, chip.id);
	});

	it("adds nothing when no composer is mounted for the session", () => {
		expect({
			delivered: attachContext(SESSION, {kind: "file", path: "a.ts"}),
			chips: getContextChips(SESSION),
		}).toStrictEqual({delivered: false, chips: []});
	});

	it("queues chips in attach order, removes one, and empties on take", () => {
		const focused: string[] = [];
		const stop = registerComposer(SESSION, {
			insertText: () => {},
			focus: () => focused.push("focus"),
		});
		const delivered = [
			attachContext(SESSION, {kind: "file", path: "alice.ts"}),
			attachContext(SESSION, {kind: "terminal", text: "bob"}),
			attachContext(SESSION, {kind: "file", path: "carol.ts"}),
		];
		const [, middle] = getContextChips(SESSION);
		if (middle === undefined) throw new Error("no chip");
		removeContextChip(SESSION, middle.id);
		const afterRemove = getContextChips(SESSION).map(({id: _id, ...rest}) => rest);
		const taken = takeContextChips(SESSION).map(({id: _id, ...rest}) => rest);
		stop();

		expect({
			delivered,
			focused,
			afterRemove,
			taken,
			after: getContextChips(SESSION),
		}).toStrictEqual({
			delivered: [true, true, true],
			focused: ["focus", "focus", "focus"],
			afterRemove: [
				{kind: "file", path: "alice.ts"},
				{kind: "file", path: "carol.ts"},
			],
			taken: [
				{kind: "file", path: "alice.ts"},
				{kind: "file", path: "carol.ts"},
			],
			after: [],
		});
	});

	it("swaps a pending upload chip in place, and leaves it out of a take", () => {
		const stop = registerComposer(SESSION, {insertText: () => {}, focus: () => {}});
		attachContext(SESSION, {kind: "file", path: "alice.ts"});
		const id = attachPendingUpload(SESSION, {kind: "image", name: "shot.png", previewUrl: "blob:shot"});
		attachContext(SESSION, {kind: "file", path: "carol.ts"});
		if (id === undefined) throw new Error("no pending chip");
		const pending = getContextChips(SESSION).map(({id: _id, ...rest}) => rest);
		const resolved = resolvePendingUpload(SESSION, id, {
			kind: "image",
			path: "/cache/0001.png",
			name: "shot.png",
			previewUrl: "blob:shot",
		});
		const after = getContextChips(SESSION).map((chip) => ({...chip, id: chip.id === id ? "same" : "other"}));
		stop();

		expect({pending, resolved, after}).toStrictEqual({
			pending: [
				{kind: "file", path: "alice.ts"},
				{kind: "image", name: "shot.png", previewUrl: "blob:shot", status: "pending"},
				{kind: "file", path: "carol.ts"},
			],
			resolved: true,
			after: [
				{kind: "file", path: "alice.ts", id: "other"},
				{kind: "image", path: "/cache/0001.png", name: "shot.png", previewUrl: "blob:shot", id: "same"},
				{kind: "file", path: "carol.ts", id: "other"},
			],
		});
	});

	it("takes only settled chips, leaving pending uploads in the strip", () => {
		const stop = registerComposer(SESSION, {insertText: () => {}, focus: () => {}});
		const id = attachPendingUpload(SESSION, {kind: "file", name: "notes.md"});
		attachContext(SESSION, {kind: "file", path: "alice.ts"});
		const taken = takeContextChips(SESSION).map(({id: _id, ...rest}) => rest);
		const left = getContextChips(SESSION).map((chip) => chip.id === id);
		stop();

		expect({taken, left}).toStrictEqual({taken: [{kind: "file", path: "alice.ts"}], left: [true]});
	});

	it("adds nothing when a removed or dropped pending upload resolves", () => {
		const stop = registerComposer(SESSION, {insertText: () => {}, focus: () => {}});
		const removed = attachPendingUpload(SESSION, {kind: "image", name: "a.png"});
		const dropped = attachPendingUpload(SESSION, {kind: "image", name: "b.png"});
		if (removed === undefined || dropped === undefined) throw new Error("no pending chip");
		removeContextChip(SESSION, removed);
		dropPendingUpload(SESSION, dropped);
		const resolved = [
			resolvePendingUpload(SESSION, removed, {kind: "image", path: "/cache/a.png", name: "a.png"}),
			resolvePendingUpload(SESSION, dropped, {kind: "image", path: "/cache/b.png", name: "b.png"}),
		];
		stop();

		expect({resolved, chips: getContextChips(SESSION)}).toStrictEqual({resolved: [false, false], chips: []});
	});

	it("waits until every pending upload in the session has settled", async () => {
		const stop = registerComposer(SESSION, {insertText: () => {}, focus: () => {}});
		const first = attachPendingUpload(SESSION, {kind: "image", name: "a.png"});
		const second = attachPendingUpload(SESSION, {kind: "file", name: "b.md"});
		if (first === undefined || second === undefined) throw new Error("no pending chip");
		const events: string[] = [];
		const waited = waitForPendingUploads(SESSION).then(() => events.push("settled"));
		resolvePendingUpload(SESSION, first, {kind: "image", path: "/cache/a.png", name: "a.png"});
		await Promise.resolve();
		events.push("one left");
		dropPendingUpload(SESSION, second);
		await waited;
		await waitForPendingUploads(SESSION);
		events.push("none pending resolves at once");
		stop();

		expect(events).toStrictEqual(["one left", "settled", "none pending resolves at once"]);
	});

	it("appends a rejected send's tiles after the strip and hands back its typed text, once", () => {
		const stop = registerComposer(SESSION, {insertText: () => {}, focus: () => {}});
		attachContext(SESSION, {kind: "file", path: "alice.ts"});
		attachContext(SESSION, {kind: "image", path: "/cache/bob.png", name: "bob.png"});
		const sent = takeContextChips(SESSION);
		const composed = composePrompt("hi", sent, []);
		recordSentAttachments(SESSION, composed, "hi", sent);
		attachContext(SESSION, {kind: "terminal", text: "carol"});

		const restored = restoreRejectedAttachments(SESSION, composed);
		const chips = getContextChips(SESSION).map(({id: _id, ...rest}) => rest);
		const freshIds = getContextChips(SESSION).every((chip) => !sent.some((each) => each.id === chip.id));
		const again = restoreRejectedAttachments(SESSION, composed);
		const unknown = restoreRejectedAttachments(SESSION, "never sent");
		stop();

		expect({restored, chips, freshIds, again, unknown}).toStrictEqual({
			restored: "hi",
			chips: [
				{kind: "terminal", text: "carol"},
				{kind: "file", path: "alice.ts"},
				{kind: "image", path: "/cache/bob.png", name: "bob.png"},
			],
			freshIds: true,
			again: null,
			unknown: null,
		});
	});

	it("restores a rejected send's images through the 5-image cap, warning once", () => {
		const stop = registerComposer(SESSION, {insertText: () => {}, focus: () => {}});
		attachContext(SESSION, {kind: "image", path: "/cache/alice.png", name: "alice.png"});
		attachContext(SESSION, {kind: "image", path: "/cache/bob.png", name: "bob.png"});
		attachContext(SESSION, {kind: "file", path: "carol.ts"});
		const sent = takeContextChips(SESSION);
		const composed = composePrompt("hi", sent, []);
		recordSentAttachments(SESSION, composed, "hi", sent);
		for (const name of ["d", "e", "f", "g"])
			attachContext(SESSION, {kind: "image", path: `/cache/${name}.png`, name});
		const notify = vi.fn<(options: ToastOptions) => void>();

		const restored = restoreRejectedAttachments(SESSION, composed, notify);
		const chips = getContextChips(SESSION).map(({id: _id, ...rest}) => rest);
		stop();

		expect({restored, chips, toasts: notify.mock.calls}).toStrictEqual({
			restored: "hi",
			chips: [
				{kind: "image", path: "/cache/d.png", name: "d"},
				{kind: "image", path: "/cache/e.png", name: "e"},
				{kind: "image", path: "/cache/f.png", name: "f"},
				{kind: "image", path: "/cache/g.png", name: "g"},
				{kind: "image", path: "/cache/alice.png", name: "alice.png"},
				{kind: "file", path: "carol.ts"},
			],
			toasts: [[{kind: "warning", message: "Maximum of 5 images allowed.", durationMs: 8000}]],
		});
	});

	it("takes a sent prompt back as its typed text plus its tiles", () => {
		const takenBack: string[] = [];
		const stop = registerComposer(SESSION, {
			insertText: () => {},
			focus: () => {},
			takeBack: (text) => {
				takenBack.push(text);
				return true;
			},
		});
		attachContext(SESSION, {kind: "file", path: "alice.ts"});
		const sent = takeContextChips(SESSION);
		const composed = composePrompt("hi", sent, []);
		recordSentAttachments(SESSION, composed, "hi", sent);
		attachContext(SESSION, {kind: "terminal", text: "bob"});

		const taken = takeBackSend(SESSION, composed);
		const chips = getContextChips(SESSION).map(({id: _id, ...rest}) => rest);
		const unrecorded = takeBackSend(SESSION, "plain prompt");
		const after = getContextChips(SESSION).map(({id: _id, ...rest}) => rest);
		stop();

		expect({taken, takenBack, chips, unrecorded, after}).toStrictEqual({
			taken: true,
			takenBack: ["hi", "plain prompt"],
			chips: [
				{kind: "terminal", text: "bob"},
				{kind: "file", path: "alice.ts"},
			],
			unrecorded: true,
			after: [
				{kind: "terminal", text: "bob"},
				{kind: "file", path: "alice.ts"},
			],
		});
	});

	it("keeps the record and adds no tiles when the composer refuses a take-back", () => {
		let accept = false;
		const takenBack: string[] = [];
		const stop = registerComposer(SESSION, {
			insertText: () => {},
			focus: () => {},
			takeBack: (text) => {
				takenBack.push(text);
				return accept;
			},
		});
		attachContext(SESSION, {kind: "file", path: "alice.ts"});
		const sent = takeContextChips(SESSION);
		const composed = composePrompt("hi", sent, []);
		recordSentAttachments(SESSION, composed, "hi", sent);

		const refused = takeBackSend(SESSION, composed);
		const chipsAfterRefusal = getContextChips(SESSION).length;
		accept = true;
		const accepted = takeBackSend(SESSION, composed);
		const chips = getContextChips(SESSION).map(({id: _id, ...rest}) => rest);
		stop();

		expect({refused, chipsAfterRefusal, accepted, takenBack, chips}).toStrictEqual({
			refused: false,
			chipsAfterRefusal: 0,
			accepted: true,
			takenBack: ["hi", "hi"],
			chips: [{kind: "file", path: "alice.ts"}],
		});
	});

	it("re-queues a rejected send's diff comments and hands back only its typed text", () => {
		clearDiffComments(SESSION);
		const draftId = openDiffCommentDraft(SESSION, {path: "a.ts", side: "additions", line: 3});
		saveDiffComment(SESSION, draftId, "Rename this");
		const queued = getDiffComments(SESSION).queued;
		const comments = takeQueuedDiffComments(SESSION);
		const composed = composePrompt("hi", [], comments);
		recordSentAttachments(SESSION, composed, "hi", [], comments);

		const restored = restoreRejectedAttachments(SESSION, composed);
		const after = getDiffComments(SESSION).queued;
		clearDiffComments(SESSION);

		expect({restored, after}).toStrictEqual({restored: "hi", after: queued});
	});

	it("records nothing for a send without tiles", () => {
		recordSentAttachments(SESSION, "hi", "hi", []);

		expect({restored: restoreRejectedAttachments(SESSION, "hi"), chips: getContextChips(SESSION)}).toStrictEqual({
			restored: null,
			chips: [],
		});
	});

	it("registers every kind in the schema choice registry", () => {
		expect({
			options: ContextAttachmentKindSchema.options,
			registry: schemaChoiceRegistry["ContextAttachmentKindSchema"],
		}).toStrictEqual({
			options: ["file", "selection", "terminal", "image", "message", "excerpt", "pasted-text"],
			registry: {
				file: "File",
				selection: "Selection",
				terminal: "Terminal output",
				image: "Image",
				message: "Message",
				excerpt: "Excerpt",
				"pasted-text": "Pasted text",
			},
		});
	});
});

describe("joinPrefill", () => {
	it("appends with no separator, spacing only after an unspaced @mention token", () => {
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

describe("prefillComposer", () => {
	it("is false with no composer mounted", () => {
		expect(prefillComposer("prefill-none", "orig")).toBe(false);
	});

	it("passes on a refusal from the mounted composer", () => {
		const prefill = vi.fn<(text: string) => boolean>(() => false);
		const unregister = registerComposer("prefill-refused", {insertText: () => {}, focus: () => {}, prefill});
		expect({result: prefillComposer("prefill-refused", "orig"), calls: prefill.mock.calls}).toStrictEqual({
			result: false,
			calls: [["orig"]],
		});
		unregister();
	});

	it("is true when the composer took it", () => {
		const unregister = registerComposer("prefill-ok", {insertText: () => {}, focus: () => {}, prefill: () => true});
		expect(prefillComposer("prefill-ok", "orig")).toBe(true);
		unregister();
	});
});
