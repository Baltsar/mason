import { copyFile, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import { paths } from "../src/store.mjs";

const targets = [
  { source: path.join(paths.root, "native", "ApprenticeReader.swift"), output: paths.reader, frameworks: [] },
  { source: path.join(paths.root, "native", "MasonIcons.swift"), output: paths.icons, frameworks: ["-framework", "AppKit"] },
  { source: path.join(paths.root, "native", "ApprenticeApp.swift"), output: paths.status, frameworks: ["-framework", "AppKit", "-framework", "WebKit"], bundle: true },
];

// The app carries the version the package has, so that the two never say different things.
const { version } = JSON.parse(await readFile(path.join(paths.root, "package.json"), "utf8"));

// Mason.app is what is double-clicked. It knows where this folder is and
// which Node to run, starts the local server itself, and has the usage texts
// macOS shows when it asks for the microphone and for the Documents folder.
const infoPlist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>Mason</string>
  <key>CFBundleDisplayName</key><string>Mason</string>
  <key>CFBundleIdentifier</key><string>design.headless.apprentice</string>
  <key>CFBundleExecutable</key><string>Mason</string>
  <key>CFBundleIconFile</key><string>AppIcon</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>${version}</string>
  <key>CFBundleVersion</key><string>3</string>
  <key>LSMinimumSystemVersion</key><string>13.0</string>
  <key>NSHighResolutionCapable</key><true/>
  <key>ApprenticeRoot</key><string>${paths.root}</string>
  <key>ApprenticeNode</key><string>${process.execPath}</string>
  <key>NSMicrophoneUsageDescription</key><string>Mason listens when you answer a question or take the debrief call.</string>
  <key>NSDocumentsFolderUsageDescription</key><string>Mason runs from a folder in Documents and keeps its memory there.</string>
  <key>NSAppTransportSecurity</key>
  <dict>
    <key>NSAllowsLocalNetworking</key><true/>
    <key>NSAllowsArbitraryLoadsInWebContent</key><true/>
  </dict>
</dict>
</plist>
`;

const run = (command, args) => new Promise((resolve, reject) => {
  const child = spawn(command, args, { stdio: "inherit" });
  child.once("error", reject);
  child.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`${command} exited with ${code}`)));
});

// The file icon: the app draws its own mark, which is then cut to every size.
async function makeIcon() {
  const resources = path.join(paths.app, "Contents", "Resources");
  const iconset = path.join(paths.root, ".runtime", "AppIcon.iconset");
  const master = path.join(paths.root, ".runtime", "icon-1024.png");
  await mkdir(resources, { recursive: true });
  // The app draws its icon from the mark, so the pictures go in first.
  for (const picture of ["mason-mark.png", "mason-work.png"]) await copyFile(path.join(paths.root, "native", picture), path.join(resources, picture));
  await rm(iconset, { recursive: true, force: true });
  await mkdir(iconset, { recursive: true });
  await run(paths.status, ["--icon", master]);
  for (const size of [16, 32, 128, 256, 512]) {
    await run("sips", ["-z", String(size), String(size), master, "--out", path.join(iconset, `icon_${size}x${size}.png`)]);
    await run("sips", ["-z", String(size * 2), String(size * 2), master, "--out", path.join(iconset, `icon_${size}x${size}@2x.png`)]);
  }
  await run("iconutil", ["-c", "icns", iconset, "-o", path.join(resources, "AppIcon.icns")]);
}

await mkdir(path.dirname(paths.reader), { recursive: true });

for (const target of targets) {
  let needsBuild = true;
  try {
    const [src, bin] = await Promise.all([stat(target.source), stat(target.output)]);
    needsBuild = src.mtimeMs > bin.mtimeMs;
  } catch {}
  if (!needsBuild) continue;
  await mkdir(path.dirname(target.output), { recursive: true });
  // Without a target the compiler aims at its own SDK version, which can be
  // newer than the system; macOS then refuses to open the app by double-click.
  const target_ = process.arch === "arm64" ? "arm64-apple-macos13.0" : "x86_64-apple-macos13.0";
  await run("swiftc", ["-O", "-target", target_, target.source, ...target.frameworks, "-o", target.output]);
  if (!target.bundle) continue;
  await writeFile(path.join(paths.app, "Contents", "Info.plist"), infoPlist);
  await makeIcon().catch((error) => console.warn(`Icon not made: ${error.message}`));
  // Ad-hoc signing ties the Info.plist to the binary. The app still runs if it fails.
  await run("codesign", ["--force", "--sign", "-", paths.app]).catch(() => {});
}
