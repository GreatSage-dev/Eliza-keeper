import "dotenv/config";
import { simulateTransfer } from "../src/mcp/keeperClient.js";

async function run() {
  if (!process.env["KEEPERHUB_API_KEY"]) {
    console.error("Missing KEEPERHUB_API_KEY in environment or .env");
    process.exit(1);
  }

  console.log("Simulating 0.0001 ETH transfer on Sepolia (Chain ID: 11155111)...");
  const result = await simulateTransfer({
    chain_id: "11155111",
    to_address: "0x000000000000000000000000000000000000dEaD",
    amount: "0.0001",
  });

  console.log("Simulation Result:", JSON.stringify(result, null, 2));
}

run().catch(console.error);
