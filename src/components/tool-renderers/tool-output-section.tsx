import type {ReactNode} from "react";
import {maskSecrets} from "../../lib/secret-mask";
import {revealSpoofing} from "../../lib/visible-text";
import {FileRefTarget} from "../file-refs";
import {FILE_LINK_CLASS} from "./file-link-class";
import type {ResolvedToolOutput} from "../../lib/tool-output-resolve";
import type {ToolOutputNote} from "../../lib/tool-output-shape";
import * as Collapsible from "../ui/collapsible";
import {PlainText} from "./plain-text";
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
})
{
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

/** Upstream c40ad8c1e `u` + `break-words` (its accent ink and 3px radius as local tokens): the saved file's inline link (`Rv` > `La`). */
const SAVED_FILE_LINK_CLASS = `${FILE_LINK_CLASS} break-words`;

/** Upstream shared-29 `K7`: a path's last name, by either separator; the path itself when it has none. */
function lastName(path: string): string
{
	return path.split(/[/\\]/).findLast((name) => name !== "") ?? path;
}

/**
 * Upstream `zv` (cb6930dae, 2026-11-10): the saved file named by its last name, masked with spoofing characters
 * revealed (`u9(ME(K7(path)))`), linked through
 * the transcript's file refs to open in the Files pane; plain text when it can't link.
 */
function SavedFileLink({path}: {path: string})
{
	const name = revealSpoofing(maskSecrets(lastName(path)));
	return (
		<FileRefTarget
			path={path}
			render={(refProps) =>
				refProps === null ? (
					<span>{name}</span>
				) : (
					<span {...refProps} className={SAVED_FILE_LINK_CLASS}>
						{name}
					</span>
				)
			}
		/>
	);
}

/** Upstream `iS`: why only part of the result shows, with copy verbatim from upstream. */
function OutputNote({note}: {note: ToolOutputNote})
{
	let copy: ReactNode;
	if (note.kind === "wholeResultShown")
	{
		copy = "Claude received only the start of this result. More of it is in a saved file.";
	}
	else
	{
		const file = <SavedFileLink path={note.path} />;
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
export function ToolOutputSection({output, label}: {output: ResolvedToolOutput; label?: string | undefined})
{
	const {status, note, body, toldClaude} = output;
	if (status === undefined && note === undefined && body === undefined && toldClaude === undefined) return null;
	if (status === "waiting")
	{
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
							<PlainText>{toldClaude}</PlainText>
						</div>
					</Collapsible.Panel>
				</Collapsible.Root>
			)}
		</LabelledSection>
	);
}
