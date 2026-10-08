/**
 * TP-D2-修复1 · D2 生成器：0.1.7 预设声明文件 `presets/agent-preset.patch.yml`。
 *
 * 输入：agent.cordis.yml（组件清单，含全部注释，逐行保留）+ preset.yml（name/description/order）。
 * 输出：`- insert:` 单行的 @deepseek-ai/dsh-agent-preset 声明（格式基准 = opencode 黄金文件
 *       05-交付/安装包/dsh-orchestrator2-v2.6.1/presets/agent-preset.patch.yml）。
 * 重写：`name: ./x.mjs` 本地工具模块行 → 可解析包子路径
 *       `dsh-orchestrator2/presets/orchestrator2/x.mjs`（库加载器对非 `./` 开头名按包解析；
 *       `./` 开头名走 baseUrl 相对解析，在宿主组合树里解析不到——运维记录 2026-09-26 问题 3）。
 *
 * 模式（参照 tests/suites/build-v21-spec.mjs 的 op/--check 惯例）：
 *   node tools/gen-preset-patch.mjs                  生成并写盘（默认 源码 presets/agent-preset.patch.yml）
 *   node tools/gen-preset-patch.mjs --out <path>     写到指定路径
 *   node tools/gen-preset-patch.mjs --check <path>   语义比对：解析 YAML 比 insert 行 id/name/config
 *                                                    逐项（注释与 `# Source:` 路径行天然不在解析树内），
 *                                                    有差异则逐条打印并 exit 1，无差异 exit 0
 *
 * ponytail: 生成走纯文本（保注释与排版；YAML round-trip 会丢注释，不用）；preset.yml 只有三行
 * 标量，手工解析不引 YAML 依赖；仅 --check 需要 js-yaml（复用宿主 node_modules，同 config-check）。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const ORCH2 = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SRC_YML = join(ORCH2, 'agent.cordis.yml')
const SRC_PRESET = join(ORCH2, 'preset.yml')
const DEFAULT_OUT = join(ORCH2, 'presets', 'agent-preset.patch.yml')
const PRESET_ID = 'orchestrator2' // 包内 presets/<id>/ 目录名；声明行 id = preset-<id>
const PKG_PREFIX = `dsh-orchestrator2/presets/${PRESET_ID}/`

// ── preset.yml 三行标量手工解析（值内无 ASCII 冒号；取第一个冒号切分，稳妥）──────────
function parsePresetMeta(text) {
  const meta = {}
  for (const raw of text.split(/\r?\n/)) {
    const i = raw.indexOf(':')
    if (i < 0) continue
    const key = raw.slice(0, i).trim()
    if (key === 'name' || key === 'description' || key === 'order') {
      if (meta[key] === undefined) meta[key] = raw.slice(i + 1).trim()
    }
  }
  for (const k of ['name', 'description', 'order']) {
    if (meta[k] === undefined) throw new Error(`preset.yml 缺 ${k} 字段`)
  }
  return meta
}

/** YAML 双引号标量转义。 */
function yq(s) {
  return '"' + String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"'
}

/** 组件清单行级重写：name: ./x.mjs → name: <PKG_PREFIX>x.mjs（仅行首 name 键命中）。 */
function rewriteLine(line) {
  return line.replace(/^(\s*)name: \.\/(.*)$/, `$1name: ${PKG_PREFIX}$2`)
}

/** 纯文本生成（注释/空行/排版全部保留；统一 LF）。 */
function generate() {
  const meta = parsePresetMeta(readFileSync(SRC_PRESET, 'utf8'))
  const yml = readFileSync(SRC_YML, 'utf8').split('\r\n').join('\n')
  const body = yml
    .split('\n')
    .map((l) => (l.length ? ' '.repeat(10) + rewriteLine(l) : l))
    .join('\n')
  return [
    '# GENERATED - do not edit by hand.',
    `# Source: ${SRC_YML.split('\\').join('/')} ; regenerate when the preset entry list changes.`,
    '# 0.1.7 preset declaration: @deepseek-ai/dsh-agent-preset row (format ref: dsh-web-app/presets/*.patch.yml).',
    '- insert:',
    `    - id: preset-${PRESET_ID}`,
    "      name: '@deepseek-ai/dsh-agent-preset'",
    '      config:',
    `        id: ${PRESET_ID}`,
    `        order: ${meta.order}`,
    `        name: ${yq(meta.name)}`,
    `        description: ${yq(meta.description)}`,
    '        plugins:',
    body,
  ].join('\n')
}

