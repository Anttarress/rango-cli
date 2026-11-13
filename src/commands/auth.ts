import type { Command } from "commander";
import { action } from "../core/command.js";
import {
  configPath,
  deleteConfig,
  getApiUrl,
  maskKey,
  readConfig,
  resolveApiKey,
  writeConfig,
} from "../core/config.js";
import { ExitCode } from "../core/constants.js";
import { CliError } from "../core/errors.js";
import { keyValue } from "../core/format.js";
import { isJsonMode, print, printJson } from "../core/output.js";
import { fetchChains } from "./chains.js";

export function registerAuthCommand(program: Command): void {
  const auth = program.command("auth").description("Manage the API key: show, test, set, unset");

  auth
    .command("show")
    .description("Which key is in use and where it came from (masked)")
    .action(
      action(async () => {
        const resolved = resolveApiKey();
        const data = {
          configured: Boolean(resolved),
          source: resolved?.source ?? null,
          key: resolved ? maskKey(resolved.key) : null,
          apiUrl: getApiUrl(),
          configFile: configPath(),
        };
        if (isJsonMode()) return printJson(data);
        print(
          keyValue([
            ["Key", data.key ?? "(not set)"],
            ["Source", data.source ?? "set RANGO_API_KEY, pass --api-key, or run: rango auth set <key>"],
            ["API URL", data.apiUrl],
            ["Config file", data.configFile],
          ]),
        );
      }),
    );

  auth
    .command("test")
    .description("Make one cheap request to verify the key is accepted")
    .action(
      action(async () => {
        if (!resolveApiKey()) {
          throw new CliError(
            "No API key configured",
            ExitCode.AuthError,
            "Set RANGO_API_KEY, pass --api-key, or run: rango auth set <key>",
          );
        }
        const chains = await fetchChains();
        if (isJsonMode()) return printJson({ ok: true, blockchains: chains.length });
        print(`API key accepted (${chains.length} blockchains visible)`);
      }),
    );

  auth
    .command("set <key>")
    .description("Store the key in the config file (mode 600) for future runs")
    .action(
      action(async (key: string) => {
        writeConfig({ apiKey: key.trim() });
        if (isJsonMode()) return printJson({ ok: true, configFile: configPath(), key: maskKey(key) });
        print(`Saved ${maskKey(key)} to ${configPath()}`);
      }),
    );

  auth
    .command("unset")
    .description("Remove the stored key")
    .action(
      action(async () => {
        const had = Boolean(readConfig().apiKey);
        deleteConfig();
        if (isJsonMode()) return printJson({ ok: true, removed: had });
        print(had ? "Stored key removed." : "No stored key.");
      }),
    );
}
