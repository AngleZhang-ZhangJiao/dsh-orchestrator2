/**
 * T2/T3 核查脚本：yml 可解析（dsh node_modules 内 js-yaml）+ 引用存在性
 * （@deepseek-ai/* 包、./phase-gate.mjs、./budget.mjs、无 subagent_b/c 旧名、
 * tool-web fetch: true 断言）。
 * Run: node tests/suites/config-check.mjs
 */
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'

import { ORCH2 } from '../lib/paths.mjs'
import { reporter } from '../lib/test-harness.mjs'

const { check, writeResult } = reporter('config-check')

const DSH = 'C:\\Users\\nicia\\AppData\\Roaming\\npm\\node_modules\\@deepseek-ai\\dsh'

const require = createRequire(import.meta.url)
const yaml = require(join(DSH, 'node_modules', 'js-yaml'))
// cordis preset 行使用 !!js 自定义标签（禁用条件表达式）——用 harness 同款
// JSON_SCHEMA 扩展一个 js 标签来解析（值仅作标记，不执行）。
const JsExpr = new yaml.Type('tag:yaml.org,2002:js', {
  kind: 'scalar',
  resolve: (data) => typeof data === 'string',
  construct: (data) => ({ __jsExpr: data }),
})
const schema = yaml.JSON_SCHEMA.extend(JsExpr)

// ── T2：yml 可解析 + 顶层键 ───────────────────────────────────────────────
const presetText = readFileSync(join(ORCH2, 'preset.yml'), 'utf8')
const cordisText = readFileSync(join(ORCH2, 'agent.cordis.yml'), 'utf8')
const preset = yaml.load(presetText, { schema })
const cordis = yaml.load(cordisText, { schema })
check('T2 preset.yml 可解析（顶层键）', preset && typeof preset === 'object', `顶层键=${Object.keys(preset).join(',')}`)
check('T2 agent.cordis.yml 可解析（顶层键）', Array.isArray(cordis), `顶层=${Array.isArray(cordis) ? `数组长度 ${cordis.length}` : typeof cordis}`)
if (Array.isArray(cordis)) {
  const ids = cordis.map((row) => row.id).filter(Boolean)
  check('T2 行 id 列表', ids.length === cordis.length, `ids=${ids.join(',')}`)
}

// ── T3a：agent.cordis.yml 全部 @deepseek-ai/* name 在本机 node_modules 存在 ──
const names = new Set()
function walk(node) {
  if (node == null) return
  if (Array.isArray(node)) return node.forEach(walk)
  if (typeof node === 'object') {
    if (typeof node.name === 'string' && node.name.startsWith('@deepseek-ai/')) names.add(node.name)
    for (const v of Object.values(node)) walk(v)
  }
}
walk(cordis)
const missing = []
for (const n of [...names]) {
  const pkg = n.split('/')[1]
  if (!existsSync(join(DSH, 'node_modules', '@deepseek-ai', pkg))) missing.push(n)
}
check(`T3a @deepseek-ai/* name 全部存在（共 ${names.size} 个）`, missing.length === 0, missing.length ? `缺失：${missing.join(',')}` : [...names].sort().join(', '))
// T3a-2（TP-D2 · D1 翻转断言，D-D4 清偿）：宿主 0.1.7 已移除 @deepseek-ai/dsh-workflow-worker-thread
// 包，源码侧组件条目同步移除（原 L392-395 整段，含 config:/provider: spawn 防悬挂）——
// 该组件名全文不得再出现（含注释；若再出现则 T3a 正断言必红——包不存在，双路径互证）。
check('T3a-2 agent.cordis.yml 无 workflow-worker-thread 残留（D-D4 翻转断言）',
  !cordisText.includes('workflow-worker-thread'),
  cordisText.includes('workflow-worker-thread') ? '仍含旧组件名（宿主已剥离该包）' : '零命中')

