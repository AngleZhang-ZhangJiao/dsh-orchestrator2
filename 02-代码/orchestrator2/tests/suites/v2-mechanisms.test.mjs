/**
 * T2-TP2 新增断言：M4（显式规范版本 + fail-closed）、M3（幂等防护）、M5（设计冻结哈希）、
 * M2（派工原子化半步）、M1（两层状态源）、M6（打包不含 tests）逐条覆盖。
 *
 * 口径：真实 `validateAutoMode` / `dispatchBegin` / `dispatchEnd` / `dispatchStatus`
 * 驱动，fixture 克隆单点变异（scenario-utils），不 mock 被测算术。
 * Run: node tests/suites/v2-mechanisms.test.mjs
 */
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { ORCH2, PHASE_GATE, SPEC_DIR, TPL, SCENARIO_UTILS } from '../lib/paths.mjs'
import { reporter } from '../lib/test-harness.mjs'

const { check, writeResult } = reporter('v2-mechanisms.test')

const { validateAutoMode, SUPPORTED_SPEC_VERSION } = await import(PHASE_GATE)
const { dispatchBegin, dispatchEnd, dispatchStatus } = await import(new URL('../../dispatch.mjs', import.meta.url).href)
const { TASK_REL, scenario, write, PRODUCT } = await import(SCENARIO_UTILS)

const sha256 = (p) => createHash('sha256').update(readFileSync(p)).digest('hex')
const statusPathOf = (dir) => join(dir, '03-开发协同', 'TP1-玩具功能', '状态.md')

/** 在状态头插入/替换一行字段。 */
function setHeader(dir, key, value) {
  const p = statusPathOf(dir)
  const text = readFileSync(p, 'utf8')
  const lines = text.split('\n')
  const idx = lines.findIndex((l) => l.startsWith(`${key}：`))
  if (idx >= 0) lines[idx] = `${key}：${value}`
  else lines.unshift(`${key}：${value}`)
  write(p, lines.join('\n'))
}

// ── M4 · 显式规范版本 fail-closed 四拒绝 + 解析损坏点名文件 ──────────────────
check('M4-0 导出 SUPPORTED_SPEC_VERSION = v2.1', SUPPORTED_SPEC_VERSION === 'v2.1', `实际=${SUPPORTED_SPEC_VERSION}`)

let dir = scenario('v2-m4-no-version', (d) => {
  const p = statusPathOf(d)
  write(p, readFileSync(p, 'utf8').split('\n').filter((l) => !l.startsWith('规范版本：')).join('\n'))
})
let r = validateAutoMode(dir, TASK_REL)
check('M4-1a 缺「规范版本」字段 → 拒绝', r.ok === false && r.message.includes('规范版本'))
check('M4-1b 拒绝信息给出补写引导（升级脚手架）', r.ok === false && r.message.includes('升级脚手架'))

dir = scenario('v2-m4-v11', (d) => setHeader(d, '规范版本', 'v1.1'))
r = validateAutoMode(dir, TASK_REL)
check('M4-2a v1.1 → 拒绝', r.ok === false && r.message.includes('1.1'))
check('M4-2b v1.1 拒绝点名改用 1.0 预设（同项目不混用）', r.ok === false && r.message.includes('1.0 预设'))

dir = scenario('v2-m4-unknown-version', (d) => setHeader(d, '规范版本', 'v9.9'))
r = validateAutoMode(dir, TASK_REL)
check('M4-3a 未知版本 v9.9 → 拒绝', r.ok === false && r.message.includes('v9.9'))
check('M4-3b 拒绝信息列出合法版本枚举', r.ok === false && r.message.includes('v2.1') && r.message.includes('v2.0'))

dir = scenario('v2-m4-unknown-flow', (d) => setHeader(d, '流程类型', '三段流水线'))
r = validateAutoMode(dir, TASK_REL)
check('M4-4a 未知流程类型 → 拒绝', r.ok === false && r.message.includes('三段流水线'))
check('M4-4b 拒绝信息列出合法流程类型枚举', r.ok === false && r.message.includes('产品设计全流程') && r.message.includes('技术调研储备'))

