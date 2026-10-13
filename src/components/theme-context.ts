import {createContext, useContext, useEffect, useState} from "react";

export type Theme = "dark" | "light" | "system";

interface ThemeProviderState {
	theme: Theme;
	setTheme: (theme: Theme) => void;
}

export const ThemeProviderContext = createContext<ThemeProviderState>({
	theme: "system",
	setTheme: () => null,
});

export function useTheme() {
	const context = useContext(ThemeProviderContext);
	if (context === undefined) throw new Error("useTheme must be used within a ThemeProvider");
	return context;
}

/**
 * Returns the concrete theme currently applied to `<html>` ('dark' or 'light').
 * Tracks the `.dark` class that `ThemeProvider` toggles, so callers resolve
 * the `system` preference correctly and respond to OS-level changes.
 */
export function useResolvedTheme(): "light" | "dark" {
	const [theme, setTheme] = useState<"light" | "dark">(() => {
		if (typeof document === "undefined") return "light";
		return document.documentElement.classList.contains("dark") ? "dark" : "light";
	});

	useEffect(() => {
		const root = document.documentElement;
		const observer = new MutationObserver(() => {
			setTheme(root.classList.contains("dark") ? "dark" : "light");
		});
		observer.observe(root, {attributes: true, attributeFilter: ["class"]});
		return () => {
			observer.disconnect();
		};
	}, []);

	return theme;
}
