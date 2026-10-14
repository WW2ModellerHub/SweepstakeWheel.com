import { appendFile, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const events = JSON.parse(await readFile(path.join(root, "data", "events.json"), "utf8"));
const sources = JSON.parse(await readFile(path.join(root, "data", "event-sources.json"), "utf8"));
let health = {};
try {
  health = JSON.parse(await readFile(path.join(root, "data", "health.json"), "utf8"));
} catch {}

const leadDays = Number(process.env.REVIEW_LEAD_DAYS || 45);
const now = new Date();
const dayMs = 86400000;

function dateParts(date) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date).filter((part) => part.type !== "literal").map((part) => [part.type, Number(part.value)]));
  return { year: parts.year, monthDay: parts.month * 100 + parts.day };
}

function monthDay(value) {
  const [month, day] = String(value || "").split("-").map(Number);
  return month * 100 + day;
}

function windowActive(window, date) {
  if (Array.isArray(window.years) && !window.years.map(Number).includes(date.year)) return false;
  const start = monthDay(window.start);
  const end = monthDay(window.end);
  return start <= end
    ? date.monthDay >= start && date.monthDay <= end
    : date.monthDay >= start || date.monthDay <= end;
}

function eventIsRelevant(event) {
  const windows = event.promotion?.windows || [];
  for (let offset = 0; offset <= leadDays; offset += 1) {
    const date = new Date(now.getTime() + offset * dayMs);
    if (windows.some((window) => windowActive(window, dateParts(date)))) return true;
  }
  return false;
}

function placeholder(value) {
  return /^(?:player|contestant|campmate|horse|runner|gift|square|option)\s*\d+$/i.test(String(value || "").trim());
}

function ageInDays(value) {
  const timestamp = Date.parse(String(value || ""));
  return Number.isFinite(timestamp) ? Math.max(0, (now.getTime() - timestamp) / dayMs) : Number.POSITIVE_INFINITY;
}

function expectedEdition(config) {
  if (config.editionRule === "fixed") return String(config.expectedEdition || "");
  if (config.editionRule === "cycle-year") {
    const cycle = Number(config.editionCycleYears || 4);
    let edition = Number(config.editionAnchor);
    const switchAfter = Number(String(config.editionSwitchAfter || "12-31").replace("-", ""));
    const today = (now.getUTCMonth() + 1) * 100 + now.getUTCDate();
    while (edition < now.getUTCFullYear() || (edition === now.getUTCFullYear() && today > switchAfter)) edition += cycle;
    return String(edition);
  }
  if (config.editionRule === "calendar-year") return String(now.getUTCFullYear());
  if (config.editionRule === "season-start-year") {
    return String(now.getUTCMonth() >= 6 ? now.getUTCFullYear() : now.getUTCFullYear() - 1);
  }
  return "";
}

const latestProviderState = new Map();
const providerAlerts = new Map();
for (const item of health.lastRunSummary || []) {
  latestProviderState.set(item.slug, item);
  if (item.result === "provider-failed" || item.result === "override-rejected") {
    const current = providerAlerts.get(item.slug) || [];
    current.push(item);
    providerAlerts.set(item.slug, current);
  }
}

const review = [];
for (const event of events) {
  const config = sources.events?.[event.slug];
  if (!config || config.mode === "self-contained") continue;

  const reasons = [];
  const relevant = eventIsRelevant(event);
  const status = event.dataStatus || {};
  const providerState = latestProviderState.get(event.slug);
  const configuredMaxAge = Number(config.maxAgeDays || 30);

  if (relevant && (event.options || []).some(placeholder)) {
    reasons.push("the published list still contains placeholders");
  }

  if (relevant && config.mode === "review-required") {
    if (status.status !== "confirmed") {
      reasons.push("a reviewed current list has not been confirmed");
    } else if (ageInDays(status.checkedAt) > configuredMaxAge) {
      reasons.push(`the reviewed list is older than ${configuredMaxAge} days`);
    }
  }

  if (relevant && String(config.mode).startsWith("automatic")) {
    if (ageInDays(status.checkedAt) > configuredMaxAge) {
      reasons.push(`the automatic source has not been verified within ${configuredMaxAge} days`);
    }
    const requiredEdition = expectedEdition(config);
    if (requiredEdition && String(status.edition || "") !== requiredEdition) {
      reasons.push(`edition ${status.edition || "unknown"} does not match expected edition ${requiredEdition}`);
    }
    if (providerState?.result === "waiting-for-api-key") {
      reasons.push("the automatic football source is waiting for FOOTBALL_DATA_API_KEY");
    }
  }

  for (const alert of providerAlerts.get(event.slug) || []) {
    reasons.push(`${alert.provider} failed: ${alert.reason || "unknown error"}`);
  }

  if (reasons.length) review.push({ event, reasons: [...new Set(reasons)] });
}

const report = [
  "## Event data review needed",
  "",
  `The automated maintenance check found ${review.length} event${review.length === 1 ? "" : "s"} needing attention. Last-known-good public data remains in place until a replacement passes validation.`,
  "",
  ...review.flatMap(({ event, reasons }) => [
    `- [ ] **${event.name}**`,
    ...reasons.map((reason) => `  - ${reason}`)
  ]),
  "",
  "Resolve an item by restoring its approved provider, updating its edition configuration, or adding a reviewed `data/overrides/<event-slug>.json` with `checkedAt`. This issue is maintained by the scheduled workflow."
].join("\n");

let reportPath = "";
if (process.env.RUNNER_TEMP) {
  reportPath = path.join(process.env.RUNNER_TEMP, "event-review.md");
  await writeFile(reportPath, `${report}\n`, "utf8");
}
if (process.env.GITHUB_OUTPUT) {
  await appendFile(process.env.GITHUB_OUTPUT, `needs_review=${review.length ? "true" : "false"}\n`, "utf8");
  await appendFile(process.env.GITHUB_OUTPUT, `slugs=${review.map(({ event }) => event.slug).join(",")}\n`, "utf8");
  if (reportPath) await appendFile(process.env.GITHUB_OUTPUT, `report_path=${reportPath}\n`, "utf8");
}

console.log(report);
