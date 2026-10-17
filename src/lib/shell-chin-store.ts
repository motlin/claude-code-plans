/**
 * The composer chin labels the server paints into the hard-load fallback.
 *
 * Dependency-free so the client bundle can import it; only the server sets it
 * (see `withShellChinLabels`), so on the client it stays null and the fallback
 * keeps the server's text through hydration.
 */
export interface ShellChinLabels {
	mode: string;
	model: string;
	effort: string;
}

let current: ShellChinLabels | null = null;

export function getShellChinLabels(): ShellChinLabels | null {
	return current;
}

export function setShellChinLabels(labels: ShellChinLabels | null): void {
	current = labels;
}