// ── T3b：./phase-gate.mjs、./budget.mjs、./dispatch.mjs 相对可解析（与 yml 同目录）──
check('T3b ./phase-gate.mjs 存在', existsSync(join(ORCH2, 'phase-gate.mjs')))
check('T3b ./budget.mjs 存在', existsSync(join(ORCH2, 'budget.mjs')))
check('T3b ./dispatch.mjs 存在（M2 派工原子半步，形态 A 预设内工具模块）', existsSync(join(ORCH2, 'dispatch.mjs')))
check('T3b agent.cordis.yml 声明 dispatch 行（id=dispatch / name=./dispatch.mjs）',
  /id: dispatch[\s\S]{0,80}name: \.\/dispatch\.mjs/.test(cordisText))
// T3-TP1 · D6：四件新模块文件存在（行声明断言见 T3e）
for (const file of ['model-routes.mjs', 'session-routes.mjs', 'role-tools.mjs', 'route-fallback.mjs']) {
  check(`T3b ./${file} 存在（T3-TP1 模型路由与会话覆盖）`, existsSync(join(ORCH2, file)))
}

// ── T3c：全文无 subagent_b/c 旧名 ─────────────────────────────────────────
const oldNames = cordisText.match(/subagent_[bc]\b/g) || []
check('T3c 无 subagent_b/c 旧名', oldNames.length === 0, oldNames.length ? `命中：${[...new Set(oldNames)].join(',')}` : '零命中')

// ── T3d：tool-web 行 fetch: true 断言 ─────────────────────────────────────
let webRow = null
function findWeb(node) {
  if (node == null) return
  if (Array.isArray(node)) return node.forEach(findWeb)
  if (typeof node === 'object') {
    if (node.id === 'tool-web') { webRow = node; return }
    for (const v of Object.values(node)) findWeb(v)
  }
}
findWeb(cordis)
check('T3d tool-web 行存在且 fetch: true', webRow !== null && webRow.config && webRow.config.fetch === true, webRow ? `name=${webRow.name} fetch=${webRow.config?.fetch}` : '未找到 tool-web 行')

// ── T3e（T3-TP1 · D6 重写）：三角色模型路由装配断言 ─────────────────────────────
// 旧断言「yml 行内 agentOptions 钉模型」随官方三行删除退役：角色模型改由插件自持工具
// （./role-tools.mjs）按 持久路由配置（./model-routes.mjs 的 ROUTE_INIT + 用户配置）
// 每次派工现读。新断言三件——
//   ① 官方三行不存在（同名替换，避免同层重名抛错）；
//   ② 四个新模块行在位（model-routes/session-routes/role-tools/route-fallback）；
//   ③ 初始化值结构断言：**读 ROUTE_INIT 而非手抄字符串**，逐条比对 DEC-T3-05 表。
const roleRowIds = ['tool-subagent-researcher', 'tool-subagent-reviewer', 'tool-subagent-developer']
const residualRoleRows = roleRowIds.filter((id) => cordisText.includes(`id: ${id}`))
check('T3e 官方三角色工具行已移除（同名替换为 ./role-tools.mjs 自持工具，防同层重名）',
  residualRoleRows.length === 0,
  residualRoleRows.length ? `仍存在：${residualRoleRows.join(', ')}` : `${roleRowIds.length} 行零命中`)
const moduleRows = { 'model-routes': './model-routes.mjs', 'session-routes': './session-routes.mjs', 'role-tools': './role-tools.mjs', 'route-fallback': './route-fallback.mjs' }
const missingModuleRows = Object.entries(moduleRows).filter(([id, name]) => !new RegExp(`id: ${id}[\\s\\S]{0,60}name: ${name.replace('./', '\\.\\/')}`).test(cordisText))
check('T3e 四个新模块行在位（D6 装配；`./` 相对路径装载同 phase-gate/dispatch 形态）',
  missingModuleRows.length === 0,
  missingModuleRows.length ? `缺：${missingModuleRows.map(([id]) => id).join(', ')}` : Object.keys(moduleRows).join(', '))
