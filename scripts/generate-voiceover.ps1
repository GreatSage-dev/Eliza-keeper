Add-Type -AssemblyName System.Speech
$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer

# Pick best installed voice
$voices = $synth.GetInstalledVoices()
foreach ($v in $voices) {
    if ($v.VoiceInfo.Culture.Name -like "en*") {
        $synth.SelectVoice($v.VoiceInfo.Name)
        break
    }
}

$synth.Rate = 1 # Professional, crisp demo pacing
$synth.Volume = 100

$outputDir = Join-Path $PSScriptRoot "..\videos"
if (!(Test-Path $outputDir)) { New-Item -ItemType Directory -Path $outputDir -Force }
$audioPath = Join-Path $outputDir "voiceover.wav"

$synth.SetOutputToWaveFile($audioPath)

$scriptText = @"
Every AI agent hackathon project shows you the exact same thing: a chatbot saying yes and blindly sending a transaction. 
But if you have ever run an autonomous agent in production, you know that is how wallets get drained. 
Large Language Models are probabilistic. They hallucinate, they get prompt injected, nonces get stuck, and gas spikes cause 15 to 20 percent of transactions to fail. 
We built Eliza Keeper Bridge to bring institutional financial controls to Eliza OS. We don't demo chatbots talking. We demo our execution engine ruthlessly saying NO.

Watch what happens when an Eliza agent is instructed to rebalance a treasury with 0.05 E T H. 
The agent doesn't touch a private key. It routes the intent through KeeperHub's M C P via Streamable HTTP. 
KeeperHub simulates the E V M call on Sepolia testnet in milliseconds. It verifies gas, balance, and confirms zero reverts. 
Because 0.05 E T H is 125 dollars, exceeding our 50 dollar autonomous policy threshold, the agent pauses. 
It stages the transaction in memory bound to the initiator's user I D, preventing multi user channel hijacking. 
When the authorized user types approve, KeeperHub's Turnkey backed signer executes with a persistent idempotency key.

Now watch our centerpiece: The Refusal. 
An attacker tries a prompt injection to drain 50,000 E T H from the agent's wallet. 
A native Eliza agent would sign the transaction, broadcast it blindly, pay gas, and crash its event loop. 
Our bridge routes to KeeperHub's preflight simulator. The simulator detects the balance shortfall and blocks it immediately. 
Notice the output: Transaction blocked at simulation. Insufficient balance. Zero funds moved. Agent loop continuing. 
Zero gas spent. Zero keys exposed. Complete failure recovery.

Finally, autonomy where it actually belongs: micro transfers. 
A small transfer of 0.0001 E T H, worth 25 cents, passes preflight simulation and falls well under our 50 dollar threshold. 
The agent executes autonomously with zero human intervention, logged against our 24 hour rolling velocity cap.

Eliza Keeper Bridge is fully open source, written in strict TypeScript with 18 unit tests, and verified live on Sepolia with zero mocks. 
This is institutional execution infrastructure for the agent economy. Thank you.
"@

Write-Host "Synthesizing voiceover audio..."
$synth.Speak($scriptText)
$synth.Dispose()

$audioItem = Get-Item $audioPath
Write-Host "VOICEOVER_GENERATED: $($audioItem.Length) bytes"
