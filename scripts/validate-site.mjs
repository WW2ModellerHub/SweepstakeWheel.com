import { createRequire } from "node:module";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const errors = [];
const warnings = [];
const require = createRequire(import.meta.url);

function fail(message) { errors.push(message); }
function warn(message) { warnings.push(message); }

function schemaTypeMatches(value, type) {
  if (type === "array") return Array.isArray(value);
  if (type === "object") return value !== null && typeof value === "object" && !Array.isArray(value);
  if (type === "integer") return Number.isInteger(value);
  if (type === "number") return typeof value === "number" && Number.isFinite(value);
  return typeof value === type;
}

function validateJsonSchema(value, schema, pointer = "$") {
  if (schema.type && !schemaTypeMatches(value, schema.type)) {
    fail(`${pointer} must be ${schema.type}.`);
    return;
  }
  if (schema.enum && !schema.enum.includes(value)) fail(`${pointer} must be one of: ${schema.enum.join(", ")}.`);
  if (typeof value === "string") {
    if (schema.minLength && value.length < schema.minLength) fail(`${pointer} is shorter than ${schema.minLength} characters.`);
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) fail(`${pointer} does not match ${schema.pattern}.`);
    if (schema.format === "date-time" && (!value.includes("T") || !Number.isFinite(Date.parse(value)))) fail(`${pointer} is not a valid date-time.`);
    if (schema.format === "uri") {
      try { new URL(value); } catch { fail(`${pointer} is not a valid URI.`); }
    }
  }
  if (Array.isArray(value)) {
    if (schema.minItems && value.length < schema.minItems) fail(`${pointer} must contain at least ${schema.minItems} item(s).`);
    if (schema.uniqueItems && new Set(value.map((item) => JSON.stringify(item))).size !== value.length) fail(`${pointer} must contain unique items.`);
    if (schema.items) value.forEach((item, index) => validateJsonSchema(item, schema.items, `${pointer}[${index}]`));
  }
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    for (const key of schema.required || []) {
      if (!Object.hasOwn(value, key)) fail(`${pointer}.${key} is required.`);
    }
    for (const [key, childSchema] of Object.entries(schema.properties || {})) {
      if (Object.hasOwn(value, key)) validateJsonSchema(value[key], childSchema, `${pointer}.${key}`);
    }
  }
}

function validMonthDay(value) {
  const match = /^(\d{2})-(\d{2})$/.exec(String(value || ""));
  if (!match) return false;
  const month = Number(match[1]);
  const day = Number(match[2]);
  if (month < 1 || month > 12 || day < 1) return false;
  return day <= new Date(Date.UTC(2024, month, 0)).getUTCDate();
}

