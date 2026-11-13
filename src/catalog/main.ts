import { z } from "zod";
import {
  eventType,
  flag,
  list,
  metaFilters,
  metaParams,
  optNum,
  optStr,
  record,
  str,
  tags,
} from "./shared.js";
import { compact, defineOperation } from "./types.js";

/**
 * Main API: multi-step routing. A route is a list of swaps; each swap gets
 * its own transaction via create-tx and is tracked with check-tx-status.
 * Tokens are objects {blockchain, symbol?, address?}; amounts are
 * human-readable decimal strings ("1", "0.5"), unlike the Basic API.
 */

const tokenFields = {
  fromBlockchain: str("Source blockchain, e.g. ETH"),
  fromSymbol: optStr("Source token symbol, e.g. USDC"),
  fromAddress: optStr("Source token contract address; omit for the native coin"),
  toBlockchain: str("Destination blockchain"),
  toSymbol: optStr("Destination token symbol"),
  toAddress: optStr("Destination token contract address; omit for the native coin"),
  amount: str('Human-readable amount, e.g. "100" or "0.5"'),
};

const routingFields = {
  connectedWallets: z
    .array(z.object({ blockchain: z.string(), addresses: z.array(z.string()) }))
    .optional()
    .describe('Connected wallets, [{"blockchain":"ETH","addresses":["0x…"]}]'),
  slippage: optNum("Slippage in percent, 0.01 to 30"),
  disableMultiStepTx: flag("Disable routes that need more than one transaction"),
  affiliateRef: optStr("Affiliate reference code"),
  affiliateWallets: record('Affiliate wallet per blockchain, {"ETH":"0x…"}'),
  affiliatePercent: optNum("Affiliate reward percent, max 10"),
  swappers: list("Only these swapper ids"),
  swappersExclude: flag("Treat swappers as a deny list"),
  swapperGroups: list("Only these swapper group tags"),
  swappersGroupsExclude: flag("Treat swapperGroups as a deny list"),
  blockchains: list("Only these blockchains for intermediate steps"),
  blockchainsExclude: flag("Treat blockchains as a deny list"),
  transactionTypes: list('Accepted transaction types, e.g. ["EVM","COSMOS"]'),
  messagingProtocols: list("Messaging protocols for cross-chain messages"),
  interChainMessage: z
    .object({ sourceContract: z.string(), destinationContract: z.string(), imMessage: z.string() })
    .optional()
    .describe("Inter-chain message config"),
  contractCall: flag("Transactions are sent through a contract"),
  enableCentralizedSwappers: flag("Include centralized swappers"),
  avoidNativeFee: flag("Skip swappers that charge fees in the native token"),
  isRefuel: flag("Request a gas top-up route"),
  depositTransaction: flag("Only routes done with a single plain transfer to a deposit address"),
};

type Routing = z.infer<z.ZodObject<typeof tokenFields & typeof routingFields>>;

function token(blockchain: string, symbol?: string, address?: string) {
  return compact({ blockchain, symbol, address });
}

function routingBody(input: Routing): Record<string, unknown> {
  const {
    fromBlockchain,
    fromSymbol,
    fromAddress,
    toBlockchain,
    toSymbol,
    toAddress,
    depositTransaction,
    ...rest
  } = input;
  return compact({
    from: token(fromBlockchain, fromSymbol, fromAddress),
    to: token(toBlockchain, toSymbol, toAddress),
    ...rest,
    routingPreferences: depositTransaction === undefined ? undefined : { depositTransaction },
  });
}

