import {defineConfig} from 'vite';
import {tanstackStart} from '@tanstack/react-start/plugin/vite';
import viteReact from '@vitejs/plugin-react';
import tsconfigPaths from 'vite-tsconfig-paths';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
	server: {port: 8899, host: true, allowedHosts: ['REDACTED_HOST']},
	plugins: [tailwindcss(), tsconfigPaths(), tanstackStart(), viteReact()],
});