const { ROUTE_INIT } = await import('../../model-routes.mjs')
const EXPECTED_ROUTES = {
  researcher: { default: { provider: 'deepseek-official', model: 'deepseek-flash', effort: 'max' }, fallback: { provider: 'openai-codex', model: 'gpt-5.6-luna', effort: 'xhigh' } },
  developer: { default: { provider: 'deepseek-official', model: 'deepseek-flash', effort: 'max' }, fallback: { provider: 'openai-codex', model: 'gpt-5.6-luna', effort: 'xhigh' } },
  reviewer: { default: { provider: 'volcengine', model: 'glm-5.3' }, fallback: { provider: 'openai-codex', model: 'gpt-6.1-sol' } },
}
const routeDiffs = []
for (const [role, slots] of Object.entries(EXPECTED_ROUTES)) {
  for (const [slot, want] of Object.entries(slots)) {
    const got = ROUTE_INIT?.[role]?.[slot] ?? {}
    const wantEffort = Object.prototype.hasOwnProperty.call(want, 'effort') ? want.effort : undefined
    if (got.provider !== want.provider || got.model !== want.model || got.effort !== wantEffort) {
      routeDiffs.push(`${role}.${slot} 期望 ${JSON.stringify(want)} 实际 ${JSON.stringify(got)}`)
    }
  }
}
check('T3e 初始化路由表（读 ROUTE_INIT，非手抄）= DEC-T3-05 用户裁决表六条（effort 省略=无该键）',
  routeDiffs.length === 0,
  routeDiffs.length ? routeDiffs.join(' | ') : `6/6 命中；researcher/developer=${ROUTE_INIT.researcher.default.provider}/${ROUTE_INIT.researcher.default.model}+${ROUTE_INIT.researcher.default.effort}`)
check('T3e 审核员初始化值不沿用历史漂移值（openai-codex/gpt-6.1-sol 仅作降级槽，默认槽=volcengine/glm-5.3）',
  ROUTE_INIT.reviewer.default.provider === 'volcengine' && ROUTE_INIT.reviewer.default.model === 'glm-5.3' &&
  !Object.prototype.hasOwnProperty.call(ROUTE_INIT.reviewer.default, 'effort'),
  `reviewer.default=${JSON.stringify(ROUTE_INIT.reviewer.default)} fallback=${JSON.stringify(ROUTE_INIT.reviewer.fallback)}`)
check('T3e 全文无旧错误 ID 写法（-max 拼接）', !cordisText.includes('deepseek-v4-flash-vision-exp-max'), '零命中')
// 旧 ID 负断言（T9 保留）：本文件字符串自身在 tests/ 内，只对 agent.cordis.yml 正文生效。
// TP1-D6 演进：审核员/开发员「备选」注释行按装机件逐字回源（含 kimi-coding/k3-256k/
// kimi-for-coding 旧模型名）——负断言先剥全行注释（^\s*#）再扫，注释行豁免、配置行照扫。
const cordisNoComments = cordisText.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n')
check('T3e agent.cordis.yml 无旧模型 ID 残留（deepseek-v4-flash-vision-exp / kimi-coding / k3-256k / kimi-for-coding；注释行豁免）',
  !cordisNoComments.includes('deepseek-v4-flash-vision-exp') && !cordisNoComments.includes('kimi-coding') && !cordisNoComments.includes('k3-256k') && !cordisNoComments.includes('kimi-for-coding'), '零命中')

