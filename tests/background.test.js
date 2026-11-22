const test = require("node:test");
const assert = require("node:assert/strict");

const listeners = [];
global.chrome = {
  runtime: {
    onMessage: {
      addListener(callback) { listeners.push(callback); }
    }
  }
};
require("../background.js");

function send(message) {
  return new Promise((resolve) => {
    const responses = listeners.map((listener) => listener(message, null, resolve));
    assert.ok(responses.includes(true));
  });
}

const config = { endpoint: "http://127.0.0.1:11434/api/chat", model: "qwen2.5:3b" };

test("最大2問を短い質問として並列分類する", async () => {
  const requestBodies = [];
  global.fetch = async (_url, options) => {
    const requestBody = JSON.parse(options.body);
    requestBodies.push(requestBody);
    const answer = requestBodies.length === 1 ? "電話番号" : "メールアドレス";
    return {
      ok: true,
      async json() { return { message: { content: answer } }; }
    };
  };

  const response = await send({
    type: "CAREER_AUTOFILL_LOCAL_LLM_CLASSIFY",
    config,
    allowedKeys: ["phone", "email"],
    fields: [
      { id: "a", question: "日中につながる番号", inputType: "text", choices: ["fullNameKanji", "fullAddress", "phone", "email"] },
      { id: "b", question: "連絡を受け取る宛先", inputType: "text", choices: ["fullNameKanji", "fullAddress", "phone", "email"] },
      { id: "c", question: "この3件目は送らない", inputType: "text", choices: ["fullNameKanji", "fullAddress", "phone", "email"] }
    ]
  });

  assert.deepEqual(response.matches, [
    { id: "a", fieldKey: "phone" },
    { id: "b", fieldKey: "email" }
  ]);
  assert.equal(response.used, true);
  assert.equal(requestBodies.length, 2);
  assert.equal(requestBodies[0].model, "qwen2.5:3b");
  assert.equal(requestBodies[0].keep_alive, "30m");
  assert.equal(requestBodies[0].options.num_ctx, 512);
  assert.equal(requestBodies[0].options.num_predict, 8);
  assert.ok(requestBodies.every((body) => !/3件目/.test(body.messages[0].content)));
  assert.ok(requestBodies.every((body) => !/候補:/.test(body.messages[0].content)));
});

test("2.6秒以内の指定時間で打ち切って成功扱いにする", async () => {
  global.fetch = (_url, options) => new Promise((_resolve, reject) => {
    options.signal.addEventListener("abort", () => {
      const error = new Error("aborted");
      error.name = "AbortError";
      reject(error);
    });
  });

  const response = await send({
    type: "CAREER_AUTOFILL_LOCAL_LLM_CLASSIFY",
    config,
    timeoutMs: 10,
    allowedKeys: ["phone"],
    fields: [{ id: "a", question: "日中につながる番号", inputType: "text", choices: ["fullNameKanji", "fullAddress", "phone", "email"] }]
  });
  assert.equal(response.ok, true);
  assert.equal(response.timedOut, true);
  assert.deepEqual(response.matches, []);
});

test("403と分類不能な応答は通常ルールへ戻せる応答にする", async (t) => {
  await t.test("403", async () => {
    global.fetch = async () => ({ ok: false, status: 403 });
    const response = await send({
      type: "CAREER_AUTOFILL_LOCAL_LLM_CLASSIFY",
      config,
      allowedKeys: ["phone"],
      fields: [{ id: "a", question: "連絡番号", inputType: "text", choices: ["fullNameKanji", "fullAddress", "phone", "email"] }]
    });
    assert.equal(response.ok, true);
    assert.match(response.error, /403/);
    assert.equal(response.timedOut, false);
  });

  await t.test("分類不能な応答", async () => {
    global.fetch = async () => ({
      ok: true,
      async json() { return { message: { content: "not-json" } }; }
    });
    const response = await send({
      type: "CAREER_AUTOFILL_LOCAL_LLM_CLASSIFY",
      config,
      allowedKeys: ["phone"],
      fields: [{ id: "a", question: "連絡番号", inputType: "text", choices: ["fullNameKanji", "fullAddress", "phone", "email"] }]
    });
    assert.equal(response.ok, true);
    assert.equal(response.used, false);
    assert.deepEqual(response.matches, []);
  });
});

