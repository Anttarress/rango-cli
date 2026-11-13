import { type Command, Option } from "commander";
import { action } from "../core/command.js";
import { invalidArgs } from "../core/errors.js";
import { api, type Params } from "../core/http.js";
import { printJson } from "../core/output.js";

/**
 * Escape hatch for any endpoint the curated commands do not cover, including
 * the multi-step routing API and the explorer. Output is always JSON.
 */
export function registerApiCommand(program: Command): void {
  program
    .command("api <path>")
    .description("Call any Rango API path directly; the key is attached for you. Always prints JSON.")
    .addOption(
      new Option("-X, --method <method>", "HTTP method").choices(["GET", "POST", "DELETE"]).default("GET"),
    )
    .option(
      "-p, --param <key=value>",
      "Query parameter (repeatable)",
      (value: string, previous: string[]) => [...previous, value],
      [],
    )
    .option("-d, --body <json>", "JSON request body; implies POST unless --method is given")
    .option("--no-auth", "Do not attach the API key")
    .option("--timeout <seconds>", "Request timeout", "30")
    .addHelpText(
      "after",
      `
Examples:
  $ rango api /basic/meta/messaging-protocols
  $ rango api /scanner/tx/latest -p count=5
  $ rango api /routing/best -d '{"from":{"blockchain":"ETH","symbol":"ETH","address":null},"to":{"blockchain":"BSC","symbol":"BNB","address":null},"amount":"0.1","checkPrerequisites":false}'`,
    )
    .action(
      action(
        async (
          path: string,
          options: { method: string; param: string[]; body?: string; auth: boolean; timeout: string },
        ) => {
          if (!path.startsWith("/")) throw invalidArgs(`Path must start with "/", got "${path}"`);
          const params: Params = {};
          for (const pair of options.param) {
            const idx = pair.indexOf("=");
            if (idx <= 0) throw invalidArgs(`--param expects key=value, got "${pair}"`);
            params[pair.slice(0, idx)] = pair.slice(idx + 1);
          }
          let body: unknown;
          if (options.body !== undefined) {
            try {
              body = JSON.parse(options.body);
            } catch (error) {
              throw invalidArgs(`--body is not valid JSON: ${(error as Error).message}`);
            }
          }
          const method = (options.body !== undefined && options.method === "GET" ? "POST" : options.method) as
            | "GET"
            | "POST"
            | "DELETE";
          const timeoutMs = Math.max(1, Number(options.timeout) || 30) * 1000;
          const data = await api[method.toLowerCase() as "get" | "post" | "delete"]<unknown>(path, {
            params,
            body,
            auth: options.auth,
            timeoutMs,
          });
          printJson(data ?? { ok: true });
        },
      ),
    );
}
