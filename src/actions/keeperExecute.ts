import type {
  Action,
  IAgentRuntime,
  Memory,
  State,
  HandlerCallback,
} from "@elizaos/core";
import * as keeperClient from "../mcp/keeperClient.js";
import {
  KeeperHubConnectionError,
  KeeperHubExecutionError,
} from "../types.js";
import type { PendingWorkflow, TransferParams } from "../types.js";

// ─── Constants ─────────────────────────────────────────────────────
const TRIGGER_KEYWORDS = ["transfer", "swap", "send", "execute", "pay"];
const APPROVAL_KEYWORDS = ["approve", "confirm", "proceed", "yes"];
const WORKFLOW_TTL_MS = 5 * 60 * 1000; // 5 minutes
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

// ─── Cumulative 24h Auto-Spend Rate Limiter ─────────────────────────
interface AutoExecutionRecord {
  timestamp: number;
  usdValue: number;
}
const recentAutoExecutions: AutoExecutionRecord[] = [];

function getDailyAutoSpend(): number {
  const cutoff = Date.now() - ONE_DAY_MS;
  // Prune entries older than 24h
  for (let i = recentAutoExecutions.length - 1; i >= 0; i--) {
    const entry = recentAutoExecutions[i];
    if (entry && entry.timestamp < cutoff) {
      recentAutoExecutions.splice(i, 1);
    }
  }
  return recentAutoExecutions.reduce((acc, curr) => acc + curr.usdValue, 0);
}

function recordAutoExecution(usdValue: number): void {
  recentAutoExecutions.push({ timestamp: Date.now(), usdValue });
}

function getMaxDailyAutoUsd(): number {
  const raw = process.env["KEEPER_MAX_DAILY_AUTO_USD"];
  if (!raw) return 200; // Default $200 daily cumulative cap
  const parsed = parseFloat(raw);
  return isNaN(parsed) ? 200 : parsed;
}

// ─── Chain ID Helper ───────────────────────────────────────────────
function detectChainId(text: string): string {
  const lower = text.toLowerCase();
  if (lower.includes("mainnet") || lower.includes("eth mainnet")) return "1";
  if (lower.includes("base sepolia")) return "84532";
  if (lower.includes("base")) return "8453";
  if (lower.includes("arbitrum")) return "42161";
  if (lower.includes("polygon")) return "137";
  if (lower.includes("sepolia")) return "11155111";
  return process.env["KEEPER_CHAIN_ID"] ?? "11155111";
}

function getExplorerBase(chainId: string): string {
  const chainExplorers: Record<string, string> = {
    "1": "https://etherscan.io/tx/",
    "8453": "https://basescan.org/tx/",
    "137": "https://polygonscan.com/tx/",
    "42161": "https://arbiscan.io/tx/",
    "10": "https://optimistic.etherscan.io/tx/",
    "11155111": "https://sepolia.etherscan.io/tx/",
  };
  return chainExplorers[chainId] ?? "https://etherscan.io/tx/";
}

// ─── Pending Workflow Store (keyed by roomId) ──────────────────────
const pendingWorkflows = new Map<string, PendingWorkflow>();

function getPendingWorkflow(roomId: string): PendingWorkflow | undefined {
  const pending = pendingWorkflows.get(roomId);
  if (!pending) return undefined;

  // Auto-expire stale workflows
  if (Date.now() - pending.createdAt > WORKFLOW_TTL_MS) {
    pendingWorkflows.delete(roomId);
    return undefined;
  }

  return pending;
}

// ─── Intent Parsing & Validation ───────────────────────────────────

export interface ParsedIntentResult {
  valid: boolean;
  isSwap?: boolean;
  error?: string;
  params?: TransferParams;
}

const EVM_ADDRESS_REGEX = /^0x[a-fA-F0-9]{40}$/;

