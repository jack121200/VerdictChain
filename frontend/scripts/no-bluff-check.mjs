#!/usr/bin/env node
/**
 * No-bluff checker (plan section 1, R10, and section 7 blacklist). Node built-ins only.
 *
 * Fails with file:line for:
 *   - raw hex colours, rgb(), rgba(), hsl() or hsla() outside src/styles/tokens.css
 *   - mockData, Math.random, dangerouslySetInnerHTML
 *   - fetch( outside src/api/
 *   - toFixed(, toLocaleString(, toPrecision( or Intl.NumberFormat outside src/lib/format.ts (one place formats numbers)
 *   - a {shortId(...)} printed as JSX text with no CopyHash / CopyButton within six lines (the full id must be one click away)
 *   - the three investigator ids used as object keys (or listed in a row) outside src/lib/agents.ts and src/api/ (one agent table)
 *   - a page that repeats `data === undefined` with `error === null` (src/features/**): usePageData works the state out once
 *   - any import from src/data/ (the folder must stay empty)
 *   - any blacklisted literal from plan section 7 (case-sensitive, src/** only)
 *
 * Exit code 0 means no violations. Exit code 1 prints every violation.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, extname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const FRONTEND = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(FRONTEND, 'src');
const TOKENS = join(SRC, 'styles', 'tokens.css');
const API_DIR = join(SRC, 'api') + sep;
const FORMAT_FILE = join(SRC, 'lib', 'format.ts');
const AGENTS_FILE = join(SRC, 'lib', 'agents.ts');
const FEATURES_DIR = join(SRC, 'features') + sep;
const DATA_DIR = join(SRC, 'data');

/** Plan section 7. Case-sensitive substrings. */
const BLACKLIST = [
  '99.82', '96.2', '98.4', '94.6', '91.4', '0.958', '142 t/s', '14ms', '14 ms', '0ms', '0 ms', '120k',
  'RFC-8941', 'RFC-6962', 'Merkle', 'Ed25519', 'eBPF', 'SEV-SNP', 'seccomp', 'AppArmor', 'Kerberos',
  'Linode', 'SanDisk', 'Sysmon', 'USENIX', 'Xu et al', 'Zero-Trust', 'Zero Trust', 'Byzantine',
  'hallucination rate', 'air-gapped', 'Apache 2.0', 'MIT', 'Enclave', 'BYPASS', 'Llama', 'Gemini 2.5',
  'Gemini 1.5', 'Claude 3.5', 'DeepSeek', 'Protocol 88', 'Protocol V2.4', 'Threat Lvl 3', 'Alert Orange',
  'dev_mgrant', 'admin_clark99', 'WS-CORP', 'VC-8821', 'VC-4409', 'INV-2026-', 'Sentinel Ω', 'Delta', 'Epsilon',
];

