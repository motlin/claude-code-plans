import { schemaChoiceRegistry } from "../src/lib/schema-choices";
import { JsonlRecordSchema } from "../src/lib/schemas";
import { jsonlRecordFixtures } from "./fixtures/jsonl-records";

const registeredVariants = schemaChoiceRegistry["JsonlRecordSchema"];
if (registeredVariants === undefined) {
  throw new Error("JsonlRecordSchema is missing from the schema-choice registry");
}
const registeredRecordTypes = Object.keys(registeredVariants);
const fixtureEntries = registeredRecordTypes.map(
  (recordType) =>
    [recordType, jsonlRecordFixtures[recordType as keyof typeof jsonlRecordFixtures]] as const,
);

describe("JSONL record fixtures", () => {
  it("covers every variant registered by the schema-choice registry", () => {
    expect(Object.keys(jsonlRecordFixtures).sort()).toStrictEqual(
      [...registeredRecordTypes].sort(),
    );
  });

  it.each(fixtureEntries)("parses the %s fixture", (_recordType, fixture) => {
    expect(JsonlRecordSchema.parse(fixture)).toStrictEqual(fixture);
  });

  it.each(fixtureEntries)("rejects an unknown field on the %s fixture", (_recordType, fixture) => {
    expect(JsonlRecordSchema.safeParse({ ...fixture, unexpectedFixtureField: true }).success).toBe(
      false,
    );
  });
});
