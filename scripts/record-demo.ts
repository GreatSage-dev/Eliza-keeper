import { chromium } from "playwright-core";
import * as path from "path";
import * as fs from "fs";

const EDGE_PATH = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";

async function record() {
  console.log("==========================================================");
  console.log("   AUTOMATED 1080P DEMO VIDEO RECORDER (PLAYWRIGHT)       ");
  console.log("==========================================================\n");

  const outputDir = path.resolve(process.cwd(), "videos");
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  console.log("🎥 Launching Chromium/Edge headless browser...");
  const browser = await chromium.launch({
    executablePath: EDGE_PATH,
    headless: true,
    args: ["--window-size=1920,1080"],
  });

  const context = await browser.newContext({
    recordVideo: {
      dir: outputDir,
      size: { width: 1920, height: 1080 },
    },
    viewport: { width: 1920, height: 1080 },
  });

  const page = await context.newPage();
  const htmlPath = path.resolve(process.cwd(), "scripts", "demo-ui.html");
  const fileUrl = `file:///${htmlPath.replace(/\\/g, "/")}`;

  console.log(`🎬 Recording demo presentation from: ${fileUrl}`);
  await page.goto(fileUrl);

  // Allow the automated scenarios to play out with pauses
  console.log("⏳ Recording live scenarios (Scenario 1, Scenario 2, Scenario 3)...");
  await page.waitForTimeout(22000); // 22 seconds covers full playback cleanly

  console.log("💾 Finalizing video stream...");
  await page.close();
  await context.close();
  await browser.close();

  // Find the generated video and rename it
  const files = fs.readdirSync(outputDir).filter(f => f.endsWith(".webm"));
  if (files.length > 0) {
    const latestVideo = files[files.length - 1];
    const oldPath = path.join(outputDir, latestVideo);
    const newPath = path.join(outputDir, "eliza-keeper-demo.webm");
    if (oldPath !== newPath) {
      if (fs.existsSync(newPath)) fs.unlinkSync(newPath);
      fs.renameSync(oldPath, newPath);
    }
    const stats = fs.statSync(newPath);
    console.log(`\n✅ VIDEO RECORDING COMPLETE!`);
    console.log(`📁 File saved to: ${newPath}`);
    console.log(`📊 Size: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);
    console.log(`📺 Resolution: 1920x1080 Full HD (Ready for DoraHacks / YouTube / Loom)`);
  } else {
    console.log("⚠️ No video file detected in videos directory.");
  }
}

record().catch(console.error);
