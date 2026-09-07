import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import {
  KeeperHubConnectionError,
  KeeperHubExecutionError,
  KeeperHubSimulationError,
} from "../types.js";
import type {
  SimulationResult,
  ExecuteResult,
  ExecutionStatus,
  TransferParams,
  ContractCallParams,
} from "../types.js";

// ─── Environment helpers ───────────────────────────────────────────
function getMcpUrl(): string {
  const url = process.env["KEEPERHUB_MCP_URL"];
  if (!url) {
    throw new KeeperHubConnectionError(
      "KEEPERHUB_MCP_URL environment variable is not set",
    );
  }
  return url;
}

function getApiKey(): string {
  const key = process.env["KEEPERHUB_API_KEY"];
  if (!key) {
    throw new KeeperHubConnectionError(
      "KEEPERHUB_API_KEY environment variable is not set",
    );
  }
  return key;
}

// ─── MCP Client factory ───────────────────────────────────────────
async function createClient(): Promise<Client> {
  const url = getMcpUrl();
  const apiKey = getApiKey();

  const transport = new StreamableHTTPClientTransport(new URL(url), {
    requestInit: {
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    },
  });

  const client = new Client({
    name: "eliza-keeper-bridge",
    version: "1.0.0",
  });

  try {
    await client.connect(transport);
  } catch (error: unknown) {
    throw new KeeperHubConnectionError(
      `Failed to connect to KeeperHub MCP at ${url}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  return client;
}

// ─── Parse MCP tool response ──────────────────────────────────────
function extractTextFromMcpResult(
  content: unknown,
  context: string,
): string {
  if (!Array.isArray(content) || content.length === 0) {
    throw new KeeperHubConnectionError(
      `Empty response from KeeperHub ${context}`,
    );
  }

  const items = content as Array<Record<string, unknown>>;
  const textItem = items.find(
    (c) =>
      typeof c === "object" &&
      c !== null &&
      c["type"] === "text" &&
      typeof c["text"] === "string",
  );

  if (!textItem || typeof textItem["text"] !== "string") {
    throw new KeeperHubConnectionError(
      `No text content in KeeperHub ${context} response`,
    );
  }

  return textItem["text"];
}

function parseResponse(text: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(text);
  if (typeof parsed !== "object" || parsed === null) {
    throw new KeeperHubConnectionError("Invalid JSON response from KeeperHub");
  }
  return parsed as Record<string, unknown>;
}

/**
 * KeeperHub MCP responses often embed JSON inside a larger text string
 * (e.g., "API call failed: 400 Bad Request - {json...}\n\nHuman-readable text").
 * This extracts and parses the first JSON object found in the text.
 */
function extractEmbeddedJson(text: string): Record<string, unknown> | null {
  // First, try parsing the entire text as JSON
  try {
    const direct = JSON.parse(text);
    if (typeof direct === "object" && direct !== null) {
      return direct as Record<string, unknown>;
    }
  } catch {
    // Not pure JSON, try to find embedded JSON
  }

  // Look for JSON object embedded in the text (after "- {" pattern from KeeperHub)
  const jsonStart = text.indexOf("{");
  if (jsonStart === -1) return null;

  // Find the matching closing brace
  let depth = 0;
  let jsonEnd = -1;
  for (let i = jsonStart; i < text.length; i++) {
    if (text[i] === "{") depth++;
    if (text[i] === "}") depth--;
    if (depth === 0) {
      jsonEnd = i + 1;
      break;
    }
  }

  if (jsonEnd === -1) return null;

  try {
    const jsonStr = text.slice(jsonStart, jsonEnd);
    const parsed = JSON.parse(jsonStr);
    if (typeof parsed === "object" && parsed !== null) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // Could not parse embedded JSON
  }

  return null;
}

// ─── Public API ───────────────────────────────────────────────────

/**
 * Simulate a token transfer via KeeperHub MCP (execute_transfer with simulate=true).
 * This is the dry-run — no transaction is broadcast.
 */
export async function simulateTransfer(
  params: TransferParams,
): Promise<SimulationResult> {
  let client: Client | undefined;
  try {
    client = await createClient();

    const result = await client.callTool({
      name: "execute_transfer",
      arguments: {
        chain_id: params.chain_id,
        to_address: params.to_address,
        amount: params.amount,
        ...(params.token_address ? { token_address: params.token_address } : {}),
        simulate: true,
      },
    });

    const text = extractTextFromMcpResult(result.content, "simulate_transfer");
    const isError = Boolean(result.isError);

    // KeeperHub returns text with embedded JSON + human-readable suffix
    // Try to extract the JSON portion (before "Simulation preflight" text)
    const simData = extractEmbeddedJson(text);
    const estimatedValue = parseFloat(params.amount) * getEthPrice();

    if (isError || (simData && simData["wouldRevert"] === true)) {
      const reason =
        String(simData?.["revertReason"] ?? simData?.["error"] ?? text.slice(0, 300));
      const codeSuffix = simData?.["code"] ? ` [${simData["code"]}]` : "";
      return {
        success: false,
        details: reason,
        gasEstimate: "",
        estimatedUsdValue: estimatedValue,
        raw: simData ?? {},
        error: `${reason}${codeSuffix}`,
      };
    }

    // Successful simulation
    const gasUsed = simData?.["gasUsed"] ?? simData?.["gas"] ?? "21000";

    return {
      success: true,
      details: `Transfer ${params.amount} ${params.token_address ? "tokens" : "ETH"} to ${params.to_address}`,
      gasEstimate: `${String(gasUsed)} gas`,
      estimatedUsdValue: estimatedValue,
      raw: simData ?? {},
    };
  } catch (error: unknown) {
    if (
      error instanceof KeeperHubConnectionError ||
      error instanceof KeeperHubSimulationError
    ) {
      throw error;
    }
    throw new KeeperHubConnectionError(
      `KeeperHub simulation failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  } finally {
    if (client) {
      try { await client.close(); } catch { /* ignore */ }
    }
  }
}

/**
 * Simulate a contract call via KeeperHub MCP (execute_contract_call with simulate=true).
 */
export async function simulateContractCall(
  params: ContractCallParams,
): Promise<SimulationResult> {
  let client: Client | undefined;
  try {
    client = await createClient();

    const args: Record<string, unknown> = {
      contract_address: params.contract_address,
      chain_id: params.chain_id,
      function_name: params.function_name,
      simulate: true,
    };
    if (params.function_args) args["function_args"] = params.function_args;
    if (params.abi) args["abi"] = params.abi;
    if (params.value) args["value"] = params.value;

    const result = await client.callTool({
      name: "execute_contract_call",
      arguments: args,
    });

    const text = extractTextFromMcpResult(result.content, "simulate_contract_call");
    const isError = Boolean(result.isError);
    const obj = parseResponse(text);

    if (isError) {
      return {
        success: false,
        details: String(obj["error"] ?? obj["message"] ?? text),
        gasEstimate: "",
        estimatedUsdValue: 0,
        raw: obj,
        error: String(obj["error"] ?? obj["message"] ?? text),
      };
    }

    const resultObj = (obj["result"] ?? obj) as Record<string, unknown>;
    const gasUsed = resultObj["gasUsed"] ?? resultObj["gas"] ?? "unknown";

    return {
      success: true,
      details: `Contract call ${params.function_name} on ${params.contract_address}`,
      gasEstimate: `${String(gasUsed)} gas`,
      estimatedUsdValue: params.value ? parseFloat(params.value) * getEthPrice() : 0,
      raw: obj,
    };
  } catch (error: unknown) {
    if (
      error instanceof KeeperHubConnectionError ||
      error instanceof KeeperHubSimulationError
    ) {
      throw error;
    }
    throw new KeeperHubConnectionError(
      `KeeperHub contract simulation failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  } finally {
    if (client) {
      try { await client.close(); } catch { /* ignore */ }
    }
  }
}

/**
 * Execute a real transfer via KeeperHub MCP (execute_transfer with simulate=false).
 * Returns an execution ID — poll get_direct_execution_status for the tx hash.
 */
export async function executeTransfer(
  params: TransferParams,
  idempotencyKey?: string,
): Promise<ExecuteResult> {
  let client: Client | undefined;
  try {
    client = await createClient();

    const args: Record<string, unknown> = {
      chain_id: params.chain_id,
      to_address: params.to_address,
      amount: params.amount,
    };
    if (params.token_address) args["token_address"] = params.token_address;
    if (idempotencyKey) args["idempotency_key"] = idempotencyKey;

    const result = await client.callTool({
      name: "execute_transfer",
      arguments: args,
    });

    const text = extractTextFromMcpResult(result.content, "execute_transfer");

    if (result.isError) {
      throw new KeeperHubExecutionError(
        `Transfer execution failed: ${text}`,
      );
    }

    const obj = parseResponse(text);
    const resultObj = (obj["result"] ?? obj) as Record<string, unknown>;
    const executionId = String(resultObj["executionId"] ?? resultObj["execution_id"] ?? "");
    const txHash = String(resultObj["txHash"] ?? resultObj["transactionHash"] ?? "");
    const status = String(resultObj["status"] ?? "pending");

    const chainExplorers: Record<string, string> = {
      "1": "https://etherscan.io/tx/",
      "8453": "https://basescan.org/tx/",
      "137": "https://polygonscan.com/tx/",
      "42161": "https://arbiscan.io/tx/",
      "10": "https://optimistic.etherscan.io/tx/",
      "11155111": "https://sepolia.etherscan.io/tx/",
    };
    const explorerBase = chainExplorers[params.chain_id] ?? `https://etherscan.io/tx/`;

    return {
      executionId,
      txHash,
      explorerUrl: txHash ? `${explorerBase}${txHash}` : "",
      status,
    };
  } catch (error: unknown) {
    if (error instanceof KeeperHubExecutionError) throw error;
    if (error instanceof KeeperHubConnectionError) throw error;
    throw new KeeperHubExecutionError(
      `Transfer execution failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  } finally {
    if (client) {
      try { await client.close(); } catch { /* ignore */ }
    }
  }
}

/**
 * Poll execution status via KeeperHub MCP (get_direct_execution_status).
 */
export async function getExecutionStatus(
  executionId: string,
): Promise<ExecutionStatus> {
  let client: Client | undefined;
  try {
    client = await createClient();

    const result = await client.callTool({
      name: "get_direct_execution_status",
      arguments: { execution_id: executionId },
    });

    const text = extractTextFromMcpResult(result.content, "get_execution_status");
    const obj = parseResponse(text);
    const resultObj = (obj["result"] ?? obj) as Record<string, unknown>;

    return {
      status: String(resultObj["status"] ?? "unknown"),
      txHash: resultObj["txHash"] ? String(resultObj["txHash"]) : undefined,
      result: resultObj,
    };
  } catch (error: unknown) {
    if (error instanceof KeeperHubConnectionError) throw error;
    throw new KeeperHubConnectionError(
      `Failed to get execution status: ${error instanceof Error ? error.message : String(error)}`,
    );
  } finally {
    if (client) {
      try { await client.close(); } catch { /* ignore */ }
    }
  }
}

/**
 * Polls get_direct_execution_status until a terminal status (completed / failed) or txHash is found,
 * or until maxAttempts are exhausted.
 */
export async function pollExecutionStatus(
  executionId: string,
  maxAttempts = 4,
  delayMs = 2500,
): Promise<ExecutionStatus> {
  let lastStatus: ExecutionStatus = { status: "pending" };
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      lastStatus = await getExecutionStatus(executionId);
      if (lastStatus.status === "completed" || lastStatus.status === "failed" || lastStatus.txHash) {
        return lastStatus;
      }
    } catch {
      // Retry on transient network/polling glitches
    }
    if (attempt < maxAttempts) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  return lastStatus;
}

// ─── Helpers ──────────────────────────────────────────────────────

/** Rough ETH price estimate for USD threshold gating. In production, use a price feed. */
function getEthPrice(): number {
  return 2500; // Hardcoded for demo — documented in Honesty Table
}
