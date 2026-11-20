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

  it("basic chains prints JSON and map describes the catalogue", async () => {
    mockFetch({ "/basic/meta/blockchains": BLOCKCHAINS });
    const r = await run(["basic", "chains"]);
    expect(JSON.parse(r.stdout)).toHaveLength(3);
    const map = JSON.parse((await run(["map"])).stdout);
    expect(map.surfaces.basic).toHaveLength(15); // 13 catalog ops + token + tokens
    expect(map.surfaces.main).toHaveLength(17); // 15 catalog ops + token + tokens
    expect(map.curated.some((c: { command: string }) => c.command === "rango auth")).toBe(true);
    expect(map.surfaces.basic.some((o: { command: string }) => o.command === "rango basic token")).toBe(true);
  });

  it("every generated command shows an example and accepts `help` on leaves", async () => {
    const leaf = await run(["basic", "quote", "help"]);
    expect(leaf.code).toBe(0);
    expect(leaf.stdout).toMatch(/Example:/);
    expect(leaf.stdout).toMatch(/rango basic quote --from/);
    const dashHelp = await run(["main", "create-tx", "--help"]);
    expect(dashHelp.stdout).toMatch(/Example:/);
    expect(dashHelp.stdout).toMatch(/rango main create-tx --request-id/);
    const group = await run(["basic", "help"]);
    expect(group.code).toBe(0);
    expect(group.stdout).toMatch(/\bquote\b/);
    expect((await run(["map", "help"])).stdout).toMatch(/Examples:/);
  });
});
