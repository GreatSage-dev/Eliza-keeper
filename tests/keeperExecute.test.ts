import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  KeeperHubConnectionError,
  KeeperHubExecutionError,
} from "../src/types.js";
import type { SimulationResult, ExecuteResult, ExecutionStatus } from "../src/types.js";
import type { TransferParams } from "../src/types.js";

const VALID_ADDR = "0x1234567890123456789012345678901234567890";
const VALID_ADDR_2 = "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd";

// ─── Mock keeperClient ─────────────────────────────────────────────
const mockSimulateTransfer = vi.fn<
  (params: TransferParams) => Promise<SimulationResult>
>();
const mockExecuteTransfer = vi.fn<
  (params: TransferParams, idempotencyKey?: string) => Promise<ExecuteResult>
>();
const mockPollExecutionStatus = vi.fn<
  (executionId: string, maxAttempts?: number, delayMs?: number) => Promise<ExecutionStatus>
>();

vi.mock("../src/mcp/keeperClient.js", () => ({
  simulateTransfer: (...args: [TransferParams]) =>
    mockSimulateTransfer(...args),
  executeTransfer: (...args: [TransferParams, string?]) =>
    mockExecuteTransfer(...args),
  pollExecutionStatus: (...args: [string, number?, number?]) =>
    mockPollExecutionStatus(...args),
}));

// Import action after mocks
import {
  keeperExecuteAction,
  pendingWorkflows,
} from "../src/actions/keeperExecute.js";

// ─── Test helpers ──────────────────────────────────────────────────
function createMessage(
  text: string,
  roomId = "room-1",
  userId = "user-1",
): {
  content: { text: string };
  roomId: string;
  userId: string;
} {
  return { content: { text }, roomId, userId };
}

function createRuntime(): Record<string, unknown> {
  return {};
}

