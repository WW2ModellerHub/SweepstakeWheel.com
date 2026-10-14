(function (root) {
  "use strict";

  const AMAZON_TAG = "sweepstakewheel-21";

  function normaliseName(value) {
    return String(value || "").trim().replace(/\s+/g, " ");
  }

  function parseNames(value) {
    return String(value || "")
      .split(/\r?\n/)
      .map(normaliseName)
      .filter(Boolean);
  }

  function randomInt(maxExclusive) {
    if (!Number.isInteger(maxExclusive) || maxExclusive < 1) return 0;
    if (root.crypto && typeof root.crypto.getRandomValues === "function") {
      const range = 0x100000000;
      const limit = range - (range % maxExclusive);
      const values = new Uint32Array(1);
      do root.crypto.getRandomValues(values); while (values[0] >= limit);
      return values[0] % maxExclusive;
    }
    return Math.floor(Math.random() * maxExclusive);
  }

  function createAssignments(names) {
    const clean = names.map(normaliseName).filter(Boolean);
    if (clean.length < 2) throw new Error("Add at least two people.");

    const seen = new Set();
    clean.forEach((name) => {
      const key = name.toLocaleLowerCase("en-GB");
      if (seen.has(key)) throw new Error(`Each name must be unique. “${name}” appears more than once.`);
      seen.add(key);
    });

    const recipients = clean.map((name, id) => ({ id, name }));
    for (let i = recipients.length - 1; i > 0; i -= 1) {
      const j = randomInt(i);
      [recipients[i], recipients[j]] = [recipients[j], recipients[i]];
    }

    return clean.map((giver, id) => ({ giver, recipient: recipients[id].name }));
  }

  function amazonUrl(query) {
    const params = new URLSearchParams({ k: query, tag: AMAZON_TAG });
    return `https://www.amazon.co.uk/s?${params.toString()}`;
  }

  const api = { createAssignments, parseNames };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.SecretSantaTools = api;

  if (typeof document === "undefined") return;

  const qs = (selector, scope = document) => scope.querySelector(selector);
  const namesInput = qs("#ssNamesInput");
  const createButton = qs("#ssCreateBtn");
  const resetButton = qs("#ssResetBtn");
  const revealButton = qs("#ssRevealBtn");
  const nextButton = qs("#ssHideNextBtn");
  const cancelButton = qs("#ssCancelBtn");
  const newDrawButton = qs("#ssNewDrawBtn");
  const dialog = qs("#ssDialog");
  const passView = qs("#ssPassView");
  const revealView = qs("#ssRevealView");
  const completeView = qs("#ssCompleteView");
  const giverName = qs("#ssGiverName");
  const recipientName = qs("#ssRecipientName");
  const progress = qs("#ssProgress");
  const statusCount = qs("#ssParticipantCount");
  const statusRevealed = qs("#ssRevealedCount");
  const budgetSelect = qs("#ssBudget");
  const giftLink = qs("#ssGiftIdeasLink");
  const completeGiftLink = qs("#ssCompleteGiftLink");

  let assignments = [];
  let revealIndex = 0;
  let recipientVisible = false;

  function setView(view) {
    [passView, revealView, completeView].forEach((item) => {
      if (item) item.hidden = item !== view;
    });
  }

  function clearPrivateText() {
    if (recipientName) recipientName.textContent = "";
    recipientVisible = false;
  }

  function updateCounts() {
    const entered = parseNames(namesInput?.value || "").length;
    if (statusCount) statusCount.textContent = String(assignments.length || entered);
    if (statusRevealed) statusRevealed.textContent = `${Math.min(revealIndex, assignments.length)}/${assignments.length || entered}`;
  }

  function giftQuery() {
    const budget = budgetSelect?.value || "20";
    return budget === "any"
      ? "Secret Santa gift ideas"
      : `Secret Santa gift ideas £${budget} budget`;
  }

  function updateGiftLinks() {
    const href = amazonUrl(giftQuery());
    [giftLink, completeGiftLink].forEach((link) => {
      if (link) link.href = href;
    });
  }

  function preparePassView() {
    clearPrivateText();
    if (!assignments.length || revealIndex >= assignments.length) {
      assignments = [];
      setView(completeView);
      if (progress) progress.textContent = "Everyone has privately viewed their Secret Santa match.";
      if (statusRevealed) statusRevealed.textContent = `${revealIndex}/${revealIndex}`;
      completeView?.querySelector("h3")?.focus();
      return;
    }

    const current = assignments[revealIndex];
    if (giverName) giverName.textContent = current.giver;
    if (progress) progress.textContent = `Ready for person ${revealIndex + 1} of ${assignments.length}.`;
    setView(passView);
    revealButton?.focus();
  }

  function startDraw() {
    try {
      assignments = createAssignments(parseNames(namesInput?.value || ""));
    } catch (error) {
      if (progress) progress.textContent = error.message;
      namesInput?.focus();
      return;
    }

    revealIndex = 0;
    clearPrivateText();
    updateCounts();
    updateGiftLinks();
    if (dialog && typeof dialog.showModal === "function") dialog.showModal();
    preparePassView();
  }

  function revealRecipient() {
    const current = assignments[revealIndex];
    if (!current) return;
    if (recipientName) recipientName.textContent = current.recipient;
    recipientVisible = true;
    setView(revealView);
    recipientName?.focus();
  }

  function hideAndContinue() {
    if (!recipientVisible) return;
    clearPrivateText();
    revealIndex += 1;
    updateCounts();
    preparePassView();
  }

  function resetDraw({ closeDialog = true } = {}) {
    clearPrivateText();
    assignments = [];
    revealIndex = 0;
    if (closeDialog && dialog?.open) dialog.close();
    if (progress) progress.textContent = "Names stay on this device and are cleared when you reset or reload.";
    updateCounts();
    setView(passView);
  }

  function startAnotherDraw() {
    resetDraw();
    namesInput?.focus();
  }

  function trackAffiliateClick(event) {
    const link = event.target.closest("a[href*='amazon.co.uk']");
    if (!link || typeof root.gtag !== "function") return;
    root.gtag("event", "affiliate_click", {
      event_slug: "secret-santa-wheel",
      placement: link.dataset.affiliatePlacement || "secret-santa",
      link_label: normaliseName(link.textContent).slice(0, 80)
    });
  }

  createButton?.addEventListener("click", startDraw);
  resetButton?.addEventListener("click", () => {
    resetDraw();
    if (namesInput) namesInput.value = "";
    updateCounts();
    namesInput?.focus();
  });
  revealButton?.addEventListener("click", revealRecipient);
  nextButton?.addEventListener("click", hideAndContinue);
  cancelButton?.addEventListener("click", () => resetDraw());
  newDrawButton?.addEventListener("click", startAnotherDraw);
  namesInput?.addEventListener("input", updateCounts);
  budgetSelect?.addEventListener("change", updateGiftLinks);
  document.addEventListener("click", trackAffiliateClick);

  dialog?.addEventListener("cancel", (event) => {
    if (assignments.length) {
      event.preventDefault();
      if (progress) progress.textContent = "Use “Cancel this draw” so the private assignments are cleared safely.";
    }
  });
  dialog?.addEventListener("close", () => {
    if (assignments.length) resetDraw({ closeDialog: false });
  });

  updateCounts();
  updateGiftLinks();
})(typeof window !== "undefined" ? window : globalThis);
