
const EVENTS_FALLBACK = window.SWEEPSTAKE_EVENTS_FALLBACK || [];

let events = EVENTS_FALLBACK;
let selectedEvent = null;
let participants = [];
let drawPool = [];
let results = [];
let spinning = false;
let rosterLocked = false;
let drawMode = "all";
let drawTarget = 0;
let lockedOptions = [];
let participantOrder = [];
let currentFilter = "All";
let seasonalFocus = null;
let activeSeasonalEvents = [];
let activeSeasonalSlugs = new Set();

const DEFAULT_FEATURE_SLUGS = [
  "world-cup-sweepstake",
  "grand-national-sweepstake",
  "eurovision-sweepstake",
  "custom-sweepstake-generator"
];

const AMAZON_TAG = "sweepstakewheel-21";
const AMAZON_PICK_PRESETS = {
  "secret-santa-wheel": [
    ["£10-budget gift ideas on Amazon", "Secret Santa gift ideas £10 budget"],
    ["£20-budget gift ideas on Amazon", "Secret Santa gift ideas £20 budget"],
    ["Gifts for colleagues on Amazon", "Secret Santa gifts for colleagues"],
    ["Gift bags & wrapping on Amazon", "Christmas gift bags wrapping paper"]
  ],
  "world-cup-sweepstake": [
    ["Football party supplies on Amazon", "football party supplies"],
    ["Country flags on Amazon", "World Cup country flags"],
    ["Football gifts on Amazon", "football gifts"],
    ["Winner trophies on Amazon", "football winner trophy"]
  ],
  "wimbledon-sweepstake": [
    ["Tennis gifts on Amazon", "tennis gifts"],
    ["Garden-party supplies on Amazon", "garden party supplies"],
    ["Tennis balls on Amazon", "tennis balls"],
    ["Tennis books on Amazon", "tennis books"]
  ],
  "grand-national-sweepstake": [
    ["Racing-day party supplies on Amazon", "horse racing party supplies"],
    ["Sweepstake envelopes on Amazon", "money envelopes sweepstake"],
    ["Horse-racing gifts on Amazon", "horse racing gifts"],
    ["Winner trophies on Amazon", "horse racing trophy"]
  ],
  "eurovision-sweepstake": [
    ["Eurovision party supplies on Amazon", "Eurovision party supplies"],
    ["Country flags on Amazon", "European country flags party"],
    ["Karaoke microphones on Amazon", "karaoke microphone"],
    ["Party prizes on Amazon", "party prizes"]
  ]
};

const qs = (sel, root=document) => root.querySelector(sel);
const qsa = (sel, root=document) => Array.from(root.querySelectorAll(sel));

