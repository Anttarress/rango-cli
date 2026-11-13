import type { Command } from "commander";
import { vi } from "vitest";
import { createProgram } from "../bin/rango.js";

export class ExitSignal extends Error {
  constructor(public readonly code: number) {
    super(`exit ${code}`);
  }
}

export interface Call {
  url: URL;
  init: RequestInit;
}

export type Handler = (call: Call) => Response | Promise<Response>;

export function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

export function html(status: number, body: string): Response {
  return new Response(body, { status, headers: { "content-type": "text/html" } });
}

export function empty(status: number): Response {
  return new Response("", { status });
}

/** Route every fetch() by URL path suffix. Returns the calls made. */
export function mockFetch(routes: Record<string, Handler | Response | unknown>): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL, init: RequestInit = {}) => {
      const url = new URL(String(input));
      calls.push({ url, init });
      for (const [suffix, route] of Object.entries(routes)) {
        if (!url.pathname.endsWith(suffix)) continue;
        if (typeof route === "function") return (route as Handler)({ url, init });
        if (route instanceof Response) return route.clone();
        if (route instanceof Error) throw route;
        return json(200, route);
      }
      return json(404, { error: `unexpected path ${url.pathname}` });
    }),
  );
  return calls;
}

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** Run the CLI in-process with the given args; capture stdout, stderr and the exit code. */
export async function run(args: string[], opts: { tty?: boolean } = {}): Promise<RunResult> {
  const out: string[] = [];
  const err: string[] = [];
  const logSpy = vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => {
    out.push(a.map(String).join(" "));
  });
  const errSpy = vi.spyOn(console, "error").mockImplementation((...a: unknown[]) => {
    err.push(a.map(String).join(" "));
  });
  const exitSpy = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
    throw new ExitSignal(code ?? 0);
  }) as never);
  const ttyDescriptor = Object.getOwnPropertyDescriptor(process.stdout, "isTTY");
  Object.defineProperty(process.stdout, "isTTY", { value: opts.tty === true, configurable: true });
  process.exitCode = undefined;
  let code = 0;
  try {
    const program = createProgram();
    // Subcommands only inherit output settings applied before they are added,
    // so walk the tree and apply them everywhere.
    const configure = (cmd: Command) => {
      cmd.exitOverride();
      cmd.configureOutput({
        writeErr: (s) => err.push(s.trimEnd()),
        writeOut: (s) => out.push(s.trimEnd()),
      });
      for (const sub of cmd.commands) configure(sub);
    };
    configure(program);
    await program.parseAsync(["node", "rango", ...args]);
    code = typeof process.exitCode === "number" ? process.exitCode : 0;
  } catch (error) {
    if (error instanceof ExitSignal) code = error.code;
    else if (error && typeof error === "object" && "exitCode" in error)
      code = (error as { exitCode: number }).exitCode;
    else throw error;
  } finally {
    logSpy.mockRestore();
    errSpy.mockRestore();
    exitSpy.mockRestore();
    if (ttyDescriptor) Object.defineProperty(process.stdout, "isTTY", ttyDescriptor);
    else delete (process.stdout as { isTTY?: boolean }).isTTY;
    process.exitCode = undefined;
  }
  return { code, stdout: out.join("\n"), stderr: err.join("\n") };
}

export const EVM = "^0x[a-fA-F0-9]{40}$";

export const BLOCKCHAINS = [
  {
    name: "BSC",
    displayName: "BNB Chain",
    type: "EVM",
    chainId: "0x38",
    enabled: true,
    addressPatterns: [EVM],
    defaultDecimals: 18,
  },
  {
    name: "ETH",
    displayName: "Ethereum",
    type: "EVM",
    chainId: "0x1",
    enabled: true,
    addressPatterns: [EVM],
    defaultDecimals: 18,
  },
  {
    name: "COSMOS",
    displayName: "Cosmos",
    type: "COSMOS",
    chainId: "cosmoshub-4",
    enabled: false,
    addressPatterns: ["^cosmos1[a-z0-9]{38}$"],
  },
];

export const USDC = "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48";

export const META_ETH = {
  tokens: [
    {
      blockchain: "ETH",
      symbol: "ETH",
      name: "Ether",
      address: null,
      decimals: 18,
      isPopular: true,
      usdPrice: 3000,
    },
    {
      blockchain: "ETH",
      symbol: "USDC",
      name: "USD Coin",
      address: USDC,
      decimals: 6,
      isPopular: true,
      usdPrice: 1,
    },
    {
      blockchain: "ETH",
      symbol: "SHIB",
      name: "Shiba",
      address: "0x95ad61b0a150d79219dcf64e1e6cc01f0b64c4ce",
      decimals: 18,
      isPopular: false,
      usdPrice: 0.00001,
    },
  ],
};

export const META_BSC = {
  tokens: [
    {
      blockchain: "BSC",
      symbol: "BNB",
      name: "BNB",
      address: null,
      decimals: 18,
      isPopular: true,
      usdPrice: 600,
    },
  ],
};

export const QUOTE = {
  requestId: "req-1",
  resultType: "OK",
  route: {
    outputAmount: "2500000000",
    outputAmountMin: "2480000000",
    outputAmountUsd: 2500.5,
    feeUsd: 1.25,
    estimatedTimeInSeconds: 120,
    swapper: { id: "OneInch", title: "1inch" },
    from: { blockchain: "BSC", symbol: "BNB", decimals: 18 },
    to: { blockchain: "ETH", symbol: "USDC", decimals: 6, address: USDC },
    path: [
      {
        from: { blockchain: "BSC", symbol: "BNB", decimals: 18 },
        to: { blockchain: "BSC", symbol: "USDT", decimals: 18 },
        swapper: { title: "PancakeSwap" },
        expectedOutput: "60000000000000000000",
      },
      {
        from: { blockchain: "BSC", symbol: "USDT", decimals: 18 },
        to: { blockchain: "ETH", symbol: "USDC", decimals: 6 },
        swapper: { title: "Across" },
        expectedOutput: "2500000000",
      },
    ],
  },
  error: null,
  errorCode: null,
  traceId: null,
};

export const SWAP = {
  ...QUOTE,
  requestId: "req-2",
  tx: {
    type: "EVM",
    blockChain: { name: "BSC" },
    from: `0x${"a".repeat(40)}`,
    txTo: `0x${"b".repeat(40)}`,
    txData: `0x${"ff".repeat(100)}`,
    value: "0x16345785d8a0000",
    gasLimit: "0x5208",
    approveTo: null,
    approveData: null,
  },
};