function parseTransferIntent(text: string): ParsedIntentResult {
  const lower = text.toLowerCase();

  // Check if user specifically requested a swap
  if (/\bswap\b/i.test(lower)) {
    return {
      valid: false,
      isSwap: true,
      error:
        "Direct DEX swaps require smart contract router integration. Direct token transfers to recipient addresses are currently supported (e.g. 'Transfer 0.1 ETH to 0x...').",
    };
  }

  // Match transfer pattern: "Transfer 0.5 ETH to 0x..."
  const transferPattern = /(?:transfer|send|pay)\s+([\d.]+)\s*(?:ETH|eth|ether)?/i;
  const addressPattern = /(?:to\s+)?(0x[a-fA-F0-9]+)/i;

  const amountMatch = transferPattern.exec(text);
  if (!amountMatch || !amountMatch[1]) {
    return {
      valid: false,
      error:
        "Could not parse transaction amount. Please specify an amount (e.g. 'Send 0.1 ETH to 0x...').",
    };
  }

  const amount = amountMatch[1];
  const addressMatch = addressPattern.exec(text);
  if (!addressMatch || !addressMatch[1]) {
    return {
      valid: false,
      error:
        "Missing recipient address. Please specify a 40-character Ethereum address (e.g. 'Send 0.1 ETH to 0x1234...5678').",
    };
  }

  const toAddress = addressMatch[1];
  if (!EVM_ADDRESS_REGEX.test(toAddress)) {
    return {
      valid: false,
      error: `Invalid recipient address format: '${toAddress}'. Expected a 40-character hexadecimal Ethereum address (e.g. 0x...).`,
    };
  }

  return {
    valid: true,
    params: {
      chain_id: detectChainId(text),
      to_address: toAddress,
      amount,
    },
  };
}

// ─── Helpers ───────────────────────────────────────────────────────
function getAutoThresholdUsd(): number {
  const raw = process.env["KEEPER_AUTO_THRESHOLD_USD"];
  if (!raw) return 0; // 0 = always require approval
  const parsed = parseFloat(raw);
  return isNaN(parsed) ? 0 : parsed;
}

function isApprovalMessage(text: string): boolean {
  const lower = text.toLowerCase().trim().replace(/[.,!]/g, "");
  return APPROVAL_KEYWORDS.some(
    (kw) =>
      lower === kw ||
      lower.startsWith(`${kw} `) ||
      lower === `"${kw}"` ||
      lower === `'${kw}'`,
  );
}

function isQuestionMessage(text: string): boolean {
  const lower = text.toLowerCase().trim();
  return (
    lower.startsWith("did you") ||
    lower.startsWith("why did") ||
    lower.startsWith("how to") ||
    lower.startsWith("can you explain") ||
    (lower.endsWith("?") && !/(?:send|transfer|pay)\s+[\d.]+/i.test(lower))
  );
}

function isTriggerMessage(text: string): boolean {
  if (isQuestionMessage(text)) return false;
  const lower = text.toLowerCase();
  return TRIGGER_KEYWORDS.some((kw) => lower.includes(kw));
}

