(function initContentScript() {
  if (window.__careerAutofillContentLoaded) return;
  window.__careerAutofillContentLoaded = true;

  const Core = globalThis.CareerAutofillCore;
  const ELEMENT_ATTRIBUTE = "data-career-autofill-id";
  const lastScan = new Map();
  const localLlmCandidates = new Map();
  const appleReviewCandidates = new Map();
  let scannedProfile = {};
  let scannedLanguage = "ja";
  let sequence = 0;

  function isSupported(control) {
    if (control.disabled || control.readOnly) return false;
    if (control instanceof HTMLSelectElement || control instanceof HTMLTextAreaElement) return true;
    if (!(control instanceof HTMLInputElement)) return false;
    return !["hidden", "submit", "button", "reset", "file", "image", "password", "checkbox"].includes(control.type);
  }

  function isVisible(control) {
    const style = getComputedStyle(control);
    const rect = control.getBoundingClientRect();
    return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
  }

  function cleanText(value, limit = 180) {
    return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, limit);
  }

  function explicitLabel(control) {
    const pieces = [];
    if (control.labels) pieces.push(...Array.from(control.labels, (label) => label.innerText));
    if (control.id) {
      try {
        const label = document.querySelector(`label[for="${CSS.escape(control.id)}"]`);
        if (label) pieces.push(label.innerText);
      } catch (_) { /* invalid third-party id */ }
    }
    const parentLabel = control.closest("label");
    if (parentLabel) pieces.push(parentLabel.innerText);
    const labelledBy = (control.getAttribute("aria-labelledby") || "").split(/\s+/).filter(Boolean);
    for (const id of labelledBy) {
      const label = document.getElementById(id);
      if (label) pieces.push(label.innerText || label.textContent);
    }
    const describedBy = (control.getAttribute("aria-describedby") || "").split(/\s+/).filter(Boolean);
    for (const id of describedBy) {
      const description = document.getElementById(id);
      if (description) pieces.push(description.innerText || description.textContent);
    }
    const row = control.closest("tr");
    if (row) pieces.push(...Array.from(row.querySelectorAll("th"), (header) => header.innerText));
    const definition = control.closest("dd");
    if (definition?.previousElementSibling?.matches("dt")) pieces.push(definition.previousElementSibling.innerText);
    pieces.push(control.getAttribute("aria-label"), control.getAttribute("data-label"));
    return cleanText(pieces.filter(Boolean).join(" "));
  }

  function contextContainer(control) {
    const preferred = control.closest("tr, [role='listitem'], fieldset, .form-group, .form-field, .field, .question, .entry, li, dl, [data-field], [data-question]");
    if (preferred && cleanText(preferred.innerText).length <= 500) return preferred;

    let current = control.parentElement;
    let fallback = current;
    for (let depth = 0; current && depth < 5; depth += 1, current = current.parentElement) {
      const text = cleanText(current.innerText, 600);
      const controls = current.querySelectorAll("input, select, textarea").length;
      if (text && text.length <= 350 && controls <= 8) fallback = current;
      if (controls >= 2 && controls <= 6 && text.length <= 350) return current;
    }
    return fallback;
  }

  function peerControls(control) {
    let current = control.parentElement;
    let best = [control];
    for (let depth = 0; current && depth < 6; depth += 1, current = current.parentElement) {
      const candidates = Array.from(current.querySelectorAll("input, select, textarea")).filter(isSupported);
      const textLength = cleanText(current.innerText, 800).length;
      if (candidates.length >= 2 && candidates.length <= 6 && textLength <= 500) {
        best = candidates;
        break;
      }
    }
    return best;
  }

  function optionNumbers(select) {
    if (!(select instanceof HTMLSelectElement)) return [];
    return Array.from(select.options)
      .map((option) => Number(Core.digits(option.textContent)))
      .filter((number) => Number.isFinite(number) && number > 0);
  }

  function inferHint(control, nearby) {
    const normalized = Core.normalize(nearby);
    const peers = peerControls(control);
    const index = peers.indexOf(control);
    let hint = "";

    if (normalized.includes("生年月日") && peers.length >= 3) {
      hint += [" 生年月日年", " 生年月日月", " 生年月日日"][index] || "";
    } else if (normalized.includes("入学年月") && peers.length >= 2) {
      hint += [" 入学年月年", " 入学年月月"][index] || "";
    } else if ((normalized.includes("卒業年月") || normalized.includes("卒業予定年月")) && peers.length >= 2) {
      hint += [" 卒業予定年月年", " 卒業予定年月月"][index] || "";
    } else if ((normalized === "氏名" || normalized.includes("氏名漢字")) && peers.length === 2) {
      hint += [" 氏名姓", " 氏名名"][index] || "";
    } else if ((normalized.includes("フリガナ") || normalized.includes("氏名カナ")) && peers.length === 2) {
      hint += [" セイ", " メイ"][index] || "";
    }

    if (control instanceof HTMLSelectElement && !(normalized.includes("生年月日") && peers.length >= 3)) {
      const numbers = optionNumbers(control);
      const max = numbers.length ? Math.max(...numbers) : 0;
      if (normalized.includes("生年月日")) {
        if (max > 1900) hint += " 生年月日年";
        else if (max <= 12) hint += " 生年月日月";
        else if (max <= 31) hint += " 生年月日日";
      }
    }

    if (control.type === "radio" && (normalized.includes("性別") || normalized.includes("gender"))) hint += " 性別";
    return hint;
  }

  function signalsFor(control) {
    const container = contextContainer(control);
    const nearby = cleanText(container?.innerText || "");
    const hint = inferHint(control, nearby);
    const label = cleanText(`${explicitLabel(control)} ${hint}`);
    const attrs = cleanText([
      control.name,
      control.id,
      control.placeholder,
      control.title,
      control.getAttribute("aria-describedby"),
      control.getAttribute("data-testid"),
      control.type,
      hint
    ].filter(Boolean).join(" "));
    return {
      label,
      attrs,
      nearby,
      autocomplete: control.autocomplete || "",
      inputType: control instanceof HTMLInputElement ? control.type : control instanceof HTMLSelectElement ? "select" : "textarea"
    };
  }

  function displayLabel(control, signals, match) {
    return cleanText(signals.label || signals.nearby || control.name || match.label, 80) || match.label;
  }

  function segmentedValue(control, match, profile) {
    const peers = peerControls(control);
    const index = peers.indexOf(control);
    const maxLength = control instanceof HTMLInputElement ? control.maxLength : -1;

    if (match.key === "phone" && peers.length >= 2 && peers.length <= 4) {
      return profile.phoneParts[index] ?? "";
    }
    if (match.key === "postalCode" && peers.length === 2) {
      return profile.postalParts[index] ?? profile.postalDigits;
    }
    if (match.key === "phone") return maxLength > 0 && maxLength < profile.phoneDigits.length ? profile.phoneDigits.slice(0, maxLength) : profile.phone;
    if (match.key === "postalCode") return maxLength > 0 && maxLength < profile.postalDigits.length ? profile.postalDigits.slice(0, maxLength) : profile.postalCode;
    return match.value;
  }

  function radioText(control) {
    return cleanText(explicitLabel(control) || control.value || control.getAttribute("aria-label"));
  }

  function radioAccepts(control, target) {
    const actual = Core.normalize(radioText(control));
    const wanted = Core.normalize(target);
    if (!actual || !wanted) return false;
    if (actual === wanted || actual.includes(wanted) || wanted.includes(actual)) return true;
    const aliases = {
      男性: ["男", "male", "m"],
      女性: ["女", "female", "f"],
      その他: ["other", "その他"],
      回答しない: ["無回答", "回答しない", "prefernottosay"]
    };
    return (aliases[target] || []).some((alias) => actual === Core.normalize(alias));
  }

  function resolveSelectValue(select, target) {
    const normalizedTarget = Core.normalize(target);
    const targetDigits = Core.digits(target);
    const options = Array.from(select.options).filter((option) => !option.disabled);

    const exact = options.find((option) => {
      const text = Core.normalize(option.textContent);
      const value = Core.normalize(option.value);
      return text === normalizedTarget || value === normalizedTarget;
    });
    if (exact) return exact.value;

    if (targetDigits) {
      const numeric = options.find((option) => {
        const textDigits = Core.digits(option.textContent);
        const valueDigits = Core.digits(option.value);
        return textDigits === targetDigits || valueDigits === targetDigits;
      });
      if (numeric) return numeric.value;
    }

    const partial = options.find((option) => {
      const text = Core.normalize(option.textContent);
      return normalizedTarget.length >= 1 && (text.includes(normalizedTarget) || normalizedTarget.includes(text));
    });
    return partial?.value ?? null;
  }

  function ensureId(control) {
    let id = control.getAttribute(ELEMENT_ATTRIBUTE);
    if (!id) {
      sequence += 1;
      id = `${Date.now().toString(36)}-${sequence}`;
      control.setAttribute(ELEMENT_ATTRIBUTE, id);
    }
    return id;
  }

  function scan(rawProfile, language = "ja") {
    lastScan.clear();
    localLlmCandidates.clear();
    appleReviewCandidates.clear();
    scannedLanguage = language === "en" ? "en" : "ja";
    const profile = Core.prepareProfile(rawProfile, scannedLanguage);
    scannedProfile = profile;
    const controls = Array.from(document.querySelectorAll("input, select, textarea")).filter((control) => isSupported(control) && isVisible(control));
    const matches = [];
    const handledRadioGroups = new Set();

    for (const control of controls) {
      const signals = signalsFor(control);
      const match = Core.matchField(signals, profile);
      const id = ensureId(control);
      // AI is deliberately limited to fields that the deterministic matcher
      // could not classify at all.  It never revisits a rule-based result.
      appleReviewCandidates.set(id, { control, signals, baseline: match });
      if (!match) {
        localLlmCandidates.set(id, { control, signals, baseline: match });
      }
      if (!match) continue;

      if (control.type === "radio") {
        const groupKey = `${control.name || "anonymous"}:${match.key}`;
        if (handledRadioGroups.has(groupKey)) continue;
        const sameGroup = controls.filter((candidate) => candidate.type === "radio" && (candidate.name || "anonymous") === (control.name || "anonymous"));
        const targetRadio = sameGroup.find((candidate) => radioAccepts(candidate, match.value));
        if (!targetRadio) continue;
        handledRadioGroups.add(groupKey);
        const id = ensureId(targetRadio);
        const confidence = Core.confidence(match.score);
        const item = { id, fieldKey: match.key, fieldLabel: match.label, pageLabel: displayLabel(targetRadio, signals, match), value: match.value, score: match.score, confidence };
        lastScan.set(id, { control: targetRadio, value: match.value, item });
        matches.push(item);
        continue;
      }

      let value = segmentedValue(control, match, profile);
      if (!value) continue;
      if (control instanceof HTMLSelectElement) {
        const optionValue = resolveSelectValue(control, value);
        if (optionValue === null) continue;
      }

      const confidence = Core.confidence(match.score);
      const item = { id, fieldKey: match.key, fieldLabel: match.label, pageLabel: displayLabel(control, signals, match), value, score: match.score, confidence };
      lastScan.set(id, { control, value, item });
      matches.push(item);
    }

    return matches.sort((a, b) => b.score - a.score);
  }

  function localLlmQuestion(signals) {
    const label = cleanText(signals.label, 80);
    const nearby = cleanText(signals.nearby, 80);
    if (label && nearby && !Core.normalize(nearby).includes(Core.normalize(label))) return cleanText(`${label} / ${nearby}`, 80);
    return label || nearby;
  }

  function localLlmChoices(question, inputType, availableKeys) {
    const available = new Set(availableKeys);
    const groups = {
      contact: ["fullNameKanji", "fullAddress", "phone", "email"],
      education: ["university", "faculty", "department", "graduationYear"],
      universityMeta: ["universityType", "universityInitial", "university"],
      address: ["postalCode", "prefecture", "city", "fullAddress"],
      identity: ["fullNameKanji", "fullNameKana", "birthDate", "gender"],
      guardian: ["parentName", "relationship", "phone", "email"]
    };
    const normalized = Core.normalize(question);
    let group = groups.contact;
    if (/(頭文字|最初の文字|初めの文字|国立|私立|国公立|設置|大学区分|大学種別)/.test(normalized)) group = groups.universityMeta;
    else if (/(学部学科|学部.*学科|学科.*学部)/.test(normalized)) group = ["faculty", "department"];
    else if (/(大学|学校|教育|学部|学科|専攻|卒業|入学|university|college|school|faculty|department|major|graduation|enrollment)/.test(normalized)) group = groups.education;
    else if (/(住所|居住|郵便|都道府県|市区町村|番地|建物|address|postal|zip|city|state|province)/.test(normalized)) group = groups.address;
    else if (/(生年月日|誕生日|性別|氏名|名前|ふりがな|フリガナ|カナ|birth|dateofbirth|gender|firstname|lastname|fullname)/.test(normalized)) group = groups.identity;
    else if (/(保護者|親権者|続柄|父母)/.test(normalized)) group = groups.guardian;

    if (inputType === "email") group = ["email", "emailConfirm", "email2"];
    else if (inputType === "tel") group = ["phone"];
    else if (inputType === "date") group = ["birthDate", "enrollmentYear", "graduationYear"];
    return group.filter((key) => available.has(key)).slice(0, 4);
  }

  function makeLocalLlmFields() {
    const seenQuestions = new Set();
    const seenRadioGroups = new Set();
    const candidates = [];

    for (const [id, candidate] of localLlmCandidates) {
      const { control, signals, baseline } = candidate;
      const question = localLlmQuestion(signals);
      const normalizedQuestion = Core.normalize(question);
      if (!normalizedQuestion || seenQuestions.has(normalizedQuestion)) continue;

      if (control.type === "radio") {
        const radioGroup = control.name || normalizedQuestion;
        if (seenRadioGroups.has(radioGroup)) continue;
        seenRadioGroups.add(radioGroup);
      }
      seenQuestions.add(normalizedQuestion);
      candidates.push({ id, question, inputType: signals.inputType, baselineScore: baseline?.score ?? -1 });
    }

    candidates.sort((a, b) => {
      const aMatched = a.baselineScore < 0 ? 0 : 1;
      const bMatched = b.baselineScore < 0 ? 0 : 1;
      return aMatched - bMatched || a.baselineScore - b.baselineScore;
    });
    const allowedKeys = Core.DEFINITIONS
      .filter((definition) => Boolean(Core.fieldValue(definition.key, scannedProfile)))
      .map((definition) => definition.key);
    const fields = candidates.map(({ id, question, inputType }) => ({
      id,
      question,
      inputType,
      choices: localLlmChoices(question, inputType, allowedKeys)
    })).filter((field) => field.choices.length >= 2).slice(0, 2);
    return { fields, allowedKeys };
  }

  function makeAppleReviewFields() {
    const allowedKeys = Core.DEFINITIONS.filter((definition) => Boolean(Core.fieldValue(definition.key, scannedProfile))).map((definition) => definition.key);
    const allowed = new Set(allowedKeys);
    const seen = new Set(), fields = [];
    for (const [id, candidate] of appleReviewCandidates) {
      const { control, signals, baseline } = candidate;
      const question = localLlmQuestion(signals);
      const normalized = Core.normalize(question);
      if (!normalized || seen.has(normalized)) continue;
      const group = localLlmChoices(question, signals.inputType, allowedKeys);
      const choices = Array.from(new Set([baseline?.key, ...group, "phone", "email", "fullAddress", "fullNameKanji"].filter((key) => allowed.has(key)))).slice(0, 4);
      if (choices.length < 2 || control.type === "radio") continue;
      seen.add(normalized);
      fields.push({ id, question, inputType: signals.inputType, choices });
      if (fields.length >= 100) break;
    }
    return { fields, allowedKeys };
  }

  function applyAppleReviews(decisions) {
    const additions = [];
    for (const decision of decisions || []) {
      const source = appleReviewCandidates.get(decision.id);
      if (!source) continue;
      const question = Core.normalize(localLlmQuestion(source.signals));
      for (const [id, candidate] of appleReviewCandidates) {
        if (!question || Core.normalize(localLlmQuestion(candidate.signals)) !== question) continue;
        const record = lastScan.get(id);
        if (record) {
          if (!decision.fieldKey || decision.fieldKey !== record.item.fieldKey) {
            record.item.score = 45;
            record.item.confidence = Core.confidence(45);
            record.item.reviewNote = decision.fieldKey ? "AIと判定が異なるため確認" : "AIが判断できず要確認";
          } else {
            record.item.reviewNote = "AI照合済み";
          }
        } else if (!candidate.baseline && decision.fieldKey && Core.compatibleField(decision.fieldKey, candidate.signals)) {
          additions.push({ id, fieldKey: decision.fieldKey });
        }
      }
    }
    if (additions.length) {
      addLocalLlmMatches(additions);
      for (const item of additions) {
        const record = lastScan.get(item.id);
        if (record?.item.localLlm) {
          record.item.score = 45;
          record.item.confidence = Core.confidence(45);
          record.item.reviewNote = "AI候補・要確認";
        }
      }
    }
    return Array.from(lastScan.values(), (record) => record.item).sort((a, b) => b.score - a.score);
  }

  function jevLabel(key) {
    const english = {
      email: "email address", emailConfirm: "email confirmation", email2: "secondary email",
      lastNameKanji: "last/family name", firstNameKanji: "first/given name", fullNameKanji: "full name",
      phone: "phone number", postalCode: "ZIP/postal code", prefecture: "state/province", city: "city",
      addressLine1: "street address", addressLine2: "unit/apartment", fullAddress: "full address",
      birthDate: "date of birth", gender: "gender", university: "university/school", faculty: "faculty", department: "department/major"
    };
    return scannedLanguage === "en" ? (english[key] || key) : (Core.definitionForKey(key)?.label || key);
  }

  function makeJevFields() {
    const allowedKeys = Core.DEFINITIONS
      .filter((definition) => Boolean(Core.fieldValue(definition.key, scannedProfile)))
      .map((definition) => definition.key);
    const seenQuestions = new Set();
    const seenRadioGroups = new Set();
    const fields = [];
    for (const [id, candidate] of localLlmCandidates) {
      const { control, signals } = candidate;
      const question = localLlmQuestion(signals);
      const normalizedQuestion = Core.normalize(question);
      if (!normalizedQuestion || seenQuestions.has(normalizedQuestion)) continue;
      if (control.type === "radio") {
        const group = control.name || normalizedQuestion;
        if (seenRadioGroups.has(group)) continue;
        seenRadioGroups.add(group);
      }
      const choices = localLlmChoices(question, signals.inputType, allowedKeys);
      if (choices.length < 2) continue;
      seenQuestions.add(normalizedQuestion);
      fields.push({ id, inputType: signals.inputType, choices });
      if (fields.length >= 20) break;
    }
    return fields.map((field) => {
      const candidate = localLlmCandidates.get(field.id);
      return {
        id: field.id,
        label: candidate?.signals.label || "",
        attrs: candidate?.signals.attrs || "",
        nearby: candidate?.signals.nearby || "",
        inputType: field.inputType,
        choices: field.choices.map((key) => ({ key, label: jevLabel(key) }))
      };
    });
  }

  function addLocalLlmMatches(classifications) {
    const additions = [];
    const controls = Array.from(document.querySelectorAll("input, select, textarea")).filter(isSupported);
    const handledRadioGroups = new Set(Array.from(lastScan.values(), (record) => record.control.type === "radio" ? record.control.name : "").filter(Boolean));
    const expandedClassifications = [];
    for (const classification of classifications || []) {
      const source = localLlmCandidates.get(classification.id);
      const sourceQuestion = Core.normalize(localLlmQuestion(source?.signals || {}));
      for (const [id, candidate] of localLlmCandidates) {
        if (sourceQuestion && Core.normalize(localLlmQuestion(candidate.signals)) === sourceQuestion) {
          expandedClassifications.push({ ...classification, id });
        }
      }
    }
    for (const classification of expandedClassifications) {
      const candidate = localLlmCandidates.get(classification.id);
      const definition = Core.definitionForKey(classification.fieldKey);
      const value = definition ? Core.fieldValue(definition.key, scannedProfile) : "";
      if (!candidate || !definition || !value || !Core.compatibleField(definition.key, candidate.signals)) continue;
      const { control, signals, baseline } = candidate;
      if (baseline) continue;

      if (control.type === "radio") {
        const groupKey = control.name || `anonymous-${classification.id}`;
        if (handledRadioGroups.has(groupKey)) continue;
        const sameGroup = controls.filter((item) => item.type === "radio" && (item.name || `anonymous-${classification.id}`) === groupKey);
        const target = sameGroup.find((item) => radioAccepts(item, value));
        if (!target) continue;
        const id = ensureId(target);
        const score = 70;
        const item = { id, fieldKey: definition.key, fieldLabel: definition.label, pageLabel: displayLabel(target, signals, definition), value, score, confidence: Core.confidence(score), localLlm: true };
        lastScan.set(id, { control: target, value, item });
        additions.push(item);
        handledRadioGroups.add(groupKey);
        continue;
      }

      const match = { ...definition, value };
      const targetValue = segmentedValue(control, match, scannedProfile);
      if (!targetValue) continue;
      if (control instanceof HTMLSelectElement && resolveSelectValue(control, targetValue) === null) continue;
      const score = 70;
      const item = { id: classification.id, fieldKey: definition.key, fieldLabel: definition.label, pageLabel: displayLabel(control, signals, definition), value: targetValue, score, confidence: Core.confidence(score), localLlm: true };
      lastScan.set(classification.id, { control, value: targetValue, item });
      additions.push(item);
    }
    return Array.from(lastScan.values(), (record) => record.item).sort((a, b) => b.score - a.score);
  }

  function setNativeValue(control, value) {
    const prototype = control instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
    if (setter) setter.call(control, value);
    else control.value = value;
  }

  function dispatchEvents(control) {
    control.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
    control.dispatchEvent(new Event("change", { bubbles: true }));
    control.dispatchEvent(new Event("blur", { bubbles: false }));
  }

  function applyOne(record) {
    const { control, value } = record;
    if (!control.isConnected || control.disabled || control.readOnly) return false;

    if (control.type === "radio") {
      control.click();
      dispatchEvents(control);
    } else if (control instanceof HTMLSelectElement) {
      const resolved = resolveSelectValue(control, value);
      if (resolved === null) return false;
      const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set;
      if (setter) setter.call(control, resolved);
      else control.value = resolved;
      dispatchEvents(control);
    } else {
      setNativeValue(control, value);
      dispatchEvents(control);
    }

    const previousOutline = control.style.outline;
    control.style.outline = "3px solid rgba(23, 107, 67, .45)";
    window.setTimeout(() => { control.style.outline = previousOutline; }, 1800);
    return true;
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    try {
      if (message?.type === "CAREER_AUTOFILL_SCAN") {
        const matches = scan(message.profile || {}, message.language);
        sendResponse({ ok: true, matches, url: location.href });
        return;
      }
      if (message?.type === "CAREER_AUTOFILL_LOCAL_LLM_ENRICH") {
        const isApple = message.config?.provider === "apple";
        const { fields, allowedKeys } = isApple ? makeAppleReviewFields() : makeLocalLlmFields();
        if (!fields.length) {
          sendResponse({ ok: true, matches: Array.from(lastScan.values(), (record) => record.item), used: false, timedOut: false, noCandidates: true });
          return;
        }
        chrome.runtime.sendMessage({
          type: "CAREER_AUTOFILL_LOCAL_LLM_CLASSIFY",
          config: message.config || {},
          fields,
          allowedKeys,
          timeoutMs: message.timeoutMs
        })
          .then((response) => {
            if (!response?.ok) throw new Error(response?.error || "ローカルLLMの判定に失敗しました。");
            const matches = isApple && response.decisions?.length ? applyAppleReviews(response.decisions) : response.matches?.length && !isApple ? addLocalLlmMatches(response.matches) : Array.from(lastScan.values(), (record) => record.item);
            sendResponse({ ok: true, matches, used: Boolean(response.used), timedOut: Boolean(response.timedOut), noCandidates: false, partial: Boolean(response.partial), error: response.error || "" });
          })
          .catch((error) => sendResponse({
            ok: true,
            matches: Array.from(lastScan.values(), (record) => record.item),
            used: false,
            timedOut: false,
            noCandidates: false,
            error: error instanceof Error ? error.message : String(error)
          }));
        return true;
      }
      if (message?.type === "CAREER_AUTOFILL_JEV_ENRICH") {
        const fields = makeJevFields();
        if (!fields.length) {
          sendResponse({ ok: true, matches: Array.from(lastScan.values(), (record) => record.item), used: false, timedOut: false, noCandidates: true });
          return;
        }
        chrome.runtime.sendMessage({
          type: "CAREER_AUTOFILL_JEV_CLASSIFY",
          config: message.config || {},
          fields,
          language: scannedLanguage,
          timeoutMs: message.timeoutMs
        }).then((response) => {
          const matches = response?.matches?.length ? addLocalLlmMatches(response.matches) : Array.from(lastScan.values(), (record) => record.item);
          sendResponse({ ok: true, matches, used: Boolean(response?.used), timedOut: Boolean(response?.timedOut), noCandidates: Boolean(response?.noCandidates), rejected: response?.rejected || 0, error: response?.error || "" });
        }).catch((error) => sendResponse({ ok: true, matches: Array.from(lastScan.values(), (record) => record.item), used: false, error: error instanceof Error ? error.message : String(error) }));
        return true;
      }
      if (message?.type === "CAREER_AUTOFILL_APPLY") {
        let applied = 0;
        for (const id of message.ids || []) {
          const record = lastScan.get(id);
          if (record && applyOne(record)) applied += 1;
        }
        sendResponse({ ok: true, applied });
      }
    } catch (error) {
      sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) });
    }
  });
})();
