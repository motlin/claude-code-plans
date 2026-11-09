import {useCallback, useMemo, useState} from "react";

import {findSecrets, maskSecrets} from "../../lib/secret-mask";

/** A tool body's secret count and reveal state (upstream code card `H` / revealed). */
export interface SecretReveal {
	count: number;
	revealed: boolean;
	onToggle: () => void;
	/** The text to show and copy: masked until revealed. */
	show: (text: string) => string;
}

export function useSecretReveal(texts: readonly string[]): SecretReveal {
	const [revealed, setRevealed] = useState(false);
	const key = texts.join("\0");
	const count = useMemo(() => key.split("\0").reduce((sum, text) => sum + findSecrets(text).length, 0), [key]);
	const onToggle = useCallback(() => {
		setRevealed((value) => !value);
	}, []);
	const show = useCallback((text: string) => (revealed ? text : maskSecrets(text)), [revealed]);
	return {count, revealed, onToggle, show};
}