async function exists(relative) {
  try {
    await stat(path.join(root, relative));
    return true;
  } catch {
    return false;
  }
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

for (const required of [
  "index.html",
  "assets/app.js",
  "assets/styles.css",
  "assets/secret-santa.js",
  "assets/events-fallback.js",
  "data/events.json",
  "data/event-sources.json",
  "data/health.json",
  "data/schema/events.schema.json",
  "sitemap.xml",
  "robots.txt"
]) {
  if (!await exists(required)) fail(`Missing required file: ${required}`);
}

const events = JSON.parse(await readFile(path.join(root, "data", "events.json"), "utf8"));
const sources = JSON.parse(await readFile(path.join(root, "data", "event-sources.json"), "utf8"));
const eventsSchema = JSON.parse(await readFile(path.join(root, "data", "schema", "events.schema.json"), "utf8"));
validateJsonSchema(events, eventsSchema, "data/events.json");
if (!Array.isArray(events) || !events.length) fail("data/events.json must be a non-empty array.");

const slugs = new Set();
for (const event of events) {
  if (!event.slug || slugs.has(event.slug)) fail(`Invalid or duplicate event slug: ${event.slug || "(missing)"}`);
  slugs.add(event.slug);
  if (!Array.isArray(event.options)) fail(`${event.slug} options must be an array.`);
  if (event.mode !== "private-name-draw" && !(event.options || []).length) fail(`${event.slug} must have at least one option.`);
  const optionKeys = (event.options || []).map((value) => String(value).trim().toLocaleLowerCase("en-GB"));
  if (new Set(optionKeys).size !== optionKeys.length) fail(`${event.slug} contains duplicate options.`);
  if (event.promotion && !Array.isArray(event.promotion.windows)) fail(`${event.slug} promotion windows must be an array.`);
  for (const [index, window] of (event.promotion?.windows || []).entries()) {
    if (!validMonthDay(window.start) || !validMonthDay(window.end)) fail(`${event.slug} promotion window ${index + 1} has an invalid month/day.`);
  }
  if (!sources.events[event.slug]) fail(`${event.slug} is missing from data/event-sources.json.`);
  if ((event.options || []).some((value) => /^(player|contestant|campmate|horse|runner)\s*\d+$/i.test(value))) {
    warn(`${event.slug} still contains placeholder entries; the freshness workflow will raise a review issue when its season approaches.`);
  }
}

const allowedModes = new Set(["automatic", "automatic-when-key-present", "review-required", "self-contained"]);
const allowedProviders = new Set(["openf1", "football-data", "licensed-tennis-feed", "licensed-racing-feed", "official-announcements", "browser"]);
const sourceSlugs = Object.keys(sources.events || {});
for (const slug of sourceSlugs) {
  if (!slugs.has(slug)) fail(`data/event-sources.json has an unknown event: ${slug}.`);
  const config = sources.events[slug];
  if (!allowedModes.has(config.mode)) fail(`${slug} has an invalid source mode: ${config.mode}.`);
  if (!allowedProviders.has(config.provider)) fail(`${slug} has an invalid provider: ${config.provider}.`);
  if (config.mode === "self-contained" && config.provider !== "browser") fail(`${slug} self-contained events must use the browser provider.`);
  if (config.mode === "automatic" && config.provider !== "openf1") fail(`${slug} automatic mode must use the approved OpenF1 provider.`);
  if (config.mode === "automatic-when-key-present" && (config.provider !== "football-data" || !config.competitionCode)) {
    fail(`${slug} conditional automatic mode requires football-data and a competitionCode.`);
  }
  if (config.mode !== "self-contained") {
    if (!Number.isFinite(config.expectedMin) || !Number.isFinite(config.expectedMax) || config.expectedMin < 1 || config.expectedMax < config.expectedMin) {
      fail(`${slug} has an invalid expected entry range.`);
    }
    if (!Number.isFinite(config.maxAgeDays) || config.maxAgeDays < 1) fail(`${slug} must define a positive maxAgeDays.`);
  }
  if (config.checkIntervalDays && config.checkIntervalDays > config.maxAgeDays) fail(`${slug} checkIntervalDays exceeds maxAgeDays.`);
  if (config.refreshAlways !== undefined && typeof config.refreshAlways !== "boolean") fail(`${slug} refreshAlways must be a boolean.`);
  if (config.refreshLeadDays !== undefined && (!Number.isInteger(config.refreshLeadDays) || config.refreshLeadDays < 0)) fail(`${slug} refreshLeadDays must be a non-negative integer.`);
  if (config.editionRule && !["fixed", "cycle-year", "calendar-year", "season-start-year"].includes(config.editionRule)) fail(`${slug} has an invalid editionRule.`);
  if (config.editionRule === "fixed" && (!config.expectedEdition || !/^\d{4}$/.test(String(config.expectedEdition)))) {
    fail(`${slug} fixed edition rules require a four-digit expectedEdition.`);
  }
  if (config.editionRule === "cycle-year") {
    if (!Number.isInteger(config.editionAnchor) || !Number.isInteger(config.editionCycleYears) || config.editionCycleYears < 1) {
      fail(`${slug} cycle-year rules require integer editionAnchor and editionCycleYears values.`);
    }
    if (!validMonthDay(config.editionSwitchAfter)) fail(`${slug} cycle-year rules require a valid editionSwitchAfter month/day.`);
  }
  if (config.editionReviewAfter && !/^\d{4}-\d{2}-\d{2}$/.test(config.editionReviewAfter)) fail(`${slug} has an invalid editionReviewAfter date.`);
}

const expectedFallback = `/* Generated from data/events.json by scripts/build-derived.mjs. */\nwindow.SWEEPSTAKE_EVENTS_FALLBACK = ${JSON.stringify(events)};\n`;
const fallback = await readFile(path.join(root, "assets", "events-fallback.js"), "utf8");
if (fallback !== expectedFallback) fail("assets/events-fallback.js is not synchronized with data/events.json.");

const app = await readFile(path.join(root, "assets", "app.js"), "utf8");
if (/buymeacoffee|office results pack|paid export|542346/i.test(app)) fail("assets/app.js still contains the retired paid office-pack offer.");
if (/const EVENTS_FALLBACK = \[/.test(app)) fail("assets/app.js still embeds a duplicate event dataset.");
if (!app.includes("window.SWEEPSTAKE_EVENTS_FALLBACK")) fail("assets/app.js does not use the generated event fallback.");

const pages = await htmlFiles(root);
let jsonLdCount = 0;
let amazonLinkCount = 0;
for (const file of pages) {
  const relative = path.relative(root, file).replaceAll("\\", "/");
  const html = await readFile(file, "utf8");
  if (/buymeacoffee|office results pack|paid export|542346/i.test(html)) fail(`${relative} still contains the retired paid office-pack offer.`);
  const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]);
  const duplicateIds = ids.filter((id, index) => ids.indexOf(id) !== index);
  if (duplicateIds.length) fail(`${relative} contains duplicate ids: ${[...new Set(duplicateIds)].join(", ")}`);

  for (const match of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
    try {
      JSON.parse(match[1]);
      jsonLdCount += 1;
    } catch (error) {
      fail(`${relative} has invalid JSON-LD: ${error.message}`);
    }
  }

  const amazonAnchors = [...html.matchAll(/<a\b([^>]*href="https:\/\/www\.amazon\.co\.uk\/[^"]+"[^>]*)>([\s\S]*?)<\/a>/g)];
  if (!amazonAnchors.length) continue;
  amazonLinkCount += amazonAnchors.length;
  const disclosure = "As an Amazon Associate I earn from qualifying purchases.";
  if (!html.includes(disclosure)) fail(`${relative} has Amazon links without the required Associate statement.`);
  const firstAmazon = html.indexOf("https://www.amazon.co.uk/");
  const paidDisclosure = Math.max(html.lastIndexOf("Paid links", firstAmazon), html.lastIndexOf("paid links", firstAmazon));
  if (paidDisclosure < 0) fail(`${relative} needs a conspicuous paid-link disclosure before its first Amazon link.`);

  for (const [, attributes, body] of amazonAnchors) {
    const href = attributes.match(/href="([^"]+)"/)?.[1]?.replaceAll("&amp;", "&");
    const rel = attributes.match(/rel="([^"]+)"/)?.[1]?.split(/\s+/) || [];
    try {
      const url = new URL(href);
      if (url.hostname !== "www.amazon.co.uk") fail(`${relative} has an unapproved Amazon host.`);
      if (url.searchParams.get("tag") !== "sweepstakewheel-21") fail(`${relative} has an Amazon link with the wrong tracking tag.`);
    } catch {
      fail(`${relative} has an invalid Amazon URL.`);
    }
    for (const token of ["sponsored", "nofollow", "noopener"]) {
      if (!rel.includes(token)) fail(`${relative} Amazon link is missing rel=${token}.`);
    }
    const label = body.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    if (!/amazon/i.test(label)) fail(`${relative} Amazon destination is not explicit in link text: ${label}`);
  }
}

