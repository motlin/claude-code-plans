import {createFileRoute, redirect} from "@tanstack/react-router";

/**
 * Custom (legacy) commands are listed inside Customize › Skills, as
 * claude.ai/code merges commands into skills; each opens its own detail there.
 */
export function redirectLegacyCommand({params}: {params: {source: string; filename: string}}): never {
	throw redirect({
		to: "/customize/skills/command/$source/$filename",
		params: {source: params.source, filename: params.filename},
		replace: true,
	});
}

export const Route = createFileRoute("/command/$source/$filename")({
	beforeLoad: redirectLegacyCommand,
});
