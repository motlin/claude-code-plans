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
	plugins: [tailwindcss(), tanstackStart(), viteReact()],
});
