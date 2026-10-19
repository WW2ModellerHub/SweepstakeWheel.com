import { spawnSync } from "node:child_process";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import { pathToFileURL } from "node:url";

async function collectFiles(directory, predicate) {
  const output = [];
  for (const entry of await readdir(directory)) {
    if ([".git", "node_modules"].includes(entry)) continue;
    const full = path.join(directory, entry);
    const info = await stat(full);
    if (info.isDirectory()) output.push(...await collectFiles(full, predicate));
    else if (predicate(full)) output.push(full);
  }
  return output;
}

function createElement(initial = {}) {
  const attributes = new Map();
  const listeners = new Map();
  return {
    value: "",
    textContent: "",
    innerHTML: "",
    disabled: false,
    readOnly: false,
    hidden: false,
    checked: false,
    dataset: {},
    children: [],
    style: {
      transform: "",
      transition: "",
      setProperty() {}
    },
    classList: { add() {}, remove() {}, toggle() {} },
    appendChild(child) { this.children.push(child); return child; },
    remove() {},
    click() {},
    focus() { this.focused = true; },
    closest() { return null; },
    insertAdjacentElement() {},
    setAttribute(name, value) {
      attributes.set(name, String(value));
      if (name === "value") this.value = String(value);
    },
    getAttribute(name) { return attributes.get(name) ?? null; },
    addEventListener(name, listener) { listeners.set(name, listener); },
    removeEventListener(name) { listeners.delete(name); },
    ...initial
  };
}

function createHarness(appSource, { names, options, mode = "all", randomValues = [] }) {
  const elements = new Map();
  const element = (selector, initial = {}) => {
    if (!elements.has(selector)) elements.set(selector, createElement(initial));
    return elements.get(selector);
  };

  element("#namesInput").value = names.join("\n");
  element("#optionsInput").value = options.join("\n");
  const allMode = createElement({ value: "all", checked: mode === "all" });
  const oneMode = createElement({ value: "one", checked: mode === "one" });
  const allocationControls = [allMode, oneMode];

  for (const selector of [
    "#toast", "#wheelSvg", "#wheelCenterText", "#resultList", "#statNames", "#statOptions", "#statDrawn",
    "#drawPlanSummary", "#drawProgress", "#drawProgressBar", "#drawProgressText", "#loadBtn", "#resetBtn",
    "#spinBtn", "#autoBtn", "#exportBtn", "#shareBtn", "#imageBtn", "#printBtn", "#eventSelect"
  ]) element(selector);

  const document = {
    body: createElement({ dataset: {} }),
    querySelector(selector) {
      if (selector === 'input[name="allocationMode"]:checked') {
        return allocationControls.find((control) => control.checked) || null;
      }
      return elements.get(selector) || null;
    },
    querySelectorAll(selector) {
      if (selector.includes('input[name="allocationMode"]')) return allocationControls;
      return [];
    },
    createElement: () => createElement(),
    createElementNS: () => createElement(),
    addEventListener() {},
    appendChild() {}
  };

  const values = [...randomValues];
  const crypto = {
    getRandomValues(array) {
      array[0] = values.length ? values.shift() : 0;
      return array;
    }
  };
  const context = {
    console,
    document,
    location: { pathname: "/world-cup-sweepstake/", search: "" },
    navigator: {},
    crypto,
    URL,
    URLSearchParams,
    Blob,
    Date,
    Intl,
    Math,
    Promise,
    Set,
    Map,
    Uint32Array,
    Object,
    String,
    Number,
    Array,
    RegExp,
    Error,
    setTimeout,
    clearTimeout
  };
  context.window = context;
  context.window.crypto = crypto;
  context.window.matchMedia = () => ({ matches: true });

  vm.createContext(context);
  const instrumented = `${appSource}\n;globalThis.__fairDrawUnderTest = {\n` +
    "loadDraw, autoDraw, spinOne, syncDraft, allocationSummary, getState: () => ({" +
    "participants:[...participants], drawPool:[...drawPool], results:results.map(item => ({...item}))," +
    "drawTarget, drawMode, rosterLocked" +
    "})};";
  new vm.Script(instrumented, { filename: "assets/app.js" }).runInContext(context);
  return { api: context.__fairDrawUnderTest, elements };
}

function countsByPerson(results) {
  const counts = new Map();
  results.forEach(({ person }) => counts.set(person, (counts.get(person) || 0) + 1));
  return counts;
}