// ── T3f（TP-B-修复1 / D5）：防再发门禁——严格 YAML（重复键即抛）+ persona prefix 键 + FFFD=0 ──
// 事故口径：0.1.5 选择器 list 期健康检查以严格 YAML 丢弃 broken 预设；用户紧急修复曾以
// GBK 误读写 UTF-8 文件致乱码、且 persona 键更名 text:→prefix: 无断言守护。以下三断言
// 对污染夹具必须红、对现文件必须绿（夹具演算内联，门禁自身可信可复算）。
function strictParseOrThrow(text) {
  // 默认 schema 即严格：重复映射键抛 yamlException（0.1.5 discoverPresets 同款口径；
  // 注意 json:true 反而会放过重复键——probe 实证，故此处不用）
  return yaml.load(text, { schema })
}
const FFFD = '�'
// 演算 1：重复键夹具必须被拦截（若门禁失效则本断言红）
const dupFixture = '- id: persona\n  name: x\n  config:\n    prefix: |\n      a\n    fetch: true\n    fetch: true\n'
let dupCaught = false
try { strictParseOrThrow(dupFixture) } catch (e) { dupCaught = /duplicated mapping key/.test(e.message) }
check('T3f-演算1 重复键夹具能被严格解析拦截（门禁可信）', dupCaught, `夹具含重复 fetch 键`)
// 演算 2：FFFD 夹具必须检出
const fffdFixture = '- id: persona\n  config:\n    prefix: |\n      调度�?乱码\n'
check('T3f-演算2 FFFD 夹具检出（含 U+FFFD ' + FFFD.codePointAt(0).toString(16).toUpperCase() + '）', fffdFixture.includes(FFFD))
let strictOk = false
try { strictParseOrThrow(cordisText); strictOk = true } catch { strictOk = false }
check('T3f-1 agent.cordis.yml 严格 YAML 解析通过（含重复键检测）', strictOk)
const personaRowF = Array.isArray(cordis) ? cordis.find((r) => r && r.id === 'persona') : undefined
check('T3f-2 persona 行 prefix 键在位（0.1.5 适配）',
  personaRowF !== undefined && personaRowF.config !== undefined &&
  typeof personaRowF.config.prefix === 'string' && personaRowF.config.text === undefined,
  personaRowF ? `config 键=${Object.keys(personaRowF.config).join(',')}` : '未找到 persona 行')
check('T3f-3 agent.cordis.yml 全文无 U+FFFD（UTF-8 保真）', !cordisText.includes(FFFD),
  cordisText.includes(FFFD) ? `命中 ${cordisText.split(FFFD).length - 1} 处` : 'FFFD=0')

