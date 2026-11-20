import { describe, expect, it } from "vitest";
import { tidyJson } from "./output.js";

describe("tidy JSON", () => {
  it("keeps a field on one line and breaks only where objects nest twice", () => {
    const schema = {
      type: "object",
      properties: {
        amount: { type: "string", description: 'An "integer" string' },
        swappers: { type: "array", items: { type: "string" } },
        route: { type: "object", properties: { fee: { type: "array", items: { type: "object" } } } },
      },
      required: ["amount"],
    };
    expect(tidyJson(schema)).toBe(
      [
        "{",
        '  "type": "object",',
        '  "properties": {',
        '    "amount": { "type": "string", "description": "An \\"integer\\" string" },',
        '    "swappers": { "type": "array", "items": { "type": "string" } },',
        '    "route": {',
        '      "type": "object",',
        '      "properties": {',
        '        "fee": { "type": "array", "items": { "type": "object" } }',
        "      }",
        "    }",
        "  },",
        '  "required": ["amount"]',
        "}",
      ].join("\n"),
    );
  });

  it("is the same JSON as JSON.stringify gives", () => {
    const values = [
      null,
      1,
      "text",
      [],
      {},
      [1, "two", null, true],
      [{ title: "A" }, { title: "B", oneOf: [{ title: "C" }] }],
      { skipped: undefined, kept: null, list: [undefined, 1], deep: { a: { b: { c: [{ d: 1 }] } } } },
    ];
    for (const value of values) {
      expect(JSON.parse(tidyJson(value))).toEqual(JSON.parse(JSON.stringify(value)));
    }
  });
});
