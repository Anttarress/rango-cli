import { describe, expect, it } from "vitest";
import {
  cell,
  formatAmount,
  formatDuration,
  formatUsd,
  keyValue,
  recordsTable,
  table,
  toSmallestUnit,
} from "./format.js";

describe("formatAmount", () => {
  it("scales by decimals without floating point", () => {
    expect(formatAmount("1500000000000000000", 18)).toBe("1.5");
    expect(formatAmount("1000000", 6)).toBe("1");
    expect(formatAmount("123", 6)).toBe("0.000123");
    expect(formatAmount("0", 18)).toBe("0");
    expect(formatAmount("12345678901234567890123", 18)).toBe("12345.678901234567890123");
  });
  it("passes through non-integers and empties", () => {
    expect(formatAmount("1.5", 18)).toBe("1.5");
    expect(formatAmount(null, 18)).toBe("");
    expect(formatAmount("42", undefined)).toBe("42");
  });
});

describe("toSmallestUnit", () => {
  it("converts decimals to integers", () => {
    expect(toSmallestUnit("1.5", 18)).toBe("1500000000000000000");
    expect(toSmallestUnit("0.000001", 6)).toBe("1");
    expect(toSmallestUnit("100", 6)).toBe("100000000");
    expect(toSmallestUnit(".5", 2)).toBe("50");
    expect(toSmallestUnit("0", 18)).toBe("0");
  });
  it("rejects too many decimals and junk", () => {
    expect(() => toSmallestUnit("1.1234567", 6)).toThrow(/decimal places/);
    expect(() => toSmallestUnit("abc", 6)).toThrow(/Not a decimal/);
    expect(() => toSmallestUnit("1e18", 6)).toThrow();
  });
});

describe("misc formatting", () => {
  it("formats usd and durations", () => {
    expect(formatUsd(2500.5)).toBe("$2,500.50");
    expect(formatUsd(null)).toBe("");
    expect(formatDuration(45)).toBe("~45 s");
    expect(formatDuration(600)).toBe("~10 min");
    expect(formatDuration(7200)).toBe("~2 h");
  });
  it("renders cells and tables", () => {
    expect(cell(true)).toBe("yes");
    expect(cell(null)).toBe("");
    expect(cell({ a: 1 })).toBe('{"a":1}');
    expect(cell("x".repeat(60), 10)).toBe(`${"x".repeat(9)}…`);
    const t = table(
      ["a", "bb"],
      [
        ["1", "2"],
        ["333", "4"],
      ],
    );
    expect(t.split("\n")[0]).toBe("a    bb");
    expect(t.split("\n")[2]).toBe("1    2");
    expect(table(["a"], [])).toBe("(no rows)");
    expect(recordsTable([{ a: 1 }, { b: 2, a: 3 }]).split("\n")[0]).toBe("a  b");
  });
  it("drops empty key/value rows", () => {
    expect(
      keyValue([
        ["A", "x"],
        ["Long key", undefined],
        ["B", null],
        ["C", 0],
      ]),
    ).toBe("A  x\nC  0");
  });
});