// ── T3h（T3-TP1-修复1 · R1/AC-R1）：本地模块行「必须导出 apply」装配断言 ──────
// 事故口径（issueId=T3TP1-LIVE-01，2026-10-02 用户实测）：T3-TP1 在 delegation 组新增
// 四件本地模块行，其中 model-routes/session-routes 是纯函数库——只导出 name，没有
// apply。cordis `registry.plugin()` 只接受「函数或带 apply 的对象」，对这两行同步抛
// `invalid plugin`（宿主抛出点：`@deepseek-ai/cordis/lib/index.js:1621`——本轮已复核
// 源码行，见修复执行自测 §T7），mount audit 遂报 `never started`
//（`@deepseek-ai/dsh-agent-preset-registry/lib/types/mount.js:166`），整个预设挂载被拒：
// 新会话预设选择器不可见 + 老会话 resume 报错。既有两道门禁（T3b/T3e 装配断言、
// dump-config 组合树解析）均不覆盖「模块形态被 registry.plugin() 接受」，故本缺陷穿网。
// T3h 补第三道：逐行「本地 `.mjs` 行 ↔ 模块必须导出 apply 函数」，缺一即红。
// 口径（为何静态）：apply 出现在 `export function/const/class/let/var apply` 或
// `export { apply }` 均可被 registry 接受（后者键名缺省即 apply）；静态读源文件与
// import 后 `typeof mod.apply` 结果一致，且零副作用、零宿主依赖。检红演算内联（见下），
// 门禁自身可信可复算。
/** 从组件清单文本解析本地 `.mjs` 行（顶层 `- id:` + 其后 3 行内的 name）。 */
function parseModuleRows(text) {
  const acc = []
  const lines = text.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const m = /^\s*-\s+id:\s*([\w-]+)\s*$/.exec(lines[i])
    if (!m) continue
    for (let j = i + 1; j < Math.min(i + 4, lines.length); j++) {
      const n = /^\s+name:\s*(.+?)\s*$/.exec(lines[j])
      if (!n) continue
      const name = n[1]
      if (/^\.\/[\w-]+\.mjs$/.test(name)) acc.push({ id: m[1], name, file: name.slice(2) })
      break
    }
  }
  return acc
}
/** 模块源文本是否导出 apply（registry.plugin() 接受的装载形态之一）。 */
function exportsApply(text) {
  return /^\s*export\s+(?:(?:async\s+)?function|const|let|var|class)\s+apply\b/m.test(text) ||
    /^\s*export\s*\{[^}]*\bapply\b[^}]*\}/m.test(text)
}
/** 逐行读模块文件，返回未通过「导出 apply」的行清单（文件缺失/无 apply 两类）。 */
function scanModuleRows(entries, readText, existsFn) {
  const missed = []
  for (const e of entries) {
    if (!existsFn(e.file)) { missed.push(`${e.id}（${e.name}：文件不存在）`); continue }
    if (!exportsApply(readText(e.file))) missed.push(`${e.id}（${e.name}：未导出 apply）`)
  }
  return missed
}
// 两份内联夹具（照 v2.7.0 两个事故模块的真实形态取材，不改仓库文件）：
//   MISSING_FIXTURE_TEXT ← 缺陷形态（只导出 name 的纯库）；
//   MATCHING_FIXTURE_TEXT ← 修复后形态（同文件 + 空 apply 空载），用作对照证明「红因为缺 apply」。
const MISSING_FIXTURE_TEXT = "export const name = 'fake-pure-lib'\nexport const SCHEMA_VERSION = 1\n"
const MATCHING_FIXTURE_TEXT = "export const name = 'fake-pure-lib'\nexport function apply() {}\n"
const moduleRowEntries = parseModuleRows(cordisText)
const rowMissed = scanModuleRows(moduleRowEntries, (f) => readFileSync(join(ORCH2, f), 'utf8'), (f) => existsSync(join(ORCH2, f)))
// 覆盖面自检：本预设的本地模块行至少含七件承重件（phase-gate/budget/dispatch/
// model-routes/session-routes/role-tools/route-fallback）——若解析器失效命中 0 行，
// 下面的断言会「空转通过」，故先断言清单非空且含全部七件。
const REQUIRED_ROW_IDS = ['phase-gate', 'budget', 'dispatch', 'model-routes', 'session-routes', 'role-tools', 'route-fallback']
const rowIds = moduleRowEntries.map((e) => e.id)
const rowDeficits = REQUIRED_ROW_IDS.filter((id) => !rowIds.includes(id))
check('T3h-0 装配断言覆盖面（本地 `.mjs` 行解析器命中 ≥7 行且含七件承重件）',
  moduleRowEntries.length >= 7 && rowDeficits.length === 0,
  `命中 ${moduleRowEntries.length} 行：${rowIds.join(', ')}`)
check('T3h 本地模块行必须导出 apply 函数（cordis registry.plugin() 装载形态，issueId=T3TP1-LIVE-01 防回归）',
  rowMissed.length === 0,
  rowMissed.length ? `未通过：${rowMissed.join(' | ')}` : `${moduleRowEntries.length}/${moduleRowEntries.length} 行导出 apply`)
