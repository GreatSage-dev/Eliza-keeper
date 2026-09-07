# Eliza-Keeper Bridge

**A KeeperHub execution plugin for ElizaOS that replaces native transaction signing with KeeperHub's deterministic MCP execution layer.** ElizaOS agents fail 15–20% of transactions during network volatility due to stuck nonces, gas spikes, and silent RPC timeouts. Eliza-Keeper Bridge delegates all execution to KeeperHub — which handles nonces, gas, MEV protection, and Turnkey-backed signing — so the agent never touches a raw private key.

## The Problem in One Number

> **15–20% of ElizaOS agent transactions fail during network volatility.** Stuck nonces, gas estimation failures, and silent RPC timeouts cause agents to lose funds, double-execute, or hang indefinitely. Giving an LLM direct access to a private key is a prompt injection away from catastrophe.

## How It Works

```
Agent Intent → KeeperHub MCP Dry-Run → Policy Gate → Human Approval (or Auto-Execute) → KeeperHub Execution → Tx Hash + Audit Trail
```

1. Agent detects a transaction intent (swap, transfer, send, etc.)
2. Intent is routed to KeeperHub MCP for **dry-run simulation**
3. If simulation fails → transaction is **blocked**. No funds moved. Agent continues.
4. If simulation passes → **policy gate** checks `KEEPER_AUTO_THRESHOLD_USD`:
   - Value ≤ threshold → **auto-executes** (no human needed)
   - Value > threshold → **pauses for human approval**
5. On approval → KeeperHub executes with deterministic nonce, gas, and MEV protection
6. Full audit trail returned

## Install

### 1. Install the package

```bash
npm install eliza-keeper-bridge
```

### 2. Add to your Eliza character file

```typescript
import { elizaKeeperBridgePlugin } from "eliza-keeper-bridge";

const character = {
  // ... your character config
  plugins: [elizaKeeperBridgePlugin],
};
```

### 3. Configure environment variables

```bash
cp .env.example .env
```

```env
KEEPERHUB_MCP_URL=https://app.keeperhub.com/mcp
KEEPERHUB_API_KEY=your_api_key_here
KEEPER_AUTO_THRESHOLD_USD=50
```

| Variable | Description | Default |
|----------|-------------|---------|
| `KEEPERHUB_MCP_URL` | KeeperHub MCP server endpoint | Required |
| `KEEPERHUB_API_KEY` | KeeperHub API key | Required |
| `KEEPER_AUTO_THRESHOLD_USD` | USD threshold for auto-execution. Transactions at or below this value execute after dry-run without approval. Set to `0` or omit to always require approval. | `0` (always approve) |

## Demo Loop

This is the exact sequence the demo shows:

### 1. Successful Swap (Above Threshold — Human Approval Required)

**Trigger:**
> "Whale alert: 500 ETH moved to Uniswap. Swap 2 ETH to USDC to rebalance treasury."

**Agent:**
> "Routing via KeeperHub MCP... running simulation..."

**KeeperHub dry-run returns:**
> Swap 2 ETH → 4,980 USDC. Gas: $1.40. MEV risk: low. Slippage: 0.3%.

**Agent:**
> "KeeperHub simulation complete. Swap 2 ETH → 4,980 USDC. Slippage: 0.3%. Estimated gas: $1.40. MEV risk: low. Estimated value: $4980. Reply "approve" to execute."

**User:**
> "approve"

**Agent:**
> "Executed. Tx hash: 0xabc...123 | Explorer: https://etherscan.io/tx/0xabc123 | KeeperHub audit trail: https://app.keeperhub.com/audit/wf-abc-123"

### 2. Failed Transaction — Simulation Block

**Trigger:**
> "Swap 100 ETH to USDC"

**Agent:**
> "Routing via KeeperHub MCP... running simulation..."
> "Transaction blocked at simulation. Reason: Insufficient ETH balance. No funds moved. Agent loop continuing."

**This second failure demo is what separates this from every other submission.** The agent doesn't crash. It doesn't hang. It reports exactly what went wrong and continues operating.

### 3. Auto-Execute (Below Threshold)

**Trigger:** (with `KEEPER_AUTO_THRESHOLD_USD=100`)
> "Send 0.01 ETH to 0xABC...DEF"

**Agent:**
> "KeeperHub simulation passed. Send 0.01 ETH to 0xABC. Gas: $0.30. MEV risk: none. Value ($25) within auto-threshold ($100). Executed autonomously."
> "Tx hash: 0xdef...789 | Explorer: https://etherscan.io/tx/0xdef789"

No approval needed. Sub-threshold transactions execute immediately after simulation passes.

## Architecture

```
┌─────────────────────────────────────────────────┐
│                  ElizaOS Agent                  │
│                                                 │
│  ┌───────────────┐      ┌────────────────────┐  │
│  │ KEEPER_EXECUTE │      │  KEEPER_STATUS     │  │
│  │   (Action)     │      │   (Provider)       │  │
│  └───────┬───────┘      └────────────────────┘  │
│          │                                       │
│          ▼                                       │
│  ┌───────────────┐                              │
│  │ Policy Gate   │  ← KEEPER_AUTO_THRESHOLD_USD │
│  │ (auto/approve)│                              │
│  └───────┬───────┘                              │
│          │                                       │
└──────────┼───────────────────────────────────────┘
           │ MCP (SSE)
           ▼
┌─────────────────────────────────────────────────┐
│              KeeperHub MCP Server               │
│                                                 │
│  ┌──────────┐  ┌──────────┐  ┌──────────────┐  │
│  │ Dry-Run  │  │ Execute  │  │ Audit Trail  │  │
│  │Simulation│  │ (Turnkey │  │   Logging    │  │
│  │          │  │ Signing) │  │              │  │
│  └──────────┘  └──────────┘  └──────────────┘  │
│                                                 │
│  Nonce Management • Gas Optimization • MEV      │
│  Protection • Deterministic Execution           │
└─────────────────────────────────────────────────┘
```

## Honesty Table

| What's Real | What's Hardcoded for Demo | What We Didn't Build |
|-------------|--------------------------|---------------------|
| KeeperHub MCP integration | Initial swap trigger (fixed whale alert scenario) | Underlying LLM (uses Eliza's existing model) |
| Dry-run simulation routing | — | Trading UI |
| Three-branch failure handling | — | Multi-chain support |
| Policy-gated approval (`KEEPER_AUTO_THRESHOLD_USD`) | — | Portfolio analytics |
| Approval gate with 5-min TTL | — | — |
| On-chain execution via KeeperHub | — | — |
| Typed error classes (never swallows) | — | — |
| Full audit trail passthrough | — | — |

## Development

```bash
# Install dependencies
npm install

# Run tests
npm test

# Build
npm run build
```

## Security Invariant

> **This plugin will NEVER fall back to native Eliza signing under any circumstances.**
>
> If KeeperHub is unreachable, the transaction is paused — not retried through a local private key. This is by design. KeeperHub is the execution firewall.

## License

MIT
