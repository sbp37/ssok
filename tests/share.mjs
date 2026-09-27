// Host/API contract tests; actual Toss share-sheet rendering needs a device.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const code = ts.transpileModule(readFileSync(new URL('../src/ui/share.ts', import.meta.url), 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
}).outputText;

function setup(environment = 'web', navigator = {}, overrides = {}) {
  const notices = [], states = [], calls = [];
  const sdk = {
    Environment: { environment },
    Share: {
      createLink: async o => { calls.push(['link', o]); return 'https://minion.toss.im/example'; },
      sendMessage: async o => { calls.push(['message', o]); },
      ...overrides,
    },
  };
  const exports = {};
  vm.runInNewContext(code, {
    exports, navigator, Error,
    require: name => name === 'react'
      ? { useRef: value => ({ current: value }), useState: value => [value, v => states.push(v)] }
      : sdk,
  });
  const hook = exports.useShare(text => notices.push(text));
  return { hook, notices, states, calls };
}

for (const host of ['toss', 'sandbox']) {
  const x = setup(host);
  await x.hook.share('곰돌이');
  assert.equal(x.calls[0][1].path, 'intoss://ssok-picky-pad/');
  assert.match(x.calls[0][1].ogImageUrl, /branding\/share-stretch\.jpg/);
  assert.match(x.calls[1][1].message, /곰돌이 패드 다 비웠다!/);
  assert.deepEqual(x.notices, []);
  assert.deepEqual(x.states, [true, false]);
}
let release;
const x = setup('toss', {}, { createLink: () => new Promise(resolve => { release = resolve; }) });
const first = x.hook.share();
await x.hook.share();
assert.deepEqual(x.states, [true]);
release('https://minion.toss.im/example');
await first;
assert.equal(x.calls.length, 1, 'double tap sends only one message');
assert.deepEqual(x.states, [true, false]);

let shared, copied;
const web = setup('web', { share: async o => { shared = o; } });
await web.hook.share('하트');
assert.equal(shared.url, 'https://sbp37.github.io/ssok/');
assert.match(shared.text, /하트 패드 다 비웠다/);
assert.deepEqual(web.notices, []);

const cancelled = setup('web', {
  share: async () => { throw Object.assign(new Error('cancel'), { name: 'AbortError' }); },
  clipboard: { writeText: async () => assert.fail('cancel must not copy') },
});
await cancelled.hook.share();
assert.deepEqual(cancelled.notices, []);
assert.deepEqual(cancelled.states, [true, false]);

for (const share of [undefined, async () => { throw new Error('unavailable'); }]) {
  const fallback = setup('web', { share, clipboard: { writeText: async text => { copied = text; } } });
  await fallback.hook.share();
  assert.equal(copied, 'https://sbp37.github.io/ssok/');
  assert.deepEqual(fallback.notices, ['링크를 복사했어.']);
}
const failed = setup('toss', {}, { createLink: async () => { throw new Error('offline'); } });
await failed.hook.share();
assert.equal(failed.calls.length, 0);
assert.match(failed.notices[0], /공유를 열지 못했어/);
assert.deepEqual(failed.states, [true, false]);
console.log('PASS share: Toss/sandbox link + artwork, double tap, web, cancel, clipboard fallback, failure');
