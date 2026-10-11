interface BundlerLog {
	code?: string;
	id?: string;
	message: string;
}

/**
 * Rolldown warns once per dependency module that starts with "use client", which the server bundle cannot preserve;
 * React's server rendering ignores the directive anyway, so a dependency's copy is noise. The app's own still warn.
 */
export function quietDependencyDirectives<Log extends BundlerLog>(
	level: string,
	log: Log,
	handler: (level: never, log: Log) => void,
): void {
	if (
		level === "warn" &&
		log.code === "MODULE_LEVEL_DIRECTIVE" &&
		log.message.includes('"use client"') &&
		/[\\/]node_modules[\\/]/.test(log.id ?? "")
	) {
		return;
	}
	handler(level as never, log);
}
