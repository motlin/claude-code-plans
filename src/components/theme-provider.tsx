import {createContext, useContext, useEffect, useState} from 'react';

type Theme = 'dark' | 'light' | 'system';

interface ThemeProviderState {
	theme: Theme;
	setTheme: (theme: Theme) => void;
}

const ThemeProviderContext = createContext<ThemeProviderState>({
	theme: 'system',
	setTheme: () => null,
});

export function ThemeProvider({
	children,
	defaultTheme = 'system',
	storageKey = 'theme',
}: {
	children: React.ReactNode;
	defaultTheme?: Theme;
	storageKey?: string;
}) {
	const [theme, setTheme] = useState<Theme>(defaultTheme);

	useEffect(() => {
		const stored = localStorage.getItem(storageKey) as Theme | null;
		if (stored) setTheme(stored);
	}, [storageKey]);

	useEffect(() => {
		const root = document.documentElement;
		root.classList.remove('light', 'dark');

		if (theme === 'system') {
			const mql = window.matchMedia('(prefers-color-scheme: dark)');
			const handler = (e: MediaQueryListEvent) => {
				root.classList.remove('light', 'dark');
				root.classList.add(e.matches ? 'dark' : 'light');
			};
			root.classList.add(mql.matches ? 'dark' : 'light');
			mql.addEventListener('change', handler);
			return () => mql.removeEventListener('change', handler);
		}

		root.classList.add(theme);
		return undefined;
	}, [theme]);

	return (
		<ThemeProviderContext.Provider
			value={{
				theme,
				setTheme: (t: Theme) => {
					localStorage.setItem(storageKey, t);
					setTheme(t);
				},
			}}
		>
			{children}
		</ThemeProviderContext.Provider>
	);
}

export function useTheme() {
	const context = useContext(ThemeProviderContext);
	if (context === undefined) throw new Error('useTheme must be used within a ThemeProvider');
	return context;
}
