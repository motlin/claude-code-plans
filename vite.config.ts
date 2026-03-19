import {defineConfig} from 'vite';
import {tanstackStart} from '@tanstack/react-start/plugin/vite';
import viteReact from '@vitejs/plugin-react';
import tsconfigPaths from 'vite-tsconfig-paths';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
	server: {
		port: 8899,
		host: true,
		allowedHosts: process.env['VITE_ALLOWED_HOSTS']?.split(',').filter(Boolean) ?? [],
		watch: {ignored: ['**/routeTree.gen.ts']},
	},
	plugins: [tailwindcss(), tsconfigPaths(), tanstackStart(), viteReact()],
});
