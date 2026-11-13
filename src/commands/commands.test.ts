import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setOverrides } from "../core/config.js";
import {
  BLOCKCHAINS,
  empty,
  html,
  json,
  META_BSC,
  META_ETH,
  mockFetch,
  QUOTE,
  run,
  SWAP,
  USDC,
} from "../test/helpers.js";

const ADDR = `0x${"a".repeat(40)}`;

beforeEach(() => {
  process.env["RANGO_API_KEY"] = "test-key-00000000";
  process.env["XDG_CONFIG_HOME"] = "/nonexistent/for/test";
  delete process.env["RANGO_API_URL"];
  setOverrides({});
});
afterEach(() => vi.unstubAllGlobals());

describe("global behaviour", () => {
  it("prints JSON when not a tty and tables on a tty", async () => {
    mockFetch({ "/basic/meta/blockchains": BLOCKCHAINS });
    const piped = await run(["chains"]);
    expect(piped.code).toBe(0);
    expect(JSON.parse(piped.stdout)).toHaveLength(2); // disabled COSMOS filtered
    const tty = await run(["chains", "--all"], { tty: true });
    expect(tty.stdout.split("\n")[0]).toBe("name    displayName  type    chainId      enabled");
    expect(tty.stdout).toMatch(/COSMOS/);
    const compact = await run(["chains", "--compact"], { tty: true });
    expect(compact.stdout.split("\n")).toHaveLength(1);
  });
  it("--api-key wins over the environment", async () => {
    const calls = mockFetch({ "/basic/meta/swappers": [] });
    await run(["swappers", "--api-key", "override-key-000"]);
    expect(calls[0]?.url.searchParams.get("apiKey")).toBe("override-key-000");
  });
  it("maps failures to exit codes with JSON on stderr", async () => {
    mockFetch({ "/basic/meta/swappers": empty(401) });
    const auth = await run(["swappers"]);
    expect(auth.code).toBe(3);
    expect(auth.stdout).toBe("");
    expect(JSON.parse(auth.stderr)).toMatchObject({ error: true, exitCode: 3 });
    mockFetch({ "/basic/meta/swappers": html(403, "<html>blocked</html>") });
    expect((await run(["swappers"])).code).toBe(4);
    mockFetch({ "/basic/meta/swappers": new TypeError("fetch failed") });
    expect((await run(["swappers"])).code).toBe(5);
    const usage = await run(["report", "req", "--event", "NOPE"]);
    expect(usage.code).toBe(1); // commander's own validation
    expect(usage.stderr).toMatch(/Allowed choices/);
  });
  it("human errors on a tty", async () => {
    mockFetch({ "/basic/meta/swappers": json(500, { error: "boom", errorCode: 1101 }) });
    const r = await run(["swappers"], { tty: true });
    expect(r.code).toBe(4);
    expect(r.stderr).toMatch(/^Error: HTTP 500: boom \(code 1101\)/);
  });
});

describe("metadata commands", () => {
  it("chain <name> finds by name or display name", async () => {
    mockFetch({ "/basic/meta/blockchains": BLOCKCHAINS });
    const r = await run(["chain", "bnb chain"]);
    expect(JSON.parse(r.stdout).name).toBe("BSC");
    const missing = await run(["chain", "NOPE"]);
    expect(missing.code).toBe(2);
  });
  it("tokens filters and token resolves symbol or address", async () => {
    const calls = mockFetch({ "/basic/meta": META_ETH });
    const r = await run(["tokens", "eth", "--search", "usd", "--popular"]);
    expect(r.stderr).toBe("");
    expect(JSON.parse(r.stdout).map((t: { symbol: string }) => t.symbol)).toEqual(["USDC"]);
    expect(calls[0]?.url.searchParams.get("blockchains")).toBe("ETH");
    const bySymbol = await run(["token", "ETH", "usdc"]);
    expect(JSON.parse(bySymbol.stdout).address).toBe(USDC);
    const byAddress = await run(["token", "ETH", USDC.toUpperCase()]);
    expect(JSON.parse(byAddress.stdout).symbol).toBe("USDC");
  });
  it("token falls back to custom-token for an unknown address", async () => {
    mockFetch({
      "/basic/meta/custom-token": {
        token: { blockchain: "ETH", symbol: "NEW", address: `0x${"1".repeat(40)}`, decimals: 9 },
      },
      "/basic/meta": META_ETH,
    });
    const r = await run(["token", "ETH", `0x${"1".repeat(40)}`]);
    expect(JSON.parse(r.stdout).decimals).toBe(9);
  });
  it("swappers filters by type", async () => {
    mockFetch({
      "/basic/meta/swappers": [
        { id: "A", types: ["DEX"], enabled: true },
        { id: "B", types: ["BRIDGE"], enabled: true },
        { id: "C", types: ["DEX"], enabled: false },
      ],
    });
    const r = await run(["swappers", "--type", "dex"]);
    expect(JSON.parse(r.stdout).map((s: { id: string }) => s.id)).toEqual(["A"]);
  });
});