const PATTERNS = [
  { re: /#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})(?![0-9a-zA-Z_-])/, message: 'raw hex colour outside src/styles/tokens.css', onlyOutsideTokens: true },
  { re: /\b(?:rgba?|hsla?)\(/, message: 'raw rgb()/hsl() colour outside src/styles/tokens.css', onlyOutsideTokens: true },
  { re: /mockData/, message: 'mockData is not allowed: every value comes from the API' },
  { re: /Math\.random/, message: 'Math.random is not allowed: values come from the API, ids from the server' },
  { re: /dangerouslySetInnerHTML/, message: 'dangerouslySetInnerHTML is not allowed: log text is untrusted' },
  { re: /\bfetch\s*\(/, message: 'fetch( is only allowed in src/api/ (the one API client)', skipDir: API_DIR },
  {
    re: /\.(?:toFixed|toLocaleString|toPrecision)\(|\bIntl\.NumberFormat\b/,
    message: 'format numbers through src/lib/format.ts (formatCount, formatNumber, formatPercent ...), not by hand',
    skipFile: FORMAT_FILE,
    skipTests: true,
  },
  {
    // An investigator id as an object key, or the first two ids listed in a row, is a second copy of the table.
    re: /(?:^|[{,])\s*['"]?(?:network_traffic|access_log|endpoint_behavior)['"]?\s*:|['"]network_traffic['"]\s*,\s*['"]access_log['"]/,
    message:
      'the investigators are listed once, in src/lib/agents.ts (INVESTIGATOR_IDS, INVESTIGATOR_VISUALS): read them from there',
    skipFile: AGENTS_FILE,
    skipDir: API_DIR,
    skipTests: true,
    onlyCode: true,
  },
  {
    // The state of a page's data (loading, failed, ready) is worked out once, in usePageData.
    re: /===\s*undefined.*\.error\s*[!=]==\s*null|\.error\s*[!=]==\s*null.*===\s*undefined/,
    message:
      'read the page state from usePageData (src/app/use-page-data.ts: .status), do not repeat data === undefined with error === null',
    onlyDir: FEATURES_DIR,
    skipTests: true,
  },
  { re: /\bfrom\s*['"](lucide-react|recharts)['"]/, message: 'lucide-react and recharts are outside the locked stack (CLAUDE.md)' },
];

// A shortened id printed as JSX text must have its full value one click away: a copy button within a few lines.
const SHORT_ID_TEXT = /(?:^|>)\s*\{shortId\(/;
const COPY_BUTTON = /<Copy(?:Hash|Button)\b/;
const COPY_WINDOW = 6;

const IMPORT_SPECIFIER = [
  /\bfrom\s*['"]([^'"]+)['"]/g,
  /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  /^\s*import\s*['"]([^'"]+)['"]/g,
];

/**
 * True when term occurs in text as its own token. A term that starts with a digit may not follow
 * a digit or dot ("0ms" is not inside "200ms"). A word term may not follow a letter, digit or
 * underscore ("MIT" is not inside "LIMIT"). Matching is case-sensitive.
 */
function occursAsToken(text, term) {
  const numeric = /^[0-9]/.test(term);
  let from = 0;
  for (;;) {
    const at = text.indexOf(term, from);
    if (at === -1) return false;
    const before = at > 0 ? text[at - 1] : '';
    const after = text[at + term.length] ?? '';
    const leftOk = numeric ? !/[0-9.]/.test(before) : !/[A-Za-z0-9_]/.test(before);
    const rightOk = numeric ? !/[0-9]/.test(after) : true;
    if (leftOk && rightOk) return true;
    from = at + 1;
  }
}

const TEXT_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.css', '.json', '.html']);

function walk(dir, files = []) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, files);
    else if (TEXT_EXTENSIONS.has(extname(name))) files.push(path);
  }
  return files;
}

const rel = (path) => relative(FRONTEND, path).split(sep).join('/');

const violations = [];
function report(file, line, message, text) {
  violations.push(`${rel(file)}:${line}: ${message}${text ? `  [${text.trim().slice(0, 120)}]` : ''}`);
}

/** Import specifiers in src/data/ are a violation, resolved from the importing file. */
function checkImport(file, lineNumber, specifier, text) {
  let target = null;
  if (specifier.startsWith('.')) target = resolve(dirname(file), specifier);
  else if (specifier.startsWith('@/')) target = join(SRC, specifier.slice(2));
  if (target === null) return;
  if (target === DATA_DIR || target.startsWith(DATA_DIR + sep)) {
    report(file, lineNumber, 'import from src/data/ is not allowed (the folder stays empty)', text);
  }
}

if (existsSync(DATA_DIR)) {
  const leftovers = walk(DATA_DIR);
  const entries = readdirSync(DATA_DIR);
  if (leftovers.length > 0 || entries.length > 0) {
    report(DATA_DIR, 1, 'src/data/ must stay empty (remove the files; no mock data)', entries.join(', '));
  }
}

const sourceFiles = walk(SRC);
const scanned = [...sourceFiles];
const indexHtml = join(FRONTEND, 'index.html');
if (existsSync(indexHtml)) scanned.push(indexHtml);

for (const file of scanned) {
  const inSrc = file.startsWith(SRC + sep);
  const isTokens = file === TOKENS;
  const lines = readFileSync(file, 'utf8').split(/\r?\n/);
  lines.forEach((text, index) => {
    const lineNumber = index + 1;
    for (const pattern of PATTERNS) {
      if (pattern.onlyOutsideTokens && isTokens) continue;
      if (pattern.skipDir && file.startsWith(pattern.skipDir)) continue;
      if (pattern.skipFile && file === pattern.skipFile) continue;
      if (pattern.skipTests && /\.test\.[cm]?[jt]sx?$/.test(file)) continue;
      if (pattern.onlyCode && !/\.[cm]?tsx?$/.test(file)) continue;
      if (pattern.onlyDir && !file.startsWith(pattern.onlyDir)) continue;
      if (pattern.re.test(text)) report(file, lineNumber, pattern.message, text);
    }
    if (inSrc && !/\.test\.[cm]?[jt]sx?$/.test(file) && SHORT_ID_TEXT.test(text)) {
      const near = lines.slice(Math.max(0, index - COPY_WINDOW), index + COPY_WINDOW + 1).join('\n');
      if (!COPY_BUTTON.test(near)) {
        report(file, lineNumber, 'a shortened id shown as text needs a copy button (CopyHash or CopyButton) beside it', text);
      }
    }
    if (inSrc) {
      for (const specifierRe of IMPORT_SPECIFIER) {
        specifierRe.lastIndex = 0;
        let match;
        while ((match = specifierRe.exec(text)) !== null) checkImport(file, lineNumber, match[1], text);
      }
      for (const term of BLACKLIST) {
        if (occursAsToken(text, term)) report(file, lineNumber, `blacklisted literal "${term}" (plan section 7)`, text);
      }
    }
  });
}

if (violations.length > 0) {
  console.error(violations.join('\n'));
  console.error(`\ncheck:no-bluff FAILED: ${violations.length} violation(s) in ${scanned.length} file(s).`);
  process.exit(1);
}
console.log(`check:no-bluff OK: ${scanned.length} file(s) scanned, 0 violations.`);
