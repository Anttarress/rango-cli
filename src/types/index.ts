/** Shapes from docs.rango.exchange, Basic API. Fields are optional where the API may omit or null them. */

export interface Token {
  blockchain: string;
  chainId?: string | null;
  address?: string | null;
  symbol: string;
  name?: string | null;
  decimals: number;
  image?: string | null;
  blockchainImage?: string | null;
  usdPrice?: number | null;
  isPopular?: boolean;
  supportedSwappers?: string[];
}

export interface Blockchain {
  name: string;
  displayName?: string;
  shortName?: string;
  type?: string;
  chainId?: string | null;
  enabled?: boolean;
  defaultDecimals?: number;
  addressPatterns?: string[];
  feeAssets?: { blockchain: string; symbol: string; address: string | null }[];
  logo?: string;
  color?: string;
  sort?: number;
  info?: {
    infoType?: string;
    chainName?: string;
    nativeCurrency?: { name?: string; symbol?: string; decimals?: number };
    rpcUrls?: string[];
    blockExplorerUrls?: string[];
    addressUrl?: string;
    transactionUrl?: string;
    enableGasV2?: boolean;
  } | null;
}

export interface Swapper {
  id: string;
  title?: string;
  logo?: string;
  swapperGroup?: string;
  types?: string[];
  enabled?: boolean;
}

export interface MetaResponse {
  blockchains?: Blockchain[];
  tokens?: Token[];
  swappers?: Swapper[];
}

export type ResultType = "OK" | "HIGH_IMPACT" | "INPUT_LIMIT_ISSUE" | "NO_ROUTE" | string;

export interface Fee {
  token?: Token;
  expenseType?: string;
  amount?: string;
  name?: string;
  meta?: unknown;
}

export interface PathStep {
  swapper?: Swapper;
  swapperType?: string;
  from?: Token;
  to?: Token;
  inputAmount?: string;
  expectedOutput?: string;
  estimatedTimeInSeconds?: number;
}

export interface Route {
  from?: Token;
  to?: Token;
  outputAmount?: string;
  outputAmountMin?: string;
  outputAmountUsd?: number | null;
  swapper?: Swapper;
  path?: PathStep[] | null;
  fee?: Fee[];
  feeUsd?: number | null;
  amountRestriction?: { min?: string | null; max?: string | null; type?: string } | null;
  estimatedTimeInSeconds?: number | null;
}

export interface QuoteResponse {
  requestId?: string | null;
  resultType?: ResultType;
  route?: Route | null;
  error?: string | null;
  errorCode?: number | string | null;
  traceId?: string | null;
}

/** The transaction is chain-typed; only the fields the CLI looks at are declared. */
export interface SwapTransaction {
  type?: string;
  blockChain?: string | { name?: string } | null;
  from?: string | null;
  txTo?: string | null;
  to?: string | null;
  txData?: string | null;
  data?: string | null;
  value?: string | null;
  gasLimit?: string | null;
  gasPrice?: string | null;
  maxFeePerGas?: string | null;
  maxPriorityFeePerGas?: string | null;
  approveTo?: string | null;
  approveData?: string | null;
  approve_payload?: unknown;
  approveCalls?: unknown;
  [key: string]: unknown;
}

export interface SwapResponse extends QuoteResponse {
  tx?: SwapTransaction | null;
}

export interface StatusResponse {
  status?: "running" | "success" | "failed" | string | null;
  error?: string | null;
  output?: { amount?: string; receivedToken?: Token; type?: string } | null;
  explorerUrl?: { url?: string; description?: string }[] | null;
  diagnosisUrl?: string | null;
  bridgeData?: Record<string, unknown> | null;
}

export interface ApprovalResponse {
  isApproved?: boolean;
  txStatus?: string | null;
  requiredApprovedAmount?: string | null;
  currentApprovedAmount?: string | null;
}

export interface BalanceResponse {
  wallets?: {
    blockChain?: string;
    address?: string;
    failed?: boolean;
    explorerUrl?: string | null;
    balances?:
      | {
          asset?: { blockchain?: string; symbol?: string; address?: string | null };
          amount?: { amount?: string; decimals?: number };
        }[]
      | null;
  }[];
}

export interface TokenBalanceResponse {
  balance?: string | null;
  error?: string | null;
  errorCode?: number | string | null;
  traceId?: string | null;
}

export interface CustomTokenResponse {
  token?: Token | null;
  error?: string | null;
  errorCode?: number | string | null;
  traceId?: string | null;
}
