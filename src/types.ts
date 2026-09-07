// ─── Dry-Run / Simulation Result ───────────────────────────────────
export interface SimulationResult {
  /** Whether the simulation passed */
  success: boolean;
  /** Human-readable summary of the simulation outcome */
  details: string;
  /** Estimated gas cost (from simulation), e.g. "$1.40" */
  gasEstimate: string;
  /** Estimated USD value of the transaction for threshold gating */
  estimatedUsdValue: number;
  /** Raw response from KeeperHub for debugging */
  raw: Record<string, unknown>;
  /** Error reason when success is false */
  error?: string;
}

// ─── Execute Result ────────────────────────────────────────────────
export interface ExecuteResult {
  /** KeeperHub execution ID (used to poll status) */
  executionId: string;
  /** On-chain transaction hash (available after completion) */
  txHash: string;
  /** Block explorer URL for the transaction */
  explorerUrl: string;
  /** Execution status: pending, running, unconfirmed, completed, failed */
  status: string;
}

// ─── Execution Status (from polling) ──────────────────────────────
export interface ExecutionStatus {
  /** Execution status: pending, running, unconfirmed, completed, failed */
  status: string;
  /** Transaction hash (when available) */
  txHash?: string;
  /** Full result from KeeperHub */
  result?: Record<string, unknown>;
}

// ─── Pending Workflow (staged for approval) ────────────────────────
export interface PendingWorkflow {
  /** The original intent text from the user */
  intent: string;
  /** Parsed transaction parameters */
  txParams: TransferParams | ContractCallParams;
  /** Type of transaction */
  txType: "transfer" | "contract_call";
  /** Human-readable simulation details */
  details: string;
  /** Estimated gas cost string */
  gasEstimate: string;
  /** Estimated USD value of the transaction */
  estimatedUsdValue: number;
  /** Unique idempotency key bound to this workflow for safe retries */
  idempotencyKey: string;
  /** Timestamp of creation */
  createdAt: number;
  /** Room ID for scoping */
  roomId: string;
  /** User ID of the initiator who staged the workflow */
  userId: string;
}

// ─── Transaction Parameters ────────────────────────────────────────
export interface TransferParams {
  chain_id: string;
  to_address: string;
  amount: string;
  token_address?: string;
}

export interface ContractCallParams {
  contract_address: string;
  chain_id: string;
  function_name: string;
  function_args?: string;
  abi?: string;
  value?: string;
}

// ─── Custom Error Types ────────────────────────────────────────────
export class KeeperHubConnectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "KeeperHubConnectionError";
  }
}

export class KeeperHubExecutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "KeeperHubExecutionError";
  }
}

export class KeeperHubSimulationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "KeeperHubSimulationError";
  }
}
