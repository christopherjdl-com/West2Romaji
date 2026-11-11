import { injectGlassFilter } from "./glass.js";
import { userMessage } from "./errors.js";
import { formatElapsed, formatWhen, wordCount } from "./format.js";
import { createHistory } from "./history.js";
import { haptic } from "./haptics.js";
import { FUNCTION_URL, FUNCTION_URL_TOKYO } from "./config.js";
import { functionUrlForZone } from "./region.js";
import { createKeyStore, isLocalDebug } from "./keychain.js";
import { translateWithFunction } from "./remote.js";
import { MAX_CHARS, WORD_HINT, translatePhrase } from "./translate.js";

const SETTINGS_KEY = "west2romaji.settings";
const $ = (id) => document.getElementById(id);

const state = {
  inCordova: false,
  keyStore: null,
  apiKey: "",
  provider: "",
  history: null,
  settings: { theme: "system" },
  busy: false,
  undo: null,
  undoTimer: 0,
  clearTimer: 0,
  clearArmed: false,
  settingsReturn: null,
};

function loadSettings() {
  try {
    const parsed = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}");
    return {
      theme: parsed.theme === "light" || parsed.theme === "dark" ? parsed.theme : "system",
    };
  } catch (error) {
    return { theme: "system" };
  }
}

function saveSettings() {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({
      theme: state.settings.theme,
    }));
  } catch (error) {
    /* History and the key have their own stores. Theme can fall back to system. */
  }
}

