// Validates every checked-in public dataset against public-data/schema.json —
// the same check contributors rely on in CI.

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Ajv2020 } from "ajv/dist/2020";
import { describe, expect, test } from "vitest";

const publicDataDir = fileURLToPath(new URL("../../public-data", import.meta.url));
const schema = JSON.parse(readFileSync(join(publicDataDir, "schema.json"), "utf8"));
const dataFiles = readdirSync(publicDataDir).filter((f: string) => f.endsWith(".json") && f !== "schema.json");

describe("public-data schema validation", () => {
  test("at least the worked example exists", () => {
    expect(dataFiles).toContain("iphone-releases.json");
  });

  for (const file of dataFiles) {
    test(`${file} conforms to schema.json`, () => {
      const ajv = new Ajv2020({ allErrors: true });
      const validate = ajv.compile(schema);
      const data = JSON.parse(readFileSync(join(publicDataDir, file), "utf8"));
      const valid = validate(data);
      expect(validate.errors ?? []).toEqual([]);
      expect(valid).toBe(true);
    });
  }

  for (const file of dataFiles) {
    test(`${file} has internally unique and resolvable ids`, () => {
      const data = JSON.parse(readFileSync(join(publicDataDir, file), "utf8"));
      const ids = new Set<string>();
      for (const collection of ["groups", "categories", "rows", "entries"]) {
        for (const item of data[collection]) {
          expect(ids.has(item.id), `duplicate id ${item.id}`).toBe(false);
          ids.add(item.id);
        }
      }
      for (const row of data.rows) {
        expect(ids.has(row.groupId)).toBe(true);
        expect(ids.has(row.categoryId)).toBe(true);
      }
      for (const entry of data.entries) {
        expect(ids.has(entry.rowId)).toBe(true);
      }
    });
  }
});
