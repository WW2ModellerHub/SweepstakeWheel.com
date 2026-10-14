import { access, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const noNetwork = process.argv.includes("--no-network");
const dryRun = process.argv.includes("--dry-run");
const now = new Date();
const nowIso = now.toISOString();
const period = nowIso.slice(0, 7);
const dayMs = 86400000;
const eventsPath = path.join(root, "data", "events.json");
const sourcesPath = path.join(root, "data", "event-sources.json");
const healthPath = path.join(root, "data", "health.json");

const events = JSON.parse(await readFile(eventsPath, "utf8"));
const sourceConfig = JSON.parse(await readFile(sourcesPath, "utf8"));
const originalEvents = JSON.stringify(events);
const runSummary = [];

function placeholderOption(value) {
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

function monthDayNumber(value) {
  return Number(String(value || "").replace("-", ""));
}

function refreshIsDue(event, config) {
  if (config.refreshAlways) return true;
  const windows = event.promotion?.windows || [];
  const leadDays = Number(config.refreshLeadDays || 45);
  for (let offset = 0; offset <= leadDays; offset += 1) {
    const probe = new Date(now.getTime() + offset * dayMs);
    const year = probe.getUTCFullYear();
    const today = (probe.getUTCMonth() + 1) * 100 + probe.getUTCDate();
    for (const window of windows) {
      if (Array.isArray(window.years) && !window.years.map(Number).includes(year)) continue;
      const start = monthDayNumber(window.start);
      const end = monthDayNumber(window.end);
      if (start <= end ? today >= start && today <= end : today >= start || today <= end) return true;
    }
  }
  return false;
}

function candidateError(options, config, event, providerMeta = {}) {
  if (!Array.isArray(options)) return "provider did not return an options array";
  const clean = options.map((value) => String(value || "").trim()).filter(Boolean);
  if (clean.length < Number(config.expectedMin || 1)) return `only ${clean.length} entries were returned`;
  if (config.expectedMax && clean.length > Number(config.expectedMax)) return `${clean.length} entries exceeded the configured maximum`;
  if (new Set(clean.map((value) => value.toLocaleLowerCase("en-GB"))).size !== clean.length) return "duplicate entries were returned";
  if (clean.some(placeholderOption)) return "placeholder entries were returned";
  if (clean.some((value) => value.length > 120)) return "an entry was unexpectedly long";

  const requiredEdition = expectedEdition(config);
  if (requiredEdition && String(providerMeta.edition || "") !== requiredEdition) {
    return `edition ${providerMeta.edition || "unknown"} did not match expected edition ${requiredEdition}`;
  }

  const current = (event.options || []).filter((value) => !placeholderOption(value));
  const currentWasConfirmed = event.dataStatus?.status === "confirmed";
  if (currentWasConfirmed && current.length >= 8 && process.env.ALLOW_LARGE_EVENT_REFRESH !== "1") {
    const before = new Set(current.map((value) => value.toLocaleLowerCase("en-GB")));
    const after = new Set(clean.map((value) => value.toLocaleLowerCase("en-GB")));
    const retained = [...before].filter((value) => after.has(value)).length;
    const churn = 1 - retained / Math.max(before.size, after.size);
    if (churn > Number(config.maxChurn ?? 0.8)) return `the candidate changed ${Math.round(churn * 100)}% of the confirmed list`;
  }
  return "";
}

function applyCandidate(event, options, config, providerMeta = {}) {
  const clean = options.map((value) => String(value).trim()).filter(Boolean);
  const error = candidateError(clean, config, event, providerMeta);
  if (error) throw new Error(error);

  const changed = JSON.stringify(clean) !== JSON.stringify(event.options || []);
  if (changed) event.options = clean;
  const checkedAt = providerMeta.checkedAt || nowIso;
  const checkIntervalDays = Number(config.checkIntervalDays || 7);
  const recordCheck = Boolean(providerMeta.checkedAt) || changed || ageInDays(event.dataStatus?.checkedAt) >= checkIntervalDays;
  event.dataStatus = {
    ...(event.dataStatus || {}),
    mode: config.mode,
    status: "confirmed",
    sourceName: providerMeta.sourceName || config.sourceName,
    sourceUrl: providerMeta.sourceUrl || config.sourceUrl,
    edition: providerMeta.edition,
    checkedAt: recordCheck ? checkedAt : event.dataStatus?.checkedAt,
    updatedAt: changed ? checkedAt : event.dataStatus?.updatedAt,
    expectedMin: config.expectedMin,
    expectedMax: config.expectedMax
  };
  Object.keys(event.dataStatus).forEach((key) => event.dataStatus[key] === undefined && delete event.dataStatus[key]);
  return changed;
}

function seedStatus(event, config) {
  if (!config) return;
  const existing = event.dataStatus || {};
  const hasPlaceholders = (event.options || []).some(placeholderOption);
  const status = config.mode === "self-contained"
    ? "self-contained"
    : hasPlaceholders
      ? "template"
      : existing.status || "curated";
  event.dataStatus = {
    ...existing,
    mode: config.mode,
    status,
    sourceName: existing.sourceName || config.sourceName,
    expectedMin: config.expectedMin,
    expectedMax: config.expectedMax
  };
  if (config.mode === "self-contained") {
    delete event.dataStatus.checkedAt;
    delete event.dataStatus.updatedAt;
    delete event.dataStatus.edition;
  }
  Object.keys(event.dataStatus).forEach((key) => event.dataStatus[key] === undefined && delete event.dataStatus[key]);
}

async function readOverride(slug) {
  const file = path.join(root, "data", "overrides", `${slug}.json`);
  try {
    await access(file);
  } catch {
    return null;
  }
  try {
    return { data: JSON.parse(await readFile(file, "utf8")) };
  } catch (error) {
    return { error: `override could not be read: ${error.message}` };
  }
}

function overrideMetadataError(override, config) {
  if (!override || typeof override !== "object" || Array.isArray(override)) return "override must be a JSON object";
  const checkedAt = Date.parse(String(override.checkedAt || ""));
  if (!Number.isFinite(checkedAt)) return "override must include a valid checkedAt date";
  if (checkedAt > now.getTime() + dayMs) return "override checkedAt date is in the future";
  if (override.validUntil && Date.parse(override.validUntil) < now.getTime()) return `override expired on ${override.validUntil}`;
  const maxAge = Number(config.overrideMaxAgeDays || config.maxAgeDays || 90);
  if (ageInDays(override.checkedAt) > maxAge) return `override is older than ${maxAge} days`;
  return "";
}

async function fetchJson(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

async function refreshOpenF1(event, config) {
  const headers = { accept: "application/json", "user-agent": "SweepstakeWheel-site-manager/1.0" };
  const [rows, sessions] = await Promise.all([
    fetchJson("https://api.openf1.org/v1/drivers?session_key=latest", { headers }),
    fetchJson("https://api.openf1.org/v1/sessions?session_key=latest", { headers })
  ]);
  const byNumber = new Map();
  for (const row of rows) {
    const first = String(row.first_name || "").trim();
    const last = String(row.last_name || "").trim();
    const name = `${first} ${last}`.trim() || String(row.full_name || row.broadcast_name || "").trim();
    if (!name || row.driver_number === undefined) continue;
    byNumber.set(Number(row.driver_number), name.replace(/\s+/g, " "));
  }
  const options = [...byNumber.entries()].sort((a, b) => a[0] - b[0]).map(([, name]) => name);
  return applyCandidate(event, options, config, {
    sourceName: "OpenF1",
    sourceUrl: "https://openf1.org/docs/",
    edition: String(sessions?.[0]?.date_start || "").slice(0, 4)
  });
}

async function refreshFootball(event, config, apiKey) {
  const url = `https://api.football-data.org/v4/competitions/${encodeURIComponent(config.competitionCode)}/teams`;
  const payload = await fetchJson(url, { headers: { accept: "application/json", "X-Auth-Token": apiKey } });
  const options = (payload.teams || []).map((team) => team.name);
  return applyCandidate(event, options, config, {
    sourceName: "football-data.org",
    sourceUrl: "https://www.football-data.org/documentation/quickstart",
    edition: payload.season?.startDate?.slice(0, 4) || ""
  });
}

for (const event of events) {
  const config = sourceConfig.events[event.slug];
  seedStatus(event, config);
  if (!config) continue;

  const overrideRecord = await readOverride(event.slug);
  if (overrideRecord) {
    const metadataError = overrideRecord.error || overrideMetadataError(overrideRecord.data, config);
    if (metadataError) {
      runSummary.push({ slug: event.slug, provider: "override", result: "override-rejected", reason: metadataError });
    } else {
      try {
        const override = overrideRecord.data;
        const changed = applyCandidate(event, override.options, config, {
          sourceName: override.sourceName || "Reviewed local override",
          sourceUrl: override.sourceUrl,
          edition: override.edition,
          checkedAt: new Date(override.checkedAt).toISOString()
        });
        runSummary.push({ slug: event.slug, provider: "override", result: changed ? "updated" : "verified" });
        continue;
      } catch (error) {
        runSummary.push({ slug: event.slug, provider: "override", result: "override-rejected", reason: error.message });
      }
    }
  }

  if (noNetwork) continue;
  if (String(config.mode).startsWith("automatic") && !refreshIsDue(event, config)) {
    runSummary.push({ slug: event.slug, provider: config.provider, result: "out-of-season" });
    continue;
  }
  try {
    if (config.provider === "openf1") {
      const changed = await refreshOpenF1(event, config);
      runSummary.push({ slug: event.slug, provider: "openf1", result: changed ? "updated" : "verified" });
    } else if (config.provider === "football-data" && process.env.FOOTBALL_DATA_API_KEY) {
      const changed = await refreshFootball(event, config, process.env.FOOTBALL_DATA_API_KEY);
      runSummary.push({ slug: event.slug, provider: "football-data", result: changed ? "updated" : "verified" });
    } else if (config.provider === "football-data") {
      runSummary.push({ slug: event.slug, provider: "football-data", result: "waiting-for-api-key" });
    }
  } catch (error) {
    runSummary.push({ slug: event.slug, provider: config.provider, result: "provider-failed", reason: error.message, retainedLastKnownGood: true });
  }
}

let previousHealth = {};
try {
  previousHealth = JSON.parse(await readFile(healthPath, "utf8"));
} catch {}
const failureResults = new Set(["provider-failed", "override-rejected"]);
const failures = runSummary.filter((item) => failureResults.has(item.result));
const waitingForCredentials = runSummary.some((item) => item.result === "waiting-for-api-key");
const overallStatus = failures.length ? "attention" : waitingForCredentials ? "partial" : "healthy";
const summaryChanged = JSON.stringify(previousHealth.lastRunSummary || []) !== JSON.stringify(runSummary);
const healthChanged = !noNetwork && (
  previousHealth.period !== period ||
  previousHealth.overallStatus !== overallStatus ||
  summaryChanged
);
const health = healthChanged ? {
  ...previousHealth,
  period,
  overallStatus,
  lastRunRecordedAt: nowIso,
  lastSuccessfulRun: failures.length ? previousHealth.lastSuccessfulRun : nowIso,
  lastFailedRun: failures.length ? nowIso : previousHealth.lastFailedRun,
  policy: "Last-known-good event data is retained when a provider fails validation, and failures are surfaced in the maintained review issue.",
  automaticProviders: ["OpenF1", "football-data.org when FOOTBALL_DATA_API_KEY is configured"],
  lastRunSummary: runSummary
} : previousHealth;
Object.keys(health).forEach((key) => health[key] === undefined && delete health[key]);

const eventsChanged = JSON.stringify(events) !== originalEvents;
if (!dryRun && eventsChanged) await writeFile(eventsPath, `${JSON.stringify(events, null, 2)}\n`, "utf8");
if (!dryRun && healthChanged) await writeFile(healthPath, `${JSON.stringify(health, null, 2)}\n`, "utf8");

for (const failure of failures) console.warn(`ATTENTION: ${failure.slug} ${failure.provider}: ${failure.reason}`);
console.log(JSON.stringify({ eventsChanged, healthChanged, overallStatus, dryRun, runSummary }, null, 2));
