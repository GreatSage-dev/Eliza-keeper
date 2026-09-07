import type { Plugin } from "@elizaos/core";
import { keeperExecuteAction } from "./actions/keeperExecute.js";
import { keeperStatusProvider } from "./providers/keeperStatus.js";

export const elizaKeeperBridgePlugin: Plugin = {
  name: "eliza-keeper-bridge",
  description:
    "Delegates all ElizaOS agent transaction execution to KeeperHub MCP — deterministic signing, gas management, MEV protection, audit trail",
  actions: [keeperExecuteAction],
  providers: [keeperStatusProvider],
};

export default elizaKeeperBridgePlugin;

// Re-export for consumers
export { keeperExecuteAction } from "./actions/keeperExecute.js";
export { keeperStatusProvider } from "./providers/keeperStatus.js";
export {
  KeeperHubConnectionError,
  KeeperHubExecutionError,
  KeeperHubSimulationError,
} from "./types.js";
export type {
  SimulationResult,
  ExecuteResult,
  ExecutionStatus,
  PendingWorkflow,
  TransferParams,
  ContractCallParams,
} from "./types.js";
