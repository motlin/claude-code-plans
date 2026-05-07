import {defineConfig} from 'vite';
import {tanstackStart} from '@tanstack/react-start/plugin/vite';
import viteReact from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
	server: {
		// 7526 = "PLAN" on a phone dialpad. Fixed + strictPort so a clash fails loudly
		// instead of silently falling back to a different port.
		port: Number(process.env['PORT'] ?? 7526),
		strictPort: true,
		host: true,
		allowedHosts: process.env['VITE_ALLOWED_HOSTS']?.split(',').filter(Boolean) ?? [],
		watch: {ignored: ['**/routeTree.gen.ts']},
	},
	resolve: {
		tsconfigPaths: true,
	},
	build: {
		// The session detail route legitimately ships ~1.2MB (gzipped ~370kB) of tool
		// renderers, transcript processing, and chat UI. The markdown editor and the
		// Shiki C/C++ language grammar are similarly large but already lazy-loaded.
		// Raise the warning threshold so it only fires on regressions beyond today's
		// baseline rather than firing on every build.
		chunkSizeWarningLimit: 1500,
	},
	plugins: [tailwindcss(), tanstackStart(), viteReact()],
});