dir = scenario('v2-m4-missing-design-dir', (d) => {
  const p = statusPathOf(d)
  write(p, readFileSync(p, 'utf8').split('\n').filter((l) => !l.startsWith('设计目录：')).join('\n'))
})
r = validateAutoMode(dir, TASK_REL)
check('M4-5 v2.x 缺「设计目录」→ 拒绝（不再回落 legacy 路径）',
  r.ok === false && r.message.includes('设计目录'))

// 解析损坏 fixture：把状态.md 顶部固定块写坏（无「：」分隔行）→ fail-closed 拒绝并点名文件
dir = scenario('v2-m4-broken-status', (d) => {
  write(statusPathOf(d), '这是一个损坏的状态文件\n没有字段分隔符也没有固定块\n')
})
r = validateAutoMode(dir, TASK_REL)
check('M4-6a 固定块不可解析 → 拒绝', r.ok === false)
check('M4-6b 拒绝信息**点名损坏文件路径**（状态.md 绝对路径）',
  r.ok === false && r.message.includes('状态.md') && r.message.includes('不可解析'))
check('M4-6c 拒绝信息含具体路径（fixture 根被打印）', r.ok === false && r.message.includes(dir))

// ── M3 · 幂等防护（两路：无 goalLookup 放行 / 有既有 goal 拒绝）──────────────
dir = scenario('v2-m3-clean', () => {})
r = validateAutoMode(dir, TASK_REL, {})
check('M3-1 缺省（无 goalLookup）不做幂等检查 → 合法包仍接受', r.ok === true)
r = validateAutoMode(dir, TASK_REL, { goalLookup: () => undefined })
check('M3-2a goalLookup 返回 undefined（无既有 goal）→ 接受', r.ok === true)
r = validateAutoMode(dir, TASK_REL, { goalLookup: () => ({ id: 'g-1', state: 'paused' }) })
check('M3-2b 既有 paused goal → 拒绝（幂等）', r.ok === false && r.message.includes('幂等'))
check('M3-2c 拒绝信息返回现状（goal id + 状态）', r.ok === false && r.message.includes('g-1') && r.message.includes('paused'))
r = validateAutoMode(dir, TASK_REL, { goalLookup: () => ({ id: 'g-2', state: 'active' }) })
check('M3-3 既有 active goal → 拒绝并返回现状', r.ok === false && r.message.includes('g-2') && r.message.includes('active'))
r = validateAutoMode(dir, TASK_REL, { goalLookup: () => { throw new Error('lookup boom') } })
check('M3-4 幂等查询抛错 → 保守拒绝（不放过）', r.ok === false && r.message.includes('保守拒绝'))

// ── M5 · 设计冻结哈希（设计基线.json）────────────────────────────────────
const PRODUCT_REL = ['01-设计', '玩具项目']
dir = scenario('v2-m5-clean', (d) => {
  const prod = PRODUCT(d)
  write(join(prod, '设计基线.json'), JSON.stringify({
    基线ID: 'DB-20260915-1',
    确认版本: 'v1.0',
    确认时间: '2026-09-15 10:00',
    files: {
      '04_产品设计方案.md': sha256(join(prod, '04_产品设计方案.md')),
      '06_设计定稿记录.md': sha256(join(prod, '06_设计定稿记录.md')),
    },
  }, null, 2))
})
r = validateAutoMode(dir, TASK_REL)
check('M5-1a 设计基线存在且哈希一致 → 接受', r.ok === true)

dir = scenario('v2-m5-tampered', (d) => {
  const prod = PRODUCT(d)
  write(join(prod, '设计基线.json'), JSON.stringify({
    基线ID: 'DB-20260915-1',
    确认版本: 'v1.0',
    files: { '04_产品设计方案.md': sha256(join(prod, '04_产品设计方案.md')) },
  }, null, 2))
  // 确认后篡改 04（追加一字）
  write(join(prod, '04_产品设计方案.md'), readFileSync(join(prod, '04_产品设计方案.md'), 'utf8') + '\n（确认后被改动的追加行）\n')
})
r = validateAutoMode(dir, TASK_REL)
check('M5-2a 确认后篡改 04 → 拒绝', r.ok === false && r.message.includes('设计冻结校验失败'))
check('M5-2b 拒绝信息报告**差异文件**（04 路径 + 基线/当前哈希前缀）',
  r.ok === false && r.message.includes('04_产品设计方案.md') && r.message.includes('哈希不符'))
