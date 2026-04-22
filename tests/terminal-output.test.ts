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
		expect(extractExitCode('Exit code 1\nCommand failed')).toStrictEqual({
			exitCode: 1,
			contentWithoutExitCode: 'Command failed',
		});
	});

	it('extracts exit code 127 from error result', () => {
		expect(extractExitCode('Exit code 127\nCommand not found')).toStrictEqual({
			exitCode: 127,
			contentWithoutExitCode: 'Command not found',
		});
	});

	it('handles exit code with multiple lines of output', () => {
		expect(extractExitCode('Exit code 1\nError details\nMore error info\nMore lines')).toStrictEqual({
			exitCode: 1,
			contentWithoutExitCode: 'Error details\nMore error info\nMore lines',
		});
	});

	it('returns null for content without exit code', () => {
		expect(extractExitCode('Just a regular error message')).toStrictEqual({
			exitCode: null,
			contentWithoutExitCode: 'Just a regular error message',
		});
	});

	it('handles exit code at end of content without newline', () => {
		expect(extractExitCode('Exit code 42')).toStrictEqual({
			exitCode: 42,
			contentWithoutExitCode: '',
		});
	});

	it('only matches exit code at the beginning of content', () => {
		expect(extractExitCode('Some text\nExit code 1\nMore text')).toStrictEqual({
			exitCode: null,
			contentWithoutExitCode: 'Some text\nExit code 1\nMore text',
		});
	});

	it('handles exit code with large number', () => {
		expect(extractExitCode('Exit code 256\nError output')).toStrictEqual({
			exitCode: 256,
			contentWithoutExitCode: 'Error output',
		});
	});

	it('handles zero exit code', () => {
		expect(extractExitCode('Exit code 0\nSuccess message')).toStrictEqual({
			exitCode: 0,
			contentWithoutExitCode: 'Success message',
		});
	});
});
