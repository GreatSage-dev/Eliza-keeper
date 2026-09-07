import "dotenv/config";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const MCP_URL = process.env["KEEPERHUB_MCP_URL"] ?? "https://app.keeperhub.com/mcp";
const API_KEY = process.env["KEEPERHUB_API_KEY"];

if (!API_KEY) {
  console.error("Missing KEEPERHUB_API_KEY in environment or .env");
  process.exit(1);
}

async function checkBalance() {
  const transport = new StreamableHTTPClientTransport(new URL(MCP_URL), {
    requestInit: { headers: { Authorization: `Bearer ${API_KEY}` } },
  });
  const client = new Client({ name: "balance-probe", version: "1.0.0" });
  await client.connect(transport);

  // Let's test a few amounts on Sepolia to see what the balance is
  for (const amount of ["1.0", "0.1", "0.01", "0.001", "0.0001"]) {
    const res = await client.callTool({
      name: "execute_transfer",
      arguments: {
        chain_id: "11155111",
        to_address: "0x000000000000000000000000000000000000dEaD",
        amount,
        simulate: true,
      },
    });
    const text = (res.content[0] as { text: string }).text;
    if (res.isError) {
      const match = text.match(/Have:\s*([\d.]+)/);
      if (match) {
        console.log(`Wallet Balance on Sepolia: ${match[1]} ETH`);
        break;
      }
    } else {
      console.log(`Amount ${amount} ETH passes! Balance is at least ${amount} ETH.`);
    }
  }

  await client.close();
}

checkBalance().catch(console.error);
