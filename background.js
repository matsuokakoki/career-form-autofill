/* Optional local-only classifier. Form values and the saved profile never enter
 * this request. The classifier is deliberately bounded so a slow/cold model
 * cannot hold up the normal rule-based scan. */
(function initLocalLlmBridge() {
  const MAX_FIELDS = 2;
  const CLASSIFY_TIMEOUT_MS = 2600;
  const KEEP_ALIVE = "30m";
  const FIELD_LABELS = {
    email: "メール", emailConfirm: "確認メール", email2: "第2メール",
    lastNameKanji: "姓漢字", firstNameKanji: "名漢字", fullNameKanji: "氏名漢字",
    lastNameKana: "姓カナ", firstNameKana: "名カナ", fullNameKana: "氏名カナ",
    lastNameHalfKana: "姓半角カナ", firstNameHalfKana: "名半角カナ", fullNameHalfKana: "氏名半角カナ",
    phone: "電話番号", postalCode: "郵便番号", prefecture: "都道府県", city: "市区町村",
    addressLine1: "町名番地", addressLine2: "建物部屋", fullAddress: "住所全体",
    birthYear: "生年", birthMonth: "生月", birthDay: "生日", birthDate: "生年月日", gender: "性別",
    parentName: "保護者氏名", relationship: "続柄", university: "大学名", faculty: "学部",
    department: "学科専攻", enrollmentYear: "入学年", enrollmentMonth: "入学月",
    graduationYear: "卒業年", graduationMonth: "卒業月"
  };
  const ALLOWED_KEYS = new Set(Object.keys(FIELD_LABELS));
  const FIELD_ALIASES = {
    emailConfirm: ["確認メール", "メール確認", "メールアドレス確認"],
    email2: ["第2メール", "予備メール", "サブメール"],
    email: ["メール", "メールアドレス", "電子メール"],
    lastNameKana: ["姓カナ", "姓フリガナ", "セイ"],
    firstNameKana: ["名カナ", "名フリガナ", "メイ"],
    fullNameKana: ["フリガナ", "氏名カナ", "ヨミガナ"],
    lastNameKanji: ["姓", "苗字", "名字"],
    firstNameKanji: ["名", "下の名前"],
    fullNameKanji: ["氏名", "名前", "フルネーム"],
    phone: ["電話", "電話番号", "連絡番号", "携帯番号"],
    postalCode: ["郵便", "郵便番号"],
    prefecture: ["都道府県"], city: ["市区町村", "市町村"],
    addressLine1: ["町名番地", "番地"], addressLine2: ["建物", "建物名", "部屋番号"],
    fullAddress: ["住所", "所在地", "居住地"],
    birthDate: ["生年月日", "誕生日", "出生日"], gender: ["性別", "ジェンダー"],
    parentName: ["保護者", "保護者氏名", "親権者"], relationship: ["続柄", "関係"],
    university: ["大学", "大学名", "学校", "学校名", "教育機関", "教育機関名"],
    faculty: ["学部", "学部名"], department: ["学科", "専攻", "学科専攻"],
    enrollmentYear: ["入学年", "入学年月"], enrollmentMonth: ["入学月"],
    graduationYear: ["卒業年", "卒業年月", "卒業予定"], graduationMonth: ["卒業月"]
  };

  function localEndpoint(url) {
    try {
      const parsed = new URL(url);
      const localHosts = new Set(["127.0.0.1", "localhost", "[::1]"]);
      return parsed.protocol === "http:" && localHosts.has(parsed.hostname) ? parsed : null;
    } catch (_) {
      return null;
    }
  }

  function responseJson(text) {
    const fenced = String(text || "").match(/```(?:json)?\s*([\s\S]*?)```/i);
    return JSON.parse((fenced ? fenced[1] : String(text || "")).trim());
  }

  function compactFields(fields) {
    const compacted = Array.isArray(fields) ? fields.map((field) => ({
      id: String(field?.id || ""),
      question: String(field?.question || "").replace(/\s+/g, " ").trim().slice(0, 80),
      inputType: String(field?.inputType || "text").slice(0, 12),
      choices: Array.from(new Set(Array.isArray(field?.choices) ? field.choices.filter((key) => ALLOWED_KEYS.has(key)).slice(0, 4) : []))
    })).filter((field) => field.id && field.question && field.choices.length >= 2) : [];
    return compacted.slice(0, MAX_FIELDS);
  }

  function normalizedAnswer(value) {
    return String(value ?? "").normalize("NFKC").toLowerCase().replace(/[\s\u3000・･_\-—–:：/\\()（）\[\]【】「」『』.,，。]/g, "");
  }

  function compactPrompt(field) {
    const choices = field.choices.map((key) => FIELD_LABELS[key]).join("/");
    return `「${field.question}」は${choices}のどれ?答えだけ。`;
  }

  function resolveFieldKey(answer, allowedKeys) {
    if (ALLOWED_KEYS.has(answer) && allowedKeys.has(answer)) return answer;
    const normalized = normalizedAnswer(answer);
    for (const [key, aliases] of Object.entries(FIELD_ALIASES)) {
      if (!allowedKeys.has(key)) continue;
      if (aliases.some((alias) => normalized === normalizedAnswer(alias))) return key;
    }
    for (const [key, aliases] of Object.entries(FIELD_ALIASES)) {
      if (!allowedKeys.has(key)) continue;
      if (aliases.some((alias) => {
        const normalizedAlias = normalizedAnswer(alias);
        return normalizedAlias.length >= 3 && normalized.includes(normalizedAlias);
      })) return key;
    }
    return null;
  }

  function decodedMatches(text, fields, allowedKeyValues) {
    const globallyAllowed = new Set(Array.isArray(allowedKeyValues) ? allowedKeyValues.filter((key) => ALLOWED_KEYS.has(key)) : Array.from(ALLOWED_KEYS));
    let answers;
    try {
      const parsed = responseJson(text);
      if (Array.isArray(parsed)) answers = parsed;
      else if (parsed && typeof parsed === "object") answers = fields.map((field) => parsed[field.queryId]);
      else answers = [parsed];
    } catch (_) {
      answers = String(text || "").trim().split(/[,，、/\n]+/);
    }
    const matches = [];
    fields.forEach((field, index) => {
      const allowedKeys = new Set(field.choices.filter((key) => globallyAllowed.has(key)));
      const fieldKey = resolveFieldKey(answers[index], allowedKeys);
      if (field && fieldKey) matches.push({ id: field.id, fieldKey });
    });
    return matches;
  }

  async function requestWithDeadline(endpoint, payload, timeoutMs) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: controller.signal
      });
    } finally {
      clearTimeout(timer);
    }
  }

  async function classify(config, fields, allowedKeys, requestedTimeout) {
    const endpoint = localEndpoint(config?.endpoint || "http://127.0.0.1:11434/api/chat");
    if (!endpoint) throw new Error("ローカルLLMのURLは localhost / 127.0.0.1 の http URL のみ使用できます。");
    const safeFields = compactFields(fields);
    if (!safeFields.length) return { matches: [], used: false, timedOut: false };

    const numericTimeout = Number(requestedTimeout);
    const timeoutMs = Number.isFinite(numericTimeout) ? Math.max(1, Math.min(CLASSIFY_TIMEOUT_MS, numericTimeout)) : CLASSIFY_TIMEOUT_MS;
    const settled = await Promise.allSettled(safeFields.map(async (field) => {
      const response = await requestWithDeadline(endpoint, {
        model: String(config?.model || "qwen2.5:3b"),
        stream: false,
        keep_alive: KEEP_ALIVE,
        messages: [{ role: "user", content: compactPrompt(field) }],
        options: { temperature: 0, num_ctx: 512, num_predict: 8 }
      }, timeoutMs);
      if (!response.ok) throw new Error(`ローカルLLMが応答しませんでした (${response.status})`);
      const body = await response.json();
      return decodedMatches(body?.message?.content || body?.response || "", [field], allowedKeys);
    }));
    const matches = [];
    const errors = [];
    let timedOut = false;
    for (const result of settled) {
      if (result.status === "fulfilled") matches.push(...result.value);
      else {
        timedOut ||= result.reason?.name === "AbortError";
        errors.push(result.reason instanceof Error ? result.reason.message : String(result.reason));
      }
    }
    return { matches, used: matches.length > 0, timedOut, error: errors[0] || "" };
  }

  async function warmup(config) {
    const endpoint = localEndpoint(config?.endpoint || "http://127.0.0.1:11434/api/chat");
    if (!endpoint) throw new Error("ローカルLLMのURLが不正です。");
    const response = await requestWithDeadline(endpoint, {
      model: String(config?.model || "qwen2.5:3b"),
      stream: false,
      keep_alive: KEEP_ALIVE,
      messages: [],
      options: { num_ctx: 512 }
    }, 60000);
    if (!response.ok) throw new Error(`ローカルLLMが応答しませんでした (${response.status})`);
    return true;
  }

  async function classifyApple(fields, allowedKeys, requestedTimeout) {
    const safeFields = compactFields(fields);
    if (!safeFields.length) return { matches: [], used: false, noCandidates: true };
    const allowed = new Set(Array.isArray(allowedKeys) ? allowedKeys : []);
    const timeout = Math.min(28000, Math.max(1, Number(requestedTimeout) || 28000));
    const results = await Promise.all(safeFields.map(async (field) => {
      const labels = field.choices.map((key) => FIELD_LABELS[key]);
      let timer;
      let response;
      try {
        response = await Promise.race([
          chrome.runtime.sendNativeMessage("com.career_form_autofill.apple_fm", { question: field.question, choices: labels }),
          new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("Apple Intelligence が時間内に応答しませんでした")), timeout); })
        ]);
      } finally { clearTimeout(timer); }
      if (response?.error) throw new Error(response.error);
      const index = labels.indexOf(response?.answer);
      const key = field.choices[index];
      return key && allowed.has(key) ? { id: field.id, fieldKey: key } : null;
    }));
    const matches = results.filter(Boolean);
    return { matches, used: matches.length > 0, timedOut: false };
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "CAREER_AUTOFILL_LOCAL_LLM_CLASSIFY") {
      (message.config?.provider === "apple" ? classifyApple(message.fields, message.allowedKeys, message.timeoutMs) : classify(message.config, message.fields, message.allowedKeys, message.timeoutMs))
        .then((result) => sendResponse({ ok: true, ...result }))
        .catch((error) => {
          const timedOut = error?.name === "AbortError";
          sendResponse({ ok: true, matches: [], used: false, timedOut, error: timedOut ? "ローカルLLMが時間内に応答しませんでした。" : (error instanceof Error ? error.message : String(error)) });
        });
      return true;
    }
    if (message?.type === "CAREER_AUTOFILL_LOCAL_LLM_WARMUP") {
      warmup(message.config)
        .then(() => sendResponse({ ok: true }))
        .catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }));
      return true;
    }
    return undefined;
  });
})();

