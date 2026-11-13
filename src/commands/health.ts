import type { Command } from "commander";
import { action } from "../core/command.js";
import { getApiUrl } from "../core/config.js";
import { isJsonMode, print, printJson } from "../core/output.js";
import { fetchChains } from "./chains.js";

export function registerHealthCommand(program: Command): void {
  program
    .command("health")
    .description("Check that the API is reachable and the key works")
    .action(
      action(async () => {
        const started = Date.now();
        const chains = await fetchChains();
        const latencyMs = Date.now() - started;
        const result = { ok: true, apiUrl: getApiUrl(), latencyMs, blockchains: chains.length };
        if (isJsonMode()) return printJson(result);
        print(`OK  ${result.apiUrl}  ${latencyMs} ms  ${chains.length} blockchains`);
      }),
    );
}
