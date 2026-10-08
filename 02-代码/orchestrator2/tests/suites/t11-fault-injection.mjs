/**
 * TP-B · D6 故障注入套件（AC-B-3）：五项逐项断言 + 六态结算覆盖（T3 佐证）。
 * 口径：真实 `dispatchBegin` / `dispatchEnd` / `dispatchStatus` / `migrateLedger`
 * 驱动，fixture 克隆（scenario-utils），不 mock 被测逻辑。
 *   ① 重复结算拒绝（行已有结论 → 拒，保留锁）
 *   ② 写锁后崩溃 → 恢复轮按锁 runId 对账（status 报锁、补登记后精确结算）
 *   ③ 写台账后崩溃 → status 标悬空（锁 + 已派工行都在）
 *   ④ 子代理完成未结算 → 四方一致补结算（悬空行 + 锁已不在 + 证据存在性）
 *   ⑤ 多「已派工行」→ 精确匹配不错账（错 runId 不动账，正确 runId 只结本行）
 * Run: node tests/suites/t11-fault-injection.mjs
 */
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { SCENARIO_UTILS } from '../lib/paths.mjs'
import { reporter } from '../lib/test-harness.mjs'

const { check, pushLine, writeResult } = reporter('t11-fault-injection')

const { dispatchBegin, dispatchEnd, dispatchStatus } = await import(new URL('../../dispatch.mjs', import.meta.url).href)
const { TASK_REL, scenario, write } = await import(SCENARIO_UTILS)

const taskDirOf = (dir) => join(dir, TASK_REL)
const ledgerOf = (dir) => join(taskDirOf(dir), '预算台账.md')
const lockOf = (dir) => join(taskDirOf(dir), '.lock')
const ledgerText = (dir) => readFileSync(ledgerOf(dir), 'utf8')
const countPending = (dir) => ledgerText(dir).split('| 已派工 |').length - 1

/** 在状态头插入/替换一行字段（与 v2-mechanisms 同款最小实现）。 */
function setHeader(dir, key, value) {
  const p = join(taskDirOf(dir), '状态.md')
  const lines = readFileSync(p, 'utf8').split('\n')
  const idx = lines.findIndex((l) => l.startsWith(`${key}：`))
  if (idx >= 0) lines[idx] = `${key}：${value}`
  else lines.unshift(`${key}：${value}`)
  write(p, lines.join('\n'))
}

/** 手工写一份锁（模拟 dispatch_begin 写锁后、写台账前崩溃的现场）。 */
function writeLock(dir, runId, 环节, beforePhase = '待审核') {
  write(lockOf(dir), [
    `任务目录：${taskDirOf(dir).split(/[\\/]/).pop()}`,
    `环节：${环节}`,
    `角色：subagent_reviewer`,
    `runId：${runId}`,
    `派工时间：2026-09-16 00:00`,
    `派工前阶段：${beforePhase}`,
  ].join('\n') + '\n')
}

/** 手工把台账中某 runId 的「已派工」行改写为已结算（模拟调度员对账补记）。 */
function settleRowManually(dir, runId, 结论cell) {
  const lines = ledgerText(dir).split('\n')
  const idx = lines.findIndex((l) => l.includes(`| ${runId} |`) && l.includes('| 已派工 |'))
  if (idx < 0) throw new Error(`settleRowManually: 找不到 runId=${runId} 的已派工行`)
  const cells = lines[idx].split('|').slice(1, -1).map((c) => c.trim())
  cells[3] = 结论cell
  lines[idx] = `| ${cells.join(' | ')} |`
  writeFileSync(ledgerOf(dir), lines.join('\n'), 'utf8')
}

/** 手工补登记一行「已派工」（模拟调度员按锁 runId 对账补记台账；v1/v2 表头均可）。 */
function appendPendingRow(dir, runId, 环节, beforePhase = '待审核') {
  const lines = ledgerText(dir).split('\n')
  const headerIdx = lines.findIndex((l) => l.startsWith('| ') && l.includes('结论') && l.includes('token'))
  if (headerIdx < 0) throw new Error('appendPendingRow: 找不到明细表头')
  let insertAt = headerIdx + 1
  while (insertAt < lines.length && lines[insertAt].startsWith('|')) insertAt++
  lines.splice(insertAt, 0, `| 2026-09-16 00:00 | ${环节} | — | 已派工 | ${runId} | 1 | ${beforePhase} | — | — | — | 0 | 1 | 1 | — |`)
  writeFileSync(ledgerOf(dir), lines.join('\n'), 'utf8')
}

