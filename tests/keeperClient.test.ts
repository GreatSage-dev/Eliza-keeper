import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  KeeperHubConnectionError,
  KeeperHubExecutionError,
} from "../src/types.js";

// ─── Mock the MCP SDK before importing the client ──────────────────
const mockCallTool = vi.fn();
const mockConnect = vi.fn();
const mockClose = vi.fn();

vi.mock("@modelcontextprotocol/sdk/client/index.js", () => ({
  Client: vi.fn().mockImplementation(() => ({
    connect: mockConnect,
    callTool: mockCallTool,
    close: mockClose,
  })),
}));

vi.mock("@modelcontextprotocol/sdk/client/streamableHttp.js", () => ({
  StreamableHTTPClientTransport: vi.fn().mockImplementation(() => ({})),
}));

// Import after mocks are registered
import { simulateTransfer, executeTransfer } from "../src/mcp/keeperClient.js";

describe("keeperClient", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env["KEEPERHUB_MCP_URL"] = "https://app.keeperhub.com/mcp";
    process.env["KEEPERHUB_API_KEY"] = "test-key";
  });

  // ── simulateTransfer ────────────────────────────────────────────

  describe("simulateTransfer", () => {
    it("returns success result when simulation passes", async () => {
      mockCallTool.mockResolvedValueOnce({
        content: [
          {
            type: "text",
            text: JSON.stringify({
              ok: true,
              result: { gasUsed: "21000", status: "success" },
            }),
          },
        ],
        isError: false,
      });

      const result = await simulateTransfer({
        chain_id: "1",
        to_address: "0xABCDEF1234567890ABCDEF1234567890ABCDEF12",
        amount: "1",
      });

      expect(result.success).toBe(true);
      expect(result.gasEstimate).toContain("21000");
      expect(result.estimatedUsdValue).toBe(2500); // 1 ETH * 2500
      expect(mockCallTool).toHaveBeenCalledWith({
        name: "execute_transfer",
        arguments: {
          chain_id: "1",
          to_address: "0xABCDEF1234567890ABCDEF1234567890ABCDEF12",
          amount: "1",
          simulate: true,
        },
      });
    });

    it("returns failure when simulation is rejected", async () => {
      mockCallTool.mockResolvedValueOnce({
        content: [
          {
            type: "text",
            text: JSON.stringify({
              error: "Insufficient ETH balance for transfer",
            }),
          },
        ],
        isError: true,
      });

      const result = await simulateTransfer({
        chain_id: "1",
        to_address: "0x1234",
        amount: "1000",
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("Insufficient ETH balance");
    });

    it("throws KeeperHubConnectionError when MCP is unreachable", async () => {
      mockConnect.mockRejectedValueOnce(new Error("ECONNREFUSED"));

      await expect(
        simulateTransfer({
          chain_id: "1",
          to_address: "0x1234",
          amount: "1",
        }),
      ).rejects.toThrow(KeeperHubConnectionError);
    });
  });

  // ── executeTransfer ─────────────────────────────────────────────

  describe("executeTransfer", () => {
    it("returns execution result on success", async () => {
      mockCallTool.mockResolvedValueOnce({
        content: [
          {
            type: "text",
            text: JSON.stringify({
              ok: true,
              result: {
                executionId: "exec-abc-123",
                status: "pending",
              },
            }),
          },
        ],
        isError: false,
      });

      const result = await executeTransfer(
        {
          chain_id: "1",
          to_address: "0xABCDEF",
          amount: "0.5",
        },
        "idem-key-1",
      );

      expect(result.executionId).toBe("exec-abc-123");
      expect(result.status).toBe("pending");
      expect(mockCallTool).toHaveBeenCalledWith({
        name: "execute_transfer",
        arguments: {
          chain_id: "1",
          to_address: "0xABCDEF",
          amount: "0.5",
          idempotency_key: "idem-key-1",
        },
      });
    });

    it("throws KeeperHubExecutionError when execution fails", async () => {
      mockCallTool.mockResolvedValueOnce({
        content: [
          {
            type: "text",
            text: "Insufficient balance for transfer",
          },
        ],
        isError: true,
      });

      await expect(
        executeTransfer({
          chain_id: "1",
          to_address: "0x1234",
          amount: "1000",
        }),
      ).rejects.toThrow(KeeperHubExecutionError);
    });
  });
});
