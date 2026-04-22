import {describe, it, expect} from 'vitest';
import {parseAnsiCodes} from '../src/components/tool-renderers/shared';

/**
 * Comprehensive test cases for ANSI code parsing
 * Tests the parseAnsiCodes function which converts ANSI escape sequences to styled parts
 */

describe('parseAnsiCodes function', () => {
	it('should handle basic text without ANSI codes', () => {
		expect(parseAnsiCodes('Hello World')).toStrictEqual([{text: 'Hello World'}]);
	});

	it('should handle red text ANSI code (31m)', () => {
		const result = parseAnsiCodes('\x1b[31mRed text\x1b[0m');
		expect(result.length).toBeGreaterThanOrEqual(1);
		expect(result[0]?.text).toBe('Red text');
		expect(result[0]?.fg).toBe('#cc0000'); // red color
	});

	it('should handle bold ANSI code (1m)', () => {
		const result = parseAnsiCodes('\x1b[1mBold text\x1b[0m');
		expect(result.length).toBeGreaterThanOrEqual(1);
		expect(result[0]?.text).toBe('Bold text');
		expect(result[0]?.bold).toBe(true);
	});

	it('should handle combined styles (bold + red)', () => {
		const result = parseAnsiCodes('\x1b[1;31mBold Red\x1b[0m');
		expect(result.length).toBeGreaterThanOrEqual(1);
		expect(result[0]?.text).toBe('Bold Red');
		expect(result[0]?.bold).toBe(true);
		expect(result[0]?.fg).toBe('#cc0000');
	});

	it('should handle 256-color codes (38;5;N)', () => {
		const result = parseAnsiCodes('\x1b[38;5;196mRed text\x1b[0m');
		expect(result.length).toBeGreaterThanOrEqual(1);
		expect(result[0]?.text).toBe('Red text');
		// 196 is in the 216-color cube range (16-231)
		expect(result[0]?.fg).toMatch(/^rgb\(/);
	});

	it('should handle RGB color codes (38;2;R;G;B)', () => {
		const result = parseAnsiCodes('\x1b[38;2;255;0;0mRed text\x1b[0m');
		expect(result.length).toBeGreaterThanOrEqual(1);
		expect(result[0]?.text).toBe('Red text');
		expect(result[0]?.fg).toBe('rgb(255,0,0)');
	});

	it('should handle background colors (41m)', () => {
		const result = parseAnsiCodes('\x1b[41mRed background\x1b[0m');
		expect(result.length).toBeGreaterThanOrEqual(1);
		expect(result[0]?.text).toBe('Red background');
		expect(result[0]?.bg).toBe('#cc0000');
	});

	it('should handle RGB background colors (48;2;R;G;B)', () => {
		const result = parseAnsiCodes('\x1b[48;2;0;255;0mGreen bg\x1b[0m');
		expect(result.length).toBeGreaterThanOrEqual(1);
		expect(result[0]?.bg).toBe('rgb(0,255,0)');
	});

	it('should handle underline (4m)', () => {
		const result = parseAnsiCodes('\x1b[4mUnderlined\x1b[0m');
		expect(result.length).toBeGreaterThanOrEqual(1);
		expect(result[0]?.underline).toBe(true);
	});

	it('should handle dim/faint text (2m)', () => {
		const result = parseAnsiCodes('\x1b[2mDim text\x1b[0m');
		expect(result.length).toBeGreaterThanOrEqual(1);
		expect(result[0]?.dim).toBe(true);
	});

	it('should handle italic text (3m)', () => {
		const result = parseAnsiCodes('\x1b[3mItalic text\x1b[0m');
		expect(result.length).toBeGreaterThanOrEqual(1);
		expect(result[0]?.italic).toBe(true);
	});

	it('should handle bright colors (92m)', () => {
		const result = parseAnsiCodes('\x1b[92mBright green\x1b[0m');
		expect(result.length).toBeGreaterThanOrEqual(1);
		expect(result[0]?.text).toBe('Bright green');
		expect(result[0]?.fg).toBe('#00ff00'); // bright green
	});

	it('should preserve text content through multiple ANSI codes', () => {
		const result = parseAnsiCodes('\x1b[31mHello\x1b[0m \x1b[32mWorld\x1b[0m');
		const texts = result.map((p) => p.text).join('');
		expect(texts).toContain('Hello');
		expect(texts).toContain('World');
	});

	it('should handle reset code (0m)', () => {
		expect(parseAnsiCodes('\x1b[31mRed\x1b[0mNormal')).toStrictEqual([
			{text: 'Red', fg: '#cc0000'},
			{text: 'Normal'},
		]);
	});

	it('should handle multiple style codes in sequence', () => {
		const result = parseAnsiCodes('\x1b[1;4;31mBold Underlined Red\x1b[0m');
		expect(result[0]?.bold).toBe(true);
		expect(result[0]?.underline).toBe(true);
		expect(result[0]?.fg).toBe('#cc0000');
	});

	it('should handle color reset and reapply', () => {
		const result = parseAnsiCodes('\x1b[31mRed\x1b[0m\x1b[32mGreen\x1b[0m');
		const redPart = result.find((p) => p.text === 'Red');
		const greenPart = result.find((p) => p.text === 'Green');
		expect(redPart?.fg).toBe('#cc0000');
		expect(greenPart?.fg).toBe('#00cc00');
	});

	it('should handle bright background colors (102m)', () => {
		const result = parseAnsiCodes('\x1b[102mBright green bg\x1b[0m');
		expect(result[0]?.bg).toBe('#00ff00');
	});

	it('should handle 256-color background (48;5;N)', () => {
		const result = parseAnsiCodes('\x1b[48;5;21mBlue bg\x1b[0m');
		expect(result[0]?.bg).toMatch(/^rgb\(|^#/);
	});

	it('should handle grayscale 256-colors (232-255)', () => {
		const result = parseAnsiCodes('\x1b[38;5;232mDark gray\x1b[0m');
		// Grayscale range should produce rgb values
		expect(result[0]?.fg).toMatch(/^rgb\(/);
	});

	it('should handle bold off (22m)', () => {
		const result = parseAnsiCodes('\x1b[1mBold\x1b[22mNormal\x1b[0m');
		const boldPart = result.find((p) => p.text === 'Bold');
		const normalPart = result.find((p) => p.text === 'Normal');
		expect(boldPart?.bold).toBe(true);
		expect(normalPart?.bold).toBeFalsy();
	});

	it('should handle underline off (24m)', () => {
		const result = parseAnsiCodes('\x1b[4mUnderlined\x1b[24mNormal\x1b[0m');
		const underlinedPart = result.find((p) => p.text === 'Underlined');
		const normalPart = result.find((p) => p.text === 'Normal');
		expect(underlinedPart?.underline).toBe(true);
		expect(normalPart?.underline).toBeFalsy();
	});

	it('should handle italic off (23m)', () => {
		const result = parseAnsiCodes('\x1b[3mItalic\x1b[23mNormal\x1b[0m');
		const italicPart = result.find((p) => p.text === 'Italic');
		const normalPart = result.find((p) => p.text === 'Normal');
		expect(italicPart?.italic).toBe(true);
		expect(normalPart?.italic).toBeFalsy();
	});

	it('should handle empty ANSI codes', () => {
		const result = parseAnsiCodes('\x1b[mText');
		expect(result[0]?.text).toBe('Text');
	});

	it('should handle multiple consecutive ANSI codes', () => {
		const result = parseAnsiCodes('\x1b[1m\x1b[31mText');
		expect(result[0]?.text).toBe('Text');
		expect(result[0]?.bold).toBe(true);
		expect(result[0]?.fg).toBe('#cc0000');
	});
});
