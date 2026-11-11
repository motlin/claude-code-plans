import {
	MASK_CHAR,
	SECRET_LABELS,
	SECRET_PATTERNS,
	cutUnterminatedPrivateKey,
	findSecrets,
	maskAndCap,
	maskSecretValue,
	maskSecrets,
	maskSecretsCompact,
	maskSecretsFixed,
	maskUrlSecrets,
	maskedPrefix,
	stripControlsAndMask,
} from "../src/lib/secret-mask";

// A fake PEM armor, assembled so no literal key header sits in the source.
const KEY_KIND = ["RSA", "PRIVATE", "KEY"].join(" ");
const PEM_BEGIN = `-----BEGIN ${KEY_KIND}-----`;
const PEM_END = `-----END ${KEY_KIND}-----`;
const bullets = (n: number): string => MASK_CHAR.repeat(n);
const FAKE_GH = `ghp_${"A".repeat(36)}`;
const FAKE_AWS = "AKIAEXAMPLEFAKE12345";
const PEM_BODY = ["QUJDRA==TESTFAKEKEY", "QUJDRA==TESTFAKE"];
const PEM = `${PEM_BEGIN}\n${PEM_BODY.join("\n")}\n${PEM_END}`;

describe("findSecrets", () => {
	test("finds a GitHub token with its offsets and pattern", () => {
		expect(findSecrets(`token ${FAKE_GH} end`)).toStrictEqual([
			{start: 6, end: 46, value: FAKE_GH, patternId: "github"},
		]);
	});

	test("ignores a token under the minimum length", () => {
		expect(findSecrets(`sk-ant-${"a".repeat(5)}`)).toStrictEqual([]);
	});

	test("finds an in-word token glued after an underscore (added path)", () => {
		expect(findSecrets(`id_${FAKE_GH}`)).toStrictEqual([{start: 3, end: 43, value: FAKE_GH, patternId: "github"}]);
	});

	test("finds a token after a literal \\n escape", () => {
		expect(findSecrets(`a\\n${FAKE_GH}`)).toStrictEqual([{start: 3, end: 43, value: FAKE_GH, patternId: "github"}]);
	});

	test("finds a whole PEM block as one private_key match", () => {
		expect(findSecrets(`x ${PEM}`)).toStrictEqual([
			{start: 2, end: 2 + PEM.length, value: PEM, patternId: "private_key"},
		]);
	});

	test("matches a token split by an invisible character via the shadow copy", () => {
		const split = `gh​p_${"A".repeat(36)}`;
		expect(findSecrets(split)).toStrictEqual([{start: 0, end: split.length, value: split, patternId: "github"}]);
	});

	test("returns [] for input longer than 262144 chars", () => {
		expect(findSecrets(`${" ".repeat(262145)}${FAKE_GH}`)).toStrictEqual([]);
	});
});

describe("maskSecretValue", () => {
	test("bullets a value of 12 chars or fewer entirely", () => {
		expect(maskSecretValue("abcdefghijkl")).toBe(bullets(12));
	});

	test("keeps the first 8 chars of a longer value", () => {
		expect(maskSecretValue(FAKE_AWS)).toBe(`AKIAEXAM${bullets(12)}`);
	});

	test("respects a shorter keep", () => {
		expect(maskSecretValue(FAKE_GH, 3)).toBe(`ghp${bullets(37)}`);
	});

	test("counts visible chars when the value holds invisible chars", () => {
		expect(maskSecretValue(`gh​p_${"A".repeat(36)}`)).toBe(`gh​p_AAAA${bullets(32)}`);
	});

	test("keeps PEM header and footer legible and bullets body lines at equal length", () => {
		expect(maskSecretValue(PEM)).toBe(
			`${PEM_BEGIN}\n${PEM_BODY.map((l) => bullets(l.length)).join("\n")}\n${PEM_END}`,
		);
	});
});