function escapeHtml(value){
  return String(value ?? "").replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[ch]));
}
function lines(value){
  return String(value || "").split(/\r?\n/).map(v => v.trim()).filter(Boolean);
}
function uniqueOptions(value){
  const seen = new Set();
  const items = [];
  let duplicateCount = 0;
  lines(value).forEach(item => {
    const key = item.toLocaleLowerCase("en-GB");
    if(seen.has(key)){
      duplicateCount += 1;
      return;
    }
    seen.add(key);
    items.push(item);
  });
  return {items, duplicateCount};
}
function secureRandomAvailable(){
  return !!(window.crypto && typeof window.crypto.getRandomValues === "function");
}
function randomIndex(length){
  if(!Number.isSafeInteger(length) || length < 1) return 0;
  if(!secureRandomAvailable()) throw new Error("Secure random selection is unavailable");
  const range = 0x100000000;
  const limit = range - (range % length);
  const value = new Uint32Array(1);
  do{
    window.crypto.getRandomValues(value);
  }while(value[0] >= limit);
  return value[0] % length;
}
function secureShuffle(items){
  const shuffled = [...items];
  for(let index=shuffled.length - 1;index>0;index--){
    const swapIndex = randomIndex(index + 1);
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }
  return shuffled;
}
function slugFromPath(){
  const bodySlug = document.body.dataset.pageSlug || "";
  if(bodySlug) return bodySlug;
  const path = location.pathname.replace(/^\/|\/$/g,"");
  if(!path) return "";
  return path.split("/")[0].replace(/\.html$/,"");
}
function findEvent(slug){
  return events.find(e => e.slug === slug) || events.find(e => e.slug === "world-cup-sweepstake") || events[0];
}
function eventUrl(event){
  return event.slug === "custom-sweepstake-generator" ? "/custom-sweepstake-generator/" : `/${event.slug}/`;
}
function amazonSearchUrl(query){
  const params = new URLSearchParams({k:query, tag:AMAZON_TAG});
  return `https://www.amazon.co.uk/s?${params.toString()}`;
}
function amazonPicksFor(event){
  if(event && AMAZON_PICK_PRESETS[event.slug]) return AMAZON_PICK_PRESETS[event.slug];
  const label = event?.shortName || "Sweepstake";
  return [
    [`${label} gifts on Amazon`, `${label} gifts`],
    ["Party supplies on Amazon", `${label} party supplies`],
    ["Prize ideas on Amazon", "small prizes for adults"],
    ["Draw essentials on Amazon", "raffle tickets prize envelopes"]
  ];
}
function renderHomepageAmazon(event){
  const links = qs("#homeShopLinks");
  if(!links) return;
  const focus = event || null;
  const title = qs("#homeShopTitle");
  const intro = qs("#homeShopIntro");
  const heroShop = qs("#homeHeroShop");
  if(title) title.textContent = focus ? `${focus.shortName} picks on Amazon` : "Sweepstake supplies and prize ideas on Amazon";
  if(intro) intro.textContent = focus
    ? `The site has put the most relevant ${focus.shortName} searches first. Amazon inventory refreshes automatically.`
    : "Useful searches for prizes, party supplies and running your draw.";
  if(heroShop) heroShop.textContent = focus?.slug === "secret-santa-wheel" ? "Shop Secret Santa gifts" : "Shop Amazon picks";
  links.innerHTML = amazonPicksFor(focus).map(([label, query]) => `
    <a href="${amazonSearchUrl(query)}" target="_blank" rel="sponsored nofollow noopener" data-affiliate-placement="home-seasonal">${escapeHtml(label)} <span aria-hidden="true">→</span></a>
  `).join("");
}
function trackAffiliateClick(event){
  const link = event.target.closest("a[href*='amazon.co.uk']");
  if(!link || typeof window.gtag !== "function") return;
  window.gtag("event", "affiliate_click", {
    event_slug: seasonalFocus?.slug || slugFromPath() || "homepage",
    placement: link.dataset.affiliatePlacement || "event-page",
    link_label: String(link.textContent || "").trim().replace(/\s+/g," ").slice(0,80)
  });
}
async function loadEventData(){
  try{
    const response = await fetch("/data/events.json", {cache:"no-cache"});
    if(!response.ok) throw new Error(`Event data returned ${response.status}`);
    const loaded = await response.json();
    const valid = Array.isArray(loaded) && loaded.length && loaded.every(event =>
      event && typeof event.slug === "string" && typeof event.name === "string" && Array.isArray(event.options)
    );
    if(!valid) throw new Error("Event data is not valid");
    events = loaded;
  }catch(error){
    console.warn("Using bundled event data because data/events.json could not be loaded.", error);
    events = EVENTS_FALLBACK;
  }
}
function siteDateParts(){
  const preview = new URLSearchParams(location.search).get("previewDate");
  if(/^\d{4}-\d{2}-\d{2}$/.test(preview || "")){
    const [year, month, day] = preview.split("-").map(Number);
    const checked = new Date(Date.UTC(year, month - 1, day));
    if(checked.getUTCFullYear() === year && checked.getUTCMonth() === month - 1 && checked.getUTCDate() === day){
      return {year, month, day, monthDay:month * 100 + day};
    }
  }
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-GB", {
    timeZone:"Europe/London",
    year:"numeric",
    month:"2-digit",
    day:"2-digit"
  }).formatToParts(new Date()).filter(part => part.type !== "literal").map(part => [part.type, Number(part.value)]));
  return {year:parts.year, month:parts.month, day:parts.day, monthDay:parts.month * 100 + parts.day};
}
function monthDayValue(value){
  const match = /^(\d{2})-(\d{2})$/.exec(String(value || ""));
  if(!match) return null;
  const month = Number(match[1]);
  const day = Number(match[2]);
  if(month < 1 || month > 12 || day < 1 || day > 31) return null;
  return month * 100 + day;
}
function promotionWindowIsActive(window, date){
  if(!window || typeof window !== "object") return false;
  if(Array.isArray(window.years) && !window.years.map(Number).includes(date.year)) return false;
  const start = monthDayValue(window.start);
  const end = monthDayValue(window.end);
  if(start === null || end === null) return false;
  return start <= end
    ? date.monthDay >= start && date.monthDay <= end
    : date.monthDay >= start || date.monthDay <= end;
}
function updateSeasonalState(){
  const date = siteDateParts();
  activeSeasonalEvents = events
    .map((event, index) => ({event, index}))
    .filter(({event}) => Array.isArray(event.promotion?.windows) && event.promotion.windows.some(window => promotionWindowIsActive(window, date)))
    .sort((a, b) => Number(b.event.promotion.priority || 0) - Number(a.event.promotion.priority || 0) || a.index - b.index)
    .map(({event}) => event);
  activeSeasonalSlugs = new Set(activeSeasonalEvents.map(event => event.slug));
  seasonalFocus = activeSeasonalEvents[0] || null;
}
function orderedEvents(items){
  if(!activeSeasonalEvents.length) return items;
  const seasonalOrder = new Map(activeSeasonalEvents.map((event, index) => [event.slug, index]));
  return [...items].sort((a, b) => {
    const aRank = seasonalOrder.has(a.slug) ? seasonalOrder.get(a.slug) : Number.MAX_SAFE_INTEGER;
    const bRank = seasonalOrder.has(b.slug) ? seasonalOrder.get(b.slug) : Number.MAX_SAFE_INTEGER;
    return aRank - bRank;
  });
}
function renderSeasonalHomepage(){
  const title = qs("#homeHeroTitle");
  if(!title) return;

  const candidates = [];
  const seen = new Set();
  [...activeSeasonalEvents, ...DEFAULT_FEATURE_SLUGS.map(findEvent)].forEach(event => {
    if(event && !seen.has(event.slug)){
      seen.add(event.slug);
      candidates.push(event);
    }
  });

  const previewGrid = qs("#homePreviewGrid");
  if(previewGrid){
    previewGrid.innerHTML = candidates.slice(0, 4).map(event => `
      <a class="preview-tile ${event.slug === seasonalFocus?.slug ? "is-seasonal-focus" : ""}" href="${eventUrl(event)}">
        <b>${event.emoji} ${escapeHtml(event.shortName)}</b>
        <span>${escapeHtml(event.entries)}</span>
      </a>
    `).join("");
  }

  renderHomepageAmazon(seasonalFocus);
  if(!seasonalFocus) return;
  document.body.classList.add("has-seasonal-focus");
  document.body.dataset.seasonalFocus = seasonalFocus.slug;
  document.body.style.setProperty("--season-accent", seasonalFocus.promotion.accent || "#2855ff");
  document.body.style.setProperty("--season-tint", seasonalFocus.promotion.tint || "#edf2ff");

  const eyebrow = qs("#homeHeroEyebrow");
  const intro = qs("#homeHeroIntro");
  const cta = qs("#homeHeroCta");
  const cardTitle = qs("#homeHeroCardTitle");
  const cardLabel = qs("#homeHeroCardLabel");
  const card = qs(".hero-card");
  const trustRow = qs("#homeTrustRow");
  if(eyebrow) eyebrow.textContent = `${seasonalFocus.emoji} ${seasonalFocus.promotion.label || "Featured now"}`;
  title.textContent = seasonalFocus.headline;
  if(intro) intro.textContent = seasonalFocus.intro;
  if(cta){
    cta.href = eventUrl(seasonalFocus);
    cta.textContent = `Open ${seasonalFocus.shortName}`;
  }
  if(cardTitle) cardTitle.textContent = `${seasonalFocus.shortName} is in season`;
  if(cardLabel) cardLabel.textContent = "Featured now";
  if(card) card.setAttribute("aria-label", `Seasonal focus: ${seasonalFocus.name}`);
  if(trustRow && seasonalFocus.mode === "private-name-draw"){
    trustRow.innerHTML = "<span>✅ Free draw</span><span>✅ No self-matches</span><span>✅ Private reveals</span><span>✅ Nothing saved</span>";
  }
}
function toast(message){
  const el = qs("#toast");
  if(!el) return;
  el.textContent = message;
  el.classList.add("show");
  clearTimeout(window.__toastTimer);
  window.__toastTimer = setTimeout(()=>el.classList.remove("show"),2600);
}

