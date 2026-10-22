import {useEffect, useState} from "react";

/**
 * How long to wait between our own health probes. The Agentation toolbar polls `/health` every 10s
 * while it has an endpoint, so with no server running (or behind a proxy that 502s the path) every
 * tab logs a failed request every 10s. Probing ourselves at this much longer interval keeps the
 * toolbar endpoint-less, and its poll off, until a server actually answers.
 */
export const AGENTATION_REPROBE_MS = 5 * 60_000;

async function isHealthy(endpoint: string): Promise<boolean> {
	try {
		const response = await fetch(`${endpoint}/health`);
		return response.ok;
	} catch {
		return false;
	}
}

/**
 * `endpoint` once a health probe succeeds, `undefined` while unknown or after a failed probe.
 * Re-probes every {@link AGENTATION_REPROBE_MS}, so a server started later is picked up and one that
 * stops is dropped.
 */
export function useHealthyAgentationEndpoint(endpoint: string): string | undefined {
	const [healthy, setHealthy] = useState<string | undefined>(undefined);
	useEffect(() => {
		let disposed = false;
		const probe = async () => {
			const ok = await isHealthy(endpoint);
			if (!disposed) setHealthy(ok ? endpoint : undefined);
		};
		void probe();
		const interval = setInterval(() => void probe(), AGENTATION_REPROBE_MS);
		return () => {
			disposed = true;
			clearInterval(interval);
		};
	}, [endpoint]);
	return healthy;
}