async function addDynamicChecks(appSource, fail) {
  const names = ["Ada", "Beth", "Chris"];
  const options = ["A", "B", "C", "D", "E", "F", "G", "H"];

  const allHarness = createHarness(appSource, { names, options, mode: "all" });
  if (!allHarness.api.loadDraw()) fail("The all-options draw could not be loaded in the engine harness.");
  allHarness.api.autoDraw();
  const allState = allHarness.api.getState();
  if (allState.drawMode !== "all") fail("The engine did not retain the default all-options allocation mode.");
  if (allState.drawTarget !== options.length) fail(`All-options mode planned ${allState.drawTarget} assignments instead of ${options.length}.`);
  if (allState.results.length !== options.length) fail(`All-options mode created ${allState.results.length} assignments instead of ${options.length}.`);
  const usedOptions = allState.results.map(({ pick }) => pick);
  if (new Set(usedOptions).size !== options.length || options.some((option) => !usedOptions.includes(option))) {
    fail("All-options mode did not assign every unique option exactly once.");
  }
  const allCounts = [...countsByPerson(allState.results).values()];
  if (allCounts.length !== names.length || Math.max(...allCounts) - Math.min(...allCounts) > 1) {
    fail("All-options mode did not distribute options evenly between participants.");
  }
  if (allHarness.elements.get("#statDrawn").textContent !== "8/8") fail("The drawn counter does not use the full all-options assignment target.");
  if (allHarness.elements.get("#drawProgressBar").max !== 8 || allHarness.elements.get("#drawProgressBar").value !== 8) {
    fail("The progress bar does not finish at the full all-options assignment target.");
  }
  if (!/8 unique options.*3 people.*2 or 3 each/i.test(allHarness.elements.get("#drawPlanSummary").textContent)) {
    fail("The allocation summary does not explain the 8-option, 3-person distribution.");
  }

  const oneHarness = createHarness(appSource, { names, options, mode: "one" });
  if (!oneHarness.api.loadDraw()) fail("The one-each draw could not be loaded in the engine harness.");
  oneHarness.api.autoDraw();
  const oneState = oneHarness.api.getState();
  if (oneState.results.length !== names.length) fail(`One-each mode created ${oneState.results.length} assignments instead of ${names.length}.`);
  if (new Set(oneState.results.map(({ pick }) => pick)).size !== names.length) fail("One-each mode reused an option.");
  if (new Set(oneState.results.map(({ person }) => person)).size !== names.length) fail("One-each mode did not assign exactly one option to every participant.");
  if (oneState.drawPool.length !== options.length - names.length) fail("One-each mode did not leave the expected excess options undrawn.");

  const manualHarness = createHarness(appSource, {
    names,
    options: ["A", "B", "C", "D", "E"],
    mode: "all",
    randomValues: Array(20).fill(0)
  });
  manualHarness.api.loadDraw();
  await manualHarness.api.spinOne();
  await manualHarness.api.spinOne();
  await manualHarness.api.spinOne();
  if (manualHarness.elements.get("#spinBtn").disabled) {
    fail("Spin one becomes disabled after every participant has one option even though all-options mode still has options to distribute.");
  }
  await manualHarness.api.spinOne();
  await manualHarness.api.spinOne();
  const manualState = manualHarness.api.getState();
  if (manualState.results.length !== 5 || manualHarness.elements.get("#statDrawn").textContent !== "5/5") {
    fail("Repeated manual spins did not complete the full all-options allocation.");
  }

  const duplicateHarness = createHarness(appSource, {
    names: ["Ada", "Beth"],
    options: ["Alpha", " alpha ", "Beta"],
    mode: "all"
  });
  duplicateHarness.api.loadDraw();
  duplicateHarness.api.autoDraw();
  const duplicateState = duplicateHarness.api.getState();
  if (duplicateState.results.length !== 2 || new Set(duplicateState.results.map(({ pick }) => pick.toLowerCase())).size !== 2) {
    fail("Case-insensitive duplicate options were not removed before drawing.");
  }

  const duplicateNameHarness = createHarness(appSource, {
    names: ["Ada", " ada ", "Beth"],
    options: ["Alpha", "Beta", "Gamma"],
    mode: "all"
  });
  duplicateNameHarness.api.syncDraft();
  if (duplicateNameHarness.api.loadDraw()) fail("A draw with duplicate participant names was allowed to start.");
  if (duplicateNameHarness.api.getState().rosterLocked) fail("Duplicate participant names locked an invalid roster.");
  if (!/duplicate participant name/i.test(duplicateNameHarness.elements.get("#drawPlanSummary").textContent)) {
    fail("The allocation summary does not identify duplicate participant names.");
  }

  const pointerHarness = createHarness(appSource, {
    names: ["Ada"],
    options: ["A", "B", "C", "D"],
    mode: "all",
    randomValues: [1, 0]
  });
  pointerHarness.api.loadDraw();
  await pointerHarness.api.spinOne();
  const state = pointerHarness.api.getState();
  const rotation = Number(pointerHarness.elements.get("#wheelSvg").dataset.rotation || 0);
  const normalized = ((rotation % 360) + 360) % 360;
  const expected = 225;
  if (state.results[0]?.pick !== "B") fail(`Deterministic spin recorded ${state.results[0]?.pick || "no result"} instead of B.`);
  if (Math.abs(normalized - expected) > 0.000001) {
    fail(`The wheel stopped at ${normalized} degrees, which does not point to the recorded B segment (${expected} degrees).`);
  }
}

