import {Outlet, createRootRoute, HeadContent, Scripts, useRouter} from '@tanstack/react-router';
import type {ErrorComponentProps} from '@tanstack/react-router';
import {useCallback, useEffect, useState, type ReactNode} from 'react';
import {ThemeProvider} from '../components/theme-provider';
import {ModeToggle} from '../components/mode-toggle';
import {Sidebar} from '../components/sidebar';
import {CommandPalette} from '../components/command-palette';
import {useCommandPalette} from '../hooks/use-command-palette';
import {IndexingBanner} from '../components/indexing-banner';
import appCss from '../styles/globals.css?url';

export const Route = createRootRoute({
	head: () => ({
		meta: [{charSet: 'utf-8'}, {name: 'viewport', content: 'width=device-width, initial-scale=1'}],
		links: [
			{rel: 'stylesheet', href: appCss},
			{
				rel: 'icon',
				type: 'image/svg+xml',
				href: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='7' fill='%23C87B3A'/%3E%3Cpath d='M16 5L17.5 13.5L26 16L17.5 18.5L16 27L14.5 18.5L6 16L14.5 13.5Z' fill='white' opacity='0.95'/%3E%3C/svg%3E",
			},
			{rel: 'preconnect', href: 'https://fonts.googleapis.com'},
			{rel: 'preconnect', href: 'https://fonts.gstatic.com', crossOrigin: 'anonymous'},
			{
				rel: 'stylesheet',
				href: 'https://fonts.googleapis.com/css2?family=Inter:wght@300..700&family=JetBrains+Mono:wght@400;600&display=swap',
			},
		],
	}),
	component: RootComponent,
	notFoundComponent: NotFound,
	errorComponent: RootErrorComponent,
});

function RootComponent() {
	const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
	const [refreshKey, setRefreshKey] = useState(0);
	const commandPalette = useCommandPalette();

	return (
		<RootDocument>
			<ThemeProvider>
				<div className="flex h-screen">
					<Sidebar
						collapsed={sidebarCollapsed}
						onToggle={() => setSidebarCollapsed((c) => !c)}
						refreshKey={refreshKey}
					/>
					<main className="flex-1 overflow-y-auto bg-bg-000">
						<div className="flex items-center justify-end p-3">
							<ModeToggle />
						</div>
						<IndexingBanner />
						<div className="px-4 pb-8 sm:px-8">
							<Outlet />
						</div>
					</main>
				</div>
				<CommandPalette
					open={commandPalette.open}
					onOpenChange={commandPalette.setOpen}
				/>
				<SseListener onContentUpdated={useCallback(() => setRefreshKey((k) => k + 1), [])} />
			</ThemeProvider>
		</RootDocument>
	);
}

function SseListener({onContentUpdated}: {onContentUpdated: () => void}) {
	const router = useRouter();

	useEffect(() => {
		const es = new EventSource('/api/events');
		es.addEventListener('content-updated', () => {
			router.invalidate();
			onContentUpdated();
		});
		return () => es.close();
	}, [router, onContentUpdated]);

	return null;
}

function NotFound() {
	return (
		<div className="p-8">
			<h1 className="text-lg font-semibold">404 &mdash; Not Found</h1>
			<p className="mt-2 text-text-500">The requested page was not found.</p>
		</div>
	);
}

function RootErrorComponent({error, reset}: ErrorComponentProps) {
	const message = error instanceof Error ? error.message : 'An unexpected error occurred';

	return (
		<div className="p-8">
			<h1 className="text-lg font-semibold text-red-600 dark:text-red-400">Something went wrong</h1>
			<pre className="mt-3 max-w-2xl overflow-auto rounded-md border border-border-300/15 bg-bg-200 p-3 font-mono text-sm text-text-500">
				{message}
			</pre>
			<button
				type="button"
				onClick={reset}
				className="mt-4 rounded-md bg-accent-100 px-3 py-1.5 text-sm font-medium text-white hover:bg-accent-100/80"
			>
				Try again
			</button>
		</div>
	);
}

const themeScript = `(function(){try{var t=localStorage.getItem('theme');var d=document.documentElement;if(t==='dark')d.classList.add('dark');else if(t==='light')d.classList.add('light');else{d.classList.add(window.matchMedia('(prefers-color-scheme:dark)').matches?'dark':'light')}}catch(e){}})()`;

function RootDocument({children}: Readonly<{children: ReactNode}>) {
	return (
		<html
			lang="en"
			suppressHydrationWarning
		>
			<head>
				<script dangerouslySetInnerHTML={{__html: themeScript}} />
				<HeadContent />
			</head>
			<body>
				{children}
				<Scripts />
			</body>
		</html>
	);
}
