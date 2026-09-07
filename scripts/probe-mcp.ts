import "dotenv/config";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const MCP_URL = process.env["KEEPERHUB_MCP_URL"] ?? "https://app.keeperhub.com/mcp";
const API_KEY = process.env["KEEPERHUB_API_KEY"];

if (!API_KEY) {
  console.error("Missing KEEPERHUB_API_KEY in environment or .env");
  process.exit(1);
}

async function main(): Promise<void> {
  console.log("═══════════════════════════════════════════════════");
  console.log("  Probing KeeperHub MCP (Streamable HTTP)");
  console.log("═══════════════════════════════════════════════════\n");

  let client: Client | undefined;

  try {
    console.log(`🔌 Connecting to ${MCP_URL} via Streamable HTTP...`);

    const transport = new StreamableHTTPClientTransport(new URL(MCP_URL), {
      requestInit: {
        headers: {
          Authorization: `Bearer ${API_KEY}`,
        },
      },
    });

    client = new Client({
      name: "eliza-keeper-bridge-probe",
      version: "1.0.0",
    });

    await client.connect(transport);
    console.log("✅ Connected!\n");

    // List tools
    console.log("─── Available Tools ───────────────────────────────");
    const toolsResult = await client.listTools();
    if (toolsResult.tools.length === 0) {
      console.log("⚠️  No tools found.");
    } else {
      for (const tool of toolsResult.tools) {
        console.log(`\n  📦 ${tool.name}`);
        console.log(`     Description: ${tool.description ?? "(none)"}`);
        if (tool.inputSchema) {
          const schema = JSON.stringify(tool.inputSchema, null, 2);
          console.log(`     Input Schema:\n${schema.split("\n").map(l => "       " + l).join("\n")}`);
        }
      }
    }

    // Try dry-run
    console.log("\n─── Test: Dry-Run ─────────────────────────────────");
    console.log("  Intent: 'Swap 1 ETH for USDC'\n");
    try {
      const dryResult = await client.callTool({
        name: "keeper_dry_run",
        arguments: { intent: "Swap 1 ETH for USDC" },
      });
      console.log("  ✅ Dry-run response:");
      console.log(JSON.stringify(dryResult, null, 2));
    } catch (err) {
      console.log(`  ❌ keeper_dry_run failed: ${err instanceof Error ? err.message : String(err)}`);
      console.log("  Trying alternative tool names...\n");

      // Try common alternative names
      const alternatives = [
        "dry_run", "dryRun", "dryrun",
        "simulate", "simulation",
        "keeper-dry-run", "keeperDryRun",
        "run_dry_run", "preview",
      ];

      for (const name of alternatives) {
        try {
          const result = await client.callTool({
            name,
            arguments: { intent: "Swap 1 ETH for USDC" },
          });
          console.log(`  ✅ Tool "${name}" worked!`);
          console.log(JSON.stringify(result, null, 2));
          break;
        } catch {
          console.log(`  ❌ "${name}" — not found`);
        }
      }
    }

    // Try failure case
    console.log("\n─── Test: Failure Path ────────────────────────────");
    console.log("  Intent: 'Transfer 1000 ETH to 0x1234'\n");
    try {
      const failResult = await client.callTool({
        name: "keeper_dry_run",
        arguments: { intent: "Transfer 1000 ETH to 0x1234" },
      });
      console.log("  Response:");
      console.log(JSON.stringify(failResult, null, 2));
    } catch (err) {
      console.log(`  Error: ${err instanceof Error ? err.message : String(err)}`);
    }

  } catch (err) {
    console.error("\n💥 Connection failed:", err instanceof Error ? err.message : String(err));
    if (err instanceof Error && err.stack) {
      console.error(err.stack);
    }

    // Fallback: try raw HTTP POST to see what the server responds with
    console.log("\n─── Fallback: Raw HTTP POST ───────────────────────");
    try {
      const response = await fetch(MCP_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${API_KEY}`,
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: {
            protocolVersion: "2025-03-26",
            capabilities: {},
            clientInfo: { name: "probe", version: "1.0.0" },
          },
        }),
      });
      console.log(`  HTTP ${response.status} ${response.statusText}`);
      console.log(`  Content-Type: ${response.headers.get("content-type")}`);
      const body = await response.text();
      console.log(`  Body: ${body.slice(0, 2000)}`);
    } catch (fetchErr) {
      console.error(`  Raw fetch also failed: ${fetchErr instanceof Error ? fetchErr.message : String(fetchErr)}`);
    }

  } finally {
    if (client) {
      try { await client.close(); } catch { /* ignore */ }
      console.log("\n🔒 Connection closed.");
    }
  }

  console.log("\n═══════════════════════════════════════════════════");
  console.log("  Done.");
  console.log("═══════════════════════════════════════════════════");
}

main();
