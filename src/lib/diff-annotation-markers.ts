/**
 * Upstream's diff-comment prompt parser (`Q` in c4d199b75): each `In \`path\` at line(s) N[ (before changes)]:`
 * header directly before a code fence becomes an annotation, with the text after the fence as its body,
 * up to the first `\n\n\n`; everything else stays prompt text.
 */

/** A diff comment a sent prompt carried, as upstream's `Pe` annotation. */
export interface DiffAnnotation {
	filePath: string;
	startLine: number;
	endLine: number | undefined;
	/** Commented on the old side: the header said "(before changes)". */
	oldSide: boolean;
	code: string;
	lang: string;
	body: string;
	/** A ```suggestion fence directly after the comment. */
	suggestion?: string;
}

/** Upstream `s`: a backtick fence with an info word, closed by the same run on its own line. */
const FENCE_RE = /^(`{3,})(\S*)\n([\s\S]*?)\n\1[ \t]*$/gm;

/** Upstream `te`: the annotation header, at the end of the text before a fence. */
const HEADER_RE =
	/(?:^|\n)In `([^`\n]+)` at lines? (\d+)(?:-(\d+))?( \(before changes\))?(?: — review comment from [@＠]\S+)?:$/;

/** Upstream `ne`: a header anywhere, which keeps a following suggestion fence from attaching to the previous one. */
const ANY_HEADER_RE = /^In `[^`\n]+` at lines? \d+/m;

type Item = {kind: "text"; text: string} | ({kind: "annotation"} & DiffAnnotation);

export function parseDiffAnnotations(prompt: string): {annotations: DiffAnnotation[]; rest: string} {
	if (!prompt.includes("```") || !prompt.includes("In `")) return {annotations: [], rest: prompt};
	const items: Item[] = [];
	const emitText = (text: string) => {
		const trimmed = text.trim();
		if (trimmed !== "") items.push({kind: "text", text: trimmed});
	};
	const lastAnnotation = () => {
		const last = items.at(-1);
		return last?.kind === "annotation" ? last : null;
	};
	/** Upstream `f`: text up to the first `\n\n\n` joins the annotation's body; returns what follows. */
	const appendBody = (annotation: DiffAnnotation, text: string, split = true): string => {
		const end = split ? text.indexOf("\n\n\n") : -1;
		const part = (end === -1 ? text : text.slice(0, end)).trim();
		if (part !== "") annotation.body = annotation.body === "" ? part : `${annotation.body}\n\n${part}`;
		return end === -1 ? "" : text.slice(end + 3);
	};

	let cursor = 0;
	for (const fence of prompt.matchAll(FENCE_RE)) {
		const before = prompt.slice(cursor, fence.index);
		const trimmed = before.trim();
		const header = HEADER_RE.exec(trimmed);
		const lead = header === null ? trimmed : trimmed.slice(0, header.index).trim();
		const info = fence[2] ?? "";
		const lang = info === "" ? "text" : info;
		const previous = lastAnnotation();
		if (previous === null) {
			emitText(header === null ? before : lead);
		} else {
			emitText(
				header !== null || (lang === "suggestion" && !before.includes("\n\n\n"))
					? appendBody(previous, header === null ? before : lead, false)
					: appendBody(previous, before),
			);
		}

		let attached = false;
		if (lang === "suggestion" && !ANY_HEADER_RE.test(trimmed) && !before.includes("\n\n\n") && previous !== null) {
			if (previous.suggestion === undefined) {
				previous.suggestion = fence[3] ?? "";
				attached = true;
			}
		}
		if (!attached) {
			if (header === null) items.push({kind: "text", text: fence[0]});
			else
				items.push({
					kind: "annotation",
					filePath: header[1] ?? "",
					startLine: Number(header[2]),
					endLine: header[3] === undefined ? undefined : Number(header[3]),
					oldSide: header[4] !== undefined,
					code: fence[3] ?? "",
					lang,
					body: "",
				});
		}
		cursor = fence.index + fence[0].length;
	}
	const tail = prompt.slice(cursor);
	const previous = lastAnnotation();
	emitText(previous === null ? tail : appendBody(previous, tail));

	const annotations = items.flatMap((item) => {
		if (item.kind === "text") return [];
		const {kind: _kind, ...annotation} = item;
		return [annotation];
	});
	if (annotations.length === 0) return {annotations: [], rest: prompt};
	return {
		annotations,
		rest: items.flatMap((item) => (item.kind === "text" ? [item.text] : [])).join("\n\n"),
	};
}
