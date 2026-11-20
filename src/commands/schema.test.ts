import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { operations } from "../catalog/index.js";
import { run } from "../test/helpers.js";

const columns = Object.getOwnPropertyDescriptor(process.stdout, "columns");
const setColumns = (value: number) =>
  Object.defineProperty(process.stdout, "columns", { value, configurable: true });

beforeEach(() => setColumns(100));
afterEach(() => {
  if (columns) Object.defineProperty(process.stdout, "columns", columns);
  else delete (process.stdout as { columns?: number }).columns;
});

const table = async (...args: string[]) => (await run(["schema", ...args], { tty: true })).stdout.split("\n");
const json = async (...args: string[]) => JSON.parse((await run(["schema", ...args])).stdout);

describe("rango schema on a terminal", () => {
  it("lists what an operation takes and returns, a field per line", async () => {
    setColumns(120);
    const lines = await table("basic", "quote");
    expect(lines.slice(0, 5)).toEqual([
      "rango basic quote",
      "Best single-step route, without a transaction",
      "GET /basic/quote · MCP tool basic_quote",
      "",
      "Input",
    ]);
    const text = lines.join("\n");
    expect(text).toMatch(/^ {2}from \* +string +Source asset, e\.g\. "BSC\.BNB" or "ETH\.USDC--0xa0b8…"$/m);
    expect(text).toMatch(/^ {2}swappers +string\[\] +Only route through these swapper ids$/m);
    // Output: the response as Rango's API reference documents it, one level of nesting deep.
    expect(text).toMatch(
      /^ {2}resultType \* +string +Route state \(OK \| HIGH_IMPACT \| INPUT_LIMIT_ISSUE \| NO_ROUTE\)$/m,
    );
    expect(text).toMatch(/^ {2}route +object +Route found by Rango$/m);
    expect(text).toMatch(/^ {4}outputAmount \* +int64 +Swap output$/m);
    expect(text).toMatch(/^ {4}fee \* +object\[\]$/m);
    expect(text).not.toMatch(/^ {6}\w/m); // nothing two levels down
    expect(lines.slice(-3)).toEqual([
      "",
      "* required · int64 and decimal amounts are sent as strings · --depth 2 shows nested fields",
      "https://api-docs.rango.exchange/reference/quote",
    ]);
  });

  it("keeps the columns aligned and inside the terminal", async () => {
    for (const width of [80, 100, 120]) {
      setColumns(width);
      const lines = await table("basic", "quote");
      // A row is a name, a star when required, and a type; where the type starts is the column.
      const typeAt = lines
        .map((line) => /^( +\w+(?: \*)? +)(?:string|number|boolean|object|int\d\d|double|decimal)/.exec(line))
        .flatMap((row) => (row?.[1] ? [row[1].length] : []));
      expect(typeAt.length).toBeGreaterThan(30);
      expect(new Set(typeAt).size, `type column at ${width}`).toBe(1);
      const body = lines.slice(lines.indexOf("Input"), lines.lastIndexOf(""));
      expect(Math.max(...body.map((line) => line.length))).toBeLessThanOrEqual(width);
    }
  });

  it("puts descriptions under the fields when the terminal is narrow", async () => {
    setColumns(44);
    const lines = await table("basic", "status");
    const at = lines.findIndex((line) => /^ {2}requestId \* +string$/.test(line));
    expect(at).toBeGreaterThan(0);
    expect(lines[at + 1]).toMatch(/^ {6}requestId returned by the swap call/);
    expect(
      Math.max(...lines.slice(lines.indexOf("Input"), lines.lastIndexOf("")).map((l) => l.length)),
    ).toBeLessThanOrEqual(44);
  });

  it("says what kind of thing comes back when it is not an object, and that nothing goes in", async () => {
    const lines = await table("basic", "chains");
    expect(lines.slice(lines.indexOf("Input"), lines.indexOf("Input") + 2)).toEqual(["Input", "  none"]);
    expect(lines).toContain("Output  object[]");
    expect(lines.join("\n")).toMatch(/^ {2}name \* +string$/m);
  });

  it("names the variants of a oneOf, and lists their fields with --depth 2", async () => {
    const one = (await table("basic", "swap")).join("\n");
    expect(one).toMatch(/^ {2}tx +oneOf +BasicApiEvmTransaction \| BasicApiStarkNetTransaction \|/m);
    expect(one).not.toMatch(/txTo/);
    const two = (await table("basic", "swap", "--depth", "2")).join("\n");
    expect(two).toMatch(/^ {2}tx +oneOf$/m);
    expect(two).toMatch(
      /^ {4}BasicApiEvmTransaction +object +The transaction object for all EVM-based blockchains/m,
    );
    expect(two).toMatch(/^ {6}txTo \* +string +Address of smart contract that is going to be called$/m);
    expect(two).toMatch(/--depth 3 shows nested fields/);
  });

  it("stops offering more depth once everything is shown", async () => {
    const top = await table("basic", "token-balance", "--depth", "0");
    expect(top.at(-2)).toBe("* required · int64 and decimal amounts are sent as strings");
    expect((await table("main", "report-tx")).at(-2)).toBe("* required");
  });
});

