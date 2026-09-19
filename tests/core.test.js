const test = require("node:test");
const assert = require("node:assert/strict");
const Core = require("../autofill-core.js");

const profile = {
  lastNameKanji: "松岡",
  firstNameKanji: "功樹",
  lastNameKana: "マツオカ",
  firstNameKana: "コウキ",
  email: "koki@example.com",
  email2: "koki.sub@example.com",
  phone: "090-1234-5678",
  university: "名古屋大学",
  graduationYear: "2028"
};

test("全角カナを半角カナへ変換する", () => {
  assert.equal(Core.toHalfWidthKana("マツオカ コウキ"), "ﾏﾂｵｶ ｺｳｷ");
});

test("電話番号を3ブロックへ分割する", () => {
  assert.deepEqual(Core.splitPhone("090-1234-5678"), ["090", "1234", "5678"]);
});

test("確認用メール欄には第1メールアドレスを使う", () => {
  const match = Core.matchField({ label: "メールアドレス（確認）", attrs: "email_confirm", nearby: "", autocomplete: "" }, profile);
  assert.equal(match.key, "emailConfirm");
  assert.equal(match.value, "koki@example.com");
});

test("第2メールアドレス欄を確認欄と区別する", () => {
  const match = Core.matchField({ label: "第2メールアドレス", attrs: "email2", nearby: "", autocomplete: "" }, profile);
  assert.equal(match.key, "email2");
  assert.equal(match.value, "koki.sub@example.com");
});

test("autocomplete属性を優先して姓を判定する", () => {
  const match = Core.matchField({ label: "", attrs: "field_1", nearby: "", autocomplete: "family-name" }, profile);
  assert.equal(match.key, "lastNameKanji");
  assert.equal(match.score, 100);
});

test("Googleフォーム風の周辺テキストから大学名を判定する", () => {
  const match = Core.matchField({ label: "", attrs: "entry.123", nearby: "大学名 必須", autocomplete: "" }, profile);
  assert.equal(match.key, "university");
  assert.ok(match.score >= 60);
});

test("卒業予定年を判定する", () => {
  const match = Core.matchField({ label: "卒業予定年", attrs: "graduation_year", nearby: "卒業予定年月", autocomplete: "" }, profile);
  assert.equal(match.key, "graduationYear");
  assert.equal(match.value, "2028");
});

test("section付きautocompleteと日本語の表記ゆれを解釈する", () => {
  const email = Core.matchField({ label: "", attrs: "", nearby: "", autocomplete: "section-apply shipping email", inputType: "email" }, profile);
  const postal = Core.matchField({ label: "郵便", attrs: "post_code", nearby: "ご住所", autocomplete: "", inputType: "text" }, { ...profile, postalCode: "464-0001" });
  assert.equal(email.key, "email");
  assert.equal(email.score, 100);
  assert.equal(postal.key, "postalCode");
});

test("date型の『誕生日』は日単体ではなく生年月日として扱う", () => {
  const match = Core.matchField({ label: "誕生日", attrs: "birth_date", nearby: "本人情報", autocomplete: "", inputType: "date" }, {
    ...profile, birthYear: "2004", birthMonth: "4", birthDay: "2"
  });
  assert.equal(match.key, "birthDate");
  assert.equal(match.value, "2004-04-02");
});

test("設問ラベルが住所ならtel属性でも電話番号を選ばない", () => {
  const match = Core.matchField({ label: "住所", attrs: "tel address_input", nearby: "郵便番号から住所を入力", autocomplete: "", inputType: "tel" }, {
    ...profile, prefecture: "愛知県", city: "名古屋市", addressLine1: "千種区"
  });
  assert.equal(match.key, "fullAddress");
});

test("学部・学科欄へ大学名を割り当てない", () => {
  const match = Core.matchField({ label: "学部・学科", attrs: "school_name", nearby: "", autocomplete: "", inputType: "text" }, {
    ...profile, faculty: "情報学部", department: "情報学科"
  });
  assert.equal(match.key, "department");
  assert.equal(match.value, "情報学科");
});

test("名古屋大学から国立区分と頭文字を補完する", () => {
  const prepared = Core.prepareProfile({ university: "名古屋大学" });
  assert.equal(prepared.universityType, "国立");
  assert.equal(prepared.universityInitial, "な");
});

test("Englishモードでは英語プロフィールを共通の意味キーへ重ねる", () => {
  const profile = Core.prepareProfile({
    lastNameLatin: "Yamada", firstNameLatin: "Taro", addressLine1English: "1 Main St", cityEnglish: "Boston", stateProvince: "MA"
  }, "en");
  assert.equal(profile.fullNameKanji, "Yamada Taro");
  assert.equal(profile.fullAddress, "MA, Boston, 1 Main St");
  assert.equal(profile.fullNameKana, "");
});