function generateIdempotencyKey(): string {
  return `eliza-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

// ─── Action ────────────────────────────────────────────────────────
export const keeperExecuteAction: Action = {
  name: "KEEPER_EXECUTE",
  description:
    "Routes transaction execution through KeeperHub MCP — simulation via execute_transfer(simulate=true), policy-gated approval, deterministic signing",
  similes: [
    "KEEPER_SWAP",
    "KEEPER_TRANSFER",
    "KEEPER_SEND",
    "KEEPERHUB_EXECUTE",
    "KEEPER_PAY",
  ],
  examples: [
    [
      {
        user: "{{user1}}",
        content: {
          text: "Transfer 0.5 ETH to 0x9210E2f133087f57A5C57106395C8f9197075BFe",
        },
      },
      {
        user: "{{agentName}}",
        content: {
          text: 'KeeperHub simulation complete. Transfer 0.5 ETH. Gas estimate: 21000 gas. Reply "approve" to execute.',
        },
      },
    ],
    [
      {
        user: "{{user1}}",
        content: { text: "approve" },
      },
      {
        user: "{{agentName}}",
        content: {
          text: "Executed via KeeperHub. Execution ID: exec-... | Tx hash: 0x... | Explorer: https://sepolia.etherscan.io/tx/0x...",
        },
      },
    ],
  ],

  // ── Validate ───────────────────────────────────────────────────
  validate: async (
    _runtime: IAgentRuntime,
    message: Memory,
    _state?: State,
  ): Promise<boolean> => {
    const text = String(message.content?.text ?? "");
    if (isTriggerMessage(text)) return true;

    // Accept approval keywords only when a pending workflow exists for this room
    const roomId = message.roomId;
    if (isApprovalMessage(text) && getPendingWorkflow(roomId) !== undefined) {
      return true;
    }

    return false;
  },

  // ── Handler ────────────────────────────────────────────────────
  handler: async (
    _runtime: IAgentRuntime,
    message: Memory,
    _state?: State,
    _options?: Record<string, unknown>,
    callback?: HandlerCallback,
  ): Promise<boolean> => {
    const text = String(message.content?.text ?? "");
    const roomId = message.roomId;
    const userId = String(message.userId ?? "default-user");

    // ── APPROVAL FLOW ────────────────────────────────────────────
    if (isApprovalMessage(text)) {
      const pending = getPendingWorkflow(roomId);
      if (!pending) {
        await callback?.({
          text: "No pending transaction to approve. It may have expired (5-minute TTL).",
        });
        return true;
      }

      // Authorization Check: Verify caller initiated this transaction
      if (pending.userId && userId !== "default-user" && pending.userId !== userId) {
        await callback?.({
          text: `Unauthorized: This transaction was initiated by another user (${pending.userId}). Only the initiator can approve it.`,
        });
        return true;
      }

      try {
        if (pending.txType === "transfer") {
          // Re-use the bound idempotency key from simulation to prevent double-execution
          const result = await keeperClient.executeTransfer(
            pending.txParams as TransferParams,
            pending.idempotencyKey,
          );

          // Attempt short async poll to resolve confirmed txHash
          let finalTxHash = result.txHash;
          let finalStatus = result.status;
          let finalExplorerUrl = result.explorerUrl;

          if (!finalTxHash && result.executionId) {
            const polled = await keeperClient.pollExecutionStatus(
              result.executionId,
              3,
              2000,
            );
            if (polled.txHash) {
              finalTxHash = polled.txHash;
              finalStatus = polled.status;
              const chainId = (pending.txParams as TransferParams).chain_id;
              finalExplorerUrl = `${getExplorerBase(chainId)}${finalTxHash}`;
            }
          }

          pendingWorkflows.delete(roomId);

          const parts = [
            `Executed via KeeperHub. Execution ID: ${result.executionId}`,
            `Status: ${finalStatus}`,
          ];
          if (finalTxHash) {
            parts.push(`Tx hash: ${finalTxHash}`);
            parts.push(`Explorer: ${finalExplorerUrl}`);
          } else {
            parts.push("Transaction submitted. Confirmation in progress.");
          }
          await callback?.({ text: parts.join(" | ") });
          return true;
        }

        // Fallback for unsupported tx types
        pendingWorkflows.delete(roomId);
        await callback?.({
          text: "Unsupported transaction type for execution.",
        });
        return true;
      } catch (error: unknown) {
        if (error instanceof KeeperHubExecutionError) {
          pendingWorkflows.delete(roomId);
          await callback?.({
            text: `Execution failed. Reason: ${error.message}. No funds moved. Pending workflow cleared.`,
          });
          return true;
        }
        if (error instanceof KeeperHubConnectionError) {
          await callback?.({
            text: "KeeperHub execution layer unreachable. Transaction paused. No funds moved. Retry when connection restored.",
          });
          return true;
        }
        await callback?.({
          text: "Unexpected error during execution. No funds moved. No fallback to native signing.",
        });
        return true;
      }
    }

    // ── NEW TRANSACTION FLOW ─────────────────────────────────────
    const parsed = parseTransferIntent(text);
    if (!parsed.valid || !parsed.params) {
      await callback?.({
        text: parsed.error ?? "Could not parse transaction intent.",
      });
      return true;
    }

    await callback?.({
      text: "Routing via KeeperHub MCP... running simulation...",
    });

    try {
      // Simulate via KeeperHub
      const simResult = await keeperClient.simulateTransfer(parsed.params);

      // ── Branch 2: simulation fails ─────────────────────────────
      if (!simResult.success) {
        const reason = simResult.error ?? simResult.details;
        console.log(`[KEEPER] Simulation failed: ${reason}`);
        await callback?.({
          text: `Transaction blocked at simulation. Reason: ${reason}. No funds moved. Agent loop continuing.`,
        });
        return true;
      }

      // ── Branch 1: simulation passes ────────────────────────────
      console.log(
        `[KEEPER] Simulation passed. Gas: ${simResult.gasEstimate}. Value: $${simResult.estimatedUsdValue}`,
      );

      const threshold = getAutoThresholdUsd();
      const maxDailyAuto = getMaxDailyAutoUsd();
      const currentDailySpend = getDailyAutoSpend();
      const wouldExceedDailyCap = currentDailySpend + simResult.estimatedUsdValue > maxDailyAuto;

      // Bound idempotency key created at simulation time
      const workflowIdempotencyKey = generateIdempotencyKey();

      // Auto-execute if below per-transaction threshold AND below cumulative 24h cap
      if (threshold > 0 && simResult.estimatedUsdValue <= threshold) {
        if (wouldExceedDailyCap) {
          console.log(
            `[KEEPER] Single tx is $${simResult.estimatedUsdValue} <= $${threshold}, but 24h cumulative total would reach $${currentDailySpend + simResult.estimatedUsdValue} > $${maxDailyAuto}. Staging for human approval.`,
          );
        } else {
          console.log(
            `[KEEPER] $${simResult.estimatedUsdValue} <= $${threshold} threshold. Auto-executing.`,
          );

          const execResult = await keeperClient.executeTransfer(
            parsed.params,
            workflowIdempotencyKey,
          );
          recordAutoExecution(simResult.estimatedUsdValue);

          // Brief async poll to resolve txHash if available
          let autoTxHash = execResult.txHash;
          let autoStatus = execResult.status;
          let autoExplorerUrl = execResult.explorerUrl;

          if (!autoTxHash && execResult.executionId) {
            const polled = await keeperClient.pollExecutionStatus(
              execResult.executionId,
              3,
              2000,
            );
            if (polled.txHash) {
              autoTxHash = polled.txHash;
              autoStatus = polled.status;
              autoExplorerUrl = `${getExplorerBase(parsed.params.chain_id)}${autoTxHash}`;
            }
          }

          const parts = [
            `KeeperHub simulation passed. ${simResult.details}.`,
            `Gas: ${simResult.gasEstimate}.`,
            `Value ($${simResult.estimatedUsdValue}) within auto-threshold ($${threshold}). Executed autonomously.`,
            ``,
            `Execution ID: ${execResult.executionId}`,
            `Status: ${autoStatus}`,
          ];
          if (autoTxHash) {
            parts.push(`Tx hash: ${autoTxHash}`);
            parts.push(`Explorer: ${autoExplorerUrl}`);
          }
          await callback?.({ text: parts.join("\n") });
          return true;
        }
      }

      // Above threshold (or daily cap reached or threshold unset) — stage for approval
      const pending: PendingWorkflow = {
        intent: text,
        txParams: parsed.params,
        txType: "transfer",
        details: simResult.details,
        gasEstimate: simResult.gasEstimate,
        estimatedUsdValue: simResult.estimatedUsdValue,
        idempotencyKey: workflowIdempotencyKey,
        createdAt: Date.now(),
        roomId,
        userId,
      };
      pendingWorkflows.set(roomId, pending);

      const policyNote = wouldExceedDailyCap && threshold > 0 && simResult.estimatedUsdValue <= threshold
        ? ` (Note: Paused because 24h auto-execution limit of $${maxDailyAuto} would be exceeded).`
        : "";

      await callback?.({
        text: [
          `KeeperHub simulation complete. ${simResult.details}.`,
          `Estimated gas: ${simResult.gasEstimate}.`,
          `Estimated value: $${simResult.estimatedUsdValue}.${policyNote}`,
          ``,
          `Reply "approve" to execute.`,
        ].join("\n"),
      });
      return true;
    } catch (error: unknown) {
      // ── Branch 3: MCP unreachable ──────────────────────────────
      if (error instanceof KeeperHubConnectionError) {
        console.error(`[KEEPER] MCP unreachable: ${error.message}`);
        await callback?.({
          text: "KeeperHub execution layer unreachable. Transaction paused. No funds moved. Retry when connection restored.",
        });
        return true;
      }

      // Unexpected — graceful, no crash, no native signing fallback
      console.error(
        `[KEEPER] Unexpected error: ${error instanceof Error ? error.message : String(error)}`,
      );
      await callback?.({
        text: "Unexpected error during KeeperHub simulation. No funds moved. No fallback to native signing. Agent loop continuing.",
      });
      return true;
    }
  },
};

// Export store for provider and testing
export { pendingWorkflows, getPendingWorkflow };
