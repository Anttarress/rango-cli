import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { setOverrides } from "../core/config.js";
import { BLOCKCHAINS, mockFetch, run } from "../test/helpers.js";
import { optionsFor } from "./generated.js";

beforeEach(() => {
  process.env["RANGO_API_KEY"] = "test-key-00000000";
  process.env["XDG_CONFIG_HOME"] = "/nonexistent/for/test";
  setOverrides({});
});
afterEach(() => vi.unstubAllGlobals());

describe("zod to commander", () => {
  it("maps each schema kind to the right option", () => {
    const [str] = optionsFor("fromAsset", z.string().describe("Asset"));
    expect(str?.long).toBe("--from-asset");
    expect(str?.required).toBe(true);
    expect(str?.mandatory).toBe(true);
    const [opt] = optionsFor("slippage", z.number().optional());
    expect(opt?.mandatory).toBe(false);
    const bools = optionsFor("checkPrerequisites", z.boolean().optional());
    expect(bools.map((o) => o.long)).toEqual(["--check-prerequisites", "--no-check-prerequisites"]);
    const [list] = optionsFor("swappers", z.array(z.string()).optional());
    expect(list?.flags).toBe("--swappers <a,b>");
    const [json] = optionsFor("selectedWallets", z.record(z.string(), z.string()).optional());
    expect(json?.flags).toBe("--selected-wallets <json>");
    const [choice] = optionsFor("eventType", z.enum(["A", "B"]));
    expect(choice?.argChoices).toEqual(["A", "B"]);
  });
});

describe("generated commands", () => {
  it("main best-route builds the body from flags, including JSON and tri-state booleans", async () => {
    const calls = mockFetch({ "/routing/best": { requestId: "r" } });
    const r = await run([
      "main",
      "best-route",
      "--from-blockchain",
      "ETH",
      "--from-symbol",
      "usdc",
      "--to-blockchain",
      "BSC",
      "--amount",
      "1",
      "--selected-wallets",
      '{"ETH":"0x1"}',
      "--check-prerequisites",
      "--swappers",
      "a,b",
      "--swappers",
      "c",
    ]);
    expect(r.code).toBe(0);
    const body = JSON.parse(String(calls[0]?.init.body));
    expect(body).toEqual({
      from: { blockchain: "ETH", symbol: "usdc" },
      to: { blockchain: "BSC" },
      amount: "1",
      selectedWallets: { ETH: "0x1" },
      checkPrerequisites: true,
      swappers: ["a", "b", "c"],
    });
    const negated = await run([
      "main",
      "best-route",
      "--from-blockchain",
      "ETH",
      "--to-blockchain",
      "BSC",
      "--amount",
      "1",
      "--no-check-prerequisites",
    ]);
    expect(negated.code).toBe(0);
    expect(JSON.parse(String(calls[1]?.init.body)).checkPrerequisites).toBe(false);
  });

  it("validates flags before any request", async () => {
    const calls = mockFetch({});
    const missing = await run(["main", "best-route", "--from-blockchain", "ETH"]);
    expect(missing.code).toBe(1);
    expect(missing.stderr).toMatch(/required option/);
    const badJson = await run([
      "main",
      "best-route",
      "--from-blockchain",
      "ETH",
      "--to-blockchain",
      "BSC",
      "--amount",
      "1",
      "--selected-wallets",
      "{nope",
    ]);
    expect(badJson.code).toBe(1);
    expect(badJson.stderr).toMatch(/expected JSON/);
    const badNumber = await run(["main", "create-tx", "--request-id", "r", "--step", "one"]);
    expect(badNumber.code).toBe(1);
    const badStep = await run(["main", "create-tx", "--request-id", "r", "--step", "0"]);
    expect(badStep.code).toBe(2);
    expect(badStep.stderr).toMatch(/step/);
    expect(calls).toHaveLength(0);
  });

  it("basic chains prints JSON and schema/map describe the catalogue", async () => {
    mockFetch({ "/basic/meta/blockchains": BLOCKCHAINS });
    const r = await run(["basic", "chains"]);
    expect(JSON.parse(r.stdout)).toHaveLength(3);
    const schema = JSON.parse((await run(["schema", "main_best_route"])).stdout);
    expect(schema.command).toBe("rango main best-route");
    expect(schema.input.required).toEqual(["fromBlockchain", "toBlockchain", "amount"]);
    expect(schema.input.properties.selectedWallets.type).toBe("object");
    const two = JSON.parse((await run(["schema", "basic", "quote"])).stdout);
    expect(two.tool).toBe("basic_quote");
    expect((await run(["schema", "nope"])).code).toBe(2);
    const map = JSON.parse((await run(["map"])).stdout);
    expect(map.surfaces.basic).toHaveLength(13);
    expect(map.surfaces.main).toHaveLength(16);
    expect(map.curated.some((c: { command: string }) => c.command === "rango quote")).toBe(true);
  });

  it("route renders the multi-step table", async () => {
    const calls = mockFetch({
      "/routing/best": {
        requestId: "r-1",
        result: {
          resultType: "OK",
          outputAmount: "99500000",
          swaps: [
            {
              swapperId: "Uniswap",
              from: { symbol: "USDC", blockchain: "ETH", decimals: 6 },
              to: { symbol: "ETH", blockchain: "ETH", decimals: 18 },
              toAmount: "40000000000000000",
              estimatedTimeInSeconds: 30,
            },
            {
              swapperId: "Across",
              from: { symbol: "ETH", blockchain: "ETH", decimals: 18 },
              to: { symbol: "USDC", blockchain: "ARBITRUM", decimals: 6 },
              toAmount: "99500000",
              estimatedTimeInSeconds: 90,
            },
          ],
        },
        diagnosisMessages: ["Fees are high right now"],
      },
    });
    const r = await run(
      [
        "route",
        "--from-chain",
        "eth",
        "--from-token",
        "usdc",
        "--to-chain",
        "arbitrum",
        "--to-token",
        "0xaf88d065e77c8cc2239327c5edb3a432268e5831",
        "--amount",
        "100",
        "--wallets",
        '{"ETH":"0x1"}',
      ],
      { tty: true },
    );
    expect(r.code).toBe(0);
    const body = JSON.parse(String(calls[0]?.init.body));
    expect(body.from).toEqual({ blockchain: "ETH", symbol: "USDC" });
    expect(body.to).toEqual({
      blockchain: "ARBITRUM",
      address: "0xaf88d065e77c8cc2239327c5edb3a432268e5831",
    });
    expect(r.stdout).toMatch(/Steps +2/);
    expect(r.stdout).toMatch(/You receive +99\.5 USDC/);
    expect(r.stdout).toMatch(/~2 min/);
    expect(r.stdout).toMatch(/Across/);
    expect(r.stdout).toMatch(/Note: Fees are high/);
    mockFetch({ "/routing/best": { requestId: "r", result: null, error: "no route" } });
    expect(
      (await run(["route", "--from-chain", "ETH", "--to-chain", "BSC", "--amount", "1"], { tty: true })).code,
    ).toBe(4);
  });
});
