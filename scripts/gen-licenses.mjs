#!/usr/bin/env node
/**
 * 生成第三方开源许可清单，一次产出两份文件：
 *   - THIRD-PARTY-NOTICES.md           随仓库分发的完整清单
 *   - src/data/third-party-licenses.ts App 内「开源许可」页的数据源
 *
 * 数据来源：license-checker 扫描生产依赖（含传递依赖，即会进入打包产物的全部包）。
 * 用法：npm run licenses
 */
import { createRequire } from 'node:module';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const checker = require('license-checker');

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/** 本项目自有包，不属于第三方依赖 */
const FIRST_PARTY = new Set(['smart-calendar', 'itdc-widget']);

function scanProduction() {
  return new Promise((resolve, reject) => {
    checker.init(
      { start: root, production: true, excludePrivatePackages: true },
      (err, packages) => (err ? reject(err) : resolve(packages)),
    );
  });
}

/** "name@version"（含 @scope/name@version）拆包名与版本 */
function splitKey(key) {
  const at = key.lastIndexOf('@');
  return { name: key.slice(0, at), version: key.slice(at + 1) };
}

function normalizeLicense(licenses) {
  if (!licenses) return 'UNKNOWN';
  if (Array.isArray(licenses)) {
    return licenses.map((x) => (typeof x === 'string' ? x : x.type)).join(' / ');
  }
  return String(licenses);
}

/** 把各种仓库简写归一化为可点击的 https 地址 */
function normalizeRepo(raw) {
  if (!raw) return '';
  let url = (typeof raw === 'string' ? raw : raw.url || '').trim();
  if (!url) return '';
  url = url.replace(/^git\+/, '').replace(/\.git\/?$/, '');
  url = url.replace(/^git:\/\//, 'https://');
  url = url.replace(/^git@github\.com:/, 'https://github.com/');
  url = url.replace(/^github:/, 'https://github.com/');
  if (/^[\w.-]+\/[\w.-]+$/.test(url)) url = `https://github.com/${url}`;
  return url;
}

function buildMarkdown(items) {
  const lines = [
    '# 第三方开源许可清单（Third-Party Notices）',
    '',
    '本项目（ITDC）的构建与运行依赖下列开源软件包。每个软件包的版权归其各自作者所有，',
    '并按其自身的许可协议授权。本清单由 `npm run licenses` 自动生成，请勿手动修改。',
    '',
    `共 ${items.length} 个软件包（含传递依赖）。`,
    '',
    '| 软件包 | 版本 | 许可协议 | 仓库地址 |',
    '| --- | --- | --- | --- |',
  ];
  for (const it of items) {
    lines.push(`| ${it.name} | ${it.version} | ${it.license} | ${it.repo ? `[链接](${it.repo})` : '—'} |`);
  }
  lines.push(
    '',
    '## 常见协议说明',
    '',
    '- **MIT / ISC / BSD / Apache-2.0**：宽松许可，再分发时保留版权声明与许可文本即可。',
    '- **MPL-2.0**（如 ical.js）：文件级 copyleft，仅在修改其源文件并分发时需要公开相应修改。',
    '- 各软件包的完整许可文本见其发布包内的 LICENSE 文件（本地安装于 node_modules 中对应目录）。',
    '',
  );
  return lines.join('\n');
}

function buildTsModule(items) {
  const rows = items.map(
    (it) =>
      `  { name: ${JSON.stringify(it.name)}, version: ${JSON.stringify(it.version)}, license: ${JSON.stringify(it.license)}, repo: ${JSON.stringify(it.repo)} },`,
  );
  return [
    '/**',
    ' * 第三方开源许可数据。',
    ' * 由 `npm run licenses` 自动生成（数据源：license-checker 扫描生产依赖），请勿手动编辑。',
    ' */',
    '',
    'export interface ThirdPartyLicense {',
    '  name: string;',
    '  version: string;',
    '  license: string;',
    '  repo: string;',
    '}',
    '',
    'export const THIRD_PARTY_LICENSES: ThirdPartyLicense[] = [',
    ...rows,
    '];',
    '',
  ].join('\n');
}

const packages = await scanProduction();

const items = Object.entries(packages)
  .map(([key, info]) => {
    const { name, version } = splitKey(key);
    return {
      name,
      version,
      license: normalizeLicense(info.licenses),
      repo: normalizeRepo(info.repository),
    };
  })
  .filter((it) => !FIRST_PARTY.has(it.name))
  .sort((a, b) => a.name.localeCompare(b.name));

writeFileSync(join(root, 'THIRD-PARTY-NOTICES.md'), buildMarkdown(items));

const dataDir = join(root, 'src', 'data');
mkdirSync(dataDir, { recursive: true });
writeFileSync(join(dataDir, 'third-party-licenses.ts'), buildTsModule(items));

const licenseKinds = new Set(items.map((it) => it.license));
console.log(`licenses: ${items.length} packages -> THIRD-PARTY-NOTICES.md, src/data/third-party-licenses.ts`);
console.log(`license kinds: ${[...licenseKinds].sort().join(', ')}`);
