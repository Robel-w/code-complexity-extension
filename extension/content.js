/**
 * content.js — Content Script for Code Complexity Analyzer
 * Detects code blocks on the page, injects analyze buttons, and renders results.
 */

(function () {
  "use strict";

  // Guard against multiple injections
  if (window.__complexityAnalyzerLoaded) return;
  window.__complexityAnalyzerLoaded = true;

  // ─── Constants ────────────────────────────────────────────────────────────

  const PANEL_ID = "cca-panel";
  const BTN_CLASS = "cca-analyze-btn";
  const WRAPPER_CLASS = "cca-wrapper";

  // Selectors for code blocks we can detect
  const CODE_SELECTORS = [
    "pre code",
    "pre.highlight",
    ".highlight pre",
    ".blob-code-inner",         // GitHub raw code lines container
    ".view-lines",              // Monaco / VS Code Web
    "[class*='language-']",    // Prism.js
    "[class*='hljs']",         // highlight.js
    "div.code-block",
    "div[class*='CodeMirror']",
  ];

  // ─── Language Detection from Class Names ──────────────────────────────────

  function detectLangFromClasses(el) {
    const classes = [...el.classList, ...(el.closest("pre")?.classList ?? [])].join(" ");
    if (/language-py(thon)?|\.py\b/i.test(classes)) return "python";
    if (/language-(java|j)s|\.js\b/i.test(classes)) return "javascript";
    if (/language-ts|typescript|\.ts\b/i.test(classes)) return "javascript";
    return "auto";
  }

  // ─── DOM Utilities ────────────────────────────────────────────────────────

  function getCodeText(el) {
    return (el.innerText || el.textContent || "").trim();
  }

  function isAlreadyWrapped(el) {
    return el.closest(`.${WRAPPER_CLASS}`) !== null;
  }

  function wrapElement(el) {
    const wrapper = document.createElement("div");
    wrapper.className = WRAPPER_CLASS;
    el.parentNode.insertBefore(wrapper, el);
    wrapper.appendChild(el);
    return wrapper;
  }

  // ─── Analyze Button ───────────────────────────────────────────────────────

  function createAnalyzeButton(codeEl) {
    const btn = document.createElement("button");
    btn.className = BTN_CLASS;
    btn.innerHTML = `<span class="cca-btn-icon">⚡</span> Analyze Complexity`;
    btn.title = "Analyze code complexity";

    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const code = getCodeText(codeEl);
      if (!code) return;
      const lang = detectLangFromClasses(codeEl);
      btn.disabled = true;
      btn.textContent = "Analyzing…";
      await runAnalysis(code, lang);
      btn.disabled = false;
      btn.innerHTML = `<span class="cca-btn-icon">⚡</span> Analyze Complexity`;
    });

    return btn;
  }

  function injectButton(codeEl) {
    if (isAlreadyWrapped(codeEl)) return;
    // Skip tiny snippets
    if (getCodeText(codeEl).split("\n").length < 3) return;

    const wrapper = wrapElement(codeEl);
    const btn = createAnalyzeButton(codeEl);
    wrapper.appendChild(btn);
  }

  // ─── Panel Rendering ──────────────────────────────────────────────────────

  function removePanel() {
    document.getElementById(PANEL_ID)?.remove();
    document.getElementById("cca-backdrop")?.remove();
  }

  function severityLabel(sev) {
    const map = { low: "✅ Low", medium: "⚠️ Medium", high: "🔴 High", "very-high": "🚨 Very High" };
    return map[sev] || sev;
  }

  function miBar(mi) {
    const pct = Math.min(100, Math.max(0, mi));
    const color = mi >= 80 ? "#4ade80" : mi >= 65 ? "#facc15" : mi >= 40 ? "#fb923c" : "#f87171";
    return `
      <div class="cca-bar-track">
        <div class="cca-bar-fill" style="width:${pct}%;background:${color}"></div>
      </div>
      <span class="cca-bar-label">${mi}/100</span>
    `;
  }

  function renderPerFunction(funcs) {
    if (!funcs || funcs.length === 0) return "";
    const rows = funcs
      .slice(0, 15)
      .map((f) => {
        const rankClass = `cca-rank-${(f.rank || "?").toLowerCase()}`;
        return `<tr>
          <td>${f.type || "fn"}</td>
          <td><code>${f.name}</code></td>
          <td>${f.line != null ? `L${f.line}` : "—"}</td>
          <td><span class="cca-rank ${rankClass}">${f.rank || "?"}</span></td>
          <td>${f.complexity}</td>
        </tr>`;
      })
      .join("");
    return `
      <details class="cca-details" open>
        <summary>Per-function Breakdown</summary>
        <table class="cca-table">
          <thead><tr><th>Type</th><th>Name</th><th>Line</th><th>Rank</th><th>CC</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </details>
    `;
  }

  function renderHalstead(h) {
    if (!h || Object.keys(h).length === 0) return "";
    return `
      <details class="cca-details">
        <summary>Halstead Metrics</summary>
        <div class="cca-halstead-grid">
          ${Object.entries({
            "Volume": h.volume,
            "Difficulty": h.difficulty,
            "Effort": h.effort,
            "Time (s)": h.time,
            "Est. Bugs": h.bugs,
            "Vocabulary": h.vocabulary,
            "Length": h.length,
          })
            .map(([k, v]) => `<div class="cca-hal-item"><span class="cca-hal-key">${k}</span><span class="cca-hal-val">${v ?? "—"}</span></div>`)
            .join("")}
        </div>
      </details>
    `;
  }

  function renderPanel(data) {
    removePanel();

    const { severity, cyclomatic_complexity: cc, maintainability_index: mi,
            raw_metrics: raw, halstead, suggestions, language } = data;

    // Backdrop
    const backdrop = document.createElement("div");
    backdrop.id = "cca-backdrop";
    backdrop.addEventListener("click", removePanel);
    document.body.appendChild(backdrop);

    // Panel
    const panel = document.createElement("div");
    panel.id = PANEL_ID;
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-label", "Code Complexity Analysis Results");

    panel.innerHTML = `
      <div class="cca-panel-header">
        <div class="cca-header-left">
          <span class="cca-title">⚡ Complexity Analysis</span>
          <span class="cca-lang-badge">${language}</span>
        </div>
        <button class="cca-close-btn" title="Close">✕</button>
      </div>
      <div class="cca-panel-body">

        <!-- Severity Badge -->
        <div class="cca-severity-row">
          <div class="cca-severity-badge cca-sev-${severity}">
            ${severityLabel(severity)}
          </div>
          <span class="cca-sev-desc">Overall Complexity</span>
        </div>

        <!-- Metrics Grid -->
        <div class="cca-metrics-grid">
          <div class="cca-metric-card">
            <div class="cca-metric-label">Avg Cyclomatic</div>
            <div class="cca-metric-value">${cc?.average ?? "—"}</div>
          </div>
          <div class="cca-metric-card">
            <div class="cca-metric-label">Max CC</div>
            <div class="cca-metric-value">${cc?.max ?? "—"}</div>
          </div>
          <div class="cca-metric-card">
            <div class="cca-metric-label">LOC</div>
            <div class="cca-metric-value">${raw?.loc ?? "—"}</div>
          </div>
          <div class="cca-metric-card">
            <div class="cca-metric-label">SLOC</div>
            <div class="cca-metric-value">${raw?.sloc ?? "—"}</div>
          </div>
          <div class="cca-metric-card">
            <div class="cca-metric-label">Comments</div>
            <div class="cca-metric-value">${raw?.comments ?? "—"}</div>
          </div>
          <div class="cca-metric-card">
            <div class="cca-metric-label">Blank Lines</div>
            <div class="cca-metric-value">${raw?.blank ?? "—"}</div>
          </div>
        </div>

        <!-- Maintainability Index -->
        <div class="cca-section">
          <div class="cca-section-label">Maintainability Index</div>
          <div class="cca-mi-row">${miBar(mi ?? 0)}</div>
        </div>

        <!-- Per-function -->
        ${renderPerFunction(cc?.per_function)}

        <!-- Halstead -->
        ${renderHalstead(halstead)}

        <!-- Suggestions -->
        <div class="cca-section">
          <div class="cca-section-label">💡 Suggestions</div>
          <ul class="cca-suggestions">
            ${(suggestions || []).map((s) => `<li>${s}</li>`).join("")}
          </ul>
        </div>

      </div>
    `;

    panel.querySelector(".cca-close-btn").addEventListener("click", removePanel);
    document.body.appendChild(panel);

    // Animate in
    requestAnimationFrame(() => panel.classList.add("cca-panel-visible"));
  }

  function renderError(message) {
    removePanel();

    const backdrop = document.createElement("div");
    backdrop.id = "cca-backdrop";
    backdrop.addEventListener("click", removePanel);
    document.body.appendChild(backdrop);

    const panel = document.createElement("div");
    panel.id = PANEL_ID;
    panel.innerHTML = `
      <div class="cca-panel-header">
        <span class="cca-title">⚡ Complexity Analysis</span>
        <button class="cca-close-btn" title="Close">✕</button>
      </div>
      <div class="cca-panel-body">
        <div class="cca-error-box">
          <div class="cca-error-icon">⚠️</div>
          <div class="cca-error-msg">${message}</div>
          <div class="cca-error-hint">Make sure the backend is running:<br><code>python app.py</code></div>
        </div>
      </div>
    `;
    panel.querySelector(".cca-close-btn").addEventListener("click", removePanel);
    document.body.appendChild(panel);
    requestAnimationFrame(() => panel.classList.add("cca-panel-visible"));
  }

  // ─── Analysis Runner ──────────────────────────────────────────────────────

  async function runAnalysis(code, language = "auto") {
    const result = await chrome.runtime.sendMessage({
      type: "FETCH_ANALYSIS",
      code,
      language,
    });

    if (result.ok) {
      renderPanel(result.data);
    } else {
      renderError(result.error || "Unknown error");
    }
  }

  // ─── Observer: Inject Buttons ─────────────────────────────────────────────

  function scanAndInject(root = document) {
    CODE_SELECTORS.forEach((sel) => {
      root.querySelectorAll(sel).forEach(injectButton);
    });
  }

  // Initial scan
  scanAndInject();

  // Observe dynamic content (SPAs, lazy-loaded code)
  const observer = new MutationObserver((mutations) => {
    for (const m of mutations) {
      m.addedNodes.forEach((node) => {
        if (node.nodeType === 1) scanAndInject(node);
      });
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });

  // ─── Context Menu Message Handler ─────────────────────────────────────────

  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === "ANALYZE_SELECTION") {
      runAnalysis(message.code, "auto");
    }
  });

  // ─── Keyboard Shortcut: Escape to close ───────────────────────────────────

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") removePanel();
  });
})();
