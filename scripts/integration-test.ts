import "dotenv/config";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const MCP_URL = process.env["KEEPERHUB_MCP_URL"] ?? "https://app.keeperhub.com/mcp";
const API_KEY = process.env["KEEPERHUB_API_KEY"];

if (!API_KEY) {
  console.error("Missing KEEPERHUB_API_KEY in environment or .env");
  process.exit(1);
}

async function connectToKeeper(): Promise<Client> {
  console.log(`\n🔌 Connecting to KeeperHub MCP at ${MCP_URL}...`);

  const transport = new StreamableHTTPClientTransport(new URL(MCP_URL), {
    requestInit: {
      headers: {
        Authorization: `Bearer ${API_KEY}`,
      },
    },
  });

  const client = new Client({
    name: "eliza-keeper-bridge-integration-test",
    version: "1.0.0",
  });

  await client.connect(transport);
  console.log("✅ Connected to KeeperHub MCP.\n");
  return client;
}

async function main(): Promise<void> {
  console.log("═══════════════════════════════════════════════════");
  console.log("  Eliza-Keeper Bridge — Live Integration Test");
  console.log("═══════════════════════════════════════════════════");

  let client: Client | undefined;

  try {
    client = await connectToKeeper();

    // ── Test 1: Simulate a small transfer (should pass) ──────────
    console.log("─── Test 1: Simulate 0.001 ETH transfer ─────────");
    console.log("  execute_transfer(simulate=true)\n");

    const sim1 = await client.callTool({
      name: "execute_transfer",
      arguments: {
        chain_id: "1",
        to_address: "0x000000000000000000000000000000000000dEaD",
        amount: "0.001",
        simulate: true,
      },
    });
    console.log("  Result:");
    console.log(JSON.stringify(sim1, null, 2));
    console.log(`  isError: ${sim1.isError}\n`);

    // ── Test 2: Simulate a huge transfer (should fail) ───────────
    console.log("─── Test 2: Simulate 100000 ETH transfer (should fail) ──");
    console.log("  execute_transfer(simulate=true)\n");

    const sim2 = await client.callTool({
      name: "execute_transfer",
      arguments: {
        chain_id: "1",
        to_address: "0x000000000000000000000000000000000000dEaD",
        amount: "100000",
        simulate: true,
      },
    });
    console.log("  Result:");
    console.log(JSON.stringify(sim2, null, 2));
    console.log(`  isError: ${sim2.isError}\n`);

    // ── Test 3: Check spending limits ────────────────────────────
    console.log("─── Test 3: Get spending limits ──────────────────");

    const limits = await client.callTool({
      name: "get_spending_limits",
      arguments: {},
    });
    console.log("  Result:");
    console.log(JSON.stringify(limits, null, 2));
    console.log("");

    // ── Test 4: List integrations (check wallet) ─────────────────
    console.log("─── Test 4: List integrations (wallet check) ─────");

    const integrations = await client.callTool({
      name: "list_integrations",
      arguments: {},
    });
    console.log("  Result:");
    console.log(JSON.stringify(integrations, null, 2));
    console.log("");

  } catch (err) {
    console.error(
      "\n💥 Error:",
      err instanceof Error ? err.message : String(err),
    );
    if (err instanceof Error && err.stack) {
      console.error(err.stack);
    }
  } finally {
    if (client) {
      try {
        await client.close();
      } catch {
        // ignore
      }
      console.log("🔒 Connection closed.");
    }
  }

  console.log("\n═══════════════════════════════════════════════════");
  console.log("  Done.");
  console.log("═══════════════════════════════════════════════════");
}

main();