describe("rango schema as JSON", () => {
  it("is the same information as JSON Schema", async () => {
    const schema = await json("main_best_route");
    expect(schema).toMatchObject({
      command: "rango main best-route",
      tool: "main_best_route",
      method: "POST",
      path: "/routing/best",
      readOnly: true,
      reference: "https://api-docs.rango.exchange/reference/getbestroute",
    });
    expect(schema.input.required).toEqual(["fromBlockchain", "toBlockchain", "amount"]);
    expect(schema.input.properties.selectedWallets.type).toBe("object");
    expect(schema.output.required).toContain("requestId");
    expect(schema.output.properties.result.properties.swaps).toMatchObject({
      type: "array",
      items: { type: "object" },
    });
    expect(schema.output.$comment).toBe(
      "int64 and decimal amounts are sent as strings. --depth 2 shows nested fields.",
    );
  });

  it("goes as deep as --depth says", async () => {
    const top = await json("basic", "quote", "--depth", "0");
    expect(top.output.properties.route).toEqual({ type: "object", description: "Route found by Rango" });
    const deep = await json("basic", "quote", "--depth", "2");
    expect(deep.output.properties.route.properties.swapper.properties.id).toEqual({ type: "string" });
    expect((await json("main", "report-tx")).output.$comment).toBeUndefined();
  });

  it("prints a field per line, or everything on one line with --compact", async () => {
    const pretty = (await run(["schema", "basic", "quote"])).stdout;
    expect(pretty).toContain(
      '\n      "amount": { "type": "string", "description": "Amount in the token\'s smallest unit',
    );
    expect(pretty).toContain(
      '\n          "outputAmount": { "type": "integer", "format": "int64", "description": "Swap output" },',
    );
    expect(pretty.split("\n").length).toBeLessThan(80);
    const compact = (await run(["schema", "basic", "quote", "--compact"])).stdout;
    expect(compact.split("\n")).toHaveLength(1);
    expect(JSON.parse(compact)).toEqual(JSON.parse(pretty));
    // --json on a terminal is the JSON form too.
    expect((await run(["schema", "basic", "quote", "--json"], { tty: true })).stdout).toBe(pretty);
  });
});

describe("rango schema", () => {
  it.each(operations.map((op) => [op.surface, op.name]))(
    "describes %s %s in both forms",
    async (surface, name) => {
      const piped = await run(["schema", surface, name]);
      expect(piped.code).toBe(0);
      const schema = JSON.parse(piped.stdout);
      expect(schema.command).toBe(`rango ${surface} ${name}`);
      expect(["object", "array"]).toContain(schema.output.type);
      const shown = await run(["schema", surface, name], { tty: true });
      expect(shown.code).toBe(0);
      expect(shown.stdout).toMatch(/^Input$/m);
      expect(shown.stdout).toMatch(/^Output( {2}object\[\])?$/m);
    },
  );

  it("rejects an operation it does not know and a depth that is not a count", async () => {
    const unknown = await run(["schema", "nope"]);
    expect(unknown.code).toBe(2);
    expect(unknown.stderr).toMatch(/Unknown operation/);
    expect((await run(["schema", "basic", "token"])).code).toBe(2);
    for (const depth of ["-1", "1.5", "deep"]) {
      const bad = await run(["schema", "basic", "quote", "--depth", depth]);
      expect(bad.code, depth).toBe(1);
      expect(bad.stderr).toMatch(/expected a whole number/);
    }
  });
});