check('M5-2c 拒绝信息带上基线 ID 与确认版本', r.ok === false && r.message.includes('DB-20260915-1') && r.message.includes('v1.0'))

dir = scenario('v2-m5-missing-baseline-file', (d) => {
  setHeader(d, '必读文件', '01-设计/玩具项目/任务包/TP1-玩具功能/02_开发方案与任务包.md；设计基线.json')
})
r = validateAutoMode(dir, TASK_REL)
check('M5-3a 引用基线但基线件缺席 → 拒绝', r.ok === false && r.message.includes('设计基线.json'))
check('M5-3b 拒绝信息说明生成动作（关卡1 生成，含四个要素）',
  r.ok === false && r.message.includes('SHA-256') && r.message.includes('基线 ID'))

dir = scenario('v2-m5-bad-json', (d) => write(join(PRODUCT(d), '设计基线.json'), '{ 这不是 JSON'))
r = validateAutoMode(dir, TASK_REL)
check('M5-4 基线 JSON 损坏 → 拒绝并点名文件', r.ok === false && r.message.includes('不是合法 JSON'))

dir = scenario('v2-m5-absent-file', (d) => {
  const prod = PRODUCT(d)
  write(join(prod, '设计基线.json'), JSON.stringify({
    基线ID: 'DB-1',
    确认版本: 'v1.0',
    files: { '05_分模块设计/模块A.md': 'deadbeef' },
  }, null, 2))
})
r = validateAutoMode(dir, TASK_REL)
check('M5-5 基线列出的设计件缺失 → 拒绝并报「文件缺失」',
  r.ok === false && r.message.includes('文件缺失') && r.message.includes('05_分模块设计/模块A.md'))

// ── M2 · 派工原子半步（dispatch_begin / dispatch_end / dispatch_status）─────
dir = scenario('v2-m2-clean', () => {})
const ledgerPath = join(dir, '03-开发协同', 'TP1-玩具功能', '预算台账.md')
const lockPath = join(dir, '03-开发协同', 'TP1-玩具功能', '.lock')

let b = dispatchBegin(dir, TASK_REL, '计划审核', 'subagent_reviewer', 'kimi-coding/k3-256k')
check('M2-1a dispatch_begin 成功并返回 runId', b.ok === true && typeof b.runId === 'string' && b.runId.length > 0, `runId=${b.runId}`)
check('M2-1b 写锁成功', existsSync(lockPath))
check('M2-1c 台账预登记一行（结论列=已派工）', readFileSync(ledgerPath, 'utf8').includes('| 已派工 |'))
check('M2-1d 预登记即计次：B 运行累计 +1（0→1）', readFileSync(ledgerPath, 'utf8').includes('当前累计：C运行=0 / B运行=1 / 工作轮=1'))
let s = dispatchStatus(dir, TASK_REL)
check('M2-1e dispatch_status 识别悬空派工（已派工行 + 锁在）', s.ok === true && s.message.includes('悬空派工 1 行'))

check('M2-2 并发派工被拒（锁存在）', dispatchBegin(dir, TASK_REL, '执行与自测', 'subagent_developer').ok === false)

// 阶段未前移 → dispatch_end 拒绝回填且保留锁
let e = dispatchEnd(dir, TASK_REL, b.runId, '通过')
check('M2-3a 阶段未前移 → dispatch_end 拒绝回填', e.ok === false && e.message.includes('阶段未前移'))
check('M2-3b 拒绝后保留锁（该环节视同未完成）', existsSync(lockPath))

// runId 不匹配 → 拒绝
e = dispatchEnd(dir, TASK_REL, 'wrong-runid', '通过')
check('M2-4 runId 不匹配 → 拒绝（防跨轮错配）', e.ok === false && e.message.includes('runId 不匹配'))

