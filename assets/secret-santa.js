(function (root) {
  "use strict";

  const AMAZON_TAG = "sweepstakewheel-21";
  const randomBuffer = new Uint32Array(128);
  let randomBufferIndex = randomBuffer.length;

  function normaliseName(value) {
    return String(value || "").normalize("NFKC").trim().replace(/\s+/g, " ");
  }

  function parseNames(value) {
    return String(value || "")
      .split(/\r?\n/)
      .map(normaliseName)
      .filter(Boolean);
  }

  function randomInt(maxExclusive) {
    if (!Number.isInteger(maxExclusive) || maxExclusive < 1) return 0;
    if (!root.crypto || typeof root.crypto.getRandomValues !== "function") {
      throw new Error("Secure random drawing is unavailable in this browser. Please update it and try again.");
    }
    const range = 0x100000000;
    const limit = range - (range % maxExclusive);
    let value;
    do {
      if (randomBufferIndex >= randomBuffer.length) {
        root.crypto.getRandomValues(randomBuffer);
        randomBufferIndex = 0;
      }
      value = randomBuffer[randomBufferIndex];
      randomBufferIndex += 1;
    } while (value >= limit);
    return value % maxExclusive;
  }

  function secureShuffle(items) {
    const shuffled = [...items];
    for (let index = shuffled.length - 1; index > 0; index -= 1) {
      const random = randomInt(index + 1);
      [shuffled[index], shuffled[random]] = [shuffled[random], shuffled[index]];
    }
    return shuffled;
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

    let recipients = [];
    do {
      recipients = secureShuffle(clean);
    } while (recipients.some((recipient, index) => recipient === clean[index]));

    return clean.map((giver, index) => ({ giver, recipient: recipients[index] }));
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
  const qsa = (selector, scope = document) => Array.from(scope.querySelectorAll(selector));
  const namesInput = qs("#ssNamesInput");
  const modeInputs = qsa('input[name="ssMode"]');
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
  const organiserView = qs("#ssOrganiserView");
  const giverName = qs("#ssGiverName");
  const recipientName = qs("#ssRecipientName");
  const organiserTitle = qs("#ssOrganiserTitle");
  const organiserList = qs("#ssOrganiserList");
  const organiserStatus = qs("#ssOrganiserStatus");
  const progress = qs("#ssProgress");
  const statusCount = qs("#ssParticipantCount");
  const statusRevealed = qs("#ssRevealedCount");
  const statusActionLabel = qs("#ssStatusActionLabel");
  const modeSummaryTitle = qs("#ssModeSummaryTitle");
  const modeSummaryText = qs("#ssModeSummaryText");
  const modeHelpTitle = qs("#ssModeHelpTitle");
  const modeHelpText = qs("#ssModeHelpText");
  const budgetSelect = qs("#ssBudget");
  const giftLink = qs("#ssGiftIdeasLink");
  const completeGiftLink = qs("#ssCompleteGiftLink");
  const organiserGiftLink = qs("#ssOrganiserGiftLink");
  const csvButton = qs("#ssCsvBtn");
  const printButton = qs("#ssPrintBtn");
  const redrawButton = qs("#ssRedrawBtn");
  const editButton = qs("#ssEditBtn");

  let assignments = [];
  let revealIndex = 0;
  let recipientVisible = false;
  let drawMode = "private";
  let focusAfterDialogClose = null;

  function setView(view) {
    [passView, revealView, completeView, organiserView].forEach((item) => {
      if (item) item.hidden = item !== view;
    });
  }

  function clearSensitiveOutput() {
    if (recipientName) recipientName.textContent = "";
    if (giverName) giverName.textContent = "";
    if (organiserList) organiserList.replaceChildren();
    if (organiserStatus) organiserStatus.textContent = "";
    recipientVisible = false;
  }

  function readMode() {
    return modeInputs.find((input) => input.checked)?.value === "organiser" ? "organiser" : "private";
  }

  function setControlsLocked(locked) {
    if (namesInput) namesInput.readOnly = locked;
    modeInputs.forEach((input) => { input.disabled = locked; });
    if (budgetSelect) budgetSelect.disabled = locked;
    if (createButton) createButton.disabled = locked;
  }

  function updateCounts() {
    const entered = parseNames(namesInput?.value || "").length;
    if (statusCount) statusCount.textContent = String(assignments.length || entered);
    if (statusActionLabel) statusActionLabel.textContent = drawMode === "organiser" ? "Assigned" : "Viewed";
    if (statusRevealed) {
      const completed = drawMode === "organiser" && assignments.length
        ? assignments.length
        : Math.min(revealIndex, assignments.length);
      statusRevealed.textContent = `${completed}/${assignments.length || entered}`;
    }
  }

  function giftQuery() {
    const budget = budgetSelect?.value || "20";
    return budget === "any"
      ? "Secret Santa gift ideas"
      : `Secret Santa gift ideas £${budget} budget`;
  }

  function updateGiftLinks() {
    const href = amazonUrl(giftQuery());
    [giftLink, completeGiftLink, organiserGiftLink].forEach((link) => {
      if (link) link.href = href;
    });
  }

  function updateModeUi() {
    drawMode = readMode();
    const organiser = drawMode === "organiser";
    if (createButton) createButton.textContent = organiser ? "Create organiser list" : "Create pass-around draw";
    if (statusActionLabel) statusActionLabel.textContent = organiser ? "Assigned" : "Viewed";
    if (modeSummaryTitle) modeSummaryTitle.textContent = organiser ? "🔐 Complete list for one organiser" : "🔒 Private on one shared device";
    if (modeSummaryText) {
      modeSummaryText.textContent = organiser
        ? "You will see every giver and recipient in one private list. Names and assignments are not uploaded, emailed or saved by the site."
        : "Only the current participant’s recipient appears. Hide the name before passing the device to the next person. Names and assignments are not uploaded, emailed or saved.";
    }
    if (modeHelpTitle) modeHelpTitle.textContent = organiser ? "How organiser mode works" : "How the handover works";
    if (modeHelpText) {
      modeHelpText.textContent = organiser
        ? "Create the list, then privately tell each participant who they are buying for. You can download a CSV or print the list on this device."
        : "We first show who should hold the device. That person taps reveal, remembers their recipient, then hides the name before the next turn.";
    }
    if (!assignments.length && progress) {
      progress.textContent = organiser
        ? "The full list of who buys for whom will be shown only to the organiser on this device."
        : "Each person will reveal only their own recipient on this device.";
    }
    updateCounts();
  }

  function preparePassView() {
    clearSensitiveOutput();
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

  function renderOrganiserAssignments() {
    if (!organiserList) return;
    organiserList.replaceChildren();
    assignments.forEach((assignment) => {
      const row = document.createElement("div");
      row.className = "secret-santa-organiser-row";
      row.setAttribute("role", "row");
      const giver = document.createElement("strong");
      giver.setAttribute("role", "cell");
      giver.textContent = assignment.giver;
      const recipient = document.createElement("span");
      recipient.setAttribute("role", "cell");
      recipient.textContent = assignment.recipient;
      row.append(giver, recipient);
      organiserList.appendChild(row);
    });
  }

  function prepareOrganiserView() {
    if (recipientName) recipientName.textContent = "";
    if (giverName) giverName.textContent = "";
    recipientVisible = false;
    renderOrganiserAssignments();
    if (progress) progress.textContent = `${assignments.length} private Secret Santa assignments created for the organiser.`;
    if (organiserStatus) organiserStatus.textContent = "List ready. Download, print or privately send each person their match.";
    setView(organiserView);
    organiserTitle?.focus();
  }

  function startDraw() {
    try {
      drawMode = readMode();
      assignments = createAssignments(parseNames(namesInput?.value || ""));
    } catch (error) {
      if (progress) progress.textContent = error.message;
      namesInput?.focus();
      return;
    }

    revealIndex = 0;
    clearSensitiveOutput();
    setControlsLocked(true);
    updateCounts();
    updateGiftLinks();
    if (dialog && !dialog.open && typeof dialog.showModal === "function") dialog.showModal();
    if (drawMode === "organiser") prepareOrganiserView();
    else preparePassView();
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
    clearSensitiveOutput();
    revealIndex += 1;
    updateCounts();
    preparePassView();
  }

  function resetDraw({ closeDialog = true } = {}) {
    clearSensitiveOutput();
    document.body.classList.remove("print-secret-santa");
    qs("#ssPrintSheet")?.remove();
    assignments = [];
    revealIndex = 0;
    if (closeDialog && dialog?.open) dialog.close();
    setControlsLocked(false);
    setView(passView);
    updateModeUi();
  }

  function startAnotherDraw() {
    focusAfterDialogClose = namesInput;
    resetDraw();
  }

  function safeCsvCell(value) {
    let text = String(value ?? "");
    if (/^[=+\-@]/.test(text)) text = `'${text}`;
    return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  }

  function downloadOrganiserCsv() {
    if (drawMode !== "organiser" || !assignments.length) return;
    const rows = [["Participant", "Buys for"], ...assignments.map((item) => [item.giver, item.recipient])];
    const csv = `\uFEFF${rows.map((row) => row.map(safeCsvCell).join(",")).join("\r\n")}`;
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = "secret-santa-private-assignments.csv";
    document.body.appendChild(link);
    link.click();
    setTimeout(() => {
      URL.revokeObjectURL(link.href);
      link.remove();
    }, 200);
    if (organiserStatus) organiserStatus.textContent = "Private CSV downloaded. Keep it somewhere secure.";
  }

  function buildPrintSheet() {
    qs("#ssPrintSheet")?.remove();
    const sheet = document.createElement("section");
    sheet.id = "ssPrintSheet";
    sheet.className = "print-sheet secret-santa-print-sheet";
    const header = document.createElement("header");
    const label = document.createElement("p");
    label.textContent = "Sweepstake Wheel · private organiser copy";
    const title = document.createElement("h1");
    title.textContent = "Secret Santa assignments";
    const warning = document.createElement("span");
    warning.textContent = "Keep this list private and share each person’s assignment separately.";
    header.append(label, title, warning);
    const table = document.createElement("table");
    const thead = document.createElement("thead");
    const headingRow = document.createElement("tr");
    ["Participant", "Buys for"].forEach((value) => {
      const heading = document.createElement("th");
      heading.scope = "col";
      heading.textContent = value;
      headingRow.appendChild(heading);
    });
    thead.appendChild(headingRow);
    const tbody = document.createElement("tbody");
    assignments.forEach((assignment) => {
      const row = document.createElement("tr");
      const giver = document.createElement("th");
      giver.scope = "row";
      giver.textContent = assignment.giver;
      const recipient = document.createElement("td");
      recipient.textContent = assignment.recipient;
      row.append(giver, recipient);
      tbody.appendChild(row);
    });
    table.append(thead, tbody);
    sheet.append(header, table);
    document.body.appendChild(sheet);
    return sheet;
  }

  function printOrganiserAssignments() {
    if (drawMode !== "organiser" || !assignments.length) return;
    const sheet = buildPrintSheet();
    document.body.classList.add("print-secret-santa");
    let cleanupTimer;
    const cleanup = () => {
      root.removeEventListener("afterprint", cleanup);
      clearTimeout(cleanupTimer);
      document.body.classList.remove("print-secret-santa");
      sheet.remove();
    };
    root.addEventListener("afterprint", cleanup, { once: true });
    cleanupTimer = setTimeout(cleanup, 60000);
    root.print();
  }

  function redrawOrganiserAssignments() {
    if (drawMode !== "organiser") return;
    clearSensitiveOutput();
    assignments = [];
    revealIndex = 0;
    setControlsLocked(false);
    startDraw();
    if (organiserStatus) organiserStatus.textContent = "A new private list has been created.";
  }

  function editParticipants() {
    focusAfterDialogClose = namesInput;
    resetDraw();
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
  modeInputs.forEach((input) => input.addEventListener("change", updateModeUi));
  resetButton?.addEventListener("click", () => {
    resetDraw();
    if (namesInput) namesInput.value = "";
    updateCounts();
    namesInput?.focus();
  });
  revealButton?.addEventListener("click", revealRecipient);
  nextButton?.addEventListener("click", hideAndContinue);
  cancelButton?.addEventListener("click", () => {
    focusAfterDialogClose = createButton;
    resetDraw();
  });
  newDrawButton?.addEventListener("click", startAnotherDraw);
  csvButton?.addEventListener("click", downloadOrganiserCsv);
  printButton?.addEventListener("click", printOrganiserAssignments);
  redrawButton?.addEventListener("click", redrawOrganiserAssignments);
  editButton?.addEventListener("click", editParticipants);
  namesInput?.addEventListener("input", updateCounts);
  budgetSelect?.addEventListener("change", updateGiftLinks);
  document.addEventListener("click", trackAffiliateClick);

  dialog?.addEventListener("cancel", () => {
    focusAfterDialogClose = createButton;
  });
  dialog?.addEventListener("close", () => {
    const returnTarget = focusAfterDialogClose || createButton;
    focusAfterDialogClose = null;
    resetDraw({ closeDialog: false });
    requestAnimationFrame(() => returnTarget?.focus());
  });

  updateCounts();
  updateGiftLinks();
  updateModeUi();
})(typeof window !== "undefined" ? window : globalThis);