export const mainOperations = [
  defineOperation({
    surface: "main",
    name: "meta",
    summary: "Tokens, popular tokens, blockchains and swappers",
    description:
      "Large. Pass blockchains to narrow it. Returns {blockchains, tokens, popularTokens, swappers}.",
    readOnly: true,
    input: z.object(metaFilters),
    request: (input) => ({ method: "GET", path: "/meta", params: metaParams(input) }),
  }),
  defineOperation({
    surface: "main",
    name: "compact-meta",
    summary: "Same as meta with short field names",
    description: "Token fields are abbreviated (b, a, s, n, d, i, p, ip). Smaller payload for the same data.",
    readOnly: true,
    input: z.object(metaFilters),
    request: (input) => ({ method: "GET", path: "/meta/compact", params: metaParams(input) }),
  }),
  defineOperation({
    surface: "main",
    name: "blockchains",
    summary: "Every supported blockchain",
    description: "Main API view of the blockchain list.",
    readOnly: true,
    input: z.object({}),
    request: () => ({ method: "GET", path: "/meta/blockchains" }),
  }),
  defineOperation({
    surface: "main",
    name: "swappers",
    summary: "Every DEX, bridge and aggregator",
    description: "Main API view of the swapper list.",
    readOnly: true,
    input: z.object({}),
    request: () => ({ method: "GET", path: "/meta/swappers" }),
  }),
  defineOperation({
    surface: "main",
    name: "custom-token",
    summary: "Details of a token not in Rango's list",
    description: "Returns {token, error, errorCode, traceId}.",
    readOnly: true,
    input: z.object({ blockchain: str("Blockchain name"), address: str("Token contract address") }),
    request: (input) => ({ method: "GET", path: "/meta/custom-token", params: input }),
  }),
  defineOperation({
    surface: "main",
    name: "contracts",
    summary: "Rango's smart contract addresses",
    description: "The contracts Rango routes through, per blockchain (v3).",
    readOnly: true,
    input: z.object({}),
    request: () => ({ method: "GET", path: "/meta/rango-contracts" }),
  }),
  defineOperation({
    surface: "main",
    name: "best-route",
    summary: "Best multi-step route for a swap",
    description:
      "Returns requestId and result.swaps, one per step with swapper, from, to, toAmount, fee and estimatedTimeInSeconds. Then confirm-route, then create-tx per step.",
    readOnly: true,
    input: z.object({
      ...tokenFields,
      selectedWallets: record('Wallet per blockchain, {"ETH":"0x…","BSC":"0x…"}'),
      destination: optStr("Custom destination wallet for the output"),
      checkPrerequisites: flag("Verify balances and fees (slower, more accurate)"),
      maxLength: optNum("Maximum number of steps"),
      ...routingFields,
    }),
    request: (input) => ({ method: "POST", path: "/routing/best", body: routingBody(input) }),
  }),
  defineOperation({
    surface: "main",
    name: "best-routes",
    summary: "Several routes to compare",
    description:
      "Each result has its own requestId, swaps, scores and tags (RECOMMENDED, FASTEST, LOWEST_FEE, HIGH_IMPACT).",
    readOnly: true,
    input: z.object({ ...tokenFields, ...routingFields }),
    request: (input) => ({ method: "POST", path: "/routing/bests", body: routingBody(input) }),
  }),
  defineOperation({
    surface: "main",
    name: "confirm-route",
    summary: "Lock a route and give the wallets that will execute it",
    description: "Call after best-route and before create-tx. Returns ok and the validated result.",
    readOnly: false,
    input: z.object({
      requestId: str("requestId from best-route"),
      selectedWallets: record('Wallet per blockchain, {"ETH":"0x…"}'),
      destination: optStr("Custom destination wallet"),
      checkPrerequisites: flag("Verify balances and fees (default true)"),
    }),
    request: (input) => ({
      method: "POST",
      path: "/routing/confirm",
      body: compact({ ...input, checkPrerequisites: input.checkPrerequisites ?? true }),
    }),
  }),
  defineOperation({
    surface: "main",
    name: "create-tx",
    summary: "The transaction for one step of a confirmed route",
    description:
      "Returns {ok, transaction, error}. Nothing is signed here. Steps start at 1; call again with the next step once check-tx-status reports success.",
    readOnly: false,
    input: z.object({
      requestId: str("requestId of the confirmed route"),
      step: z.number().int().min(1).describe("Step number, starting at 1"),
      slippage: optNum("Slippage in percent (default 1)"),
      infiniteApprove: flag("Ask for an unlimited allowance"),
      validateBalance: flag("Check the balance (default true)"),
      validateFee: flag("Check gas funds (default true)"),
      validateApprove: flag("Check the allowance (default true)"),
    }),
    request: (input) => ({
      method: "POST",
      path: "/tx/create",
      body: {
        requestId: input.requestId,
        step: input.step,
        userSettings: {
          slippage: String(input.slippage ?? 1),
          infiniteApprove: input.infiniteApprove ?? false,
        },
        validations: {
          balance: input.validateBalance ?? true,
          fee: input.validateFee ?? true,
          approve: input.validateApprove ?? true,
        },
      },
    }),
  }),
  defineOperation({
    surface: "main",
    name: "check-tx-status",
    summary: "Status of one step's signed transaction",
    description: "status is running, success or failed; outputAmount and outputToken say what arrived.",
    readOnly: true,
    input: z.object({
      requestId: str("requestId of the route"),
      txId: str("Hash of the signed transaction"),
      step: z.number().int().min(1).describe("Step number"),
    }),
    request: (input) => ({ method: "POST", path: "/tx/check-status", body: input }),
  }),
  defineOperation({
    surface: "main",
    name: "check-approval",
    summary: "Whether a step's approval transaction has confirmed",
    description: "Returns isApproved, txStatus, requiredApprovedAmount, currentApprovedAmount.",
    readOnly: true,
    input: z.object({
      requestId: str("requestId of the route"),
      txId: str("Hash of the approval transaction"),
    }),
    request: (input) => ({
      method: "GET",
      path: `/tx/${encodeURIComponent(input.requestId)}/check-approval`,
      params: { txId: input.txId },
    }),
  }),
  defineOperation({
    surface: "main",
    name: "report-tx",
    summary: "Report a wallet rejection or send failure on a step",
    description: "Optional; helps routing quality.",
    readOnly: false,
    input: z.object({
      requestId: str("requestId of the route"),
      eventType,
      step: optNum("Step number where it failed"),
      reason: optStr("Free-text reason"),
      tags,
    }),
    request: (input) => ({ method: "POST", path: "/tx/report-tx", body: compact(input) }),
  }),
  defineOperation({
    surface: "main",
    name: "wallet-details",
    summary: "All balances for wallets across blockchains",
    description:
      'Addresses are CHAIN.ADDRESS, e.g. ["ETH.0x…","BSC.0x…"]. Returns {wallets:[{blockChain, address, balances}]}.',
    readOnly: true,
    input: z.object({ addresses: z.array(z.string()).min(1).describe('["ETH.0x…","BSC.0x…"]') }),
    request: (input) => ({ method: "GET", path: "/wallets/details", params: { address: input.addresses } }),
  }),
  defineOperation({
    surface: "main",
    name: "token-balance",
    summary: "One token's balance for a wallet",
    description: "Omit address for the native coin.",
    readOnly: true,
    input: z.object({
      walletAddress: str("Wallet address"),
      blockchain: str("Blockchain name"),
      symbol: optStr("Token symbol"),
      address: optStr("Token contract address"),
    }),
    request: (input) => ({ method: "GET", path: "/wallets/token-balance", params: compact(input) }),
  }),
  defineOperation({
    surface: "main",
    name: "multiple-token-balance",
    summary: "Several tokens' balances for one wallet",
    description: "Returns {balances:[{asset, amount, price}]}.",
    readOnly: true,
    input: z.object({
      walletAddress: str("Wallet address"),
      assets: z
        .array(
          z.object({ blockchain: z.string(), symbol: z.string().optional(), address: z.string().optional() }),
        )
        .min(1)
        .describe('[{"blockchain":"BSC","symbol":"USDT","address":"0x55d3…"}]'),
    }),
    request: (input) => ({ method: "POST", path: "/wallets/multiple-token-balance", body: input }),
  }),
];
