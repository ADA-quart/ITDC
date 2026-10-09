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

/**
 * 非 npm 依赖：license-checker 扫不到，但确实被项目使用/分发的东西。
 * 改动模型、内置数据或 Android 侧依赖时，同步更新这里。
 *
 * 说明：OCR 模型默认**不随 APK 分发**，由用户在「设置 → 离线 OCR 扩展」里按需下载；
 * 只有 ppocr_keys_v1.txt（识别字典）是打进包里的。
 */
const EXTERNAL_ITEMS = [
  {
    name: 'PP-OCRv4 文字检测模型（ch_PP-OCRv4_det_infer.onnx）',
    version: '按需下载 4.7MB',
    license: 'Apache-2.0',
    repo: 'https://huggingface.co/SWHL/RapidOCR',
  },
  {
    name: 'PP-OCRv4 文字识别模型（ch_PP-OCRv4_rec_infer.onnx）',
    version: '按需下载 10.9MB',
    license: 'Apache-2.0',
    repo: 'https://huggingface.co/SWHL/RapidOCR',
  },
  {
    name: 'PP-OCRv4 识别字典（ppocr_keys_v1.txt）',
    version: '随包内置',
    license: 'Apache-2.0',
    repo: 'https://github.com/PaddlePaddle/PaddleOCR',
  },
  {
    name: '本项目量化衍生模型（int8，ocr-models 分支 / ocr-models-v1 Release）',
    version: '托管但未默认启用',
    license: 'Apache-2.0',
    repo: 'https://github.com/ADA-quart/ITDC/tree/ocr-models',
  },
  {
    name: 'PaddleOCR（PP-OCRv4 原始模型与训练代码，上游）',
    version: '—',
    license: 'Apache-2.0',
    repo: 'https://github.com/PaddlePaddle/PaddleOCR',
  },
  {
    name: 'RapidOCR（PaddleOCR 权重转 ONNX 的工具与发布，上游）',
    version: '—',
    license: 'Apache-2.0',
    repo: 'https://github.com/RapidAI/RapidOCR',
  },
  {
    name: 'AndroidX AppCompat',
    version: '1.7.1',
    license: 'Apache-2.0',
    repo: 'https://github.com/androidx/androidx',
  },
  {
    name: 'AndroidX Core',
    version: '1.17.0',
    license: 'Apache-2.0',
    repo: 'https://github.com/androidx/androidx',
  },
  {
    name: 'AndroidX CoordinatorLayout',
    version: '1.3.0',
    license: 'Apache-2.0',
    repo: 'https://github.com/androidx/androidx',
  },
  {
    name: 'AndroidX Core SplashScreen',
    version: '1.2.0',
    license: 'Apache-2.0',
    repo: 'https://github.com/androidx/androidx',
  },
  {
    name: 'AndroidX Activity / Fragment / WebKit',
    version: '1.11.0 / 1.8.9 / 1.14.0',
    license: 'Apache-2.0',
    repo: 'https://github.com/androidx/androidx',
  },
  {
    name: 'Android Gradle Plugin',
    version: '8.13.0',
    license: 'Apache-2.0',
    repo: 'https://developer.android.com/build/releases/gradle-plugin',
  },
  {
    name: 'Google Services Gradle Plugin',
    version: '4.4.4',
    license: 'Apache-2.0',
    repo: 'https://developers.google.com/android/guides/google-services-plugin',
  },
];

/**
 * 只作设计参考、**未随包分发**的上游项目。
 * CDUniTap 是 GPL-3.0：早期版本的课表解析标注「移植自 CDUniTap」，与项目自身的
 * PolyForm Noncommercial 许可冲突，现已重写为自有实现（shared/cdut-parser.ts），
 * 不再包含其代码，也不依赖其服务——这里只作致谢与来源说明。
 */
const REFERENCES = [
  {
    name: 'CDUniTap（统一认证接口的设计参考）',
    version: '仅参考，未分发代码',
    license: 'GPL-3.0',
    repo: 'https://github.com/kengwang/CDUniTap',
  },
];

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
    '## 非 npm 依赖（模型 / 内置数据 / Android 侧）',
    '',
    '下面这些不是 npm 包，`license-checker` 扫不到，但确实被项目使用或分发：',
    '',
    '| 名称 | 版本 / 形态 | 许可协议 | 来源 |',
    '| --- | --- | --- | --- |',
  );
  for (const it of EXTERNAL_ITEMS) {
    lines.push(`| ${it.name} | ${it.version} | ${it.license} | [链接](${it.repo}) |`);
  }
  lines.push(
    '',
    '## 参考与致谢（未随包分发代码）',
    '',
    '| 名称 | 说明 | 许可协议 | 来源 |',
    '| --- | --- | --- | --- |',
  );
  for (const it of REFERENCES) {
    lines.push(`| ${it.name} | ${it.version} | ${it.license} | [链接](${it.repo}) |`);
  }
  lines.push(
    '',
    '## 常见协议说明',
    '',
    '- **MIT / ISC / BSD / Apache-2.0**：宽松许可，再分发时保留版权声明与许可文本即可。',
    '- **MPL-2.0**（如 ical.js）：文件级 copyleft，仅在修改其源文件并分发时需要公开相应修改。',
    '- **GPL-3.0**：强 copyleft。本项目**不包含也不链接** GPL 代码（`参考资料`一节的项目只用于设计参考）。',
    '- 各软件包的完整许可文本见其发布包内的 LICENSE 文件（本地安装于 node_modules 中对应目录）。',
    '- OCR 模型默认不随 APK 分发，由用户在应用内按需下载，下载后仍受其上游许可（Apache-2.0）约束。',
    '',
  );
  return lines.join('\n');
}

function buildTsModule(items) {
  const all = [...items, ...EXTERNAL_ITEMS, ...REFERENCES];
  const rows = all.map(
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
