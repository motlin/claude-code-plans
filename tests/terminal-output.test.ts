import {describe, it, expect} from 'vitest';

/**
 * Test cases for exit code extraction from TerminalOutput
 * These test the logic for parsing and displaying exit codes from error results
 */

describe('Exit code extraction from error results', () => {
	// Helper function to simulate the regex logic from TerminalOutput
	function extractExitCode(content: string) {
		const exitCodeMatch = content.match(/^Exit code (\d+)\n?/);
		const exitCode = exitCodeMatch?.[1] ? parseInt(exitCodeMatch[1], 10) : null;
		const contentWithoutExitCode = exitCodeMatch ? content.replace(/^Exit code \d+\n?/, '') : content;
		return {exitCode, contentWithoutExitCode};
	}

	it('extracts exit code 1 from error result', () => {
		const content = 'Exit code 1\nCommand failed';
		const {exitCode, contentWithoutExitCode} = extractExitCode(content);

		expect(exitCode).toBe(1);
		expect(contentWithoutExitCode).toBe('Command failed');
	});

	it('extracts exit code 127 from error result', () => {
		const content = 'Exit code 127\nCommand not found';
		const {exitCode, contentWithoutExitCode} = extractExitCode(content);

		expect(exitCode).toBe(127);
		expect(contentWithoutExitCode).toBe('Command not found');
	});

	it('handles exit code with multiple lines of output', () => {
		const content = 'Exit code 1\nError details\nMore error info\nMore lines';
		const {exitCode, contentWithoutExitCode} = extractExitCode(content);

		expect(exitCode).toBe(1);
		expect(contentWithoutExitCode).toBe('Error details\nMore error info\nMore lines');
	});

	it('returns null for content without exit code', () => {
		const content = 'Just a regular error message';
		const {exitCode, contentWithoutExitCode} = extractExitCode(content);

		expect(exitCode).toBeNull();
		expect(contentWithoutExitCode).toBe('Just a regular error message');
	});

	it('handles exit code at end of content without newline', () => {
		const content = 'Exit code 42';
		const {exitCode, contentWithoutExitCode} = extractExitCode(content);

		expect(exitCode).toBe(42);
		expect(contentWithoutExitCode).toBe('');
	});

	it('only matches exit code at the beginning of content', () => {
		const content = 'Some text\nExit code 1\nMore text';
		const {exitCode, contentWithoutExitCode} = extractExitCode(content);

		expect(exitCode).toBeNull();
		expect(contentWithoutExitCode).toBe('Some text\nExit code 1\nMore text');
	});

	it('handles exit code with large number', () => {
		const content = 'Exit code 256\nError output';
		const {exitCode, contentWithoutExitCode} = extractExitCode(content);

		expect(exitCode).toBe(256);
		expect(contentWithoutExitCode).toBe('Error output');
	});

	it('handles zero exit code', () => {
		const content = 'Exit code 0\nSuccess message';
		const {exitCode, contentWithoutExitCode} = extractExitCode(content);

		expect(exitCode).toBe(0);
		expect(contentWithoutExitCode).toBe('Success message');
	});
});
