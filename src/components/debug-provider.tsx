import {createContext, useCallback, useContext, useEffect, useState} from 'react';

interface DebugProviderState {
	enabled: boolean;
	setEnabled: (v: boolean) => void;
}

const DebugProviderContext = createContext<DebugProviderState>({
	enabled: false,
	setEnabled: () => null,
});

const STORAGE_KEY = 'ccp-show-debug';

export function DebugProvider({children}: {children: React.ReactNode}) {
	const [enabled, setEnabledRaw] = useState(false);

	useEffect(() => {
		const stored = localStorage.getItem(STORAGE_KEY);
		if (stored !== null) setEnabledRaw(stored === 'true');
	}, []);

	const setEnabled = useCallback((v: boolean) => {
		setEnabledRaw(v);
		localStorage.setItem(STORAGE_KEY, String(v));
	}, []);

	return <DebugProviderContext.Provider value={{enabled, setEnabled}}>{children}</DebugProviderContext.Provider>;
}

export function useDebug() {
	return useContext(DebugProviderContext);
}