export async function validateFairDraw({ root = process.cwd() } = {}) {
  const errors = [];
  const warnings = [];
  const fail = (message) => errors.push(message);
  const appPath = path.join(root, "assets", "app.js");
  const appSource = await readFile(appPath, "utf8");

  if (/\bMath\s*\.\s*random\s*\(/.test(appSource)) fail("assets/app.js must not use Math.random; the generic draw must use Web Crypto only.");
  if (!/crypto[\s\S]{0,160}getRandomValues|getRandomValues[\s\S]{0,160}crypto/.test(appSource)) {
    fail("assets/app.js does not use crypto.getRandomValues for draw randomness.");
  }
  if (/Copy Results/i.test(appSource)) fail('assets/app.js contains the retired "Copy Results" label.');
  for (const [id, handler] of [["shareBtn","shareResults"],["imageBtn","downloadResultImage"],["printBtn","printResults"]]) {
    if (!new RegExp(`#${id}["']\\)\\?\\.addEventListener\\(["']click["'][\\s\\S]{0,120}${handler}`).test(appSource)) {
      fail(`assets/app.js does not bind #${id} to ${handler}.`);
    }
  }

  const htmlFiles = await collectFiles(root, (file) => file.endsWith(".html"));
  const builderPages = [];
  for (const file of htmlFiles) {
    const html = await readFile(file, "utf8");
    const relative = path.relative(root, file).replaceAll("\\", "/");
    if (/Copy Results/i.test(html)) fail(`${relative} contains the retired "Copy Results" label.`);
    if (!html.includes('id="namesInput"') || !html.includes('id="optionsInput"') || !html.includes("/assets/app.js")) continue;
    builderPages.push(relative);

    const allocationInputs = [...html.matchAll(/<input\b([^>]*\bname=["']allocationMode["'][^>]*)>/gi)].map((match) => match[1]);
    const all = allocationInputs.filter((attributes) => /\bvalue=["']all["']/i.test(attributes));
    const one = allocationInputs.filter((attributes) => /\bvalue=["']one["']/i.test(attributes));
    if (all.length !== 1 || one.length !== 1) fail(`${relative} must provide exactly one allocationMode=all and one allocationMode=one control.`);
    if (all.length === 1 && !/\bchecked\b/i.test(all[0])) fail(`${relative} must default allocationMode=all to checked.`);
    if (one.some((attributes) => /\bchecked\b/i.test(attributes))) fail(`${relative} must not default allocationMode=one to checked.`);
    for (const id of ["drawPlanSummary", "loadBtn", "drawProgress", "drawProgressBar", "drawProgressText", "shareBtn", "imageBtn", "printBtn", "exportBtn"]) {
      const count = (html.match(new RegExp(`\\bid=["']${id}["']`, "g")) || []).length;
      if (count !== 1) fail(`${relative} must contain exactly one #${id} element.`);
    }
    if (!/<button\b[^>]*\bid=["']loadBtn["'][^>]*>\s*Start draw\s*<\/button>/i.test(html)) {
      fail(`${relative} must label #loadBtn as "Start draw".`);
    }
  }
  if (!builderPages.length) fail("No generic sweepstake builder pages were found for allocation-control validation.");

  const scriptFiles = await collectFiles(root, (file) => file.endsWith(".js") || file.endsWith(".mjs"));
  for (const file of scriptFiles) {
    const result = spawnSync(process.execPath, ["--check", file], { cwd: root, encoding: "utf8" });
    if (result.error?.code === "EPERM") {
      warnings.push("Child-process syntax checks are unavailable in this sandbox; the VM engine check still covers assets/app.js and CI runs the full Node checks.");
      break;
    }
    if (result.status !== 0) {
      const details = result.error?.message || String(result.stderr || result.stdout || "unknown syntax-check failure").trim();
      fail(`${path.relative(root, file).replaceAll("\\", "/")} failed node --check: ${details}`);
    }
  }

  const derived = spawnSync(process.execPath, ["scripts/build-derived.mjs", "--check"], { cwd: root, encoding: "utf8" });
  if (derived.error?.code === "EPERM") {
    if (!warnings.some((message) => message.startsWith("Child-process syntax checks"))) {
      warnings.push("Child-process build checks are unavailable in this sandbox; CI runs the generated-file check separately.");
    }
  } else if (derived.status !== 0) {
    const details = derived.error?.message || String(derived.stderr || derived.stdout || "unknown derived-file failure").trim();
    fail(`Derived-file check failed: ${details}`);
  }

  try {
    await addDynamicChecks(appSource, fail);
  } catch (error) {
    fail(`Fair-draw engine harness failed: ${error.stack || error.message}`);
  }

  return { errors, warnings, builderPages };
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : "";
if (import.meta.url === invokedPath) {
  const result = await validateFairDraw({ root: process.cwd() });
  result.warnings.forEach((message) => console.warn(`WARNING: ${message}`));
  if (result.errors.length) {
    result.errors.forEach((message) => console.error(`ERROR: ${message}`));
    console.error(`Fair-draw validation failed with ${result.errors.length} error(s).`);
    process.exit(1);
  }
  console.log(`Fair-draw validation passed for ${result.builderPages.length} generic builder pages.`);
}
