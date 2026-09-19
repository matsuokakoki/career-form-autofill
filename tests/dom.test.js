const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { Window } = require("happy-dom");

const root = path.resolve(__dirname, "..");
const coreSource = fs.readFileSync(path.join(root, "autofill-core.js"), "utf8");
const contentSource = fs.readFileSync(path.join(root, "content-script.js"), "utf8");

function createPage() {
  const window = new Window({ url: "https://example.com/application" });
  window.document.body.innerHTML = `
    <form>
      <fieldset><legend>氏名</legend>
        <label>姓 <input id="last-name"></label>
        <label>名 <input id="first-name"></label>
      </fieldset>
      <label>メールアドレス <input id="email" type="email"></label>
      <label>メールアドレス（確認） <input id="email-confirm" type="email"></label>
      <label>第2メールアドレス <input id="email-2" type="email"></label>
      <div class="form-group">電話番号
        <input id="phone-1" maxlength="3"><input id="phone-2" maxlength="4"><input id="phone-3" maxlength="4">
      </div>
      <div class="form-group">郵便番号
        <input id="postal-1" maxlength="3"><input id="postal-2" maxlength="4">
      </div>
      <label>都道府県 <select id="prefecture"><option value="">選択</option><option value="23">愛知県</option></select></label>
      <div role="listitem"><span>大学名（必須）</span><input id="university" name="entry.123"></div>
      <div class="form-group">生年月日
        <select id="birth-year"><option>2003年</option><option>2004年</option></select>
        <select id="birth-month"><option>3月</option><option>4月</option></select>
        <select id="birth-day"><option>1日</option><option>2日</option></select>
      </div>
      <fieldset><legend>性別</legend>
        <label><input type="radio" name="gender" value="male">男性</label>
        <label><input type="radio" name="gender" value="female">女性</label>
      </fieldset>
    </form>`;

  window.HTMLElement.prototype.getBoundingClientRect = () => ({ width: 120, height: 24, top: 0, left: 0, right: 120, bottom: 24 });
  let listener;
  window.chrome = {
    runtime: {
      onMessage: { addListener(callback) { listener = callback; } }
    }
  };
  window.eval(coreSource);
  window.eval(contentSource);
  return { window, listener: () => listener };
}

const profile = {
  lastNameKanji: "松岡",
  firstNameKanji: "功樹",
  email: "koki@example.com",
  email2: "sub@example.com",
  phone: "090-1234-5678",
  postalCode: "464-0001",
  prefecture: "愛知県",
  university: "名古屋大学",
  birthYear: "2004",
  birthMonth: "4",
  birthDay: "2",
  gender: "男性"
};

test("DOMを解析し、プレビュー後に分割欄と選択欄へ入力する", () => {
  const page = createPage();
  let scanResponse;
  page.listener()({ type: "CAREER_AUTOFILL_SCAN", profile }, null, (response) => { scanResponse = response; });

  assert.equal(scanResponse.ok, true);
  const keys = new Set(scanResponse.matches.map((match) => match.fieldKey));
  for (const expected of ["lastNameKanji", "firstNameKanji", "email", "emailConfirm", "email2", "phone", "postalCode", "prefecture", "university", "birthYear", "birthMonth", "birthDay", "gender"]) {
    assert.ok(keys.has(expected), `${expected} should be detected`);
  }

  let applyResponse;
  page.listener()({ type: "CAREER_AUTOFILL_APPLY", ids: scanResponse.matches.map((match) => match.id) }, null, (response) => { applyResponse = response; });
  assert.equal(applyResponse.ok, true);

  const document = page.window.document;
  assert.equal(document.querySelector("#last-name").value, "松岡");
  assert.equal(document.querySelector("#first-name").value, "功樹");
  assert.equal(document.querySelector("#email").value, "koki@example.com");
  assert.equal(document.querySelector("#email-confirm").value, "koki@example.com");
  assert.equal(document.querySelector("#email-2").value, "sub@example.com");
  assert.deepEqual(["#phone-1", "#phone-2", "#phone-3"].map((selector) => document.querySelector(selector).value), ["090", "1234", "5678"]);
  assert.deepEqual(["#postal-1", "#postal-2"].map((selector) => document.querySelector(selector).value), ["464", "0001"]);
  assert.equal(document.querySelector("#prefecture").value, "23");
  assert.equal(document.querySelector("#university").value, "名古屋大学");
  assert.equal(document.querySelector("#birth-year").value, "2004年");
  assert.equal(document.querySelector("#birth-month").value, "4月");
  assert.equal(document.querySelector("#birth-day").value, "2日");
  assert.equal(document.querySelector("input[value='male']").checked, true);
});