describe("quote", () => {
  it("sends the documented params and renders the route", async () => {
    const calls = mockFetch({ "/basic/quote": QUOTE });
    const r = await run(
      [
        "quote",
        "--from",
        "BSC.BNB",
        "--to",
        `ETH.USDC--${USDC}`,
        "--amount",
        "100000000000000000",
        "--slippage",
        "1",
        "--swappers",
        "a, b",
        "--exclude-swappers",
      ],
      { tty: true },
    );
    expect(r.code).toBe(0);
    const p = calls[0]?.url.searchParams;
    expect(p?.get("from")).toBe("BSC.BNB");
    expect(p?.get("amount")).toBe("100000000000000000");
    expect(p?.get("slippage")).toBe("1");
    expect(p?.get("swappers")).toBe("a,b");
    expect(p?.get("swappersExclude")).toBe("true");
    expect(r.stdout).toMatch(/BNB \(BSC\) -> USDC \(ETH\) via 1inch/);
    expect(r.stdout).toMatch(/You receive +2500 USDC/);
    expect(r.stdout).toMatch(/Minimum +2480 USDC/);
    expect(r.stdout).toMatch(/\$2,500\.50/);
    expect(r.stdout).toMatch(/~2 min/);
    expect(r.stdout).toMatch(/PancakeSwap/); // path table for 2 steps
  });
  it("converts a decimal amount through token metadata", async () => {
    const calls = mockFetch({ "/basic/meta": META_BSC, "/basic/quote": QUOTE });
    await run(["quote", "--from", "BSC.BNB", "--to", "ETH.ETH", "--amount", "0.1"]);
    expect(calls.find((c) => c.url.pathname.endsWith("/basic/quote"))?.url.searchParams.get("amount")).toBe(
      "100000000000000000",
    );
  });
  it("NO_ROUTE and INPUT_LIMIT_ISSUE are exit 4; HIGH_IMPACT warns", async () => {
    mockFetch({ "/basic/quote": { requestId: "r", resultType: "NO_ROUTE", route: null, error: null } });
    const none = await run(["quote", "--from", "BSC.BNB", "--to", "ETH.ETH", "--amount", "1"]);
    expect(none.code).toBe(4);
    expect(JSON.parse(none.stderr).response.resultType).toBe("NO_ROUTE");
    mockFetch({
      "/basic/quote": {
        ...QUOTE,
        resultType: "INPUT_LIMIT_ISSUE",
        route: { ...QUOTE.route, amountRestriction: { min: "10", max: "20", type: "EXCLUSIVE" } },
      },
    });
    const limit = await run(["quote", "--from", "BSC.BNB", "--to", "ETH.ETH", "--amount", "1"], {
      tty: true,
    });
    expect(limit.code).toBe(4);
    expect(limit.stderr).toMatch(/accepts 10 to 20/);
    mockFetch({ "/basic/quote": { ...QUOTE, resultType: "HIGH_IMPACT" } });
    const high = await run(["quote", "--from", "BSC.BNB", "--to", "ETH.ETH", "--amount", "1"], { tty: true });
    expect(high.code).toBe(0);
    expect(high.stderr).toMatch(/HIGH_IMPACT/);
  });
  it("refuses to prompt when not interactive", async () => {
    mockFetch({});
    const r = await run(["quote", "--from", "BSC.BNB", "--no-input"]);
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(/Missing required option: --to/);
    expect((await run(["quote", "--slippage", "99", "--from", "a", "--to", "b", "--amount", "1"])).code).toBe(
      2,
    );
  });
});