function isDark(theme) {
  if (theme === "dark") return true;
  if (theme === "light") return false;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function applyTheme(theme) {
  if (theme === "light" || theme === "dark") {
    document.documentElement.setAttribute("data-theme", theme);
  } else {
    document.documentElement.removeAttribute("data-theme");
  }
  const dark = isDark(theme);
  const themeColor = document.querySelector('meta[name="theme-color"]');
  if (themeColor) themeColor.content = dark ? "#070910" : "#e6eef8";
  const bar = globalThis.StatusBar;
  if (!bar) return;
  bar.overlaysWebView(true);
  if (dark) bar.styleLightContent();
  else bar.styleDefault();
}

function syncThemeControls() {
  document.querySelectorAll('input[name="theme"]').forEach((input) => {
    input.checked = input.value === state.settings.theme;
    input.parentElement.classList.toggle("is-selected", input.checked);
  });
}

function setText(id, value) {
  const node = $(id);
  if (node.textContent !== value) node.textContent = value;
}

function refreshComposer() {
  const text = $("source").value;
  const count = wordCount(text);
  setText("composer-hint", count > WORD_HINT
    ? "Longer text can take more than a couple of seconds."
    : "Language is picked up from what you type.");
  setText("word-count", count ? String(count) : "");
  const tooLong = text.trim().length > MAX_CHARS;
  $("translate").disabled = state.busy || !text.trim() || tooLong;
}

function clearSimmerFade(button) {
  const simmer = button.querySelector(".primary-simmer");
  if (simmer) simmer.getAnimations().forEach((anim) => anim.cancel());
  button.classList.remove("is-cooling");
}

function fadeSimmer(button) {
  const simmer = button.querySelector(".primary-simmer");
  if (!simmer) {
    button.classList.remove("is-busy");
    return;
  }
  const style = getComputedStyle(simmer);
  const opacity = style.opacity;
  const filter = style.filter;
  button.classList.remove("is-busy");
  button.classList.add("is-cooling");
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const fade = simmer.animate(
    [
      { opacity, filter },
      { opacity: 0, filter: "hue-rotate(0deg) saturate(1)" },
    ],
    { duration: reduce ? 200 : 700, easing: "ease", fill: "forwards" }
  );
  fade.addEventListener("finish", () => {
    if (button.classList.contains("is-busy")) return;
    clearSimmerFade(button);
  });
}

function setBusy(busy) {
  state.busy = busy;
  const button = $("translate");
  if (busy) {
    clearSimmerFade(button);
    button.classList.add("is-busy");
  } else if (button.classList.contains("is-busy")) {
    fadeSimmer(button);
  }
  button.setAttribute("aria-busy", busy ? "true" : "false");
  setText("translate-label", busy ? "Translating" : "Translate");
  setText("translate-status", busy ? "Translating" : "");
  refreshComposer();
}

function clearError() {
  const error = $("error");
  error.hidden = true;
  error.textContent = "";
}

function showError(error) {
  const node = $("error");
  node.hidden = false;
  node.textContent = userMessage(error);
  haptic("error");
}

const MODEL_MARKS = {
  claude: [
    ["img/bedrock.png", "Amazon Bedrock"],
    ["img/claude.png", "Claude"],
  ],
  nova: [
    ["img/bedrock.png", "Amazon Bedrock"],
    ["img/nova.svg", "Nova"],
  ],
  grok: [["img/grok.svg", "Grok"]],
  gemini: [["img/gemini.svg", "Gemini"]],
};

function modelIcons(model) {
  return MODEL_MARKS[model] || [];
}

function fillModelMark(node, model) {
  node.replaceChildren();
  const icons = modelIcons(model);
  node.hidden = icons.length === 0;
  for (const [src, label] of icons) {
    const image = document.createElement("img");
    image.src = src;
    image.alt = label;
    image.width = 16;
    image.height = 16;
    node.append(image);
  }
}

function showResult(entry) {
  const result = $("result");
  result.hidden = false;
  $("romaji").textContent = entry.romaji;
  $("japanese").textContent = entry.japanese;
  fillModelMark($("model-mark"), entry.model);
  const bits = [];
  if (entry.sourceLang) bits.push(entry.sourceLang);
  if (entry.region) bits.push(entry.region);
  if (Number.isFinite(entry.elapsedMs)) bits.push(formatElapsed(entry.elapsedMs));
  else if (entry.createdAt) bits.push(formatWhen(entry.createdAt));
  $("result-meta").textContent = bits.join(" · ");
  result.classList.remove("rise");
  void result.offsetWidth;
  result.classList.add("rise");
}

function phraseRow(entry) {
  const article = document.createElement("article");
  article.className = "phrase";
  const open = document.createElement("button");
  open.type = "button";
  open.className = "phrase-main";
  open.dataset.open = entry.id;
  const source = document.createElement("span");
  source.className = "phrase-source";
  source.textContent = entry.sourceText;
  const romaji = document.createElement("span");
  romaji.className = "phrase-romaji";
  romaji.textContent = entry.romaji;
  const meta = document.createElement("span");
  meta.className = "phrase-meta";
  const mark = document.createElement("span");
  mark.className = "model-mark";
  fillModelMark(mark, entry.model);
  const metaText = document.createElement("span");
  metaText.textContent = [entry.sourceLang, entry.region, formatWhen(entry.createdAt)].filter(Boolean).join(" · ");
  meta.append(mark, metaText);
  open.append(source, romaji, meta);
  const del = document.createElement("button");
  del.type = "button";
  del.className = "phrase-delete";
  del.dataset.delete = entry.id;
  del.setAttribute("aria-label", "Delete phrase");
  del.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M5 7h14M9 7V5h6v2M8 7l.7 12h6.6L16 7"></path></svg>';
  article.append(open, del);
  return article;
}

function fillList(container, entries) {
  container.replaceChildren(...entries.map(phraseRow));
}

function renderRecent() {
  const entries = state.history.list().slice(0, 3);
  $("recent").hidden = entries.length === 0;
  fillList($("recent-list"), entries);
}

function renderHistory() {
  const entries = state.history.list();
  $("history-empty").hidden = entries.length > 0;
  $("clear-history").hidden = entries.length === 0;
  fillList($("history-list"), entries);
}

function markTab(id, on) {
  const button = $(id);
  if (on) button.setAttribute("aria-current", "page");
  else button.removeAttribute("aria-current");
}

function setTab(tab) {
  $("view-translate").hidden = tab !== "translate";
  $("view-history").hidden = tab !== "history";
  markTab("tab-translate", tab === "translate");
  markTab("tab-history", tab === "history");
  if (tab === "history") renderHistory();
}

function restore(id) {
  const entry = state.history.list().find((item) => item.id === id);
  if (!entry) return;
  $("source").value = entry.sourceText;
  refreshComposer();
  clearError();
  showResult(entry);
  setTab("translate");
  haptic("selection");
}

function hideToast() {
  $("toast").hidden = true;
  state.undo = null;
}

function removeEntry(id) {
  const removed = state.history.remove(id);
  if (!removed) return;
  state.undo = removed;
  $("toast-text").textContent = "Phrase removed";
  $("toast").hidden = false;
  clearTimeout(state.undoTimer);
  state.undoTimer = setTimeout(hideToast, 4200);
  renderRecent();
  renderHistory();
  haptic("light");
}

function onListClick(event) {
  const del = event.target.closest("[data-delete]");
  if (del) {
    removeEntry(del.dataset.delete);
    return;
  }
  const open = event.target.closest("[data-open]");
  if (open) restore(open.dataset.open);
}

function selectResult(id) {
  const node = $(id);
  const range = document.createRange();
  range.selectNodeContents(node);
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
}

function copyWithCommand(value) {
  const area = document.createElement("textarea");
  area.value = value;
  area.setAttribute("readonly", "");
  area.style.position = "fixed";
  area.style.left = "-9999px";
  document.body.appendChild(area);
  area.select();
  let ok = false;
  try {
    ok = document.execCommand("copy");
  } catch (error) {
    ok = false;
  }
  area.remove();
  return ok;
}

async function copyText(value, button) {
  const label = button.querySelector("span");
  const original = label.textContent;
  haptic("light");
  let copied = false;
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value);
      copied = true;
    } catch (error) {
      copied = false;
    }
  }
  if (!copied) copied = copyWithCommand(value);
  if (!copied) selectResult(button.id === "copy-japanese" ? "japanese" : "romaji");
  label.textContent = copied ? "Copied" : "Select the text";
  haptic(copied ? "success" : "error");
  setTimeout(() => {
    label.textContent = original;
  }, 1400);
}

