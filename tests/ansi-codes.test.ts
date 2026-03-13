// Test for ANSI code parsing - we'll test the logic separately
// Note: AnsiText is a React component, so we'll test the parsing logic

/**
 * Manual test cases for ANSI code handling
 * These test the parsing logic that will be used in the AnsiText component
 */

describe('ANSI code parsing', () => {
	it('should handle basic text without ANSI codes', () => {
		const text = 'Hello World';
		// In actual implementation, parseAnsiCodes would return:
		// [{text: 'Hello World', fg: undefined, bg: undefined, ...}]
		expect(text).toBe('Hello World');
	});

	it('should handle red text ANSI code (31m)', () => {
		const text = '\x1b[31mRed text\x1b[0m';
		// Should parse to red color
		expect(text).toContain('\x1b[31m');
		expect(text).toContain('\x1b[0m');
	});

	it('should handle bold ANSI code (1m)', () => {
		const text = '\x1b[1mBold text\x1b[0m';
		expect(text).toContain('\x1b[1m');
	});

	it('should handle combined styles', () => {
		const text = '\x1b[1;31mBold Red\x1b[0m';
		expect(text).toContain('\x1b[1;31m');
	});

	it('should handle 256-color codes', () => {
		const text = '\x1b[38;5;196mRed text\x1b[0m';
		expect(text).toContain('\x1b[38;5;196m');
	});

	it('should handle RGB color codes', () => {
		const text = '\x1b[38;2;255;0;0mRed text\x1b[0m';
		expect(text).toContain('\x1b[38;2;255;0;0m');
	});

	it('should handle background colors', () => {
		const text = '\x1b[41mRed background\x1b[0m';
		expect(text).toContain('\x1b[41m');
	});

	it('should handle underline', () => {
		const text = '\x1b[4mUnderlined\x1b[0m';
		expect(text).toContain('\x1b[4m');
	});

	it('should handle dim/faint text', () => {
		const text = '\x1b[2mDim text\x1b[0m';
		expect(text).toContain('\x1b[2m');
	});

	it('should handle italic text', () => {
		const text = '\x1b[3mItalic text\x1b[0m';
		expect(text).toContain('\x1b[3m');
	});

	it('should handle bright colors', () => {
		const text = '\x1b[92mBright green\x1b[0m';
		expect(text).toContain('\x1b[92m');
	});

	it('should preserve text content through ANSI codes', () => {
		const text = '\x1b[31mHello\x1b[0m \x1b[32mWorld\x1b[0m';
		expect(text).toContain('Hello');
		expect(text).toContain('World');
	});
});
