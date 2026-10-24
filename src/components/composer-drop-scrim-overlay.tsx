import {Files, Folder, Image} from "lucide-react";
import type {CSSProperties} from "react";
import {createPortal} from "react-dom";

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
