import {createContext, useContext, useEffect, useState} from 'react';

interface DebugProviderState {
	enabled: boolean;
	toggle: () => void;
}

const DebugProviderContext = createContext<DebugProviderState>({
	enabled: false,
	toggle: () => null,
});

const STORAGE_KEY = 'debug-mode';

export function DebugProvider({children}: {children: React.ReactNode}) {
	const [enabled, setEnabled] = useState(false);

	useEffect(() => {
		const stored = localStorage.getItem(STORAGE_KEY);
		if (stored === '1') setEnabled(true);
	}, []);

	return (
		<DebugProviderContext.Provider
			value={{
				enabled,
				toggle: () => {
					setEnabled((prev) => {
						const next = !prev;
						localStorage.setItem(STORAGE_KEY, next ? '1' : '0');
						return next;
					});
				},
			}}
		>
			{children}
		</DebugProviderContext.Provider>
	);
}

export function useDebug() {
	return useContext(DebugProviderContext);
}