describe("swap", () => {
  it("defaults the recipient, forwards addresses, renders the tx summary", async () => {
    const calls = mockFetch({ "/basic/swap": SWAP });
    const r = await run(
      [
        "swap",
        "--from",
        "BSC.BNB",
        "--to",
        `ETH.USDC--${USDC}`,
        "--amount",
        "100000000000000000",
        "--from-address",
        ADDR,
        "--infinite-approve",
      ],
      { tty: true },
    );
    expect(r.code).toBe(0);
    const p = calls[0]?.url.searchParams;
    expect(p?.get("fromAddress")).toBe(ADDR);
    expect(p?.get("toAddress")).toBe(ADDR);
    expect(p?.get("slippage")).toBe("0.5");
    expect(p?.get("infiniteApprove")).toBe("true");
    expect(r.stdout).toMatch(/Tx type +EVM on BSC/);
    expect(r.stdout).toMatch(/Approval +not needed/);
    expect(r.stdout).toMatch(/Nothing was signed or sent/);
  });
  it("in JSON mode prints the whole body and flags an approval", async () => {
    mockFetch({ "/basic/swap": { ...SWAP, tx: { ...SWAP.tx, approveTo: "0x1", approveData: "0x2" } } });
    const r = await run([
      "swap",
      "--from",
      "BSC.BNB",
      "--to",
      "ETH.ETH",
      "--amount",
      "1",
      "--from-address",
      ADDR,
    ]);
    expect(JSON.parse(r.stdout).tx.approveTo).toBe("0x1");
    const tty = await run(
      ["swap", "--from", "BSC.BNB", "--to", "ETH.ETH", "--amount", "1", "--from-address", ADDR],
      { tty: true },
    );
    expect(tty.stdout).toMatch(/Approval +needed first/);
  });
  it("a swap error is exit 4 with the body attached", async () => {
    mockFetch({
      "/basic/swap": {
        requestId: "r",
        resultType: "OK",
        route: QUOTE.route,
        tx: null,
        error: "insufficient balance",
        errorCode: 1203,
      },
    });
    const r = await run([
      "swap",
      "--from",
      "BSC.BNB",
      "--to",
      "ETH.ETH",
      "--amount",
      "1",
      "--from-address",
      ADDR,
    ]);
    expect(r.code).toBe(4);
    expect(JSON.parse(r.stderr).message).toBe("insufficient balance");
  });
});

describe("status and approval", () => {
  it("renders a terminal status", async () => {
    mockFetch({
      "/basic/status": {
        status: "success",
        output: {
          amount: "2500000000",
          receivedToken: { blockchain: "ETH", symbol: "USDC", decimals: 6 },
          type: "DESIRED_OUTPUT",
        },
        explorerUrl: [{ url: "https://etherscan.io/tx/0x1", description: "Outbound" }],
      },
    });
    const r = await run(["status", "req", "0xhash"], { tty: true });
    expect(r.stdout).toMatch(/Status +success/);
    expect(r.stdout).toMatch(/2500 USDC \(ETH\) \[DESIRED_OUTPUT\]/);
    expect(r.stdout).toMatch(/Explorer \(Outbound\) +https:\/\/etherscan.io/);
  });
  it("--watch polls until terminal and reports failures with exit 4", async () => {
    const responses = [
      { status: "running" },
      { status: "running" },
      { status: "failed", error: "bridge reverted" },
    ];
    const calls = mockFetch({ "/basic/status": () => json(200, responses.shift() ?? { status: "failed" }) });
    const r = await run(["status", "req", "0xhash", "--watch", "--interval", "0.001"]);
    expect(calls).toHaveLength(3);
    expect(JSON.parse(r.stdout).status).toBe("failed");
    expect(r.code).toBe(4);
    expect(r.stderr.match(/next check/g)).toHaveLength(2);
  });
  it("--watch times out", async () => {
    mockFetch({ "/basic/status": { status: "running" } });
    const r = await run(["status", "req", "0xhash", "--watch", "--interval", "0.001", "--timeout", "0"]);
    expect(r.code).toBe(1);
    expect(JSON.parse(r.stderr.slice(r.stderr.indexOf("{"))).message).toMatch(/Still running/);
  });
  it("approval exits 1 while not yet approved", async () => {
    mockFetch({ "/basic/is-approved": { isApproved: false, txStatus: "running" } });
    expect((await run(["approval", "req", "0xhash"])).code).toBe(1);
    mockFetch({ "/basic/is-approved": { isApproved: true, txStatus: "success" } });
    expect((await run(["approval", "req", "0xhash"])).code).toBe(0);
  });
});

