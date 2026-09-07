import "dotenv/config";
import { keeperExecuteAction, pendingWorkflows } from "../src/actions/keeperExecute.js";

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

const SEP_RECIPIENT = "0x9210E2f133087f57A5C57106395C8f9197075BFe";

async function simulateAgentChat(userText: string, roomId = "demo-room", userId = "alice") {
  console.log(`\n\x1b[36m👤 User:\x1b[0m "${userText}"`);
  await sleep(600);

  const responses: string[] = [];
  await keeperExecuteAction.handler(
    {} as any,
    { content: { text: userText }, roomId, userId } as any,
    undefined,
    undefined,
    async (resp) => {
      responses.push(resp.text);
    }
  );

  for (const resp of responses) {
    await sleep(800);
    console.log(`\x1b[32m🤖 Eliza Agent:\x1b[0m\n${resp}\n`);
  }
}

async function runDemo() {
  console.log("\x1b[1m\x1b[35m====================================================================\x1b[0m");
  console.log("\x1b[1m\x1b[35m   ELIZA-KEEPER BRIDGE — LIVE DEMO RUNNER                          \x1b[0m");
  console.log("\x1b[1m\x1b[35m   Deterministic MCP Execution Layer for Autonomous ElizaOS Agents  \x1b[0m");
  console.log("\x1b[1m\x1b[35m====================================================================\x1b[0m");

  pendingWorkflows.clear();

  // ── SCENARIO 1: Above-Threshold Transaction with Human-in-the-Loop Approval
  console.log("\n\x1b[33m[SCENARIO 1] Large Transfer Above Threshold ($50) -> Simulation Pass -> Approval Gate\x1b[0m");
  console.log("----------------------------------------------------------------------------------");
  await simulateAgentChat(`Send 0.05 ETH to ${SEP_RECIPIENT}`);
  await sleep(1500);

  console.log("\x1b[33m[SCENARIO 1 - Execution] User Approves Staged Transaction\x1b[0m");
  console.log("----------------------------------------------------------------------------------");
  await simulateAgentChat("approve");
  await sleep(2000);

  // ── SCENARIO 2: Preflight Simulation Block (Graceful Failure)
  console.log("\n\x1b[33m[SCENARIO 2] Transaction Failure Preflight Block (Insufficient Funds / Invalid)\x1b[0m");
  console.log("----------------------------------------------------------------------------------");
  await simulateAgentChat(`Transfer 50000 ETH to ${SEP_RECIPIENT}`);
  await sleep(2000);

  // ── SCENARIO 3: Autonomous Execution Below Threshold
  console.log("\n\x1b[33m[SCENARIO 3] Sub-Threshold Auto-Execution ($0.25 <= $50 Policy Gate)\x1b[0m");
  console.log("----------------------------------------------------------------------------------");
  await simulateAgentChat(`Send 0.0001 ETH to ${SEP_RECIPIENT}`);

  console.log("\x1b[1m\x1b[32m====================================================================\x1b[0m");
  console.log("\x1b[1m\x1b[32m   DEMO COMPLETE — Zero private keys exposed. Zero crashed loops.    \x1b[0m");
  console.log("\x1b[1m\x1b[32m====================================================================\x1b[0m\n");
}

runDemo().catch(console.error);
