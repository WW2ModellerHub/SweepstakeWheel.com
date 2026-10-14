import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const checkOnly = process.argv.includes("--check");
const migrateScaffolding = process.argv.includes("--migrate");
const eventsPath = path.join(root, "data", "events.json");
const fallbackPath = path.join(root, "assets", "events-fallback.js");
const appPath = path.join(root, "assets", "app.js");

const events = JSON.parse(await readFile(eventsPath, "utf8"));
const generatedFallback = `/* Generated from data/events.json by scripts/build-derived.mjs. */\nwindow.SWEEPSTAKE_EVENTS_FALLBACK = ${JSON.stringify(events)};\n`;

async function assertOrWrite(file, expected) {
  let actual = "";
  try {
    actual = await readFile(file, "utf8");
  } catch {}
  if (actual === expected) return false;
  if (checkOnly) throw new Error(`${path.relative(root, file)} is out of date. Run node scripts/build-derived.mjs.`);
  await writeFile(file, expected, "utf8");
  return true;
}

let changed = await assertOrWrite(fallbackPath, generatedFallback);

let appSource = await readFile(appPath, "utf8");
const migratedApp = appSource.replace(
  /const EVENTS_FALLBACK = \[[\s\S]*?\];\r?\n\r?\nlet events = EVENTS_FALLBACK;/,
  "const EVENTS_FALLBACK = window.SWEEPSTAKE_EVENTS_FALLBACK || [];\n\nlet events = EVENTS_FALLBACK;"
);
if (migratedApp !== appSource) {
  if (!migrateScaffolding) throw new Error("assets/app.js still contains the embedded event fallback. Run node scripts/build-derived.mjs --migrate once, then commit the scaffold change.");
  await writeFile(appPath, migratedApp, "utf8");
  appSource = migratedApp;
  changed = true;
}

async function htmlFiles(directory) {
  const output = [];
  for (const entry of await readdir(directory)) {
    if ([".git", "node_modules"].includes(entry)) continue;
    const full = path.join(directory, entry);
    const info = await stat(full);
    if (info.isDirectory()) output.push(...await htmlFiles(full));
    else if (entry.endsWith(".html")) output.push(full);
  }
  return output;
}

for (const file of await htmlFiles(root)) {
  const html = await readFile(file, "utf8");
  if (!html.includes('<script src="/assets/app.js"></script>')) continue;
  if (html.includes('<script src="/assets/events-fallback.js"></script>')) continue;
  if (!migrateScaffolding) throw new Error(`${path.relative(root, file)} is missing the generated fallback script. Run node scripts/build-derived.mjs --migrate once, then commit the scaffold change.`);
  const updated = html.replace(
    '<script src="/assets/app.js"></script>',
    '<script src="/assets/events-fallback.js"></script>\n<script src="/assets/app.js"></script>'
  );
  await writeFile(file, updated, "utf8");
  changed = true;
}

console.log(changed ? "Derived files updated." : "Derived files already current.");
