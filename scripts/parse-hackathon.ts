import * as fs from "fs";

const html = fs.readFileSync("C:\\Users\\HP LAPTOP\\.gemini\\antigravity\\brain\\960dce65-45e8-4410-a550-fc286ad84c55\\.system_generated\\steps\\388\\content.md", "utf8");

// Search for __NUXT_DATA__
const match = html.match(/<script type="application\/json" id="__NUXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
if (match) {
  const jsonStr = match[1];
  try {
    const data = JSON.parse(jsonStr);
    console.log("Parsed NUXT data length:", data.length);
    // Find strings containing "bounty" or "track" or "Prize" or "description"
    for (const item of data) {
      if (typeof item === "string" && (item.includes("The theme") || item.includes("bounty") || item.includes("Track") || item.includes("Bounty"))) {
        console.log("\n--- FOUND TEXT ---");
        console.log(item.slice(0, 4000));
      }
    }
  } catch (e) {
    console.error("JSON parse error:", e);
  }
} else {
  console.log("No NUXT_DATA match found");
}