describe("keeperExecuteAction", () => {
  let callbackMessages: string[];
  let callback: (response: { text: string }) => Promise<void>;

  beforeEach(() => {
    vi.clearAllMocks();
    callbackMessages = [];
    callback = async (response: { text: string }) => {
      callbackMessages.push(response.text);
    };
    pendingWorkflows.clear();
    process.env["KEEPER_AUTO_THRESHOLD_USD"] = "100";
    process.env["KEEPER_MAX_DAILY_AUTO_USD"] = "500";
    mockPollExecutionStatus.mockResolvedValue({ status: "pending" });
  });

  afterEach(() => {
    pendingWorkflows.clear();
  });

  // ── Validation ─────────────────────────────────────────────────

  describe("validate", () => {
    it("returns true for transaction keywords", async () => {
      const result = await keeperExecuteAction.validate(
        createRuntime() as never,
        createMessage(`Transfer 2 ETH to ${VALID_ADDR}`) as never,
      );
      expect(result).toBe(true);
    });

    it("returns false for unrelated messages", async () => {
      const result = await keeperExecuteAction.validate(
        createRuntime() as never,
        createMessage("What is the weather today?") as never,
      );
      expect(result).toBe(false);
    });

    it("returns false for conversational questions mentioning transfer", async () => {
      const result = await keeperExecuteAction.validate(
        createRuntime() as never,
        createMessage("Did you transfer the funds yesterday?") as never,
      );
      expect(result).toBe(false);
    });

    it("returns true for 'approve' when a pending workflow exists", async () => {
      pendingWorkflows.set("room-1", {
        intent: `Send 2 ETH to ${VALID_ADDR}`,
        txParams: { chain_id: "1", to_address: VALID_ADDR, amount: "2" },
        txType: "transfer",
        details: "Transfer 2 ETH",
        gasEstimate: "21000 gas",
        estimatedUsdValue: 5000,
        idempotencyKey: "test-key-1",
        createdAt: Date.now(),
        roomId: "room-1",
        userId: "user-1",
      });

      const result = await keeperExecuteAction.validate(
        createRuntime() as never,
        createMessage("approve") as never,
      );
      expect(result).toBe(true);
    });

    it("returns true for relaxed approval phrases like 'yes please' or 'confirm'", async () => {
      pendingWorkflows.set("room-1", {
        intent: `Send 2 ETH to ${VALID_ADDR}`,
        txParams: { chain_id: "1", to_address: VALID_ADDR, amount: "2" },
        txType: "transfer",
        details: "Transfer 2 ETH",
        gasEstimate: "21000 gas",
        estimatedUsdValue: 5000,
        idempotencyKey: "test-key-1",
        createdAt: Date.now(),
        roomId: "room-1",
        userId: "user-1",
      });

      const result = await keeperExecuteAction.validate(
        createRuntime() as never,
        createMessage("yes please") as never,
      );
      expect(result).toBe(true);
    });

    it("returns false for 'approve' with no pending workflow", async () => {
      const result = await keeperExecuteAction.validate(
        createRuntime() as never,
        createMessage("approve") as never,
      );
      expect(result).toBe(false);
    });
  });

  // ── Handler ────────────────────────────────────────────────────

  describe("handler", () => {
    it("handles simulation pass above threshold and stages pending workflow", async () => {
      mockSimulateTransfer.mockResolvedValueOnce({
        success: true,
        details: `Transfer 2 ETH to ${VALID_ADDR}`,
        gasEstimate: "21000 gas",
        estimatedUsdValue: 5000, // Above $100 threshold
        raw: {},
      });

      const result = await keeperExecuteAction.handler(
        createRuntime() as never,
        createMessage(`Send 2 ETH to ${VALID_ADDR}`) as never,
        undefined,
        undefined,
        callback as never,
      );

      expect(result).toBe(true);
      expect(pendingWorkflows.has("room-1")).toBe(true);
      const pending = pendingWorkflows.get("room-1");
      expect(pending?.txType).toBe("transfer");
      expect(pending?.idempotencyKey).toBeDefined();

      const lastMessage = callbackMessages[callbackMessages.length - 1];
      expect(lastMessage).toContain("simulation complete");
      expect(lastMessage).toContain('Reply "approve"');
    });

    it("handles simulation pass below threshold and auto-executes", async () => {
      mockSimulateTransfer.mockResolvedValueOnce({
        success: true,
        details: `Transfer 0.01 ETH to ${VALID_ADDR}`,
        gasEstimate: "21000 gas",
        estimatedUsdValue: 25, // Below $100 threshold
        raw: {},
      });

      mockExecuteTransfer.mockResolvedValueOnce({
        executionId: "exec-small-456",
        txHash: "",
        explorerUrl: "",
        status: "pending",
      });

      const result = await keeperExecuteAction.handler(
        createRuntime() as never,
        createMessage(`Send 0.01 ETH to ${VALID_ADDR}`) as never,
        undefined,
        undefined,
        callback as never,
      );

      expect(result).toBe(true);
      expect(pendingWorkflows.has("room-1")).toBe(false);
      expect(mockExecuteTransfer).toHaveBeenCalled();

      const lastMessage = callbackMessages[callbackMessages.length - 1];
      expect(lastMessage).toContain("Executed autonomously");
      expect(lastMessage).toContain("exec-small-456");
    });

    it("executes pending workflow when user replies 'approve' with bound idempotency key", async () => {
      const originalKey = "bound-idempotency-key-123";
      pendingWorkflows.set("room-1", {
        intent: `Send 2 ETH to ${VALID_ADDR}`,
        txParams: { chain_id: "1", to_address: VALID_ADDR, amount: "2" },
        txType: "transfer",
        details: "Transfer 2 ETH",
        gasEstimate: "21000 gas",
        estimatedUsdValue: 5000,
        idempotencyKey: originalKey,
        createdAt: Date.now(),
        roomId: "room-1",
        userId: "user-1",
      });

      mockExecuteTransfer.mockResolvedValueOnce({
        executionId: "exec-approved-789",
        txHash: "0xabc123",
        explorerUrl: "https://etherscan.io/tx/0xabc123",
        status: "completed",
      });

      const result = await keeperExecuteAction.handler(
        createRuntime() as never,
        createMessage("approve", "room-1", "user-1") as never,
        undefined,
        undefined,
        callback as never,
      );

      expect(result).toBe(true);
      // Verify idempotency key is preserved
      expect(mockExecuteTransfer).toHaveBeenCalledWith(
        expect.anything(),
        originalKey,
      );
      expect(pendingWorkflows.has("room-1")).toBe(false);

      const lastMessage = callbackMessages[callbackMessages.length - 1];
      expect(lastMessage).toContain("Executed via KeeperHub");
      expect(lastMessage).toContain("0xabc123");
    });

    it("rejects approval attempt from unauthorized user (channel hijack protection)", async () => {
      pendingWorkflows.set("room-1", {
        intent: `Send 2 ETH to ${VALID_ADDR}`,
        txParams: { chain_id: "1", to_address: VALID_ADDR, amount: "2" },
        txType: "transfer",
        details: "Transfer 2 ETH",
        gasEstimate: "21000 gas",
        estimatedUsdValue: 5000,
        idempotencyKey: "key-1",
        createdAt: Date.now(),
        roomId: "room-1",
        userId: "user-admin",
      });

      const result = await keeperExecuteAction.handler(
        createRuntime() as never,
        createMessage("approve", "room-1", "attacker-bob") as never,
        undefined,
        undefined,
        callback as never,
      );

      expect(result).toBe(true);
      // Execution must NOT be called
      expect(mockExecuteTransfer).not.toHaveBeenCalled();
      // Workflow must remain safely staged
      expect(pendingWorkflows.has("room-1")).toBe(true);

      const lastMessage = callbackMessages[callbackMessages.length - 1];
      expect(lastMessage).toContain("Unauthorized");
    });

    it("prevents burn on swap intent and informs user", async () => {
      const result = await keeperExecuteAction.handler(
        createRuntime() as never,
        createMessage("Swap 1 ETH for USDC") as never,
        undefined,
        undefined,
        callback as never,
      );

      expect(result).toBe(true);
      expect(mockSimulateTransfer).not.toHaveBeenCalled();
      const lastMessage = callbackMessages[callbackMessages.length - 1];
      expect(lastMessage).toContain("Direct DEX swaps require smart contract router");
    });

    it("handles simulation failure gracefully without crashing", async () => {
      mockSimulateTransfer.mockResolvedValueOnce({
        success: false,
        details: "",
        gasEstimate: "",
        estimatedUsdValue: 0,
        raw: {},
        error: "Insufficient ETH balance",
      });

      const result = await keeperExecuteAction.handler(
        createRuntime() as never,
        createMessage(`Transfer 1000 ETH to ${VALID_ADDR}`) as never,
        undefined,
        undefined,
        callback as never,
      );

      expect(result).toBe(true);
      expect(pendingWorkflows.has("room-1")).toBe(false);

      const lastMessage = callbackMessages[callbackMessages.length - 1];
      expect(lastMessage).toContain("Transaction blocked at simulation");
      expect(lastMessage).toContain("Insufficient ETH balance");
      expect(lastMessage).toContain("No funds moved");
    });

    it("handles MCP unreachable without falling back to native signing", async () => {
      mockSimulateTransfer.mockRejectedValueOnce(
        new KeeperHubConnectionError("ECONNREFUSED"),
      );

      const result = await keeperExecuteAction.handler(
        createRuntime() as never,
        createMessage(`Transfer 1 ETH to ${VALID_ADDR}`) as never,
        undefined,
        undefined,
        callback as never,
      );

      expect(result).toBe(true);
      expect(pendingWorkflows.has("room-1")).toBe(false);

      const lastMessage = callbackMessages[callbackMessages.length - 1];
      expect(lastMessage).toContain("unreachable");
      expect(lastMessage).toContain("No funds moved");
      expect(lastMessage).not.toContain("native");
      expect(lastMessage).not.toContain("private key");
      expect(lastMessage).not.toContain("fallback");
    });
  });
});
