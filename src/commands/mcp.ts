import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { Command } from "commander";
import { operations } from "../catalog/index.js";
import { action } from "../core/command.js";
import { resolveApiKey } from "../core/config.js";
import { note } from "../core/output.js";
import { createMcpServer } from "../mcp/server.js";

export function registerMcpCommand(program: Command): void {
  program
    .command("mcp")
    .description(
      "Serve the Rango API as MCP tools over stdio, for Claude Code, Cursor, Codex and other agents",
    )
    .addHelpText(
      "after",
      `
The key comes from RANGO_API_KEY, the config file (rango auth set) or --api-key, as for every command.
Configure it in one step with: rango agent setup

Manual config (any MCP client):
  { "mcpServers": { "rango": { "command": "rango", "args": ["mcp"] } } }`,
    )
    .action(
      action(async () => {
        if (!resolveApiKey()) {
          note(
            "rango mcp: no API key configured; tools will return an auth error until one is set (rango auth set <key>).",
          );
        }
        const server = createMcpServer();
        await server.connect(new StdioServerTransport());
        note(`rango mcp: serving ${operations.length} tools on stdio`);
        await new Promise(() => {}); // stay alive until the client closes the pipe
      }),
    );
}
