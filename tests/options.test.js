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
