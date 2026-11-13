import { afterEach, describe, expect, it, vi } from "vitest";
import { META_ETH, mockFetch, USDC } from "../test/helpers.js";
import { findToken, isIntegerAmount, parseAsset, resolveAmount } from "./assets.js";
import { configureOutput } from "./output.js";

afterEach(() => vi.unstubAllGlobals());

describe("parseAsset", () => {
  it("parses every documented form", () => {
    expect(parseAsset("BSC.BNB")).toEqual({ blockchain: "BSC", symbol: "BNB", address: undefined });
    expect(parseAsset("bsc")).toEqual({ blockchain: "BSC", symbol: undefined, address: undefined });
    expect(parseAsset(`ETH.USDC--${USDC}`)).toEqual({ blockchain: "ETH", symbol: "USDC", address: USDC });
    expect(parseAsset(`ETH--${USDC}`)).toEqual({ blockchain: "ETH", symbol: undefined, address: USDC });
  });
  it("rejects empty", () => {
    expect(() => parseAsset("")).toThrow(/Invalid asset/);
  });
});

describe("resolveAmount", () => {
  it("passes integers through without a lookup", async () => {
    const calls = mockFetch({});
    expect(isIntegerAmount("100")).toBe(true);
    expect(await resolveAmount("100", "ETH.ETH")).toBe("100");
    expect(calls).toHaveLength(0);
  });
  it("converts decimals using the token's decimals from meta", async () => {
    process.env["RANGO_API_KEY"] = "k";
    configureOutput({});
    const calls = mockFetch({ "/basic/meta": META_ETH });
    expect(await resolveAmount("1.5", `ETH.USDC--${USDC}`)).toBe("1500000");
    expect(await resolveAmount("0.25", "ETH.ETH")).toBe("250000000000000000");
    expect(calls[0]?.url.searchParams.get("blockchains")).toBe("ETH");
  });
  it("fails clearly when the token is unknown or the amount is junk", async () => {
    process.env["RANGO_API_KEY"] = "k";
    mockFetch({ "/basic/meta": META_ETH });
    await expect(resolveAmount("1.5", "ETH.NOPE")).rejects.toThrow(/not found/);
    await expect(resolveAmount("1,5", "ETH.ETH")).rejects.toThrow(/Invalid amount/);
    await expect(resolveAmount("1.5", "ETH")).rejects.toThrow(/Cannot resolve decimals/);
    await expect(resolveAmount("0.1234567", `ETH.USDC--${USDC}`)).rejects.toThrow(/decimal places/);
  });
  it("findToken prefers the native entry for a bare symbol", () => {
    const t = findToken(META_ETH.tokens as never, parseAsset("ETH.ETH"));
    expect(t?.address).toBeNull();
    expect(findToken(META_ETH.tokens as never, parseAsset(`ETH--${USDC.toUpperCase()}`))?.symbol).toBe(
      "USDC",
    );
  });
});
