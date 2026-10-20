/**
 * popup.js — Extension Popup Logic
 * Handles backend URL settings and connection testing.
 */

const DEFAULT_URL = "http://localhost:5000";

const urlInput  = document.getElementById("backendUrl");
const saveBtn   = document.getElementById("saveBtn");
const testBtn   = document.getElementById("testBtn");
const testIcon  = document.getElementById("testIcon");
const testLabel = document.getElementById("testLabel");
const testResult = document.getElementById("testResult");

// ─── Load saved URL ────────────────────────────────────────────────────────

chrome.storage.sync.get({ backendUrl: DEFAULT_URL }, ({ backendUrl }) => {
  urlInput.value = backendUrl;
});

// ─── Save URL ──────────────────────────────────────────────────────────────

saveBtn.addEventListener("click", () => {
  const url = urlInput.value.trim().replace(/\/$/, "") || DEFAULT_URL;
  urlInput.value = url;
  chrome.storage.sync.set({ backendUrl: url }, () => {
    const flash = document.createElement("span");
    flash.className = "saved-flash";
    flash.textContent = "✓ Saved";
    saveBtn.parentNode.appendChild(flash);
    setTimeout(() => flash.remove(), 2000);
  });
});

// Allow pressing Enter in input to save
urlInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") saveBtn.click();
});

// ─── Test Connection ───────────────────────────────────────────────────────

testBtn.addEventListener("click", async () => {
  testBtn.disabled = true;
  testIcon.textContent = "⏳";
  testLabel.textContent = "Testing…";
  testResult.className = "test-result hidden";

  const result = await chrome.runtime.sendMessage({ type: "TEST_CONNECTION" });

  testBtn.disabled = false;
  testIcon.textContent = result.ok ? "✅" : "❌";
  testLabel.textContent = result.ok ? "Connected!" : "Connection failed";
  testResult.classList.remove("hidden");

  if (result.ok) {
    const radon = result.data?.radon ? "radon ✓" : "radon ✗ (JS only)";
    testResult.className = "test-result success";
    testResult.textContent = `Backend online — ${radon}`;
  } else {
    testResult.className = "test-result error";
    testResult.textContent = result.error || "Could not reach backend";
  }

  // Reset button text after 3 seconds
  setTimeout(() => {
    testIcon.textContent = "🔌";
    testLabel.textContent = "Test Connection";
  }, 3000);
});
