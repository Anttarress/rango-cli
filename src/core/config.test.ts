import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  configPath,
  deleteConfig,
  getApiUrl,
  maskKey,
  readConfig,
  resolveApiKey,
  setOverrides,
  writeConfig,
} from "./config.js";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "rango-cli-"));
  process.env["XDG_CONFIG_HOME"] = dir;
  delete process.env["RANGO_API_KEY"];
  delete process.env["RANGO_API_URL"];
  setOverrides({});
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("config file", () => {
  it("writes with mode 600 and reads back", () => {
    writeConfig({ apiKey: "stored-key-123456" });
    expect(readConfig()).toEqual({ apiKey: "stored-key-123456" });
    expect(statSync(configPath()).mode & 0o777).toBe(0o600);
    writeConfig({ apiUrl: "https://example.test" });
    expect(readConfig()).toEqual({ apiKey: "stored-key-123456", apiUrl: "https://example.test" });
    deleteConfig();
    expect(readConfig()).toEqual({});
  });
});

describe("key resolution", () => {
  it("prefers flag, then env, then file", () => {
    expect(resolveApiKey()).toBeUndefined();
    writeConfig({ apiKey: "from-file-000000" });
    expect(resolveApiKey()).toEqual({ key: "from-file-000000", source: "config" });
    process.env["RANGO_API_KEY"] = "from-env-0000000";
    expect(resolveApiKey()).toEqual({ key: "from-env-0000000", source: "env" });
    setOverrides({ apiKey: "from-flag-000000" });
    expect(resolveApiKey()).toEqual({ key: "from-flag-000000", source: "flag" });
  });
  it("masks keys", () => {
    expect(maskKey("c6381a79-2817-4602-83bf-6a641a409e32")).toBe("c638…9e32");
    expect(maskKey("short")).toBe("*****");
  });
});

describe("api url", () => {
  it("defaults, honours overrides, strips trailing slash", () => {
    expect(getApiUrl()).toBe("https://api.rango.exchange");
    process.env["RANGO_API_URL"] = "https://public-api.rango.exchange/";
    expect(getApiUrl()).toBe("https://public-api.rango.exchange");
    setOverrides({ apiUrl: "http://localhost:8080" });
    expect(getApiUrl()).toBe("http://localhost:8080");
  });
  it("refuses plain http to a real host", () => {
    setOverrides({ apiUrl: "http://api.rango.exchange" });
    expect(() => getApiUrl()).toThrow(/https/);
    setOverrides({ apiUrl: "not a url" });
    expect(() => getApiUrl()).toThrow(/Invalid API URL/);
  });
});
