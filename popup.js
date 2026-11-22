(function initPopup() {
  const scanButton = document.querySelector("#scan");
  const applyButton = document.querySelector("#apply");
  const optionsButton = document.querySelector("#open-options");
  const preview = document.querySelector("#preview");
  const matchesContainer = document.querySelector("#matches");
  const status = document.querySelector("#status");
  const toggleAll = document.querySelector("#toggle-all");
  const formLanguage = document.querySelector("#form-language");
  const TOTAL_SCAN_BUDGET_MS = 2850;

  function setStatus(message, kind = "") {
    status.textContent = message;
    status.className = `status ${kind}`.trim();
  }

  function activeTab() {
    return chrome.tabs.query({ active: true, currentWindow: true }).then(([tab]) => tab);
  }

  async function installContentScript(tabId) {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["autofill-core.js", "content-script.js"]
    });
  }

  function checkboxIds() {
    return Array.from(matchesContainer.querySelectorAll("input[type='checkbox']:checked"), (checkbox) => checkbox.dataset.id);
  }

  function renderMatches(matches) {
    matchesContainer.replaceChildren();
    for (const match of matches) {
      const row = document.createElement("label");
      row.className = "match";

      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = match.confidence.key !== "low";
      checkbox.dataset.id = match.id;

      const main = document.createElement("span");
      main.className = "match-main";
      const label = document.createElement("span");
      label.className = "match-label";
      label.textContent = `${match.pageLabel} → ${match.fieldLabel}`;
      const value = document.createElement("span");
      value.className = "match-value";
      value.textContent = match.value;
      main.append(label, value);

      const confidence = document.createElement("span");
      confidence.className = `confidence ${match.confidence.key}`;
      confidence.textContent = match.reviewNote || `確度 ${match.confidence.label}`;
      confidence.title = `判定スコア: ${match.score}/100`;

      row.append(checkbox, main, confidence);
      matchesContainer.append(row);
    }
    toggleAll.checked = Array.from(matchesContainer.querySelectorAll("input[type='checkbox']")).every((item) => item.checked);
  }

  scanButton.addEventListener("click", async () => {
    const scanStartedAt = performance.now();
    scanButton.disabled = true;
    preview.hidden = true;
    setStatus("フォームを解析しています…");
    try {
      const { profile = {}, localLlm = {}, jev = {}, apple = {} } = await chrome.storage.local.get(["profile", "localLlm", "jev", "apple"]);
      if (!Object.values(profile).some(Boolean)) {
        setStatus("プロフィールが未設定です。右上の「設定」から保存してください。", "error");
        return;
      }

      const tab = await activeTab();
      if (!tab?.id || !/^https?:/i.test(tab.url || "")) throw new Error("通常のWebページで実行してください。");
      await installContentScript(tab.id);
      const language = formLanguage.value === "en" ? "en" : "ja";
      const response = await chrome.tabs.sendMessage(tab.id, { type: "CAREER_AUTOFILL_SCAN", profile, language });
      if (!response?.ok) throw new Error(response?.error || "フォームを解析できませんでした。");

      let matches = response.matches || [];
      let llmState = apple.enabled ? "no-candidates-local" : jev.enabled ? "no-candidates" : localLlm.enabled ? "no-candidates-local" : "disabled";
      if (apple.enabled || jev.enabled || localLlm.enabled) {
        const remainingMs = Math.floor((apple.enabled ? 57000 : TOTAL_SCAN_BUDGET_MS) - (performance.now() - scanStartedAt));
        if (remainingMs > 0) {
          const usingJev = !apple.enabled && jev.enabled;
          setStatus(apple.enabled ? "通常の解析後、Apple Intelligenceで設問を照合しています…" : usingJev ? "通常の解析後、Jevで空欄の設問だけを確認しています…" : "通常の解析後、ローカルLLMで空欄の設問を確認しています…");
          const request = chrome.tabs.sendMessage(tab.id, {
            type: usingJev ? "CAREER_AUTOFILL_JEV_ENRICH" : "CAREER_AUTOFILL_LOCAL_LLM_ENRICH",
            config: apple.enabled ? { provider: "apple" } : usingJev ? jev : localLlm,
            timeoutMs: Math.min(apple.enabled ? 55000 : 2600, remainingMs)
          });
          const llmResponse = await Promise.race([
            request,
            new Promise((resolve) => window.setTimeout(() => resolve({ clientTimedOut: true }), remainingMs))
          ]);
          if (llmResponse?.clientTimedOut) {
            llmState = "timed-out";
          } else if (!llmResponse?.ok) {
            llmState = "failed";
          } else {
            matches = llmResponse.matches || matches;
            if (llmResponse.partial || (llmResponse.used && llmResponse.error)) llmState = "partial";
            else if (llmResponse.used) llmState = usingJev ? "used-jev" : "used-local";
            else if (llmResponse.timedOut) llmState = "timed-out";
            else if (llmResponse.error) llmState = "failed";
            else if (llmResponse.noCandidates) llmState = "no-candidates";
            else llmState = "not-classified";
          }
        } else {
          llmState = "timed-out";
        }
      }
      renderMatches(matches);
      preview.hidden = false;
      const suffixes = {
        "used-jev": "（Jev補助済み）",
        partial: "（AIは一部のみ照合。内容を確認してください）",
        "used-local": apple.enabled ? "（Apple Intelligence補助済み）" : "（ローカルLLM補助済み）",
        "no-candidates": "（Jev補助対象なし）",
        "no-candidates-local": "（LLM補助対象なし）",
        "not-classified": "（AIは候補を確定できませんでした）",
        "timed-out": "（AIは時間切れのためルール判定のみ）",
        failed: "（AIに接続できないためルール判定のみ）"
      };
      const suffix = suffixes[llmState] || "";
      if (matches.length) setStatus(`${matches.length}項目を検出しました${suffix}。入力内容を確認してください。`);
      else setStatus(`対応できる入力欄を検出できませんでした${suffix}。`, "error");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error), "error");
    } finally {
      scanButton.disabled = false;
    }
  });

  applyButton.addEventListener("click", async () => {
    const ids = checkboxIds();
    if (!ids.length) {
      setStatus("入力する項目を1つ以上選択してください。", "error");
      return;
    }
    applyButton.disabled = true;
    try {
      const tab = await activeTab();
      const response = await chrome.tabs.sendMessage(tab.id, { type: "CAREER_AUTOFILL_APPLY", ids });
      if (!response?.ok) throw new Error(response?.error || "入力に失敗しました。");
      setStatus(`${response.applied}項目を入力しました。送信前に必ず全項目を確認してください。`, "success");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error), "error");
    } finally {
      applyButton.disabled = false;
    }
  });

  toggleAll.addEventListener("change", () => {
    for (const checkbox of matchesContainer.querySelectorAll("input[type='checkbox']")) checkbox.checked = toggleAll.checked;
  });

  matchesContainer.addEventListener("change", () => {
    const checkboxes = Array.from(matchesContainer.querySelectorAll("input[type='checkbox']"));
    toggleAll.checked = checkboxes.length > 0 && checkboxes.every((item) => item.checked);
  });

  optionsButton.addEventListener("click", () => chrome.runtime.openOptionsPage());
})();