describe("balance, report, health, auth, api", () => {
  it("balance renders amounts and token-balance uses the other endpoint", async () => {
    const calls = mockFetch({
      "/basic/balance": {
        wallets: [
          {
            blockChain: "ETH",
            address: ADDR,
            failed: false,
            balances: [
              {
                asset: { symbol: "ETH", address: null },
                amount: { amount: "1500000000000000000", decimals: 18 },
              },
            ],
          },
        ],
      },
      "/basic/token-balance": { balance: "42", error: null },
    });
    const r = await run(["balance", "eth", ADDR], { tty: true });
    expect(r.stdout).toMatch(/ETH +1\.5 +\(native\)/);
    const t = await run(["balance", "eth", ADDR, "--token", "usdc", "--token-address", USDC], { tty: true });
    expect(t.stdout).toMatch(/USDC balance .* 42/);
    expect(calls[1]?.url.searchParams.get("walletAddress")).toBe(ADDR);
    expect(calls[1]?.url.searchParams.get("symbol")).toBe("USDC");
  });
  it("report posts the documented body", async () => {
    const calls = mockFetch({ "/basic/report-tx": empty(200) });
    const r = await run([
      "report",
      "req-1",
      "--event",
      "USER_REJECT",
      "--reason",
      "nope",
      "--wallet",
      "metamask",
    ]);
    expect(r.code).toBe(0);
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({
      requestId: "req-1",
      eventType: "USER_REJECT",
      reason: "nope",
      tags: { wallet: "metamask" },
    });
  });
  it("health and auth test/show", async () => {
    mockFetch({ "/basic/meta/blockchains": BLOCKCHAINS });
    expect(JSON.parse((await run(["health"])).stdout)).toMatchObject({ ok: true, blockchains: 3 });
    expect(JSON.parse((await run(["auth", "test"])).stdout)).toEqual({ ok: true, blockchains: 3 });
    const show = JSON.parse((await run(["auth", "show"])).stdout);
    expect(show).toMatchObject({ configured: true, source: "env", key: "test…0000" });
    delete process.env["RANGO_API_KEY"];
    expect((await run(["auth", "test"])).code).toBe(3);
  });
  it("api reaches any path with params and bodies", async () => {
    const calls = mockFetch({ "/scanner/tx/latest": { items: [] }, "/routing/best": { requestId: "x" } });
    const get = await run(["api", "/scanner/tx/latest", "-p", "count=5"]);
    expect(JSON.parse(get.stdout)).toEqual({ items: [] });
    expect(calls[0]?.url.searchParams.get("count")).toBe("5");
    const post = await run(["api", "/routing/best", "-d", '{"amount":"1"}']);
    expect(calls[1]?.init.method).toBe("POST");
    expect(JSON.parse(post.stdout)).toEqual({ requestId: "x" });
    expect((await run(["api", "no-slash"])).code).toBe(2);
    expect((await run(["api", "/x", "-d", "{bad"])).code).toBe(2);
  });
});
