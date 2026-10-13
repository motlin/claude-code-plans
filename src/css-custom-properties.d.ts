import "react";

declare module "react" {
	/** Inline styles may set CSS custom properties (`--sidebar-width` etc.) without a cast. */
	interface CSSProperties {
		[customProperty: `--${string}`]: string | number | undefined;
	}
}
