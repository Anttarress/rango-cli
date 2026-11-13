import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { empty, html, json, mockFetch } from "../test/helpers.js";
import { setOverrides } from "./config.js";
import { ExitCode } from "./constants.js";
import { type CliError, errorToJson, mapHttpError, mapNetworkError } from "./errors.js";
import { api } from "./http.js";
import { configureOutput } from "./output.js";

beforeEach(() => {
  process.env["RANGO_API_KEY"] = "test-key-00000000";
  delete process.env["RANGO_API_URL"];
  setOverrides({});
  configureOutput({});
});
afterEach(() => vi.unstubAllGlobals());

async function failure(promise: Promise<unknown>): Promise<CliError> {
  try {
    await promise;
  } catch (error) {
    return error as CliError;
  }
  throw new Error("expected a failure");
}

describe("request building", () => {
  it("attaches the key and query params, skipping empties", async () => {
    const calls = mockFetch({ "/basic/quote": { ok: 1 } });
    await api.get("/basic/quote", {
      params: { from: "BSC.BNB", amount: 5, flag: true, nothing: undefined, blank: "" },
    });
    const url = calls[0]?.url;
    expect(url?.searchParams.get("apiKey")).toBe("test-key-00000000");
    expect(url?.searchParams.get("from")).toBe("BSC.BNB");
    expect(url?.searchParams.get("amount")).toBe("5");
    expect(url?.searchParams.get("flag")).toBe("true");
    expect(url?.searchParams.has("nothing")).toBe(false);
    expect(url?.searchParams.has("blank")).toBe(false);
    const headers = calls[0]?.init.headers as Record<string, string>;
    expect(headers["user-agent"]).toMatch(/^rango-cli\//);
  });
  it("sends JSON bodies and can skip auth", async () => {
    const calls = mockFetch({ "/basic/report-tx": empty(200) });
    const result = await api.post("/basic/report-tx", { body: { a: 1 }, auth: false });
    expect(result).toBeUndefined();
    expect(calls[0]?.init.method).toBe("POST");
    expect(calls[0]?.init.body).toBe('{"a":1}');
    expect(calls[0]?.url.searchParams.has("apiKey")).toBe(false);
  });
  it("fails before the network when no key is configured", async () => {
    delete process.env["RANGO_API_KEY"];
    process.env["XDG_CONFIG_HOME"] = "/nonexistent/for/test";
    const calls = mockFetch({});
    const err = await failure(api.get("/basic/meta"));
    expect(err.exitCode).toBe(ExitCode.AuthError);
    expect(calls).toHaveLength(0);
  });
});

describe("error mapping", () => {
  it("401 is an auth error, html 429 is an api error with the Cloudflare hint", async () => {
    mockFetch({
      "/a": empty(401),
      "/b": html(429, "<!DOCTYPE html><html>blocked</html>"),
      "/c": json(400, { error: "bad input", errorCode: 1201, traceId: "t1" }),
    });
    const a = await failure(api.get("/a"));
    expect(a.exitCode).toBe(ExitCode.AuthError);
    const b = await failure(api.get("/b"));
    expect(b.exitCode).toBe(ExitCode.ApiError);
    expect(b.message).toMatch(/Cloudflare/);
    const c = await failure(api.get("/c"));
    expect(c.message).toBe("HTTP 400: bad input (code 1201) traceId=t1");
    expect(errorToJson(c)).toMatchObject({ error: true, exitCode: 4, response: { errorCode: 1201 } });
  });
  it("network failures and timeouts are exit 5", async () => {
    mockFetch({ "/x": new TypeError("fetch failed") });
    const err = await failure(api.get("/x"));
    expect(err.exitCode).toBe(ExitCode.NetworkError);
    const t = mapNetworkError({ name: "TimeoutError" }, 30000);
    expect(t.message).toMatch(/timed out after 30s/);
    expect(mapHttpError(503, "text/plain", "down").message).toBe("HTTP 503: down");
    expect(mapHttpError(500, "application/json", "").message).toBe("HTTP 500 with an empty body");
  });
  it("malformed json with a json content type is an api error", async () => {
    mockFetch({
      "/m": new Response("{nope", { status: 200, headers: { "content-type": "application/json" } }),
    });
    const err = await failure(api.get("/m"));
    expect(err.exitCode).toBe(ExitCode.ApiError);
  });
});
