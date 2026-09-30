import type {GhosttyAppearance} from "../lib/server-fns";

/**
 * Upstream's terminal loading placeholder: the theme background with a
 * blinking caret in the cursor colour, laid over the terminal until the first
 * output arrives.
 */
export function TerminalPlaceholder({appearance}: {appearance: GhosttyAppearance | null}) {
	const theme = appearance?.theme;
	return (
		<div
			role="status"
			aria-label="Loading"
			data-testid="terminal-pane-placeholder"
			className="absolute inset-0 rounded-b-[inherit] bg-surface-1 p-2"
			style={theme ? {backgroundColor: theme.background} : undefined}
		>
			<span
				aria-hidden="true"
				className="terminal-caret inline-block h-[1.2em] w-[0.6em] bg-[var(--color-primary)]"
				style={theme ? {backgroundColor: theme.cursor ?? theme.foreground} : undefined}
			/>
		</div>
	);
}
