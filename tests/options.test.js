const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { Window } = require('happy-dom');

test('連絡先の取り込みは空欄のみ更新し、保存を実行しない', async () => {
  const root = path.resolve(__dirname, '..');
  const w = new Window({ url: 'https://example.test' });
  w.document.write(fs.readFileSync(path.join(root, 'options.html'), 'utf8'));
  let saved = false;
  w.chrome = { storage: { local: { get: async () => ({ profile: { email: 'existing@example.test' } }), set: async () => { saved = true; } } }, runtime: {
    sendNativeMessage: async (_host, message) => { assert.equal(message.action, 'read_my_card'); return { profile: { email: 'new@example.test', lastNameKana: 'やまだ', lastNameKanji: '山田' } }; }
  } };
  w.eval(fs.readFileSync(path.join(root, 'autofill-core.js'), 'utf8'));
  w.eval(fs.readFileSync(path.join(root, 'options.js'), 'utf8'));
  await new Promise((resolve) => setTimeout(resolve, 0));
  w.document.querySelector('#import-contact').click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  const form = w.document.querySelector('#profile-form');
  assert.equal(form.elements.namedItem('email').value, 'existing@example.test');
  assert.equal(form.elements.namedItem('lastNameKana').value, 'ヤマダ');
  assert.equal(form.elements.namedItem('lastNameKanji').value, '山田');
  assert.equal(saved, false);
  w.close();
});


test('カナ入力と英訳候補は自動入力し、入力済み英語を上書きしない', async () => {
  const root = path.resolve(__dirname, '..');
  const w = new Window({ url: 'https://example.test' });
  w.document.write(fs.readFileSync(path.join(root, 'options.html'), 'utf8'));
  let saved = false;
  w.chrome = { storage: { local: { get: async () => ({ profile: { lastNameKana: 'ヤマダ', firstNameLatin: 'Taro', firstNameKana: 'タロウ', university: '名古屋大学' } }), set: async () => { saved = true; } } }, runtime: {
    sendNativeMessage: async (_host, message) => {
      assert.equal(message.action, 'translate_profile');
      assert.equal(message.fields.lastNameLatin, 'ヤマダ');
      assert.equal(message.fields.firstNameLatin, undefined);
      return { translations: { lastNameLatin: 'Yamada', firstNameLatin: 'wrong', universityEnglish: 'Nagoya University' } };
    }
  } };
  w.eval(fs.readFileSync(path.join(root, 'autofill-core.js'), 'utf8'));
  w.eval(fs.readFileSync(path.join(root, 'options.js'), 'utf8'));
  await new Promise((resolve) => setTimeout(resolve, 0));
  const form = w.document.querySelector('#profile-form');
  assert.equal(form.elements.namedItem('lastNameHalfKana').value, 'ﾔﾏﾀﾞ');
  form.elements.namedItem('lastNameKana').value = 'スズキ';
  form.elements.namedItem('lastNameKana').dispatchEvent(new w.Event('input'));
  assert.equal(form.elements.namedItem('lastNameHalfKana').value, 'ｽｽﾞｷ');
  form.elements.namedItem('lastNameKana').value = 'ヤマダ';
  form.elements.namedItem('lastNameKana').dispatchEvent(new w.Event('input'));
  w.document.querySelector('#translate-profile').click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(form.elements.namedItem('lastNameLatin').value, 'Yamada');
  assert.equal(form.elements.namedItem('firstNameLatin').value, 'Taro');
  assert.equal(form.elements.namedItem('universityEnglish').value, 'Nagoya University');
  assert.equal(saved, false);
  w.close();
});