test("設定保存時のウォームアップは30分保持を要求する", async () => {
  let requestBody;
  global.fetch = async (_url, options) => {
    requestBody = JSON.parse(options.body);
    return { ok: true };
  };
  const response = await send({ type: "CAREER_AUTOFILL_LOCAL_LLM_WARMUP", config });
  assert.equal(response.ok, true);
  assert.equal(requestBody.keep_alive, "30m");
  assert.deepEqual(requestBody.messages, []);
});

test("Jevには値を含めず、確率とconfidenceが閾値以上の選択だけを返す", async () => {
  let requestBody;
  global.fetch = async (_url, options) => {
    requestBody = JSON.parse(options.body);
    assert.match(options.headers.Authorization, /^Bearer test-key$/);
    return {
      ok: true,
      async json() {
        return { answers: { q0: { choice: "phone", probabilities: { phone: 0.91, none: 0.09 }, confidence: 0.82 }, q1: { choice: "email", probabilities: { email: 0.7, none: 0.3 }, confidence: 0.9 } } };
      }
    };
  };
  const response = await send({
    type: "CAREER_AUTOFILL_JEV_CLASSIFY",
    config: { apiKey: "test-key" },
    language: "ja",
    fields: [
      { id: "a", label: "日中につながる番号", attrs: "", nearby: "", inputType: "text", choices: [{ key: "phone", label: "電話番号" }, { key: "email", label: "メール" }] },
      { id: "b", label: "連絡先", attrs: "", nearby: "", inputType: "text", choices: [{ key: "phone", label: "電話番号" }, { key: "email", label: "メール" }] }
    ]
  });
  assert.equal(requestBody.model, "jev-latest");
  assert.equal(requestBody.state.language, "Japanese");
  assert.ok(!JSON.stringify(requestBody).includes("090-"));
  assert.deepEqual(response.matches, [{ id: "a", fieldKey: "phone", probability: 0.91, confidence: 0.82 }]);
});

test('Apple Intelligenceへ未判定設問と候補だけを渡し、候補外を拒否する', async () => {
  const calls = [];
  chrome.runtime.sendNativeMessage = async (host, message) => {
    calls.push({ host, message });
    return { answer: calls.length === 1 ? '電話番号' : 'メールアドレスです' };
  };
  const response = await send({ type: 'CAREER_AUTOFILL_LOCAL_LLM_CLASSIFY', config: { provider: 'apple' }, allowedKeys: ['phone', 'email'], fields: [
    { id: 'a', question: '日中につながる番号', choices: ['phone', 'email'] },
    { id: 'b', question: '連絡先', choices: ['phone', 'email'] }
  ] });
  assert.deepEqual(response.matches, [{ id: 'a', fieldKey: 'phone' }]);
  assert.equal(calls[0].host, 'com.career_form_autofill.apple_fm');
  assert.deepEqual(Object.keys(calls[0].message).sort(), ['choices', 'question']);
});

test('Apple Intelligenceに接続できない場合はルール判定に戻る', async () => {
  chrome.runtime.sendNativeMessage = async () => { throw new Error('host missing'); };
  const response = await send({ type: 'CAREER_AUTOFILL_LOCAL_LLM_CLASSIFY', config: { provider: 'apple' }, fields: [{ id: 'a', question: '連絡先', choices: ['phone', 'email'] }], allowedKeys: ['phone'] });
  assert.deepEqual(response.matches, []);
  assert.match(response.error, /host missing/);
});