// ── ① 重复结算拒绝 ──────────────────────────────────────────────────────────
let dir = scenario('t11-double-settle', () => {})
let b = dispatchBegin(dir, TASK_REL, '计划审核', 'subagent_reviewer')
setHeader(dir, '当前阶段', '执行中')
let e = dispatchEnd(dir, TASK_REL, b.runId, '通过')
check('F1-1a 首次结算成功', e.ok === true, e.message.slice(0, 80))
// 模拟「回填已落账、删锁前进程崩溃」的残留现场：锁被外部恢复、行已结算
writeLock(dir, b.runId, '计划审核')
e = dispatchEnd(dir, TASK_REL, b.runId, '通过')
check('F1-1b 行已有结论 → 重复结算拒绝', e.ok === false && e.message.includes('重复结算拒绝'), e.message.slice(0, 80))
check('F1-1c 重复结算拒绝保留锁', existsSync(lockOf(dir)))
rmSync(lockOf(dir), { force: true })

// ── ② 写锁后崩溃 → 恢复轮按锁 runId 对账 ────────────────────────────────────
dir = scenario('t11-lock-only-crash', () => {})
writeLock(dir, 'TP1-玩具功能-crash0000-lockok', '计划审核')
let s = dispatchStatus(dir, TASK_REL)
check('F2-1a status 报「有锁无悬空行」（异常残留/对账）', s.ok === true && s.message.includes('无悬空派工') && s.message.includes('锁文件 ') && s.message.includes('异常：无悬空行却有锁'), s.message.split('\n').slice(-2).join(' / '))
check('F2-1b status 输出锁内 runId 供对账', s.message.includes('TP1-玩具功能-crash0000-lockok') || readFileSync(lockOf(dir), 'utf8').includes('TP1-玩具功能-crash0000-lockok'))
// 恢复：调度员按锁 runId 补登记台账行（对账动作），再正常结算
appendPendingRow(dir, 'TP1-玩具功能-crash0000-lockok', '计划审核')
setHeader(dir, '当前阶段', '执行中')
e = dispatchEnd(dir, TASK_REL, 'TP1-玩具功能-crash0000-lockok', '通过')
check('F2-2 补登记后可按锁 runId 精确结算', e.ok === true && e.message.includes('已回填并解锁'), e.message.slice(0, 100))
check('F2-3 结算行结论带状态词', ledgerText(dir).includes('通过〔DONE〕'))

// ── ③ 写台账后崩溃 → status 标悬空 ──────────────────────────────────────────
dir = scenario('t11-crash-after-ledger', () => {})
b = dispatchBegin(dir, TASK_REL, '计划审核', 'subagent_reviewer')
check('F3-1 预登记行含完整 runId', ledgerText(dir).includes(`| ${b.runId} |`), b.runId)
s = dispatchStatus(dir, TASK_REL)
check('F3-2a status 标悬空 1 行', s.ok === true && s.message.includes('悬空派工 1 行'), s.message.split('\n')[2]?.slice(0, 60))
check('F3-2b status 明示锁仍在', s.message.includes('仍在'))
setHeader(dir, '当前阶段', '执行中')
e = dispatchEnd(dir, TASK_REL, b.runId, '通过')
check('F3-3 悬空行可正常结算清零', e.ok === true && countPending(dir) === 0)

// ── ④ 子代理完成未结算 → 四方一致补结算 ─────────────────────────────────────
dir = scenario('t11-done-unsettled', () => {})
b = dispatchBegin(dir, TASK_REL, '执行与自测', 'subagent_developer')
setHeader(dir, '当前阶段', '待审查')
write(join(taskDirOf(dir), '执行自测-20260916.md'), '# 执行自测\n\n## concerns\n\n- 无\n')
rmSync(lockOf(dir), { force: true }) // 模拟结算前崩溃：锁没了，行还挂着「已派工」
s = dispatchStatus(dir, TASK_REL)
check('F4-1a 悬空行 + 锁已不在 → 中断残留提示', s.ok === true && s.message.includes('悬空派工 1 行') && s.message.includes('已不在'), s.message.split('\n').slice(2, 4).join(' / '))
settleRowManually(dir, b.runId, '中断〔INTERRUPTED〕')
s = dispatchStatus(dir, TASK_REL)
check('F4-2 补记结论后零悬空', s.ok === true && s.message.includes('无悬空派工'))
check('F4-3 四方一致：证据文件存在性不误报（最近结算行=执行与自测，证据在）',
  s.message.includes('四方一致检查：一致'), s.message.split('\n')[1]?.slice(0, 80))

