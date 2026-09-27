// Loads real src/ TypeScript modules in plain Node, with no test framework and no new deps.
// - Uses typescript's transpileModule when the installed version has it (TS 5.x),
//   otherwise Node's built-in type stripping (Node >= 22.13).
// - Relative imports are loaded recursively; bare SDK imports are replaced by stubs
//   matched on the module name, so reformatting an import line cannot break a test.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as nodeModule from 'node:module';

let ts = null;
try {
  const mod = await import('typescript');
  ts = mod.default ?? mod;
  if (typeof ts.transpileModule !== 'function') ts = null;
} catch {
  ts = null;
}

function transpile(source, path) {
  if (ts) {
    return ts.transpileModule(source, {
      fileName: path,
      compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ES2020, jsx: ts.JsxEmit.ReactJSX },
    }).outputText;
  }
  if (typeof nodeModule.stripTypeScriptTypes === 'function') {
    return nodeModule.stripTypeScriptTypes(source, { mode: 'transform' });
  }
  throw new Error('Need typescript (pnpm install) or Node >= 22.13 to run tests');
}

const toUrl = (code) => 'data:text/javascript;base64,' + Buffer.from(code).toString('base64');

/** stub module source per bare specifier; tests can override before loading */
export const stubs = {
  '@apps-in-toss/web-framework': `
    const unsupported = (fn) => Object.assign(fn, { isSupported: () => false });
    export const loadFullScreenAd = unsupported(() => () => {});
    export const showFullScreenAd = unsupported(() => () => {});
    // tests install a fake bridge with globalThis.__sdk = { grantReward }
    export const Promotion = {
      grantReward: Object.assign((o) => globalThis.__sdk.grantReward(o), { isSupported: () => !!globalThis.__sdk?.grantReward }),
    };
    export const TossAds = { initialize: unsupported(() => {}), attachBanner: () => ({ destroy() {} }) };
    export const Device = { triggerHaptic: async () => {} };
    export const Environment = { environment: 'web' };
    export const Share = {};
  `,
};

const cache = new Map();
function moduleUrl(path, env) {
  const key = path + '\0' + JSON.stringify(env);
  if (cache.has(key)) return cache.get(key);
  let code = transpile(readFileSync(path, 'utf8'), path);
  code = code.replace(/import\.meta\.env/g, `(${JSON.stringify({ DEV: false, PROD: true, BASE_URL: './', ...env })})`);
  code = code.replace(/(from\s*|import\s*\(\s*|import\s+)(['"])([^'"]+)\2/g, (m, lead, q, spec) => {
    if (spec.startsWith('.')) return `${lead}${q}${moduleUrl(resolve(dirname(path), spec.replace(/\.ts$/, '') + '.ts'), env)}${q}`;
    if (spec in stubs) return `${lead}${q}${toUrl(stubs[spec])}${q}`;
    return m;
  });
  const url = toUrl(code);
  cache.set(key, url);
  return url;
}

const fileOf = (name) => fileURLToPath(new URL('../src/game/' + name + '.ts', import.meta.url));

/** load('ads/AdPolicy') → module namespace of src/game/ads/AdPolicy.ts */
export function load(name, env = {}) {
  return import(moduleUrl(fileOf(name), env));
}

let freshSerial = 0;
/** A new instance of the module (and its singletons) on every call, e.g. a fresh `sfx`. */
export function loadFresh(name, env = {}) {
  return import(moduleUrl(fileOf(name), env) + '#fresh' + freshSerial++);
}
