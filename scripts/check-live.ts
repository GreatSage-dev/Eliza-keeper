import "dotenv/config";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const MCP_URL = process.env["KEEPERHUB_MCP_URL"] ?? "https://app.keeperhub.com/mcp";
const API_KEY = process.env["KEEPERHUB_API_KEY"];
const WALLET_ADDRESS = "0x9210E2f133087f57A5C57106395C8f9197075BFe";

if (!API_KEY) {
  console.error("Missing KEEPERHUB_API_KEY in environment or .env");
  process.exit(1);
}

async function main(): Promise<void> {
  console.log("===================================================");
  console.log(`Checking KeeperHub MCP simulation for ${WALLET_ADDRESS}...`);
  console.log("===================================================\n");

  const transport = new StreamableHTTPClientTransport(new URL(MCP_URL), {
    requestInit: {
      headers: {
        Authorization: `Bearer ${API_KEY}`,
      },
    },
  });

  const client = new Client({
    name: "balance-checker",
    version: "1.0.0",
  });

  await client.connect(transport);
  console.log("Connected to KeeperHub MCP.");

  const chains = [
    { id: "11155111", name: "Ethereum Sepolia" },
    { id: "1", name: "Ethereum Mainnet" },
    { id: "8453", name: "Base" },
    { id: "84532", name: "Base Sepolia" },
    { id: "42161", name: "Arbitrum One" },
    { id: "137", name: "Polygon" },
  ];

  for (const chain of chains) {
    console.log(`\nTesting simulation on ${chain.name} (Chain ID: ${chain.id})...`);
    try {
      const result = await client.callTool({
        name: "execute_transfer",
        arguments: {
          chain_id: chain.id,
          to_address: "0x000000000000000000000000000000000000dEaD",
          amount: "0.0001",
          simulate: true,
        },
      });

      console.log(`Response on ${chain.name}:`);
      console.log(JSON.stringify(result, null, 2));
    } catch (err: unknown) {
      console.log(`Error on ${chain.name}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  await client.close();
  console.log("\nDone checking.");
}

main().catch(console.error);