// ── ⑤ 多「已派工行」→ 精确匹配不错账 ───────────────────────────────────────
dir = scenario('t11-multi-pending', () => {})
const b1 = dispatchBegin(dir, TASK_REL, '计划审核', 'subagent_reviewer')
rmSync(lockOf(dir), { force: true }) // 第一次派工中断残留行
const b2 = dispatchBegin(dir, TASK_REL, '计划审核', 'subagent_reviewer')
check('F5-1 构造出两条已派工行', countPending(dir) === 2, `pending=${countPending(dir)}`)
setHeader(dir, '当前阶段', '执行中')
e = dispatchEnd(dir, TASK_REL, 'bogus-runid-0000', '通过')
check('F5-2a 错 runId → 拒绝结算', e.ok === false && e.message.includes('runId 不匹配'))
check('F5-2b 错 runId 不动账（仍 2 条已派工行）', countPending(dir) === 2)
e = dispatchEnd(dir, TASK_REL, b2.runId, '通过')
check('F5-3a 正确 runId 只结算本行', e.ok === true && countPending(dir) === 1)
check('F5-3b 本行结论与结算后阶段落账', ledgerText(dir).includes(`${b2.runId} | 2 | 待审核 | 执行中`))
check('F5-3c 残留 b1 行不被错结', ledgerText(dir).includes(`| ${b1.runId} |`))

// ── 六态结算（T3 佐证；与五项故障注入共用真实函数）────────────────────────────
dir = scenario('t11-states', () => {})
// DONE 未前移 → 拒
b = dispatchBegin(dir, TASK_REL, '计划审核', 'subagent_reviewer')
e = dispatchEnd(dir, TASK_REL, b.runId, '通过')
check('S-1 DONE 阶段未前移 → 拒绝回填保留锁', e.ok === false && e.message.includes('阶段未前移') && existsSync(lockOf(dir)))
rmSync(lockOf(dir), { force: true })
// NEEDS_CONTEXT / BLOCKED / FAILED / INTERRUPTED 不前移可结算 + 释锁 + 状态词落账
const cases = [
  ['NEEDS_CONTEXT', '缺少 02 文档'],
  ['BLOCKED', '依赖服务不可用'],
  ['FAILED', '子代理异常返回'],
  ['INTERRUPTED', '用户中断'],
]
for (const [state, summary] of cases) {
  const d = scenario(`t11-state-${state.toLowerCase()}`, () => {})
  const bb = dispatchBegin(d, TASK_REL, '计划审核', 'subagent_reviewer')
  const ee = dispatchEnd(d, TASK_REL, bb.runId, summary, state)
  check(`S-2 ${state} 不前移可结算`, ee.ok === true && ee.message.includes('已回填并解锁'), ee.message.slice(0, 70))
  check(`S-3 ${state} 锁已释放`, !existsSync(lockOf(d)))
  check(`S-4 ${state} 结论列带〔${state}〕`, ledgerText(d).includes(`〔${state}〕`))
}
// DWC 无 concerns 小节 → 按证据缺失拒
let d = scenario('t11-dwc-no-concerns', () => {})
b = dispatchBegin(d, TASK_REL, '执行与自测', 'subagent_developer')
setHeader(d, '当前阶段', '待审查')
e = dispatchEnd(d, TASK_REL, b.runId, '完成（有疑点）', 'DONE_WITH_CONCERNS')
check('S-5a DWC 无 concerns 小节 → 证据缺失拒绝结算', e.ok === false && e.message.includes('证据缺失') && e.message.includes('concerns'), e.message.slice(0, 90))
check('S-5b DWC 被拒保留锁', existsSync(lockOf(d)))
// DWC 有 concerns 小节 → 过
d = scenario('t11-dwc-with-concerns', () => {})
b = dispatchBegin(d, TASK_REL, '执行与自测', 'subagent_developer')
setHeader(d, '当前阶段', '待审查')
write(join(taskDirOf(d), '执行自测-20260916.md'), '# 执行自测\n\n## concerns\n\n- 疑点：xxx\n')
e = dispatchEnd(d, TASK_REL, b.runId, '完成（1 条疑点入 concerns）', 'DONE_WITH_CONCERNS')
check('S-6 DWC 含 concerns 小节 → 结算成功', e.ok === true && ledgerText(d).includes('DONE_WITH_CONCERNS'), e.message.slice(0, 80))
// 中文摘要推断：中断/失败/通过
d = scenario('t11-infer', () => {})
b = dispatchBegin(d, TASK_REL, '代码审查', 'subagent_reviewer')
e = dispatchEnd(d, TASK_REL, b.runId, '中断')
check('S-7 中文摘要「中断」推断 INTERRUPTED', e.ok === true && ledgerText(d).includes('〔INTERRUPTED〕'))
// 非法结果态 → 拒
d = scenario('t11-bad-state', () => {})
b = dispatchBegin(d, TASK_REL, '计划审核', 'subagent_reviewer')
e = dispatchEnd(d, TASK_REL, b.runId, '通过', 'MAYBE')
check('S-8 非法结果态 → 拒绝回填', e.ok === false && e.message.includes('不在六枚举内'))

pushLine('（故障注入五项 + 六态结算均以真实 dispatch 函数驱动；scenario 夹具每次重建）')
writeResult()