// 推进阶段后回填成功
setHeader(dir, '当前阶段', '执行中')
e = dispatchEnd(dir, TASK_REL, b.runId, '通过（驳回轮次 0）')
check('M2-5a 阶段前移后 dispatch_end 成功', e.ok === true && e.message.includes('已回填并解锁'))
check('M2-5b 删锁成功', !existsSync(lockPath))
check('M2-5c 台账回填结论（已派工 → 通过）',
  readFileSync(ledgerPath, 'utf8').includes('通过（驳回轮次 0）') && !readFileSync(ledgerPath, 'utf8').includes('| 已派工 |'))

// 缺台账 → 派工前拒绝
dir = scenario('v2-m2-no-ledger', (d) => rmSync(join(d, '03-开发协同', 'TP1-玩具功能', '预算台账.md')))
check('M2-6 缺台账 → 派工前拒绝（不写锁）',
  dispatchBegin(dir, TASK_REL, '计划审核', 'subagent_reviewer').ok === false &&
  !existsSync(join(dir, '03-开发协同', 'TP1-玩具功能', '.lock')))

// 预算触顶 → 派工前拒绝
dir = scenario('v2-m2-capped', (d) => {
  const p = join(d, '03-开发协同', 'TP1-玩具功能', '预算台账.md')
  write(p, readFileSync(p, 'utf8').replace('当前累计：C运行=0 / B运行=0 / 工作轮=0', '当前累计：C运行=0 / B运行=4 / 工作轮=3'))
})
let cap = dispatchBegin(dir, TASK_REL, '代码审查', 'subagent_reviewer')
check('M2-7a B 运行达上限（4/4）→ 派工前拒绝', cap.ok === false && cap.message.includes('预算触顶'))
check('M2-7b 拒绝信息给出三项超限明细与停机动作',
  cap.ok === false && cap.message.includes('B 运行 5 > 上限 4') && cap.message.includes('决策简报'))
check('M2-7c 触顶拒绝不写锁、不记台账',
  !existsSync(join(dir, '03-开发协同', 'TP1-玩具功能', '.lock')) &&
  !readFileSync(join(dir, '03-开发协同', 'TP1-玩具功能', '预算台账.md'), 'utf8').includes('| 已派工 |'))

// 工作轮触顶（上限 24 已达 24）
dir = scenario('v2-m2-rounds-capped', (d) => {
  const p = join(d, '03-开发协同', 'TP1-玩具功能', '预算台账.md')
  write(p, readFileSync(p, 'utf8').replace('B运行=0 / 工作轮=0', 'B运行=0 / 工作轮=24'))
})
cap = dispatchBegin(dir, TASK_REL, '执行与自测', 'subagent_developer')
check('M2-8 工作轮达上限（24/24）→ 派工前拒绝', cap.ok === false && cap.message.includes('工作轮 25 > 上限 24'))

// 开发员派工计 C 运行
dir = scenario('v2-m2-dev', () => {})
b = dispatchBegin(dir, TASK_REL, '执行与自测', 'subagent_developer', 'kimi-coding/kimi-for-coding')
check('M2-9a 开发员派工计 C 运行（0→1）',
  b.ok === true && readFileSync(join(dir, '03-开发协同', 'TP1-玩具功能', '预算台账.md'), 'utf8').includes('当前累计：C运行=1 / B运行=0 / 工作轮=1'))
check('M2-9b 调度员自办环节不计 B/C（只计工作轮）', dispatchBegin(scenario('v2-m2-self', () => {}), TASK_REL, '构建', '调度员').message.includes('C=0/'))

// 无锁时 dispatch_end → 拒绝（重复调用/中断残留）
dir = scenario('v2-m2-no-lock', () => {})
e = dispatchEnd(dir, TASK_REL, 'whatever', '通过')
check('M2-10 无锁调用 dispatch_end → 拒绝（重复调用防护）', e.ok === false && e.message.includes('无在跑环节'))

// ── M1 · 两层状态源（产品状态.md 模板）───────────────────────────────────
const productStatusTpl = join(TPL, '03-开发协同', '产品状态.md')
check('M1-1a 产品状态.md 模板存在', existsSync(productStatusTpl))
const psText = existsSync(productStatusTpl) ? readFileSync(productStatusTpl, 'utf8') : ''
check('M1-1b 固定块四字段齐备（当前设计阶段/负责方/活跃任务包/任务包清单）',
  ['当前设计阶段：', '当前环节负责方：', '活跃任务包：', '任务包清单：'].every((k) => psText.includes(k)))