let sheetPin = null;

function placeSheet(sheet) {
  const viewport = window.visualViewport;
  if (!viewport) return;
  sheet.style.top = `${viewport.offsetTop}px`;
  sheet.style.left = `${viewport.offsetLeft}px`;
  sheet.style.width = `${viewport.width}px`;
  sheet.style.height = `${viewport.height}px`;
}

function watchSheet(sheet) {
  const viewport = window.visualViewport;
  if (!viewport) return;
  unwatchSheet();
  sheetPin = () => placeSheet(sheet);
  viewport.addEventListener("resize", sheetPin);
  viewport.addEventListener("scroll", sheetPin);
}

function unwatchSheet() {
  const viewport = window.visualViewport;
  if (!sheetPin || !viewport) return;
  viewport.removeEventListener("resize", sheetPin);
  viewport.removeEventListener("scroll", sheetPin);
  sheetPin = null;
}

function releaseSheet(sheet) {
  unwatchSheet();
  sheet.style.top = "";
  sheet.style.left = "";
  sheet.style.width = "";
  sheet.style.height = "";
  document.documentElement.classList.remove("is-sheet");
}

function openSettings() {
  state.settingsReturn = document.activeElement;
  syncThemeControls();
  const sheet = $("settings");
  const card = sheet.querySelector(".sheet-card");
  sheet.classList.remove("is-closing");
  document.documentElement.classList.add("is-sheet");
  sheet.hidden = false;
  placeSheet(sheet);
  watchSheet(sheet);
  if (card) void card.offsetWidth;
  sheet.classList.add("is-open");
  $("app").inert = true;
  $("settings-close").focus();
}

function closeSettings() {
  const sheet = $("settings");
  if (sheet.hidden || sheet.classList.contains("is-closing")) return;
  const card = sheet.querySelector(".sheet-card");
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  sheet.classList.remove("is-open");
  if (card) void card.offsetWidth;
  sheet.classList.add("is-closing");
  const finish = () => {
    if (!sheet.classList.contains("is-closing")) return;
    sheet.classList.remove("is-closing");
    sheet.hidden = true;
    releaseSheet(sheet);
    $("app").inert = false;
    if (state.settingsReturn && state.settingsReturn.focus) state.settingsReturn.focus();
  };
  if (reduce || !card) {
    finish();
    return;
  }
  const onEnd = (event) => {
    if (event.target !== card || event.propertyName !== "bottom") return;
    card.removeEventListener("transitionend", onEnd);
    finish();
  };
  card.addEventListener("transitionend", onEnd);
  window.setTimeout(finish, 560);
}

async function onTranslate() {
  if (state.busy) return;
  clearError();
  setBusy(true);
  haptic("medium");
  try {
    const text = $("source").value;
    const result = state.keyStore.backend === "debug"
      ? await translatePhrase({
        text,
        apiKey: state.apiKey,
        provider: state.provider,
      })
      : await translateWithFunction({
        text,
        baseUrl: functionUrlForZone(Intl.DateTimeFormat().resolvedOptions().timeZone, {
          paris: FUNCTION_URL,
          tokyo: FUNCTION_URL_TOKYO,
        }),
      });
    showResult(result);
    state.history.add(result);
    renderRecent();
    haptic("success");
  } catch (error) {
    showError(error);
  } finally {
    setBusy(false);
  }
}