// 演算（检红）：同款断言跑在两份**缺 apply 夹具**上必须报缺陷，跑在真模块上必须零缺陷。
const missingFixture = '- id: delegation\n  config:\n    - id: fake-pure-lib\n      name: ./fake-pure-lib.mjs\n'
const missingFixtureEntries = parseModuleRows(missingFixture)
const missingFixtureMissed = scanModuleRows(missingFixtureEntries, () => MISSING_FIXTURE_TEXT, () => true)
const cordisImplMissed = scanModuleRows(moduleRowEntries, () => MATCHING_FIXTURE_TEXT, () => true)
// 注：夹具里 `- id: delegation` 与 `- id: fake-pure-lib` 相隔 3 行，解析器按「其后 3 行内
// 首个 name」口径两行都命中（外层 group 行的下一行也是 name），故期望检出 2 项——断言
// 只要求「>0 且每项都是未导出 apply」，以解析口径变化不破坏门禁。
check('T3h-演算 缺 apply 夹具必须检红（门禁自身可信）',
  missingFixtureMissed.length > 0 && missingFixtureMissed.every((s) => s.includes('未导出 apply')),
  `夹具检出 ${missingFixtureMissed.length} 项：${missingFixtureMissed.join(' | ')}`)
check('T3h-演算 对照文本（同模块名 + 已导出 apply）不检红（判别式有效：红因为缺 apply，非因为文件名）',
  cordisImplMissed.length === 0,
  `夹具含 ${moduleRowEntries.length} 行同 id/name，仅模块文本改为含 apply → 检出 ${cordisImplMissed.length} 项`)

// ── T3g（TP-D2-修复1 · D1+D3①）：引擎-工具配对护栏 ─────────────────────────
// 事故口径（运维记录 2026-09-26 问题 4）：0.1.7 移除 workflow-worker-thread 后只删不补，
// tool-workflow 声明 workflowEngine 消费却无人提供 → 「waiting for workflowEngine」会话全挂。
// 护栏：任何 workflowEngine 消费方（isolate.workflowEngine: true 或 @deepseek-ai/dsh-tool-workflow
// 行）在场 ⇒ 组件清单必含 id=workflow-ptc + name=@deepseek-ai/dsh-workflow-ptc 引擎行。
function findWorkflowRows(node, acc) {
  if (node == null) return
  if (Array.isArray(node)) return node.forEach((n) => findWorkflowRows(n, acc))
  if (typeof node === 'object') {
    if (node.isolate && node.isolate.workflowEngine === true) acc.engineConsumer = true
    if (node.name === '@deepseek-ai/dsh-tool-workflow') acc.toolWorkflow = true
    if (node.id === 'workflow-ptc' && node.name === '@deepseek-ai/dsh-workflow-ptc') acc.ptcRow = true
    for (const v of Object.values(node)) findWorkflowRows(v, acc)
  }
}
function hasWorkflowPair(tree) {
  const acc = {}
  findWorkflowRows(tree, acc)
  const consumer = acc.engineConsumer === true || acc.toolWorkflow === true
  return !consumer || acc.ptcRow === true
}
const t3gAcc = {}
findWorkflowRows(cordis, t3gAcc)
check('T3g 引擎-工具配对：声明 workflowEngine 消费方 ⇒ 必含 workflow-ptc 引擎行（TP-D2-修复1 防回退）',
  hasWorkflowPair(cordis),
  `engineConsumer=${t3gAcc.engineConsumer === true} tool-workflow=${t3gAcc.toolWorkflow === true} workflow-ptc=${t3gAcc.ptcRow === true}`)
// 演算：夹具（delegation 组 isolate.workflowEngine + tool-workflow 行、无 workflow-ptc）必须检红
const pairFixture = yaml.load(
  '- id: delegation\n  name: cordis:group\n  group: true\n  isolate:\n    workflowEngine: true\n  config:\n    - id: tool-workflow\n      name: "@deepseek-ai/dsh-tool-workflow"\n',
  { schema })
check('T3g-演算 缺引擎行夹具必须检红（门禁自身可信）', hasWorkflowPair(pairFixture) === false,
  `夹具含消费方不含 workflow-ptc → 配对=${hasWorkflowPair(pairFixture)}`)

writeResult()
