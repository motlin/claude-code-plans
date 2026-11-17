import {createPortal} from "react-dom";
import {DROP_SCRIM_Z_INDEX, DropIcons} from "./drop-overlay";

/** Upstream's `ChatComposerDropScrim` (shared-5 `gs`): a blurred full-viewport frame while files are dragged. */
export function ComposerDropScrim()
{
	return createPortal(
		<div className="cds-root pointer-events-auto contents" data-cds-portal="">
			<div
				data-cds="ChatComposerDropScrim"
				aria-hidden="true"
				className="cds-reset fixed inset-0 pointer-events-none"
				style={
				{
					zIndex: DROP_SCRIM_Z_INDEX,
				}}
			>
				<div
					aria-hidden="true"
					className="absolute inset-0 backdrop-blur-[12px] motion-safe:animate-[cds-fade-in_0.15s_cubic-bezier(0.215,0.61,0.355,1)]"
				/>
				<div
					aria-hidden="true"
					className="absolute inset-0 bg-page opacity-60 motion-safe:animate-[cds-fade-in_0.15s_cubic-bezier(0.215,0.61,0.355,1)]"
				/>
				<div className="absolute inset-3.5 flex flex-col items-center justify-center gap-2 rounded-card shadow-[inset_0_0_0_2px_var(--color-fill-accent)] motion-safe:animate-[cds-drop-ring-in_0.15s_cubic-bezier(0.215,0.61,0.355,1)]">
					<div
						aria-hidden="true"
						className="absolute inset-0 rounded-[inherit] shadow-[inset_0_0_24px_0_color-mix(in_srgb,var(--color-fill-accent)_20%,transparent)] motion-safe:animate-[cds-fade-in_0.2s_cubic-bezier(0.215,0.61,0.355,1)_0.08s_backwards]"
					/>
					<div
						className="flex items-end gap-3"
						style={
						{
							color: "var(--color-fill-accent)",
						}}
						aria-hidden="true"
					>
						<DropIcons />
					</div>
					<span className="text-body font-medium text-accent-100">Drop files here</span>
				</div>
			</div>
		</div>,
		document.body,
	);
}