const index = await readFile(path.join(root, "index.html"), "utf8");
if (!index.includes("SWEEPSTAKEWHEEL_V2_FULL_REBUILD")) fail("index.html is missing the rebuild marker.");
if (index.includes("Copy Results") || app.includes("Copy Results")) fail("Copy Results must not appear in index.html or assets/app.js.");

const secretPage = await readFile(path.join(root, "secret-santa-wheel", "index.html"), "utf8");
for (const forbidden of ["optionsInput", "exportBtn", "visible group draw", "dedicated service"]) {
  if (secretPage.includes(forbidden)) fail(`Secret Santa page still contains obsolete content: ${forbidden}`);
}
if (!secretPage.includes("/assets/secret-santa.js")) fail("Secret Santa page does not load its dedicated private-draw script.");
if (secretPage.includes("/assets/app.js")) fail("Secret Santa page still loads the generic sweepstake builder.");

const tools = require(path.join(root, "assets", "secret-santa.js"));
for (let count = 2; count <= 100; count += 1) {
  const names = Array.from({length:count}, (_, index) => `Person ${index + 1}`);
  for (let run = 0; run < 30; run += 1) {
    const assignments = tools.createAssignments(names);
    if (assignments.length !== count) fail(`Secret Santa returned the wrong assignment count for ${count} people.`);
    if (assignments.some((item) => item.giver === item.recipient)) fail(`Secret Santa produced a self-match for ${count} people.`);
    if (new Set(assignments.map((item) => item.recipient)).size !== count) fail(`Secret Santa reused a recipient for ${count} people.`);
  }
}
try {
  tools.createAssignments(["Sam", " sam "]);
  fail("Secret Santa did not reject case-insensitive duplicate names.");
} catch {}

const { validateFairDraw } = await import("./validate-fair-draw.mjs");
const fairDrawValidation = await validateFairDraw({root});
fairDrawValidation.errors.forEach(fail);
fairDrawValidation.warnings.forEach(warn);

warnings.forEach((message) => console.warn(`WARNING: ${message}`));
if (errors.length) {
  errors.forEach((message) => console.error(`ERROR: ${message}`));
  console.error(`Validation failed with ${errors.length} error(s).`);
  process.exit(1);
}

console.log(`Validation passed: ${events.length} events, ${pages.length} HTML files, ${jsonLdCount} JSON-LD blocks and ${amazonLinkCount} Amazon links.`);