/* Jev is a cloud decision API, not a text generator.  Only page metadata is
 * sent: the caller never includes profile values in `fields`. */
(function initJevBridge() {
  const ENDPOINT = "https://api.typesafe.ai/v1/systemone";
  const MAX_FIELDS = 20;
  const TIMEOUT_MS = 2600;

  function compactFields(fields) {
    return (Array.isArray(fields) ? fields : []).map((field) => ({
      id: String(field?.id || "").slice(0, 80),
      label: String(field?.label || "").replace(/\s+/g, " ").trim().slice(0, 100),
      attrs: String(field?.attrs || "").replace(/\s+/g, " ").trim().slice(0, 100),
      nearby: String(field?.nearby || "").replace(/\s+/g, " ").trim().slice(0, 140),
      inputType: String(field?.inputType || "text").slice(0, 20),
      choices: (Array.isArray(field?.choices) ? field.choices : []).filter((choice) => choice?.key && choice?.label).slice(0, 12)
    })).filter((field) => field.id && (field.label || field.attrs || field.nearby) && field.choices.length >= 2).slice(0, MAX_FIELDS);
  }

  async function requestWithDeadline(payload, apiKey, timeoutMs) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
        body: JSON.stringify(payload),
        signal: controller.signal
      });
    } finally { clearTimeout(timer); }
  }

  function numeric(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : 0;
  }

  async function classify(config, fields, language, requestedTimeout) {
    const apiKey = String(config?.apiKey || "").trim();
    if (!apiKey) throw new Error("Jev APIキーが未設定です。");
    const safeFields = compactFields(fields);
    if (!safeFields.length) return { matches: [], used: false, timedOut: false, noCandidates: true };
    const questions = {};
    const state = { language: language === "en" ? "English" : "Japanese", fields: safeFields.map(({ id, label, attrs, nearby, inputType }) => ({ id, label, htmlAttributes: attrs, nearbyText: nearby, inputType })) };
    safeFields.forEach((field, index) => {
      questions[`q${index}`] = {
        type: "choice",
        instructions: `Classify field id ${field.id}. Choose the saved-profile value that this field asks for. Choose none if it is not clearly one of these fields.`,
        criteria: Object.fromEntries([...field.choices.map((choice) => [choice.key, choice.label]), ["none", "Not a saved-profile field or uncertain"]])
      };
    });
    const numericTimeout = Number(requestedTimeout);
    const timeoutMs = Number.isFinite(numericTimeout) ? Math.max(1, Math.min(TIMEOUT_MS, numericTimeout)) : TIMEOUT_MS;
    const response = await requestWithDeadline({ model: "jev-latest", state, questions }, apiKey, timeoutMs);
    if (!response.ok) throw new Error(`Jevが応答しませんでした (${response.status})`);
    const body = await response.json();
    const answers = body?.answers || {};
    const matches = safeFields.flatMap((field, index) => {
      const answer = answers[`q${index}`] || {};
      const fieldKey = String(answer.choice || "");
      const allowed = new Set(field.choices.map((choice) => choice.key));
      const probability = numeric(answer?.probabilities?.[fieldKey]);
      const confidence = numeric(answer.confidence);
      if (!allowed.has(fieldKey) || fieldKey === "none" || probability < 0.85 || confidence < 0.75) return [];
      return [{ id: field.id, fieldKey, probability, confidence }];
    });
    return { matches, used: matches.length > 0, timedOut: false, rejected: safeFields.length - matches.length };
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== "CAREER_AUTOFILL_JEV_CLASSIFY") return undefined;
    classify(message.config, message.fields, message.language, message.timeoutMs)
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((error) => {
        const timedOut = error?.name === "AbortError";
        sendResponse({ ok: true, matches: [], used: false, timedOut, error: timedOut ? "Jevが時間内に応答しませんでした。" : (error instanceof Error ? error.message : String(error)) });
      });
    return true;
  });
})();
