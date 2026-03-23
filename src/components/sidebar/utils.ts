export function decodeProjectName(encoded: string): string {
	const parts = encoded.replace(/^-/, '/').replace(/-/g, '/').split('/');
	return parts[parts.length - 1]!;
}
