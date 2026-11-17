import {useExitTerminalView} from "../../hooks/use-exit-terminal-view";

/** Upstream `Xi`: a button that leaves the terminal view. */
export function ExitTerminalViewButton({className, children}: {className: string; children: React.ReactNode})
{
	const exit = useExitTerminalView();
	return (
		<button type="button" className={className} onClick={exit}>
			{children}
		</button>
	);
}

/** Upstream `P9`: the terminal view's hold screen while its chunk or transcript loads. */
export function TerminalHold()
{
	return (
		<div className="epitaxy-terminal-hold draggable-none relative h-full">
			<span role="status" aria-busy="true" className="sr-only">
				Loading session
			</span>
			<ExitTerminalViewButton className="epitaxy-terminal-hold-exit">Open the normal view</ExitTerminalViewButton>
		</div>
	);
}
