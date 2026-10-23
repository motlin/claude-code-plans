import {Files, Folder, Image} from "lucide-react";
import {type CSSProperties, type RefObject, useEffect, useEffectEvent, useState} from "react";
import {createPortal} from "react-dom";

export type FileDropState = "idle" | "off-target" | "on-target";

function hasFiles(e: DragEvent): boolean {
	return Array.from(e.dataTransfer?.types ?? []).includes("Files");
}

function inside(target: RefObject<HTMLElement | null> | undefined, node: EventTarget | null): boolean {
	const element = target?.current;
	return element != null && node instanceof Node && element.contains(node);
}

/**
 * Page-wide drop targets in mount order; the last one owns drops. Pages mount one composer today, but a drop must still attach
 * to exactly one if two ever mount at once. Focusing inside a
 * target's `targetRef` moves it to the end.
 */
const owners: symbol[] = [];

function claim(token: symbol) {
	const index = owners.indexOf(token);
	if (index !== -1) owners.splice(index, 1);
	owners.push(token);
}

/**
 * Upstream's page-scoped file drop hook (shared-5 `f7`): capture listeners on the body track whether files are being
 * dragged over the page (`on-target` when over `targetRef`), and a drop anywhere on the page attaches. When several
 * targets are mounted, only the owner (see `owners`) reacts.
 */
export function useFileDropTarget({
	onFileDrop,
	disabled = false,
	targetRef,
}: {
	onFileDrop: (files: readonly File[]) => void;
	disabled?: boolean;
	targetRef?: RefObject<HTMLElement | null>;
}): FileDropState {
	const [state, setState] = useState<FileDropState>("idle");
	const drop = useEffectEvent((files: readonly File[]) => {
		onFileDrop(files);
	});

	useEffect(() => {
		if (disabled) return undefined;
		const body = targetRef?.current?.ownerDocument.body ?? document.body;
		const token = Symbol("file-drop-target");
		claim(token);
		const owns = () => owners.at(-1) === token;
		const reset = () => {
			setState("idle");
		};
		const onFocusIn = (e: FocusEvent) => {
			if (inside(targetRef, e.target)) claim(token);
		};
		const onDragOver = (e: DragEvent) => {
			if (!hasFiles(e)) return;
			if (!owns()) {
				reset();
				return;
			}
			e.preventDefault();
			setState(inside(targetRef, e.target) ? "on-target" : "off-target");
		};
		const onDragLeave = (e: DragEvent) => {
			if (!hasFiles(e) || inside(targetRef, e.relatedTarget)) return;
			if (e.relatedTarget === null || e.target === body) reset();
		};
		const onDrop = (e: DragEvent) => {
			if (!hasFiles(e)) return;
			reset();
			if (!owns()) return;
			e.preventDefault();
			drop(Array.from(e.dataTransfer?.files ?? []));
		};
		body.addEventListener("dragover", onDragOver, true);
		body.addEventListener("dragleave", onDragLeave, true);
		body.addEventListener("dragend", reset, true);
		body.addEventListener("pointerdown", reset, true);
		body.addEventListener("drop", onDrop);
		body.addEventListener("focusin", onFocusIn, true);
		return () => {
			owners.splice(owners.indexOf(token), 1);
			body.removeEventListener("focusin", onFocusIn, true);
			body.removeEventListener("dragover", onDragOver, true);
			body.removeEventListener("dragleave", onDragLeave, true);
			body.removeEventListener("dragend", reset, true);
			body.removeEventListener("pointerdown", reset, true);
			body.removeEventListener("drop", onDrop);
			reset();
		};
	}, [disabled, targetRef]);

	return disabled ? "idle" : state;
}

const RISE_CLASS =
	"motion-safe:animate-[cds-drop-icon-rise_0.22s_cubic-bezier(0.215,0.61,0.355,1)_var(--rise-delay,0ms)_backwards]";

function riseDelay(ms: number): CSSProperties {
	return {"--rise-delay": `${ms}ms`};
}

/** Upstream's `ChatComposerDropScrim` (shared-5 `gs`): a blurred full-viewport frame while files are dragged. */
export function ComposerDropScrim() {
	return createPortal(
		<div data-cds="ChatComposerDropScrim" aria-hidden="true" className="fixed inset-0 z-[100] pointer-events-none">
			<div className="absolute inset-0 backdrop-blur-[12px] motion-safe:animate-[cds-fade-in_0.15s_cubic-bezier(0.215,0.61,0.355,1)]" />
			<div className="absolute inset-0 bg-page opacity-60 motion-safe:animate-[cds-fade-in_0.15s_cubic-bezier(0.215,0.61,0.355,1)]" />
			<div className="absolute inset-3.5 flex flex-col items-center justify-center gap-2 rounded-card shadow-[inset_0_0_0_2px_var(--color-fill-accent)] motion-safe:animate-[cds-drop-ring-in_0.15s_cubic-bezier(0.215,0.61,0.355,1)]">
				<div className="absolute inset-0 rounded-[inherit] shadow-[inset_0_0_24px_0_color-mix(in_srgb,var(--color-fill-accent)_20%,transparent)] motion-safe:animate-[cds-fade-in_0.2s_cubic-bezier(0.215,0.61,0.355,1)_0.08s_backwards]" />
				<div className="flex items-end gap-3" style={{color: "var(--color-fill-accent)"}}>
					<span className="-rotate-[14deg]">
						<Image size={24} className={RISE_CLASS} style={riseDelay(60)} />
					</span>
					<span className="-translate-y-3">
						<Files size={24} className={RISE_CLASS} />
					</span>
					<span className="rotate-[14deg]">
						<Folder size={24} className={RISE_CLASS} style={riseDelay(120)} />
					</span>
				</div>
				<span className="text-body font-medium text-accent-100">Drop files here</span>
			</div>
		</div>,
		document.body,
	);
}