// ── --check：语义等价比对（js-yaml 解析，逐项 diff）────────────────────────────
const DSH = 'C:\\Users\\nicia\\AppData\\Roaming\\npm\\node_modules\\@deepseek-ai\\dsh'
const require = createRequire(import.meta.url)
const yaml = require(join(DSH, 'node_modules', 'js-yaml'))
const JsExpr = new yaml.Type('tag:yaml.org,2002:js', {
  kind: 'scalar',
  resolve: (d) => typeof d === 'string',
  construct: (d) => ({ __jsExpr: d }),
})
const schema = yaml.JSON_SCHEMA.extend(JsExpr)

/** 解析声明文件 → insert 行（数组取首个元素，结构断言防漂移）。 */
function loadInsertRow(path) {
  const doc = yaml.load(readFileSync(path, 'utf8'), { schema })
  if (!Array.isArray(doc) || doc.length !== 1 || !doc[0].insert || !Array.isArray(doc[0].insert) || doc[0].insert.length !== 1) {
    throw new Error(`${path}：声明文件顶层结构不是「单行 - insert:」（doc=${Array.isArray(doc) ? doc.length : typeof doc}）`)
  }
  return doc[0].insert[0]
}

/** 递归逐项比对，diff 以「路径: 左值 vs 右值」收集。 */
function diffTree(a, b, path, diffs) {
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b)) {
      diffs.push(`${path}: 类型不符（${Array.isArray(a) ? '数组' : typeof a} vs ${Array.isArray(b) ? '数组' : typeof b}）`)
      return
    }
    if (a.length !== b.length) diffs.push(`${path}: 数组长度 ${a.length} vs ${b.length}`)
    for (let i = 0; i < Math.min(a.length, b.length); i++) diffTree(a[i], b[i], `${path}[${i}]`, diffs)
    return
  }
  if (a !== null && b !== null && typeof a === 'object' && typeof b === 'object') {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)])
    for (const k of keys) {
      if (!(k in a)) { diffs.push(`${path}.${k}: 仅右侧存在（${JSON.stringify(b[k])?.slice(0, 80)}）`); continue }
      if (!(k in b)) { diffs.push(`${path}.${k}: 仅左侧存在（${JSON.stringify(a[k])?.slice(0, 80)}）`); continue }
      diffTree(a[k], b[k], `${path}.${k}`, diffs)
    }
    return
  }
  if (a !== b) diffs.push(`${path}: ${JSON.stringify(a)?.slice(0, 100)} vs ${JSON.stringify(b)?.slice(0, 100)}`)
}

function checkAgainst(refPath) {
  const left = loadInsertRowFromText(generate(), '<生成物>')
  const right = loadInsertRow(refPath)
  const diffs = []
  diffTree(left, right, 'insert[0]', diffs)
  return diffs
}

// generate() 产物先进内存解析（不依赖已写盘文件，--check 永远对「当前源码」负责）
function loadInsertRowFromText(text, label) {
  const doc = yaml.load(text, { schema })
  if (!Array.isArray(doc) || doc.length !== 1 || !doc[0].insert || !Array.isArray(doc[0].insert) || doc[0].insert.length !== 1) {
    throw new Error(`${label}：生成物顶层结构不是「单行 - insert:」`)
  }
  return doc[0].insert[0]
}

// ── 入口 ──────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2)
const checkIdx = argv.indexOf('--check')
const outIdx = argv.indexOf('--out')

if (checkIdx >= 0) {
  const refPath = argv[checkIdx + 1]
  if (!refPath || !existsSync(refPath)) {
    console.error(`--check 需要已存在的参照文件路径（got: ${refPath}）`)
    process.exit(2)
  }
  const diffs = checkAgainst(resolve(refPath))
  if (diffs.length > 0) {
    console.log(`语义比对：${diffs.length} 处差异（生成物[左] vs 参照[右]）`)
    for (const d of diffs) console.log('  DIFF ' + d)
    console.log('结论：不等价')
    process.exit(1)
  }
  console.log('语义比对：insert 行 id/name/config 逐项一致（注释与 # Source: 路径行不参与比对）')
  console.log('结论：等价')
  process.exit(0)
}

const OUT = outIdx >= 0 ? resolve(argv[outIdx + 1]) : DEFAULT_OUT
const text = generate()
mkdirSync(dirname(OUT), { recursive: true })
writeFileSync(OUT, text, 'utf8')
console.log(`已生成 ${OUT}（${text.split('\n').length} 行；./x.mjs 行已重写为 ${PKG_PREFIX}*）`)
