import type {ReactNode} from "react";
import {mentionPath} from "../files/mention-path";
import {useFileRefsCwd} from "../file-refs-context";
import type {ResolvedToolOutput} from "../../lib/tool-output-resolve";
import type {ToolOutputNote} from "../../lib/tool-output-shape";
import * as Collapsible from "../ui/collapsible";
import {ToolOutputBody} from "./tool-output-body";
import {TOOL_OUTPUT_CLAMP, TOOL_OUTPUT_REGION} from "./tool-output-region";

const MUTED_FOOTNOTE = "text-footnote text-muted-as-secondary";

/** Upstream `Xx`: an optional `border-t` rule, then a 6px (default density) stack led by a muted footnote label. */
export function LabelledSection({
	label,
	rule = false,
	children,
}: {
	label?: string | undefined;
	rule?: boolean | undefined;
	children: ReactNode;
}) {
	return (
		<>
			{rule && <div className="border-t" />}
			<div className="flex flex-col gap-xs">
				{label !== undefined && (
					<div data-find-omitted="" className={MUTED_FOOTNOTE}>
						{label}
					</div>
				)}
				{children}
			</div>
		</>
	);
}

/**
 * Upstream `rS`: the saved file, relative to the session's working directory when inside it. Upstream wraps
 * the chip in a file-ref link (tool-output-saved-file-ref-chip); here it is the chip alone.
 */
function SavedFileChip({path}: {path: string}) {
	const cwd = useFileRefsCwd();
	return (
		<code className="epitaxy-code-chip">
			<bdi>{mentionPath(path, cwd)}</bdi>
		</code>
	);
}

/** Upstream `iS`: why only part of the result shows, with copy verbatim from upstream. */
function OutputNote({note}: {note: ToolOutputNote}) {
	let copy: ReactNode;
	if (note.kind === "wholeResultShown") {
		copy = "Claude received only the start of this result. More of it is in a saved file.";
	} else {
		const file = <SavedFileChip path={note.path} />;
		copy =
			note.kind === "cappedPreview" ? (
				<>This is the start of a longer result. Only part of the rest is saved, in {file}.</>
			) : note.kind === "preview" ? (
				<>This is the start of a longer result. The rest is saved in {file}.</>
			) : (
				<>This result is too long to show here. It’s saved in {file}.</>
			);
	}
	return (
		<div data-find-omitted="" className={MUTED_FOOTNOTE}>
			{copy}
		</div>
	);
}

/**
 * Upstream `tS`: a generic tool's output section. "No output" or "Waiting for the result", the note, the body,
 * then the closed "Details for Claude" fold holding everything Claude was told; the label, note, status line
 * and fold are skipped by in-app Find. A label (only when an Input section sits above) adds the rule.
 */
export function ToolOutputSection({output, label}: {output: ResolvedToolOutput; label?: string | undefined}) {
	const {status, note, body, toldClaude} = output;
	if (status === undefined && note === undefined && body === undefined && toldClaude === undefined) return null;
	if (status === "waiting") {
		return (
			<LabelledSection label={label} rule={label !== undefined}>
				<div data-find-omitted="" className="text-muted-as-secondary">
					Waiting for the result
				</div>
			</LabelledSection>
		);
	}
	return (
		<LabelledSection label={label} rule={label !== undefined}>
			{status === "empty" && (
				<div data-find-omitted="" className="text-muted-as-secondary">
					No output
				</div>
			)}
			{note !== undefined && <OutputNote note={note} />}
			{body !== undefined && <ToolOutputBody body={body} />}
			{toldClaude !== undefined && (
				<Collapsible.Root data-find-omitted="">
					<Collapsible.Trigger className={MUTED_FOOTNOTE}>Details for Claude</Collapsible.Trigger>
					<Collapsible.Panel>
						<div {...TOOL_OUTPUT_REGION} className={TOOL_OUTPUT_CLAMP}>
							{toldClaude}
						</div>
					</Collapsible.Panel>
				</Collapsible.Root>
			)}
		</LabelledSection>
	);
}
