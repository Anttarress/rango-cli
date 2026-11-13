import { describe, expect, it } from "vitest";
import { findOperation, operations, toolName } from "./index.js";

const op = (surface: string, name: string) => {
  const found = operations.find((o) => o.surface === surface && o.name === name);
  if (!found) throw new Error(`missing ${surface} ${name}`);
  return found;
};

describe("catalogue", () => {
  it("has 29 operations with unique names and tool names", () => {
    expect(operations).toHaveLength(29);
    expect(new Set(operations.map((o) => `${o.surface}/${o.name}`)).size).toBe(29);
    expect(new Set(operations.map(toolName)).size).toBe(29);
    expect(toolName(op("main", "best-route"))).toBe("main_best_route");
    for (const o of operations) {
      expect(o.summary.length).toBeGreaterThan(5);
      expect(o.description.length).toBeGreaterThan(10);
    }
  });

  it("finds operations by every reference form", () => {
    expect(findOperation("basic quote")?.name).toBe("quote");
    expect(findOperation("basic", "quote")?.name).toBe("quote");
    expect(findOperation("main_best_route")?.name).toBe("best-route");
    expect(findOperation("main/best-route")?.name).toBe("best-route");
    expect(findOperation("MAIN:check_tx_status")?.name).toBe("check-tx-status");
    expect(findOperation("explore quote")).toBeUndefined();
    expect(findOperation("nope")).toBeUndefined();
  });

  it("basic quote joins lists and drops undefined", () => {
    const input = op("basic", "quote").input.parse({
      from: "BSC.BNB",
      to: "ETH.ETH",
      amount: "5",
      swappers: ["a", "b"],
      swappersExclude: true,
    });
    const spec = op("basic", "quote").request(input);
    expect(spec).toMatchObject({ method: "GET", path: "/basic/quote" });
    expect(spec.params).toEqual({
      from: "BSC.BNB",
      to: "ETH.ETH",
      amount: "5",
      swappers: "a,b",
      swappersExclude: true,
    });
  });

  it("basic report-tx defaults reason to the event", () => {
    const o = op("basic", "report-tx");
    const spec = o.request(o.input.parse({ requestId: "r", eventType: "USER_REJECT" }));
    expect(spec).toEqual({
      method: "POST",
      path: "/basic/report-tx",
      body: { requestId: "r", eventType: "USER_REJECT", reason: "USER_REJECT" },
    });
    expect(() => o.input.parse({ requestId: "r", eventType: "NOPE" })).toThrow();
  });

  it("main best-route builds the documented body", () => {
    const o = op("main", "best-route");
    const spec = o.request(
      o.input.parse({
        fromBlockchain: "ETH",
        fromSymbol: "USDC",
        fromAddress: "0xa0b8",
        toBlockchain: "BSC",
        amount: "100",
        selectedWallets: { ETH: "0x1", BSC: "0x2" },
        checkPrerequisites: true,
        swappers: ["Across"],
        depositTransaction: true,
      }),
    );
    expect(spec.method).toBe("POST");
    expect(spec.path).toBe("/routing/best");
    expect(spec.body).toEqual({
      from: { blockchain: "ETH", symbol: "USDC", address: "0xa0b8" },
      to: { blockchain: "BSC" },
      amount: "100",
      selectedWallets: { ETH: "0x1", BSC: "0x2" },
      checkPrerequisites: true,
      swappers: ["Across"],
      routingPreferences: { depositTransaction: true },
    });
  });

  it("main create-tx sends slippage as a string with validation defaults", () => {
    const o = op("main", "create-tx");
    expect(o.request(o.input.parse({ requestId: "r", step: 1 })).body).toEqual({
      requestId: "r",
      step: 1,
      userSettings: { slippage: "1", infiniteApprove: false },
      validations: { balance: true, fee: true, approve: true },
    });
    expect(
      o.request(o.input.parse({ requestId: "r", step: 2, slippage: 0.5, validateFee: false })).body,
    ).toMatchObject({
      userSettings: { slippage: "0.5" },
      validations: { fee: false },
    });
    expect(() => o.input.parse({ requestId: "r", step: 0 })).toThrow();
  });

  it("main check-approval puts the requestId in the path and wallet-details repeats address", () => {
    const approval = op("main", "check-approval");
    expect(approval.request(approval.input.parse({ requestId: "a/b", txId: "0x1" }))).toEqual({
      method: "GET",
      path: "/tx/a%2Fb/check-approval",
      params: { txId: "0x1" },
    });
    const wallets = op("main", "wallet-details");
    expect(wallets.request(wallets.input.parse({ addresses: ["ETH.0x1", "BSC.0x2"] })).params).toEqual({
      address: ["ETH.0x1", "BSC.0x2"],
    });
    expect(() => wallets.input.parse({ addresses: [] })).toThrow();
  });

  it("meta filters become comma-separated query params on both surfaces", () => {
    for (const o of [op("basic", "meta"), op("main", "meta"), op("main", "compact-meta")]) {
      const spec = o.request(o.input.parse({ blockchains: ["ETH", "BSC"], excludeNonPopulars: true }));
      expect(spec.params).toEqual({ blockchains: "ETH,BSC", excludeNonPopulars: true });
    }
  });
});
