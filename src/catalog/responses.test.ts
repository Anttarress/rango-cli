import { afterEach, describe, expect, it } from "vitest";
import { sample } from "../test/helpers.js";
import { operations } from "./index.js";
import { endpointOf, expand, referenceUrl, type SchemaNode, schemas } from "./responses.js";

const op = (surface: string, name: string) => {
  const found = operations.find((o) => o.surface === surface && o.name === name);
  if (!found) throw new Error(`missing ${surface} ${name}`);
  return found;
};

const response = (surface: string, name: string): SchemaNode => {
  const endpoint = endpointOf(op(surface, name));
  if (!endpoint) throw new Error(`no response for ${surface} ${name}`);
  return endpoint.response;
};

/** Every node of a schema, itself included. */
function nodes(node: SchemaNode): SchemaNode[] {
  const inside = [node.items, ...(node.oneOf ?? []), ...Object.values(node.properties ?? {})];
  return [node, ...inside.flatMap((child) => (child ? nodes(child) : []))];
}

describe("the responses taken from Rango's API reference", () => {
  it("has one for every operation, under the endpoint the operation calls", () => {
    for (const o of operations) {
      const endpoint = endpointOf(o);
      expect(endpoint, `${o.surface} ${o.name}`).toBeDefined();
      const spec = o.request(sample(o.input, "") as never);
      expect(`${endpoint?.method} ${endpoint?.path}`).toBe(`${spec.method} ${decodeURIComponent(spec.path)}`);
    }
    expect(referenceUrl({ method: "GET", path: "/basic/quote", docs: "quote", response: {} })).toBe(
      "https://api-docs.rango.exchange/reference/quote",
    );
  });

  it("refers only to schemas it has, and types every field", () => {
    const roots = [...operations.map((o) => endpointOf(o)?.response ?? {}), ...Object.values(schemas)];
    for (const node of roots.flatMap(nodes)) {
      if (node.$ref) expect(schemas[node.$ref], node.$ref).toBeDefined();
      else expect(node.type, JSON.stringify(node).slice(0, 80)).toBeDefined();
    }
  });

  it("writes a schema out as many levels deep as asked", () => {
    const top = expand(response("basic", "quote"), 0);
    expect(Object.keys(top.properties ?? {})).toEqual([
      "requestId",
      "resultType",
      "route",
      "error",
      "errorCode",
      "traceId",
    ]);
    expect(top.required).toEqual(["requestId", "resultType"]);
    expect(top.properties?.["resultType"]?.enum).toContain("NO_ROUTE");
    // Below the depth an object keeps what it is, not what is in it.
    expect(top.properties?.["route"]).toEqual({ type: "object", description: "Route found by Rango" });

    const one = expand(response("basic", "quote"), 1).properties?.["route"];
    expect(one?.properties?.["outputAmount"]).toMatchObject({ type: "integer", format: "int64" });
    expect(one?.properties?.["swapper"]?.properties).toBeUndefined();
    // An array's items sit at the array's own level.
    expect(one?.properties?.["fee"]).toEqual({ type: "array", items: { type: "object" } });

    const two = expand(response("basic", "quote"), 2).properties?.["route"];
    expect(Object.keys(two?.properties?.["swapper"]?.properties ?? {})).toContain("swapperGroup");
    expect(Object.keys(two?.properties?.["fee"]?.items?.properties ?? {})).toContain("expenseType");
    expect(JSON.stringify(expand(response("basic", "quote"), 9))).not.toContain("$ref");
  });

  it("names the variants of a oneOf, and writes their fields out one level further down", () => {
    const closed = expand(response("basic", "swap"), 0).properties?.["tx"];
    expect(closed?.oneOf?.map((variant) => variant.title)).toContain("BasicApiEvmTransaction");
    expect(closed?.oneOf?.every((variant) => Object.keys(variant).join() === "title")).toBe(true);

    const named = expand(response("basic", "swap"), 1).properties?.["tx"];
    const evm = named?.oneOf?.find((variant) => variant.title === "BasicApiEvmTransaction");
    expect(evm?.description).toMatch(/EVM/);
    expect(evm?.properties).toBeUndefined();

    const open = expand(response("basic", "swap"), 2).properties?.["tx"];
    const fields = open?.oneOf?.find((variant) => variant.title === "BasicApiEvmTransaction")?.properties;
    // Fields of the base transaction and of the EVM one, folded together.
    expect(Object.keys(fields ?? {})).toEqual(
      expect.arrayContaining(["type", "txTo", "txData", "approveTo"]),
    );
  });

  describe("a schema that contains itself", () => {
    afterEach(() => {
      delete schemas["Loop"];
    });

    it("is written out once", () => {
      schemas["Loop"] = {
        type: "object",
        properties: {
          name: { type: "string" },
          next: { $ref: "Loop" },
          all: { type: "array", items: { $ref: "Loop" } },
        },
      };
      expect(expand({ $ref: "Loop" }, 50)).toEqual({
        type: "object",
        properties: {
          name: { type: "string" },
          next: { type: "object" },
          all: { type: "array", items: { type: "object" } },
        },
      });
    });
  });
});