describe("maskSecrets", () => {
	test("bullets a token after its first 8 chars", () => {
		expect(maskSecrets(`token ${FAKE_GH} end`)).toBe(`token ghp_AAAA${bullets(32)} end`);
	});

	test("keeps the text after a token, invisible characters included, as upstream's ME does", () => {
		const rlo = String.fromCodePoint(0x202e);
		expect({
			spaced: maskSecrets(`Use ${FAKE_GH} ${rlo}ok`),
			glued: maskSecrets(`Use ${FAKE_GH}${rlo}ok`),
		}).toStrictEqual({
			spaced: `Use ghp_AAAA${bullets(32)} ${rlo}ok`,
			glued: `Use ghp_AAAA${bullets(35)}`,
		});
	});

	test("returns the same string when there is no trigger", () => {
		const text = "nothing secret here";
		expect(maskSecrets(text)).toBe(text);
	});

	test("masks a token inside the window overlap of a long text once", () => {
		const text = `${" ".repeat(262000)}${FAKE_GH}${" ".repeat(300000 - 262040)}`;
		expect(maskSecrets(text)).toBe(`${" ".repeat(262000)}ghp_AAAA${bullets(32)}${" ".repeat(300000 - 262040)}`);
	});
});

describe("compact and fixed forms", () => {
	test("maskSecretsCompact collapses each masked run to 7 bullets", () => {
		expect(maskSecretsCompact(`a ${FAKE_GH} b`)).toBe(`a ghp_AAAA${bullets(7)} b`);
	});

	test("maskSecretsCompact collapses a masked PEM body including its newlines", () => {
		expect(maskSecretsCompact(PEM)).toBe(`${PEM_BEGIN}${bullets(7)}${PEM_END}`);
	});

	test("maskSecretsFixed replaces each secret with exactly 7 bullets", () => {
		expect(maskSecretsFixed(`a ${FAKE_GH} b ${FAKE_AWS}`)).toBe(`a ${bullets(7)} b ${bullets(7)}`);
	});
});

describe("cutUnterminatedPrivateKey", () => {
	test("cuts before an unterminated key header", () => {
		expect(cutUnterminatedPrivateKey(`note ${PEM_BEGIN}\nMIIB`)).toBe("note ");
	});

	test("leaves a masked terminated key unchanged", () => {
		const masked = maskSecrets(`note ${PEM} done`);
		expect(cutUnterminatedPrivateKey(masked)).toBe(masked);
	});

	test("leaves text without a key unchanged", () => {
		expect(cutUnterminatedPrivateKey("plain")).toBe("plain");
	});
});

describe("maskAndCap", () => {
	test("caps at 262144 chars plus an ellipsis", () => {
		const out = maskAndCap("x".repeat(262145));
		expect({length: out.length, last: out.at(-1)}).toStrictEqual({length: 262145, last: "…"});
	});

	test("masks short text without capping", () => {
		expect(maskAndCap(FAKE_AWS)).toBe(`AKIAEXAM${bullets(12)}`);
	});
});

describe("maskedPrefix", () => {
	test("masks then truncates to n", () => {
		expect(maskedPrefix(`ab ${FAKE_GH}`, 10)).toBe("ab ghp_AAA");
	});

	test("a token cut at the boundary keeps at most 8 visible chars when more follows", () => {
		expect(maskedPrefix(`ab ${FAKE_GH}`, 20, true)).toBe(`ab ghp_AAAA${bullets(9)}`);
	});
});

describe("other helpers", () => {
	test("stripControlsAndMask masks and drops control chars", () => {
		expect(stripControlsAndMask(`a\u0007 ${FAKE_AWS}`)).toBe(`a AKIAEXAM${bullets(12)}`);
	});

	test("maskUrlSecrets masks a secret in the path but keeps the host", () => {
		expect(maskUrlSecrets(`https://example.com/${FAKE_GH}`)).toBe(`https://example.com/ghp_AAAA${bullets(32)}`);
	});

	test("pattern table ids and labels", () => {
		expect({
			ids: SECRET_PATTERNS.map((p) => p.id),
			labels: SECRET_LABELS,
		}).toStrictEqual({
			ids: [
				"anthropic",
				"openai_proj",
				"openai",
				"github",
				"aws",
				"slack",
				"google",
				"stripe",
				"stripe_webhook",
				"age",
				"gitlab",
				"jwt",
				"private_key",
			],
			labels: {
				anthropic: "Anthropic API key",
				openai_proj: "OpenAI API key",
				openai: "OpenAI API key",
				github: "GitHub token",
				aws: "AWS access key",
				slack: "Slack token",
				google: "Google API key",
				stripe: "Stripe API key",
				stripe_webhook: "Stripe webhook secret",
				age: "age secret key",
				jwt: "JWT",
				private_key: "private key",
				unknown: "secret",
			},
		});
	});
});
