import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setOverrides } from "../core/config.js";
import { BLOCKCHAINS, empty, html, json, META_ETH, mockFetch, run, USDC } from "../test/helpers.js";

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
    const piped = await run(["basic", "chains"]);
    expect(piped.code).toBe(0);
    expect(JSON.parse(piped.stdout)).toHaveLength(3);
    const compact = await run(["basic", "chains", "--compact"], { tty: true });
    expect(compact.stdout.split("\n")).toHaveLength(1);
  });
  it("--api-key wins over the environment", async () => {
    const calls = mockFetch({ "/basic/meta/swappers": [] });
    await run(["basic", "swappers", "--api-key", "override-key-000"]);
    expect(calls[0]?.url.searchParams.get("apiKey")).toBe("override-key-000");
  });
  it("maps failures to exit codes with JSON on stderr", async () => {
    mockFetch({ "/basic/meta/swappers": empty(401) });
    const auth = await run(["basic", "swappers"]);
    expect(auth.code).toBe(3);
    expect(auth.stdout).toBe("");
    expect(JSON.parse(auth.stderr)).toMatchObject({ error: true, exitCode: 3 });
    mockFetch({ "/basic/meta/swappers": html(403, "<html>blocked</html>") });
    expect((await run(["basic", "swappers"])).code).toBe(4);
    mockFetch({ "/basic/meta/swappers": new TypeError("fetch failed") });
    expect((await run(["basic", "swappers"])).code).toBe(5);
  });
  it("human errors on a tty", async () => {
    mockFetch({ "/basic/meta/swappers": json(500, { error: "boom", errorCode: 1101 }) });
    const r = await run(["basic", "swappers"], { tty: true });
    expect(r.code).toBe(4);
    expect(r.stderr).toMatch(/^Error: HTTP 500: boom \(code 1101\)/);
  });
});

describe("surface token/tokens subcommands", () => {
  it("basic token resolves by symbol and address, falling back to custom-token", async () => {
    mockFetch({ "/basic/meta": META_ETH });
    const bySymbol = await run(["basic", "token", "ETH", "usdc"]);
    expect(JSON.parse(bySymbol.stdout).address).toBe(USDC);
    const byAddress = await run(["basic", "token", "ETH", USDC.toUpperCase()]);
    expect(JSON.parse(byAddress.stdout).symbol).toBe("USDC");
    mockFetch({
      "/basic/meta/custom-token": {
        token: { blockchain: "ETH", symbol: "NEW", address: `0x${"1".repeat(40)}`, decimals: 9 },
      },
      "/basic/meta": META_ETH,
    });
    const unknown = await run(["basic", "token", "ETH", `0x${"1".repeat(40)}`]);
    expect(JSON.parse(unknown.stdout).decimals).toBe(9);
  });

  it("main token hits /meta and /meta/custom-token", async () => {
    const calls = mockFetch({
      "/meta": META_ETH,
      "/meta/custom-token": {
        token: { blockchain: "ETH", symbol: "NEW", address: `0x${"2".repeat(40)}`, decimals: 7 },
      },
    });
    const bySymbol = await run(["main", "token", "ETH", "usdc"]);
    expect(JSON.parse(bySymbol.stdout).address).toBe(USDC);
    expect(calls[0]?.url.pathname.endsWith("/meta")).toBe(true);
    const unknown = await run(["main", "token", "ETH", `0x${"2".repeat(40)}`]);
    expect(JSON.parse(unknown.stdout).decimals).toBe(7);
  });

  it("basic tokens filters by --search and --popular", async () => {
    const calls = mockFetch({ "/basic/meta": META_ETH });
    const r = await run(["basic", "tokens", "eth", "--search", "usd", "--popular"]);
    expect(r.stderr).toBe("");
    expect(JSON.parse(r.stdout).map((t: { symbol: string }) => t.symbol)).toEqual(["USDC"]);
    expect(calls[0]?.url.searchParams.get("blockchains")).toBe("ETH");
  });
});

describe("auth, api", () => {
  it("auth test reports blockchains and latency; auth show reports configuration", async () => {
    mockFetch({ "/basic/meta/blockchains": BLOCKCHAINS });
    const test = JSON.parse((await run(["auth", "test"])).stdout);
    expect(test).toMatchObject({ ok: true, blockchains: 3 });
    expect(typeof test.latencyMs).toBe("number");
    expect(test.latencyMs).toBeGreaterThanOrEqual(0);
    expect(test.apiUrl).toMatch(/^https:\/\//);
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