check('M1-1c 声承担设计阶段九态 + 任务包只管单包',
  psText.includes('设计阶段九态') && psText.includes('开发 5 态 + 修复循环 5 态'))
const specText = readFileSync(join(SPEC_DIR, '项目目录及协同开发规范-v2.1.md'), 'utf8')
check('M1-2a 规范含「两层状态源」口径（§三）', specText.includes('两层状态源（v2.1 · M1）'))
check('M1-2b 规范说明开工判定先读产品状态再下钻',
  specText.includes('先读产品状态.md 定位设计期环节，再下钻任务包'))
check('M1-2c 模板索引含产品状态.md 行且总数 39',
  specText.includes('`03-开发协同/产品状态.md`') && specText.includes('模板总数 39 件'))

// ── M4/M5/P2-1 · 模板集与规范文本口径 ────────────────────────────────────
const statusTpl = readFileSync(join(TPL, '03-开发协同', '状态.md'), 'utf8')
check('T2-1a 状态模板含强制「规范版本：v2.1」', statusTpl.includes('规范版本：v2.1'))
check('T2-1b 状态模板含 M3 三字段（推进goal/goal状态/启动revision）',
  ['推进goal：', 'goal状态：', '启动revision：'].every((k) => statusTpl.includes(k)))
check('T2-1c 状态模板含 P2-1 三字段（repairOf/issueId/parentCandidateCommit）',
  ['repairOf：', 'issueId：', 'parentCandidateCommit：'].every((k) => statusTpl.includes(k)))
const repairStatusTpl = readFileSync(join(TPL, '_任务模板', '修复包', '状态.md'), 'utf8')
check('T6-1 修复包状态模板含 P2-1 三字段 + 父子同步口径',
  ['repairOf：', 'issueId：', 'parentCandidateCommit：', '父子同步口径'].every((k) => repairStatusTpl.includes(k)))
const baselineExample = join(TPL, '01-设计', '设计基线.example.json')
check('T5-1 设计基线示例件存在且为合法 JSON', existsSync(baselineExample) && (() => {
  try { JSON.parse(readFileSync(baselineExample, 'utf8')); return true } catch { return false }
})())
check('T5-2 设计基线示例含五要素（ID/确认版本/确认时间/files 映射）', (() => {
  const b = JSON.parse(readFileSync(baselineExample, 'utf8'))
  return typeof b['基线ID'] === 'string' && typeof b['确认版本'] === 'string' &&
    typeof b['确认时间'] === 'string' && typeof b.files === 'object'
})())

// ── M6 · 打包清单不含 tests（AC-TP2-1 后半）────────────────────────────────
const packaging = join(ORCH2, 'packaging.json')
if (existsSync(packaging)) {
  const pack = JSON.parse(readFileSync(packaging, 'utf8'))
  check('M6-1 packaging.json 不含 tests/（files 断言）',
    Array.isArray(pack.files) && !pack.files.some((f) => String(f).includes('tests')))
  check('M6-2 packaging.json 不含 tests 通配（**/* 也会带上 tests ⇒ 必须显式排除）',
    Array.isArray(pack.exclude) && pack.exclude.some((f) => String(f).includes('tests')))
} else {
  check('M6-1 packaging.json 存在（构建材料清单）', false, '缺 packaging.json')
  check('M6-2 packaging.json 含 exclude 段', false)
}

// ── T0 · 宿主探查结论落盘（形态 A/B 判定可查）────────────────────────────
const readmeText = readFileSync(join(ORCH2, 'README.md'), 'utf8')
check('T0-1 README 记录形态 A 的库加载器依据（./ 相对路径 → baseUrl）',
  readmeText.includes('baseUrl') || readmeText.includes('预设内本地工具模块'))
check('T0-2 dispatch.mjs 头注释记录形态判定与不需要形态 B 的理由',
  readFileSync(join(ORCH2, 'dispatch.mjs'), 'utf8').includes('形态 A'))

writeResult()
