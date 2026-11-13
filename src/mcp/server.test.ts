import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setOverrides } from "../core/config.js";
import { configureOutput } from "../core/output.js";
import { BLOCKCHAINS, mockFetch } from "../test/helpers.js";
import { createMcpServer } from "./server.js";

async function connected() {
  const server = createMcpServer();
  const client = new Client({ name: "test", version: "0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return { server, client };
}

beforeEach(() => {
  process.env["RANGO_API_KEY"] = "test-key-00000000";
  process.env["XDG_CONFIG_HOME"] = "/nonexistent/for/test";
  setOverrides({});
  configureOutput({});
});
afterEach(() => vi.unstubAllGlobals());

describe("mcp server", () => {
  it("exposes every catalogue operation as a tool with annotations", async () => {
    const { client, server } = await connected();
    const { tools } = await client.listTools();
    expect(tools).toHaveLength(29);
    const names = tools.map((t) => t.name);
    expect(names).toContain("basic_quote");
    expect(names).toContain("main_best_route");
    const swap = tools.find((t) => t.name === "basic_swap");
    expect(swap?.annotations?.readOnlyHint).toBe(false);
    expect(swap?.inputSchema).toMatchObject({ type: "object" });
    const swapSchema = swap?.inputSchema as { required?: string[] } | undefined;
    expect(swapSchema?.required).toEqual(
      expect.arrayContaining(["from", "to", "amount", "slippage", "fromAddress", "toAddress"]),
    );
    expect(tools.find((t) => t.name === "basic_chains")?.annotations?.readOnlyHint).toBe(true);
    await client.close();
    await server.close();
  });

  it("calls through to the API and returns JSON text", async () => {
    const calls = mockFetch({ "/basic/meta/blockchains": BLOCKCHAINS, "/routing/best": { requestId: "r" } });
    const { client, server } = await connected();
    const chains = await client.callTool({ name: "basic_chains", arguments: {} });
    expect(chains.isError).toBeFalsy();
    const text = (chains.content as { type: string; text: string }[])[0]?.text ?? "";
    expect(JSON.parse(text)).toHaveLength(3);
    expect(calls[0]?.url.searchParams.get("apiKey")).toBe("test-key-00000000");
    const route = await client.callTool({
      name: "main_best_route",
      arguments: { fromBlockchain: "ETH", toBlockchain: "BSC", amount: "1" },
    });
    expect(route.isError).toBeFalsy();
    expect(JSON.parse(String(calls[1]?.init.body)).from).toEqual({ blockchain: "ETH" });
    await client.close();
    await server.close();
  });

  it("reports API and input failures as tool errors, not crashes", async () => {
    mockFetch({ "/basic/meta/blockchains": new Response("", { status: 401 }) });
    const { client, server } = await connected();
    const auth = await client.callTool({ name: "basic_chains", arguments: {} });
    expect(auth.isError).toBe(true);
    const payload = JSON.parse((auth.content as { text: string }[])[0]?.text ?? "{}");
    expect(payload).toMatchObject({ error: true, exitCode: 3 });
    const bad = await client.callTool({ name: "basic_quote", arguments: { from: "BSC.BNB" } });
    expect(bad.isError).toBe(true);
    await client.close();
    await server.close();
  });
});
