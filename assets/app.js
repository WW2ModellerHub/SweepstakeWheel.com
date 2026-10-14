
const EVENTS_FALLBACK = window.SWEEPSTAKE_EVENTS_FALLBACK || [];

let events = EVENTS_FALLBACK;
let selectedEvent = null;
let participants = [];
let drawPool = [];
let results = [];
let spinning = false;
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
function shuffle(items){
  const arr = [...items];
  for(let i=arr.length-1;i>0;i--){
    const j = Math.floor(Math.random()*(i+1));
    [arr[i],arr[j]]=[arr[j],arr[i]];
  }
  return arr;
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
function selectEvent(slug, scroll){
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
  drawPool = [...selectedEvent.options];
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
function buildPool(options, count){
  if(!options.length) return [];
  const pool = [];
  while(pool.length < count){
    pool.push(...shuffle(options));
  }
  return shuffle(pool.slice(0, count));
}
function loadDraw(){
  const namesInput = qs("#namesInput");
  const optionsInput = qs("#optionsInput");
  participants = lines(namesInput?.value || "");
  const options = lines(optionsInput?.value || "");
  if(participants.length < 1){
    toast("Add at least one person first.");
    namesInput?.focus();
    return;
  }
  if(options.length < 1){
    toast("Add at least one team, horse, option or prize.");
    optionsInput?.focus();
    return;
  }
  drawPool = buildPool(options, participants.length);
  results = [];
  renderWheel(drawPool);
  updateUi();
  toast("Draw loaded. Spin one or auto draw everyone.");
}
function spinOne(){
  if(spinning) return;
  if(!participants.length || !drawPool.length){
    loadDraw();
    if(!participants.length || !drawPool.length) return;
  }
  if(results.length >= participants.length){
    toast("Everyone has already been drawn.");
    return;
  }
  spinning = true;
  const wheel = qs("#wheelSvg");
  if(wheel){
    wheel.style.transition = "transform 1.15s cubic-bezier(.16,.9,.22,1)";
    const turns = 720 + Math.floor(Math.random()*720);
    const current = Number(wheel.dataset.rotation || 0);
    wheel.dataset.rotation = current + turns;
    wheel.style.transform = `rotate(${current + turns}deg)`;
  }
  setTimeout(() => {
    const person = participants[results.length];
    const idx = Math.floor(Math.random()*drawPool.length);
    const picked = drawPool.splice(idx,1)[0];
    results.push({ person, pick: picked });
    spinning = false;
    renderWheel(drawPool.length ? drawPool : lines(qs("#optionsInput")?.value || ""));
    updateUi();
  }, 900);
}
function autoDraw(){
  if(!participants.length || !drawPool.length){
    loadDraw();
    if(!participants.length || !drawPool.length) return;
  }
  while(results.length < participants.length && drawPool.length){
    const person = participants[results.length];
    const idx = Math.floor(Math.random()*drawPool.length);
    const picked = drawPool.splice(idx,1)[0];
    results.push({ person, pick: picked });
  }
  renderWheel(lines(qs("#optionsInput")?.value || ""));
  updateUi();
  toast("Auto draw complete.");
}
function resetDraw(){
  results = [];
  participants = [];
  drawPool = lines(qs("#optionsInput")?.value || "");
  renderWheel(drawPool);
  updateUi();
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
  qs("#statNames") && (qs("#statNames").textContent = String(participants.length || lines(qs("#namesInput")?.value || "").length));
  qs("#statOptions") && (qs("#statOptions").textContent = String(lines(qs("#optionsInput")?.value || "").length));
  qs("#statDrawn") && (qs("#statDrawn").textContent = `${results.length}/${participants.length || 0}`);
  const center = qs("#wheelCenterText");
  if(center){
    if(results.length && results.length === participants.length) center.textContent = "Draw complete";
    else if(participants.length) center.textContent = `${Math.max(0, participants.length-results.length)} left`;
    else center.textContent = selectedEvent ? "Add names" : "Choose event";
  }
  const list = qs("#resultList");
  if(list){
    if(!results.length){
      list.innerHTML = `<div class="empty">No results yet. Add names, load the draw, then spin or auto draw.</div>`;
    } else {
      list.innerHTML = results.map(r => `<div class="result-row"><b>${escapeHtml(r.person)}</b><span>${escapeHtml(r.pick)}</span></div>`).join("");
    }
  }
  qs("#exportBtn") && (qs("#exportBtn").disabled = !results.length);
  qs("#spinBtn") && (qs("#spinBtn").disabled = !!spinning || (participants.length && results.length >= participants.length));
  qs("#autoBtn") && (qs("#autoBtn").disabled = !!spinning);
}
function makePayload(){
  return {
    event: selectedEvent?.name || "Custom Sweepstake",
    createdAt: new Date().toISOString(),
    results: results,
    names: participants,
    options: lines(qs("#optionsInput")?.value || "")
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
function bind(){
  qs("#eventSearch")?.addEventListener("input", renderEventCards);
  qs("#loadBtn")?.addEventListener("click", loadDraw);
  qs("#spinBtn")?.addEventListener("click", spinOne);
  qs("#autoBtn")?.addEventListener("click", autoDraw);
  qs("#resetBtn")?.addEventListener("click", resetDraw);
  qs("#exportBtn")?.addEventListener("click", exportResults);
  qs("#namesInput")?.addEventListener("input", updateUi);
  qs("#optionsInput")?.addEventListener("input", () => {
    drawPool = lines(qs("#optionsInput").value);
    renderWheel(drawPool);
    updateUi();
  });
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
