const pillBase =
	"inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors no-underline";

export const pillStyles = {
	primary: `${pillBase} bg-surface-0 text-secondary hover:bg-fill-control`,
	outline: `${pillBase} border border-strong text-secondary hover:bg-surface-0`,
} as const;
