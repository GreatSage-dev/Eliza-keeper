import type {
  Provider,
  IAgentRuntime,
  Memory,
  State,
} from "@elizaos/core";
import { getPendingWorkflow } from "../actions/keeperExecute.js";

export const keeperStatusProvider: Provider = {
  get: async (
    _runtime: IAgentRuntime,
    message: Memory,
    _state?: State,
  ): Promise<string> => {
    try {
      const roomId = message.roomId;
      const pending = getPendingWorkflow(roomId);

      if (!pending) {
        return "";
      }

      const ageSeconds = Math.round(
        (Date.now() - pending.createdAt) / 1000,
      );

      return [
        `[KeeperHub Status]`,
        `Type: ${pending.txType}`,
        `Intent: ${pending.intent}`,
        `Details: ${pending.details}`,
        `Gas estimate: ${pending.gasEstimate}`,
        `Estimated value: $${pending.estimatedUsdValue}`,
        `Status: Awaiting approval`,
        `Age: ${ageSeconds}s (expires at 300s)`,
      ].join("\n");
    } catch {
      // Provider must never throw
      return "";
    }
  },
};