function renderEventCards(){
  const grid = qs("#eventGrid");
  if(!grid) return;
  const query = (qs("#eventSearch")?.value || "").trim().toLowerCase();
  const visible = orderedEvents(events.filter(e => {
    const inFilter = currentFilter === "All" || e.category === currentFilter || e.status === currentFilter;
    const hay = `${e.name} ${e.category} ${e.bestFor} ${e.season} ${e.status}`.toLowerCase();
    return inFilter && (!query || hay.includes(query));
  }));
  grid.innerHTML = visible.map(e => `
    <article class="event-card ${e.slug === seasonalFocus?.slug ? "is-seasonal-focus" : ""}">
      <div class="event-top">
        <div class="event-icon">${e.emoji}</div>
        <span class="mini-pill">${escapeHtml(e.slug === seasonalFocus?.slug ? "Featured now" : activeSeasonalSlugs.has(e.slug) ? "In season" : e.badge)}</span>
      </div>
      <h3>${escapeHtml(e.name)}</h3>
      <p>${escapeHtml(e.intro)}</p>
      <div class="event-meta">
        <div class="meta-box"><small>Best for</small><b>${escapeHtml(e.bestFor)}</b></div>
        <div class="meta-box"><small>Entries</small><b>${escapeHtml(e.entries)}</b></div>
      </div>
      <div class="card-actions">
        <a class="event-open-link" href="${eventUrl(e)}">Explore ${escapeHtml(e.shortName)} <span aria-hidden="true">→</span></a>
        ${e.mode === "private-name-draw"
          ? `<a class="quick-draw-btn" href="${eventUrl(e)}">Private draw</a>`
          : `<button class="quick-draw-btn" data-use-event="${escapeHtml(e.slug)}">Quick draw</button>`}
      </div>
    </article>
  `).join("");
  qsa("[data-use-event]").forEach(btn => {
    btn.addEventListener("click", () => {
      selectEvent(btn.dataset.useEvent, true);
    });
  });
}
function renderFilters(){
  const filterWrap = qs("#filters");
  if(!filterWrap) return;
  const cats = ["All", ...Array.from(new Set(events.map(e=>e.category))).filter(Boolean), "Seasonal", "Popular"];
  filterWrap.innerHTML = cats.map(cat => `<button class="filter-btn ${cat===currentFilter?"active":""}" data-filter="${escapeHtml(cat)}">${escapeHtml(cat)}</button>`).join("");
  qsa("[data-filter]").forEach(btn => btn.addEventListener("click", () => {
    currentFilter = btn.dataset.filter;
    renderFilters();
    renderEventCards();
  }));
}
function populateSelector(){
  const select = qs("#eventSelect");
  if(!select) return;
  select.innerHTML = events.filter(e => e.mode !== "private-name-draw").map(e => `<option value="${escapeHtml(e.slug)}">${escapeHtml(e.name)}</option>`).join("");
  select.addEventListener("change", () => selectEvent(select.value, false));
}
function eventHasPlaceholderOptions(event){
  return (event?.options || []).some(value => /^(?:player|contestant|campmate|horse|runner|gift|square|option)\s*\d+$/i.test(String(value).trim()));
}
function renderDataStatus(event){
  const anchor = qs(".event-template-lock") || qs("#eventSelect")?.closest(".field");
  if(!anchor) return;
  let notice = qs("#dataStatusNotice");
  if(!notice){
    notice = document.createElement("div");
    notice.id = "dataStatusNotice";
    notice.className = "data-status-notice";
    anchor.insertAdjacentElement("afterend", notice);
  }
  const status = event?.dataStatus || {};
  notice.hidden = false;
  if(status.mode === "self-contained"){
    notice.hidden = true;
    return;
  }
  if(eventHasPlaceholderOptions(event)){
    notice.className = "data-status-notice is-review";
    notice.innerHTML = `<strong>Official list pending</strong><span>This editable template is ready for you to paste the confirmed names before drawing.</span>`;
    return;
  }
  if(status.status === "confirmed" && (status.checkedAt || status.updatedAt)){
    const date = new Intl.DateTimeFormat("en-GB", {timeZone:"Europe/London", day:"numeric", month:"short", year:"numeric"}).format(new Date(status.checkedAt || status.updatedAt));
    notice.className = "data-status-notice is-confirmed";
    notice.innerHTML = `<strong>Current list verified</strong><span>${escapeHtml(status.sourceName || "Approved source")} · checked ${escapeHtml(date)}</span>`;
    return;
  }
  if(String(status.mode || "").startsWith("automatic")){
    notice.className = "data-status-notice";
    notice.innerHTML = `<strong>Managed event list</strong><span>The maintenance job keeps this editable list current when its approved provider is available.</span>`;
    return;
  }
  notice.hidden = true;
}
function readAllocationMode(){
  const checked = qs('input[name="allocationMode"]:checked');
  const select = qs("#allocationMode");
  const value = String(checked?.value || select?.value || "all").toLowerCase();
  return value === "one" || value === "one-each" || value === "oneeach" ? "one" : "all";
}
function getDraftState(){
  const names = uniqueOptions(qs("#namesInput")?.value || "");
  const options = uniqueOptions(qs("#optionsInput")?.value || "");
  return {
    names:names.items,
    nameDuplicateCount:names.duplicateCount,
    options:options.items,
    duplicateCount:options.duplicateCount,
    mode:readAllocationMode()
  };
}
function plannedAssignments(mode, nameCount, optionCount){
  if(!nameCount || !optionCount) return 0;
  return mode === "one" ? nameCount : optionCount;
}
function allocationSummary(names, options, mode, duplicateCount=0, nameDuplicateCount=0){
  const duplicateNote = duplicateCount
    ? ` ${duplicateCount} duplicate option${duplicateCount === 1 ? "" : "s"} will be ignored.`
    : "";
  const nameDuplicateNote = nameDuplicateCount
    ? ` Remove ${nameDuplicateCount} duplicate participant name${nameDuplicateCount === 1 ? "" : "s"} before starting.`
    : "";
  const notes = `${duplicateNote}${nameDuplicateNote}`;
  if(!names.length && !options.length) return `Add people and options to preview the draw.${notes}`;
  if(!names.length) return `Add at least one person to preview the allocation.${notes}`;
  if(!options.length) return `Add at least one unique option to preview the allocation.${notes}`;
  if(mode === "one"){
    if(names.length > options.length){
      const needed = names.length - options.length;
      return `One each needs ${needed} more unique option${needed === 1 ? "" : "s"}.${notes}`;
    }
    const left = options.length - names.length;
    return `${names.length} ${names.length === 1 ? "person gets" : "people get"} one option each${left ? ` · ${left} option${left === 1 ? "" : "s"} intentionally left unassigned` : ""}.${notes}`;
  }
  const minimum = Math.floor(options.length / names.length);
  const extra = options.length % names.length;
  if(!extra){
    return `${options.length} unique option${options.length === 1 ? "" : "s"} · ${names.length} ${names.length === 1 ? "person" : "people"} · ${minimum} each.${notes}`;
  }
  const higher = minimum + 1;
  return `${options.length} unique option${options.length === 1 ? "" : "s"} · ${names.length} ${names.length === 1 ? "person" : "people"} · ${minimum} or ${higher} each.${notes}`;
}
function setRosterLocked(locked){
  rosterLocked = locked;
  [qs("#namesInput"), qs("#optionsInput")].forEach(input => {
    if(!input) return;
    input.readOnly = locked;
    input.setAttribute("aria-readonly", String(locked));
  });
  const eventSelect = qs("#eventSelect");
  if(eventSelect) eventSelect.disabled = locked;
  qsa('input[name="allocationMode"], #allocationMode').forEach(control => {
    control.disabled = locked;
  });
  const loadButton = qs("#loadBtn");
  if(loadButton) loadButton.disabled = locked;
}
function syncDraft(){
  if(rosterLocked || spinning) return;
  const draft = getDraftState();
  participants = draft.names;
  participantOrder = [];
  drawMode = draft.mode;
  lockedOptions = [];
  drawPool = draft.options;
  drawTarget = plannedAssignments(drawMode, participants.length, drawPool.length);
  results = [];
  renderWheel(drawPool);
  updateUi();
}
function selectEvent(slug, scroll){
  setRosterLocked(false);
  selectedEvent = findEvent(slug);
  const select = qs("#eventSelect");
  if(select) select.value = selectedEvent.slug;
  const optionsInput = qs("#optionsInput");
  if(optionsInput) optionsInput.value = selectedEvent.options.join("\n");
  const selectedName = qs("#selectedEventName");
  if(selectedName) selectedName.textContent = selectedEvent.name;
  const selectedIntro = qs("#selectedEventIntro");
  if(selectedIntro) selectedIntro.textContent = selectedEvent.intro;
  renderDataStatus(selectedEvent);
  results = [];
  participants = [];
  lockedOptions = [];
  participantOrder = [];
  drawMode = readAllocationMode();
  drawPool = uniqueOptions(selectedEvent.options.join("\n")).items;
  drawTarget = 0;
  renderWheel(drawPool);
  updateUi();
  if(scroll) qs("#builder")?.scrollIntoView({behavior:"smooth", block:"start"});
}
function defaultNames(){
  return ["Beth","Ryan","Luke","Rach","Chris","Mel","Sam","Sarah","Callum","Nola","Jess","Lynne"];
}
function maybeSeedNames(){
  const input = qs("#namesInput");
  if(input && !input.value.trim()) input.placeholder = defaultNames().join("\n");
}
function loadDraw(){
  if(rosterLocked) return true;
  const namesInput = qs("#namesInput");
  const optionsInput = qs("#optionsInput");
  const draft = getDraftState();
  if(draft.names.length < 1){
    toast("Add at least one person first.");
    namesInput?.focus();
    return false;
  }
  if(draft.nameDuplicateCount){
    toast(`Remove ${draft.nameDuplicateCount} duplicate participant name${draft.nameDuplicateCount === 1 ? "" : "s"} before starting.`);
    namesInput?.focus();
    return false;
  }
  if(draft.options.length < 1){
    toast("Add at least one unique team, player, horse, option or prize.");
    optionsInput?.focus();
    return false;
  }
  if(draft.mode === "one" && draft.names.length > draft.options.length){
    const needed = draft.names.length - draft.options.length;
    toast(`Add ${needed} more unique option${needed === 1 ? "" : "s"}, or choose distribute all.`);
    optionsInput?.focus();
    return false;
  }
  if(!secureRandomAvailable()){
    toast("Secure random drawing is unavailable in this browser. Please update it and try again.");
    return false;
  }
  participants = [...draft.names];
  participantOrder = secureShuffle(draft.names);
  lockedOptions = [...draft.options];
  drawPool = [...draft.options];
  drawMode = draft.mode;
  drawTarget = plannedAssignments(drawMode, participants.length, drawPool.length);
  results = [];
  setRosterLocked(true);
  renderWheel(drawPool);
  updateUi();
  if(draft.duplicateCount){
    toast(`Draw ready. Order randomised; ${draft.duplicateCount} duplicate option${draft.duplicateCount === 1 ? " was" : "s were"} ignored.`);
  }else{
    toast(drawMode === "all" ? "Draw ready. Order randomised; every unique option will be assigned once." : "Draw ready. Order randomised; everyone will receive one unique option.");
  }
  return true;
}
function drawIsComplete(){
  return rosterLocked && results.length >= drawTarget;
}
function nextParticipant(){
  if(!participantOrder.length) return "";
  return drawMode === "all"
    ? participantOrder[results.length % participantOrder.length]
    : participantOrder[results.length];
}
function nextAnimationFrame(){
  return new Promise(resolve => {
    if(typeof window.requestAnimationFrame !== "function"){
      setTimeout(resolve, 0);
      return;
    }
    window.requestAnimationFrame(() => window.requestAnimationFrame(resolve));
  });
}
function waitForWheelTransition(wheel, duration){
  if(!duration) return nextAnimationFrame();
  return new Promise(resolve => {
    let finished = false;
    const finish = () => {
      if(finished) return;
      finished = true;
      wheel.removeEventListener("transitionend", onEnd);
      clearTimeout(timer);
      resolve();
    };
    const onEnd = event => {
      if(event.target === wheel && event.propertyName === "transform") finish();
    };
    const timer = setTimeout(finish, duration + 180);
    wheel.addEventListener("transitionend", onEnd);
  });
}
async function animateWheelToIndex(index, optionCount){
  const wheel = qs("#wheelSvg");
  if(!wheel || optionCount < 1) return;
  const current = Number(wheel.dataset.rotation || 0);
  const currentNormal = ((current % 360) + 360) % 360;
  const targetNormal = ((-((index + 0.5) * 360 / optionCount) % 360) + 360) % 360;
  const fullTurns = 3 + randomIndex(3);
  const delta = ((targetNormal - currentNormal + 360) % 360) + fullTurns * 360;
  const target = current + delta;
  const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  const duration = reduceMotion ? 0 : 1150;
  wheel.style.transition = duration ? `transform ${duration}ms cubic-bezier(.16,.9,.22,1)` : "none";
  wheel.dataset.rotation = String(target);
  wheel.style.transform = `rotate(${target}deg)`;
  await waitForWheelTransition(wheel, duration);
}
async function spinOne(){
  if(spinning) return;
  if(!rosterLocked && !loadDraw()) return;
  if(drawIsComplete()){
    toast("This draw is already complete.");
    return;
  }
  if(!drawPool.length){
    toast("No unassigned options remain.");
    return;
  }
  renderWheel(drawPool);
  const index = randomIndex(drawPool.length);
  const picked = drawPool[index];
  const person = nextParticipant();
  spinning = true;
  updateUi();
  await animateWheelToIndex(index, drawPool.length);
  drawPool.splice(index, 1);
  results.push({person, pick:picked});
  spinning = false;
  updateUi();
  const resultList = qs("#resultList");
  if(resultList) resultList.scrollTop = resultList.scrollHeight;
}
function autoDraw(){
  if(spinning) return;
  if(!rosterLocked && !loadDraw()) return;
  if(drawIsComplete()){
    toast("This draw is already complete.");
    return;
  }
  while(!drawIsComplete() && drawPool.length){
    const person = nextParticipant();
    const index = randomIndex(drawPool.length);
    const picked = drawPool.splice(index, 1)[0];
    results.push({person, pick:picked});
  }
  renderWheel(drawPool.length ? drawPool : lockedOptions);
  updateUi();
  if(drawMode === "one" && drawPool.length){
    toast(`Auto draw complete. ${drawPool.length} option${drawPool.length === 1 ? " was" : "s were"} intentionally left unassigned.`);
  }else{
    toast("Auto draw complete. Every option was assigned once.");
  }
}
function resetDraw(){
  if(spinning) return;
  document.body.classList.remove("print-results-only");
  qs("#printSheet")?.remove();
  setRosterLocked(false);
  results = [];
  lockedOptions = [];
  participantOrder = [];
  drawTarget = 0;
  syncDraft();
  toast("Draw reset. You can edit the roster again.");
}
function renderWheel(items){
  const svg = qs("#wheelSvg");
  if(!svg) return;
  const clean = (items && items.length ? items : (selectedEvent?.options || ["Add options"])).filter(Boolean);
  const n = clean.length;
  const cx = 250, cy = 250, r = 242;
  const colours = ["#ffd166","#35d07f","#5b9dff","#ff4f69","#9b5cff","#4cc9f0","#f8961e","#90be6d","#f72585","#43aa8b"];
  svg.innerHTML = "";
  if(!n) return;
  for(let i=0;i<n;i++){
    const start = i/n * Math.PI*2 - Math.PI/2;
    const end = (i+1)/n * Math.PI*2 - Math.PI/2;
    const x1 = cx + r*Math.cos(start), y1 = cy + r*Math.sin(start);
    const x2 = cx + r*Math.cos(end), y2 = cy + r*Math.sin(end);
    const large = end-start > Math.PI ? 1 : 0;
    const path = document.createElementNS("http://www.w3.org/2000/svg","path");
    path.setAttribute("d",`M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2} Z`);
    path.setAttribute("fill", colours[i % colours.length]);
    path.setAttribute("stroke","rgba(255,255,255,.45)");
    path.setAttribute("stroke-width","1.5");
    svg.appendChild(path);
    if(n <= 64){
      const mid = (start+end)/2;
      const labelR = n > 36 ? 168 : 158;
      const tx = cx + labelR*Math.cos(mid), ty = cy + labelR*Math.sin(mid);
      const text = document.createElementNS("http://www.w3.org/2000/svg","text");
      text.setAttribute("x",tx);
      text.setAttribute("y",ty);
      text.setAttribute("fill","#07121f");
      text.setAttribute("font-size", n > 36 ? "8" : n > 24 ? "9.6" : "12");
      text.setAttribute("font-weight","1000");
      text.setAttribute("text-anchor","middle");
      text.setAttribute("dominant-baseline","middle");
      text.setAttribute("transform",`rotate(${mid*180/Math.PI}, ${tx}, ${ty})`);
      text.textContent = shortLabel(clean[i], n);
      svg.appendChild(text);
    }
  }
  const ring = document.createElementNS("http://www.w3.org/2000/svg","circle");
  ring.setAttribute("cx",cx); ring.setAttribute("cy",cy); ring.setAttribute("r",r);
  ring.setAttribute("fill","none"); ring.setAttribute("stroke","rgba(255,255,255,.82)"); ring.setAttribute("stroke-width","8");
  svg.appendChild(ring);
}
function shortLabel(value, n){
  const s = String(value || "");
  const max = n > 36 ? 10 : n > 24 ? 13 : 18;
  return s.length > max ? s.slice(0,max-1)+"…" : s;
}
function updateUi(){
  const draft = getDraftState();
  const activeNames = rosterLocked ? participants : draft.names;
  const activeOptions = rosterLocked ? lockedOptions : draft.options;
  const activeMode = rosterLocked ? drawMode : draft.mode;
  const target = rosterLocked
    ? drawTarget
    : plannedAssignments(activeMode, activeNames.length, activeOptions.length);
  const impossibleOneEach = activeMode === "one" && activeNames.length > activeOptions.length;
  const validDraft = !!activeNames.length && !!activeOptions.length && !impossibleOneEach && (rosterLocked || !draft.nameDuplicateCount);
  const complete = rosterLocked && results.length >= target;
  qs("#statNames") && (qs("#statNames").textContent = String(activeNames.length));
  qs("#statOptions") && (qs("#statOptions").textContent = String(activeOptions.length));
  qs("#statDrawn") && (qs("#statDrawn").textContent = `${results.length}/${target || 0}`);
  const summary = qs("#drawPlanSummary");
  if(summary){
    summary.textContent = allocationSummary(activeNames, activeOptions, activeMode, rosterLocked ? 0 : draft.duplicateCount, rosterLocked ? 0 : draft.nameDuplicateCount)
      + (rosterLocked ? " Roster locked for this draw." : "");
  }
  const progress = qs("#drawProgress");
  const progressBar = qs("#drawProgressBar");
  const progressText = qs("#drawProgressText");
  if(progress) progress.hidden = !target;
  if(progressBar){
    progressBar.max = target || 1;
    progressBar.value = Math.min(results.length, target || 0);
    progressBar.setAttribute("aria-valuetext", target ? `${results.length} of ${target} assignments` : "Draw not ready");
  }
  if(progressText){
    progressText.textContent = complete
      ? `Complete · ${results.length} assignment${results.length === 1 ? "" : "s"}`
      : `${results.length} of ${target} assigned`;
  }
  const center = qs("#wheelCenterText");
  if(center){
    if(spinning) center.textContent = "Drawing…";
    else if(complete) center.textContent = "Draw complete";
    else if(rosterLocked) center.textContent = `${Math.max(0, target-results.length)} left`;
    else if(activeNames.length) center.textContent = validDraft ? "Ready to draw" : "Check setup";
    else center.textContent = selectedEvent ? "Add names" : "Choose event";
  }
  const list = qs("#resultList");
  if(list){
    if(!results.length){
      list.innerHTML = `<div class="empty">No results yet. Add people and options, then spin or auto draw.</div>`;
    } else {
      list.innerHTML = results.map(r => `<div class="result-row"><b>${escapeHtml(r.person)}</b><span>${escapeHtml(r.pick)}</span></div>`).join("");
    }
  }
  ["#exportBtn","#shareBtn","#imageBtn","#printBtn"].forEach(selector => {
    const button = qs(selector);
    if(button) button.disabled = !results.length;
  });
  qs("#spinBtn") && (qs("#spinBtn").disabled = !!spinning || complete || (!rosterLocked && !validDraft));
  qs("#autoBtn") && (qs("#autoBtn").disabled = !!spinning || complete || (!rosterLocked && !validDraft));
  qs("#resetBtn") && (qs("#resetBtn").disabled = !!spinning);
  const loadButton = qs("#loadBtn");
  if(loadButton){
    loadButton.disabled = rosterLocked || !!spinning;
    loadButton.textContent = rosterLocked ? "Draw started" : "Start draw";
  }
}
function makePayload(){
  const draft = getDraftState();
  return {
    event: selectedEvent?.name || "Custom Sweepstake",
    createdAt: new Date().toISOString(),
    results: results,
    names: rosterLocked ? participants : draft.names,
    options: rosterLocked ? lockedOptions : draft.options,
    allocationMode:rosterLocked ? drawMode : draft.mode
  };
}
function exportResults(){
  if(!results.length){
    toast("Complete a draw before downloading the CSV.");
    return;
  }
  downloadCsv(makePayload());
  toast("Results CSV downloaded.");
}
function csvCell(value){
  const s = String(value ?? "");
  if(/[",\n\r]/.test(s)) return `"${s.replace(/"/g,'""')}"`;
  return s;
}
function downloadCsv(payload){
  const rows = [["Event","Person","Assigned"]];
  (payload.results || []).forEach(r => rows.push([payload.event || "", r.person, r.pick]));
  const csv = rows.map(row => row.map(csvCell).join(",")).join("\n");
  const blob = new Blob([csv], {type:"text/csv;charset=utf-8"});
  const a = document.createElement("a");
  const safeName = (payload.event || "sweepstake-results").toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"");
  a.href = URL.createObjectURL(blob);
  a.download = `${safeName || "sweepstake"}-results.csv`;
  document.body.appendChild(a);
  a.click();
  setTimeout(()=>{ URL.revokeObjectURL(a.href); a.remove(); }, 200);
}
function groupedResults(payload){
  const groups = [];
  const byPerson = new Map();
  (payload.results || []).forEach(result => {
    const person = String(result.person || "Participant");
    let group = byPerson.get(person);
    if(!group){
      group = {person, picks:[]};
      byPerson.set(person, group);
      groups.push(group);
    }
    group.picks.push(String(result.pick || ""));
  });
  return groups;
}
function resultFileName(payload, extension){
  const base = String(payload.event || "sweepstake-results")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g,"-")
    .replace(/^-|-$/g,"") || "sweepstake-results";
  return `${base}-results.${extension}`;
}
function resultShareText(payload){
  const rows = groupedResults(payload).map(group => `${group.person}: ${group.picks.join(", ")}`);
  return [`${payload.event || "Sweepstake"} results`, "", ...rows, "", "Created at sweepstakewheel.com"].join("\n");
}
function downloadBlob(blob, fileName){
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  setTimeout(() => {
    URL.revokeObjectURL(link.href);
    link.remove();
  }, 200);
}
function roundedRect(context, x, y, width, height, radius){
  const r = Math.min(radius, width / 2, height / 2);
  context.beginPath();
  context.moveTo(x + r, y);
  context.arcTo(x + width, y, x + width, y + height, r);
  context.arcTo(x + width, y + height, x, y + height, r);
  context.arcTo(x, y + height, x, y, r);
  context.arcTo(x, y, x + width, y, r);
  context.closePath();
}
function fittedCanvasText(context, value, maxWidth){
  const text = String(value || "");
  if(context.measureText(text).width <= maxWidth) return text;
  let fitted = text;
  while(fitted.length > 1 && context.measureText(`${fitted}…`).width > maxWidth){
    fitted = fitted.slice(0,-1);
  }
  return `${fitted}…`;
}
async function createResultImageBlob(payload){
  if(document.fonts?.ready){
    try{ await document.fonts.ready; }catch(_error){ /* System fonts are an acceptable fallback. */ }
  }
  const groups = groupedResults(payload);
  const canvas = document.createElement("canvas");
  const width = 1200;
  const columns = groups.length > 16 ? 2 : 1;
  const rowsPerColumn = Math.max(1, Math.ceil(groups.length / columns));
  const rowHeight = 82;
  const headerHeight = 264;
  const footerHeight = 92;
  const height = Math.max(760, headerHeight + rowsPerColumn * rowHeight + footerHeight);
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if(!context) throw new Error("Image creation is unavailable");

  const background = context.createLinearGradient(0,0,width,height);
  background.addColorStop(0,"#07121f");
  background.addColorStop(.56,"#10213b");
  background.addColorStop(1,"#1d3152");
  context.fillStyle = background;
  context.fillRect(0,0,width,height);
  context.globalAlpha = .16;
  context.fillStyle = "#5b9dff";
  context.beginPath(); context.arc(width - 80,40,260,0,Math.PI*2); context.fill();
  context.fillStyle = "#35d07f";
  context.beginPath(); context.arc(90,height - 30,220,0,Math.PI*2); context.fill();
  context.globalAlpha = 1;

  context.fillStyle = "#ffd166";
  context.font = "900 26px system-ui, -apple-system, Segoe UI, sans-serif";
  context.fillText("SWEEPSTAKE WHEEL",64,68);
  context.fillStyle = "#ffffff";
  context.font = "900 54px system-ui, -apple-system, Segoe UI, sans-serif";
  context.fillText(fittedCanvasText(context, payload.event || "Sweepstake results", width - 128),64,138);
  context.fillStyle = "#b9c9df";
  context.font = "700 24px system-ui, -apple-system, Segoe UI, sans-serif";
  context.fillText(`${payload.results.length} assignment${payload.results.length === 1 ? "" : "s"} · randomised on this device`,64,184);

  const side = 64;
  const gap = 24;
  const columnWidth = (width - side * 2 - gap * (columns - 1)) / columns;
  groups.forEach((group, index) => {
    const column = Math.floor(index / rowsPerColumn);
    const row = index % rowsPerColumn;
    const x = side + column * (columnWidth + gap);
    const y = headerHeight + row * rowHeight;
    roundedRect(context,x,y,columnWidth,rowHeight - 12,16);
    context.fillStyle = "rgba(255,255,255,.1)";
    context.fill();
    context.fillStyle = "#ffffff";
    context.font = "900 24px system-ui, -apple-system, Segoe UI, sans-serif";
    context.fillText(fittedCanvasText(context,group.person,columnWidth - 40),x + 20,y + 28);
    context.fillStyle = "#d8e5f6";
    context.font = "700 20px system-ui, -apple-system, Segoe UI, sans-serif";
    context.fillText(fittedCanvasText(context,group.picks.join(", "),columnWidth - 40),x + 20,y + 56);
  });

  context.fillStyle = "#ffffff";
  context.font = "900 22px system-ui, -apple-system, Segoe UI, sans-serif";
  context.fillText("sweepstakewheel.com",64,height - 42);
  context.fillStyle = "#b9c9df";
  context.textAlign = "right";
  context.font = "700 18px system-ui, -apple-system, Segoe UI, sans-serif";
  context.fillText("Free event sweepstake generator",width - 64,height - 42);
  context.textAlign = "left";

  return new Promise((resolve,reject) => {
    canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error("Image creation failed")),"image/png");
  });
}
async function downloadResultImage(){
  if(!results.length){
    toast("Complete at least one assignment before downloading an image.");
    return;
  }
  try{
    const payload = makePayload();
    const blob = await createResultImageBlob(payload);
    downloadBlob(blob,resultFileName(payload,"png"));
    toast("Result image downloaded.");
  }catch(_error){
    toast("The result image could not be created in this browser.");
  }
}
async function shareResults(){
  if(!results.length){
    toast("Complete at least one assignment before sharing.");
    return;
  }
  const payload = makePayload();
  const text = resultShareText(payload);
  try{
    if(typeof navigator.share === "function"){
      const shareData = {title:`${payload.event} results`, text, url:location.href};
      try{
        const blob = await createResultImageBlob(payload);
        const file = new File([blob],resultFileName(payload,"png"),{type:"image/png"});
        if(typeof navigator.canShare === "function" && navigator.canShare({files:[file]})) shareData.files = [file];
      }catch(_error){ /* Text sharing still works when file sharing is unavailable. */ }
      await navigator.share(shareData);
      toast("Draw shared.");
      return;
    }
    if(navigator.clipboard?.writeText){
      await navigator.clipboard.writeText(text);
      toast("Result summary copied for sharing.");
      return;
    }
    await downloadResultImage();
  }catch(error){
    if(error?.name !== "AbortError") toast("Sharing was not available. Try downloading the result image instead.");
  }
}
function printResults(){
  if(!results.length){
    toast("Complete at least one assignment before printing.");
    return;
  }
  const payload = makePayload();
  let sheet = qs("#printSheet");
  if(!sheet){
    sheet = document.createElement("section");
    sheet.id = "printSheet";
    sheet.className = "print-sheet";
    document.body.appendChild(sheet);
  }
  const rows = groupedResults(payload).map(group => `<tr><th scope="row">${escapeHtml(group.person)}</th><td>${escapeHtml(group.picks.join(", "))}</td></tr>`).join("");
  sheet.innerHTML = `<header><p>Sweepstake Wheel</p><h1>${escapeHtml(payload.event)} results</h1><span>${payload.results.length} assignment${payload.results.length === 1 ? "" : "s"} · created at sweepstakewheel.com</span></header><table><thead><tr><th>Participant</th><th>Assigned</th></tr></thead><tbody>${rows}</tbody></table>`;
  document.body.classList.add("print-results-only");
  let cleanupTimer;
  const cleanup = () => {
    window.removeEventListener("afterprint", cleanup);
    clearTimeout(cleanupTimer);
    document.body.classList.remove("print-results-only");
    sheet.remove();
  };
  window.addEventListener("afterprint", cleanup, {once:true});
  cleanupTimer = setTimeout(cleanup, 60000);
  window.print();
}
function bind(){
  qs("#eventSearch")?.addEventListener("input", renderEventCards);
  qs("#loadBtn")?.addEventListener("click", loadDraw);
  qs("#spinBtn")?.addEventListener("click", spinOne);
  qs("#autoBtn")?.addEventListener("click", autoDraw);
  qs("#resetBtn")?.addEventListener("click", resetDraw);
  qs("#exportBtn")?.addEventListener("click", exportResults);
  qs("#shareBtn")?.addEventListener("click", () => { void shareResults(); });
  qs("#imageBtn")?.addEventListener("click", () => { void downloadResultImage(); });
  qs("#printBtn")?.addEventListener("click", printResults);
  qs("#namesInput")?.addEventListener("input", syncDraft);
  qs("#optionsInput")?.addEventListener("input", syncDraft);
  qsa('input[name="allocationMode"], #allocationMode').forEach(control => control.addEventListener("change", syncDraft));
  document.addEventListener("click", trackAffiliateClick);
}
async function init(){
  await loadEventData();
  updateSeasonalState();
  renderSeasonalHomepage();
  renderFilters();
  renderEventCards();
  populateSelector();
  bind();
  maybeSeedNames();
  const pathSlug = slugFromPath();
  const initialSlug = pathSlug || (seasonalFocus?.mode === "private-name-draw" ? "custom-sweepstake-generator" : seasonalFocus?.slug) || "world-cup-sweepstake";
  selectEvent(initialSlug, false);
}
document.addEventListener("DOMContentLoaded", () => { void init(); });
