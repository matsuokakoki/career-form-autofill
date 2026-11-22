(function initOptions() {
  const form = document.querySelector("#profile-form");
  const status = document.querySelector("#status");
  const localLlmEnabled = document.querySelector("#local-llm-enabled");
  const localLlmEndpoint = document.querySelector("#local-llm-endpoint");
  const localLlmModel = document.querySelector("#local-llm-model");
  const jevEnabled = document.querySelector("#jev-enabled");
  const jevApiKey = document.querySelector("#jev-api-key");
  const appleEnabled = document.querySelector("#apple-enabled");
  let statusTimer = 0;

  function setOptionStatus(message, clearAfter = 0) {
    window.clearTimeout(statusTimer);
    status.textContent = message;
    if (clearAfter) statusTimer = window.setTimeout(() => { status.textContent = ""; }, clearAfter);
  }

  function formValues() {
    const data = new FormData(form);
    return Object.fromEntries(Array.from(data.entries(), ([key, value]) => [key, String(value).trim()]));
  }

  async function restore() {
    const { profile = {}, localLlm = {}, jev = {}, apple = {} } = await chrome.storage.local.get(["profile", "localLlm", "jev", "apple"]);
    appleEnabled.checked = Boolean(apple.enabled);
    for (const [key, value] of Object.entries(profile)) {
      const control = form.elements.namedItem(key);
      if (control) control.value = value;
    }
    localLlmEnabled.checked = Boolean(localLlm.enabled);
    localLlmEndpoint.value = localLlm.endpoint || localLlmEndpoint.defaultValue;
    localLlmModel.value = localLlm.model || localLlmModel.defaultValue;
    jevEnabled.checked = Boolean(jev.enabled);
    jevApiKey.value = jev.apiKey || "";
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const profile = formValues();

    if (!profile.lastNameHalfKana && profile.lastNameKana) {
      profile.lastNameHalfKana = CareerAutofillCore.toHalfWidthKana(profile.lastNameKana);
      form.elements.namedItem("lastNameHalfKana").value = profile.lastNameHalfKana;
    }
    if (!profile.firstNameHalfKana && profile.firstNameKana) {
      profile.firstNameHalfKana = CareerAutofillCore.toHalfWidthKana(profile.firstNameKana);
      form.elements.namedItem("firstNameHalfKana").value = profile.firstNameHalfKana;
    }

    const localLlm = {
      enabled: localLlmEnabled.checked,
      endpoint: localLlmEndpoint.value.trim(),
      model: localLlmModel.value.trim()
    };
    const jev = { enabled: jevEnabled.checked, apiKey: jevApiKey.value.trim() };
    await chrome.storage.local.set({ profile, localLlm, jev, apple: { enabled: appleEnabled.checked } });
    if (appleEnabled.checked) { setOptionStatus("保存しました。Apple Intelligenceは解析時に使用します。", 3200); return; }
    if (jev.enabled && !jev.apiKey) {
      setOptionStatus("保存しました。Jevを有効にするには API key を入力してください。");
      return;
    }
    if (jev.enabled) {
      setOptionStatus("保存しました。Jevは解析時に未判定欄だけへ使われます。", 3200);
      return;
    }
    if (!localLlm.enabled) {
      setOptionStatus("保存しました", 2200);
      return;
    }

    setOptionStatus("保存しました。ローカルLLMを準備しています…");
    try {
      const response = await chrome.runtime.sendMessage({ type: "CAREER_AUTOFILL_LOCAL_LLM_WARMUP", config: localLlm });
      if (!response?.ok) throw new Error(response?.error || "準備できませんでした");
      setOptionStatus("保存しました。ローカルLLMの準備が完了しました", 3500);
    } catch (error) {
      setOptionStatus(`保存しました。ローカルLLMの準備に失敗しました: ${error instanceof Error ? error.message : String(error)}`);
    }
  });

  restore().catch(() => { status.textContent = "読み込みに失敗しました"; });
})();
