import {useEffect, useState} from "react";

import {type Theme, ThemeProviderContext} from "./theme-context";

function isTheme(value: string | null): value is Theme {
	return value === "dark" || value === "light" || value === "system";
}

export function ThemeProvider({
	children,
	defaultTheme = "system",
	storageKey = "theme",
}: {
	children: React.ReactNode;
	defaultTheme?: Theme;
	storageKey?: string;
}) {
	const [theme, setTheme] = useState<Theme>(defaultTheme);

	useEffect(() => {
		const stored = localStorage.getItem(storageKey);
		if (isTheme(stored)) setTheme(stored);
	}, [storageKey]);

	useEffect(() => {
		const root = document.documentElement;
		root.classList.remove("light", "dark");

		if (theme === "system") {
			const mql = window.matchMedia("(prefers-color-scheme: dark)");
			const handler = (e: MediaQueryListEvent) => {
				root.classList.remove("light", "dark");
				root.classList.add(e.matches ? "dark" : "light");
			};
			root.classList.add(mql.matches ? "dark" : "light");
			mql.addEventListener("change", handler);
			return () => {
				mql.removeEventListener("change", handler);
			};
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
