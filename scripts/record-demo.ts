import { chromium } from "playwright-core";
import * as path from "path";
import * as fs from "fs";
import { execSync } from "child_process";

const EDGE_PATH = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const FFMPEG_PATH = path.resolve(process.cwd(), "node_modules", "ffmpeg-static", "ffmpeg.exe");

async function record() {
  console.log("==========================================================");
  console.log("   AUTOMATED 1080P DEMO RECORDER WITH SYNCHRONIZED AUDIO  ");
  console.log("==========================================================\n");

  const outputDir = path.resolve(process.cwd(), "videos");
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const voiceoverPath = path.resolve(outputDir, "voiceover.wav");
  if (!fs.existsSync(voiceoverPath)) {
    console.log("🎙️ voiceover.wav not found. Generating voiceover via PowerShell...");
    execSync("powershell -ExecutionPolicy Bypass -File scripts/generate-voiceover.ps1", {
      stdio: "inherit",
    });
  } else {
    const voStats = fs.statSync(voiceoverPath);
    console.log(`🎙️ Using existing voiceover: ${voiceoverPath} (${(voStats.size / 1024 / 1024).toFixed(2)} MB)`);
  }

  console.log("\n🎥 Launching Chromium/Edge headless browser at 1920x1080...");
  const browser = await chromium.launch({
    executablePath: EDGE_PATH,
    headless: true,
    args: ["--window-size=1920,1080", "--disable-gpu", "--no-sandbox"],
  });

  const rawDir = path.resolve(outputDir, "raw");
  if (!fs.existsSync(rawDir)) fs.mkdirSync(rawDir, { recursive: true });

  const context = await browser.newContext({
    recordVideo: {
      dir: rawDir,
      size: { width: 1920, height: 1080 },
    },
    viewport: { width: 1920, height: 1080 },
  });

  const page = await context.newPage();
  const htmlPath = path.resolve(process.cwd(), "scripts", "demo-ui.html");
  const fileUrl = `file:///${htmlPath.replace(/\\/g, "/")}`;

  console.log(`🎬 Navigating to demo timeline: ${fileUrl}`);
  await page.goto(fileUrl);

  const RECORDING_MS = 153500; // 153.5 seconds (full 151.21s script + outro)
  console.log(`⏳ Recording presentation in real-time (${(RECORDING_MS / 1000).toFixed(1)}s)...`);

  // Progress heartbeat every 30s
  const interval = setInterval(() => {
    console.log("   ...recording live frames...");
  }, 30000);

  await page.waitForTimeout(RECORDING_MS);
  clearInterval(interval);

  console.log("\n💾 Flushing video stream and closing browser...");
  await page.close();
  await context.close();
  await browser.close();

  // Locate the generated raw recording
  const rawFiles = fs.readdirSync(rawDir).filter((f) => f.endsWith(".webm"));
  if (rawFiles.length === 0) {
    throw new Error("No raw webm file was produced by Playwright.");
  }

  const rawWebmPath = path.join(rawDir, rawFiles[rawFiles.length - 1]);
  console.log(`📹 Raw video captured: ${rawWebmPath}`);

  // FFmpeg Muxing
  const mp4Output = path.resolve(outputDir, "eliza-keeper-demo.mp4");
  const webmOutput = path.resolve(outputDir, "eliza-keeper-demo.webm");

  console.log("\n🎛️ Muxing video and synchronized voiceover with FFmpeg...");
  console.log(`   FFmpeg binary: ${FFMPEG_PATH}`);

  // 1. Generate MP4 (H.264 + AAC, universally compatible)
  console.log("   -> Encoding MP4 (libx264 + aac)...");
  const mp4Cmd = `"${FFMPEG_PATH}" -y -i "${rawWebmPath}" -i "${voiceoverPath}" -c:v libx264 -preset fast -crf 20 -pix_fmt yuv420p -c:a aac -b:a 192k -shortest "${mp4Output}"`;
  execSync(mp4Cmd, { stdio: "inherit" });

  // 2. Generate WebM (VP8/VP9 + Opus, high compression)
  console.log("   -> Encoding WebM (copy/opus)...");
  const webmCmd = `"${FFMPEG_PATH}" -y -i "${rawWebmPath}" -i "${voiceoverPath}" -c:v copy -c:a libopus -b:a 128k -shortest "${webmOutput}"`;
  execSync(webmCmd, { stdio: "inherit" });

  // Cleanup raw directory
  try {
    fs.unlinkSync(rawWebmPath);
    fs.rmdirSync(rawDir);
  } catch (e) {
    // ignore cleanup errors
  }

  const mp4Stats = fs.statSync(mp4Output);
  const webmStats = fs.statSync(webmOutput);

  console.log("\n==========================================================");
  console.log("   🎉 DEMO VIDEO GENERATION COMPLETE!                     ");
  console.log("==========================================================");
  console.log(`📁 MP4 Video: ${mp4Output}`);
  console.log(`   - Size: ${(mp4Stats.size / 1024 / 1024).toFixed(2)} MB`);
  console.log(`   - Codec: H.264 / AAC (1080p Full HD)`);
  console.log(`   - Duration: ~2 minutes 31 seconds`);
  console.log(`📁 WebM Video: ${webmOutput}`);
  console.log(`   - Size: ${(webmStats.size / 1024 / 1024).toFixed(2)} MB`);
  console.log(`\n🏆 Ready for upload to DoraHacks, YouTube, or Loom!`);
}

record().catch((err) => {
  console.error("❌ Recording error:", err);
  process.exit(1);
});
