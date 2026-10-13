import {defined} from "../../lib/defined";

export interface PageInfo {
	index: number;
	url: string;
	selected: boolean;
}

export function parsePageList(text: string): PageInfo[] {
	const pages: PageInfo[] = [];
	for (const line of text.split("\n")) {
		const m = /^(\d+):\s+(.+?)(\s+\[selected\])?$/.exec(line.trim());
		if (m) {
			pages.push({
				index: parseInt(defined(m[1], "page index group"), 10),
				url: defined(m[2], "page URL group"),
				selected: !!m[3],
			});
		}
	}
	return pages;
}

export interface ConsoleMessage {
	msgid: string;
	level: string;
	message: string;
	argCount?: number;
}

export function parseConsoleMessage(line: string): ConsoleMessage | null {
	const m = /^msgid=(\d+)\s+\[(\w+)\]\s+(.+?)(?:\s+\((\d+)\s+args?\))?$/.exec(line.trim());
	if (!m) return null;
	const result: ConsoleMessage = {
		msgid: defined(m[1], "console msgid group"),
		level: defined(m[2], "console level group"),
		message: defined(m[3], "console message group"),
	};
	if (m[4]) {
		result.argCount = parseInt(m[4], 10);
	}
	return result;
}

export interface NetworkRequest {
	reqid: string;
	method: string;
	url: string;
	status: string;
	statusCode?: number;
}

export function parseNetworkRequest(line: string): NetworkRequest | null {
	const m = /^reqid=(\d+)\s+(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS)\s+(\S+)\s+\[(\w+)(?:\s*-\s*(\d+))?\]/.exec(
		line.trim(),
	);
	if (!m) return null;
	const result: NetworkRequest = {
		reqid: defined(m[1], "network reqid group"),
		method: defined(m[2], "network method group"),
		url: defined(m[3], "network URL group"),
		status: defined(m[4], "network status group"),
	};
	if (m[5]) {
		result.statusCode = parseInt(m[5], 10);
	}
	return result;
}