function bindViewport() {
  const viewport = window.visualViewport;
  if (!viewport) return;
  const update = () => {
    const inset = Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop);
    document.documentElement.style.setProperty("--keyboard-inset", `${Math.round(inset)}px`);
  };
  viewport.addEventListener("resize", update);
  viewport.addEventListener("scroll", update);
  update();
}

function bindPress() {
  document.addEventListener("pointerdown", (event) => {
    const button = event.target.closest("button");
    if (!button || button.disabled) return;
    button.classList.add("is-pressed");
    const release = () => {
      button.classList.remove("is-pressed");
      button.removeEventListener("pointerup", release);
      button.removeEventListener("pointercancel", release);
      button.removeEventListener("pointerleave", release);
    };
    button.addEventListener("pointerup", release);
    button.addEventListener("pointercancel", release);
    button.addEventListener("pointerleave", release);
  });
}

function bind() {
  const source = $("source");
  source.addEventListener("focus", () => document.body.classList.add("is-composing"));
  source.addEventListener("blur", () => document.body.classList.remove("is-composing"));
  source.addEventListener("input", () => {
    if (!$("error").hidden) clearError();
    refreshComposer();
  });
  bindPress();
  $("translate").addEventListener("click", onTranslate);
  $("tab-translate").addEventListener("click", () => {
    setTab("translate");
    haptic("selection");
  });
  $("tab-history").addEventListener("click", () => {
    setTab("history");
    haptic("selection");
  });
  $("recent-list").addEventListener("click", onListClick);
  $("history-list").addEventListener("click", onListClick);
  $("copy-romaji").addEventListener("click", () => copyText($("romaji").textContent, $("copy-romaji")));
  $("copy-japanese").addEventListener("click", () => copyText($("japanese").textContent, $("copy-japanese")));
  $("settings-open").addEventListener("click", openSettings);
  $("settings-close").addEventListener("click", closeSettings);
  $("settings").addEventListener("click", (event) => {
    if (event.target.closest(".sheet-card")) return;
    closeSettings();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !$("settings").hidden) closeSettings();
  });
  document.querySelectorAll('input[name="theme"]').forEach((input) => {
    input.addEventListener("change", () => {
      if (!input.checked) return;
      state.settings.theme = input.value;
      applyTheme(input.value);
      syncThemeControls();
      saveSettings();
      haptic("selection");
    });
  });
  $("clear-history").addEventListener("click", () => {
    if (!state.clearArmed) {
      state.clearArmed = true;
      $("clear-history").textContent = "Clear all?";
      clearTimeout(state.clearTimer);
      state.clearTimer = setTimeout(() => {
        state.clearArmed = false;
        $("clear-history").textContent = "Clear";
      }, 2500);
      return;
    }
    state.history.clear();
    state.clearArmed = false;
    $("clear-history").textContent = "Clear";
    renderHistory();
    renderRecent();
    haptic("light");
  });
  $("toast-undo").addEventListener("click", () => {
    if (!state.undo) return;
    state.history.insertAt(state.undo.index, state.undo.entry);
    clearTimeout(state.undoTimer);
    hideToast();
    renderRecent();
    renderHistory();
    haptic("selection");
  });
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    if (state.settings.theme === "system") applyTheme("system");
  });
  bindViewport();
}

async function main() {
  injectGlassFilter();
  state.inCordova = window.west2romajiReady ? await window.west2romajiReady : false;
  state.settings = loadSettings();
  applyTheme(state.settings.theme);
  syncThemeControls();
  state.history = createHistory();
  state.keyStore = createKeyStore({
    inCordova: state.inCordova,
    debug: !state.inCordova && isLocalDebug(),
    SecureStorage: globalThis.cordova?.plugins?.SecureStorage,
  });
  try {
    if (state.keyStore.backend === "debug") {
      state.apiKey = await state.keyStore.get();
      state.provider = state.keyStore.provider || "";
    }
  } catch (error) {
    state.apiKey = "";
    state.provider = "";
  }
  bind();
  refreshComposer();
  renderRecent();
  renderHistory();
}

main();
