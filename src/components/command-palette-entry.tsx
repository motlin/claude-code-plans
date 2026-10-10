import {CatchBoundary} from "@tanstack/react-router";
import {Suspense, use} from "react";
import type {CommandPaletteProps} from "./command-palette";

type CommandPaletteModule = typeof import("./command-palette");

// The palette, its cmdk list and search views stay off the cold load until the first ⌘K.
let paletteModule: Promise<CommandPaletteModule> | undefined;
let LoadedPalette: CommandPaletteModule["CommandPalette"] | undefined;

function loadCommandPalette(): Promise<CommandPaletteModule> {
	paletteModule ??= import("./command-palette")
		.then((module) => {
			LoadedPalette = module.CommandPalette;
			return module;
		})
		.catch((error: unknown) => {
			// A failed download is retried on the next open.
			paletteModule = undefined;
			throw error;
		});
	return paletteModule;
}

/** Suspends only while the module downloads, so once loaded it renders in the same pass, like a static import. */
function PaletteLoader(props: CommandPaletteProps) {
	const Palette = LoadedPalette ?? use(loadCommandPalette()).CommandPalette;
	return <Palette {...props} />;
}

/** Mounts the palette from its first open on; until then a closed palette renders nothing. */
export function DeferredCommandPalette(props: CommandPaletteProps) {
	if (LoadedPalette === undefined && !props.open) return null;
	return (
		<CatchBoundary getResetKey={() => String(props.open)} errorComponent={() => null}>
			<Suspense fallback={null}>
				<PaletteLoader {...props} />
			</Suspense>
		</CatchBoundary>
	);
}
