/**
 * background.js — Service Worker for Code Complexity Analyzer
 * Handles context menus and acts as a proxy for API requests from content scripts.
 */

const DEFAULT_BACKEND = "http://localhost:5000";

// ─── Context Menu Setup ────────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "analyzeComplexity",
    title: "⚡ Analyze Code Complexity",
    contexts: ["selection"],
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "analyzeComplexity" && info.selectionText) {
    chrome.tabs.sendMessage(tab.id, {
      type: "ANALYZE_SELECTION",
      code: info.selectionText,
    });
  }
});

// ─── Message Handler ────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === "FETCH_ANALYSIS") {
    handleAnalysis(message.code, message.language).then(sendResponse);
    return true; // keep channel open for async response
  }

  if (message.type === "GET_BACKEND_URL") {
    chrome.storage.sync.get({ backendUrl: DEFAULT_BACKEND }, (result) => {
      sendResponse({ url: result.backendUrl });
    });
    return true;
  }

  if (message.type === "TEST_CONNECTION") {
    chrome.storage.sync.get({ backendUrl: DEFAULT_BACKEND }, async (result) => {
      try {
        const res = await fetch(`${result.backendUrl}/health`, { signal: AbortSignal.timeout(4000) });
        const json = await res.json();
        sendResponse({ ok: true, data: json });
      } catch (err) {
        sendResponse({ ok: false, error: err.message });
      }
    });
    return true;
  }
});

// ─── Core Analysis Fetch ────────────────────────────────────────────────────

async function handleAnalysis(code, language = "auto") {
  const { backendUrl } = await chrome.storage.sync.get({ backendUrl: DEFAULT_BACKEND });
  try {
    const response = await fetch(`${backendUrl}/analyze`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, language }),
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) {
      const err = await response.json().catch(() => ({ error: response.statusText }));
      return { ok: false, error: err.error || "Request failed" };
    }
    const data = await response.json();
    return { ok: true, data };
  } catch (err) {
    return {
      ok: false,
      error: err.name === "TimeoutError"
        ? "Request timed out. Is the backend running?"
        : `Network error: ${err.message}`,
    };
  }
}
