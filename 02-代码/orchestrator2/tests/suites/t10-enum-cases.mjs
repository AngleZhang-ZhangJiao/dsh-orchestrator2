/**
 * T10（AC4）· phase-gate 枚举回归 + 新枚举拒绝用例：
 * ① 既有语义回归：v2.0 合法包接受、legacy 接受、常见拒绝路径仍按原报错；
 * ② v2.1 新枚举 `现状研究中` / `方向确认中` / `清单待确认` / `待审查`
 *    —— 喂 fixture 给真实 validateAutoMode，应一律拒绝且**报当前阶段非待审核**；
 * ③ 旧枚举兼容：`待验证` / `待代码审查` 仍在枚举内（不得落在「不在阶段枚举内」分支）。
 * Run: node tests/suites/t10-enum-cases.mjs
 */
import { readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'

import { ORCH2, FX, PHASE_GATE, SCENARIO_UTILS } from '../lib/paths.mjs'
import { reporter } from '../lib/test-harness.mjs'

const { check, writeResult } = reporter('t10-enum-cases')
const lines = []

const { validateAutoMode } = await import(PHASE_GATE)
const { TASK_REL, scenario, write } = await import(
  SCENARIO_UTILS
)

function run(label, rootDir, taskRel) {
  const r = validateAutoMode(rootDir, taskRel)
  lines.push(`--- [${label}] ok=${r.ok}${r.ok ? '' : ` message=${r.message}`}`)
  return r
}

// 读 PHASE_VALUES（模块内 const，未导出）
const gateSrc = readFileSync(join(ORCH2, 'phase-gate.mjs'), 'utf8')
const arrMatch = gateSrc.match(/const PHASE_VALUES = \[([\s\S]*?)\n\]/)
const phaseValues = arrMatch === null ? [] : [...arrMatch[1].matchAll(/'([^']+)'/g)].map((m) => m[1])

// ── ① 既有语义回归 ────────────────────────────────────────────────────────
let r = run('① v2.1 合法包（待审核）接受', join(FX, 'fixture-valid'), TASK_REL)
check('T10-1a 合法包仍被接受', r.ok === true)
r = run('①b legacy(v1.1) 旧式状态头拒绝', join(FX, 'fixture-legacy'), '03-开发协同/TL1-旧任务')
check('T10-1b v1.1 被拒绝且点名改用 1.0 预设（M4 不再按缺失字段推断版本）',
  r.ok === false && r.message.includes('v1.1') && r.message.includes('1.0 预设'))
r = run('①c 台账固定块不可解析拒绝', scenario('t10-no-ledger', (d) => {
  const p = join(d, '03-开发协同', 'TP1-玩具功能', '预算台账.md')
  write(p, '任务包：TP（不完整）\n')
}), TASK_REL)
check('T10-1c 台账固定块不可解析仍按原报错', r.ok === false && r.message.includes('不可解析'))
r = run('①d 缺台账（整件删除）拒绝', scenario('t10-missing-ledger', (d) => {
  rmSync(join(d, '03-开发协同', 'TP1-玩具功能', '预算台账.md'))
}), TASK_REL)
check('T10-1d 缺台账整件被拒（M4：v2.x 非豁免流程类型台账为必填）',
  r.ok === false && r.message.includes('机器保险丝') && r.message.includes('预算台账.md'))

// ── ② 新枚举拒绝用例（本次派工要求逐值覆盖）────────────────────────────────
const newPhases = ['现状研究中', '方向确认中', '清单待确认', '待审查']
for (const phase of newPhases) {
  const dir = scenario(`t10-new-${phase}`, (d) => {
    const p = join(d, '03-开发协同', 'TP1-玩具功能', '状态.md')
    write(p, readFileSync(p, 'utf8').replace('当前阶段：待审核', `当前阶段：${phase}`))
  })
  const res = run(`② 新枚举 ${phase}`, dir, TASK_REL)
  check(`T10-2a [${phase}] 在 PHASE_VALUES（枚举已登记）`, phaseValues.includes(phase), `枚举 ${phaseValues.length} 项`)
  check(`T10-2b [${phase}] enter_auto_mode 拒绝`, res.ok === false)
  check(`T10-2c [${phase}] 报「当前阶段为「${phase}」而非「待审核」」`,
    res.ok === false && res.message.includes(`当前阶段为「${phase}」而非「待审核」`))
  check(`T10-2d [${phase}] 报错不走「不在阶段枚举内」分支（旧枚举兼容不误伤）`,
    res.ok === false && !res.message.includes('不在阶段枚举内'))
}

// ── ③ 旧枚举兼容 ──────────────────────────────────────────────────────────
for (const phase of ['待验证', '待代码审查', '待推送']) {
  check(`T10-3a 旧值 [${phase}] 仍在枚举内（不报「不在阶段枚举内」）`, phaseValues.includes(phase))
  const dir = scenario(`t10-legacy-${phase}`, (d) => {
    const p = join(d, '03-开发协同', 'TP1-玩具功能', '状态.md')
    write(p, readFileSync(p, 'utf8').replace('当前阶段：待审核', `当前阶段：${phase}`))
  })
  const res = validateAutoMode(dir, TASK_REL)
  lines.push(`--- [③ 旧值 ${phase}] ok=${res.ok}${res.ok ? '' : ` message=${res.message}`}`)
  check(`T10-3b 旧值 [${phase}] 被拒绝但不报「不在阶段枚举内」`,
    res.ok === false && !res.message.includes('不在阶段枚举内'))
}

// ── ④ 真·非法值仍报「不在阶段枚举内」（证明枚举校验本体未被削弱）────────────
{
  const dir = scenario('t10-invalid-value', (d) => {
    const p = join(d, '03-开发协同', 'TP1-玩具功能', '状态.md')
    write(p, readFileSync(p, 'utf8').replace('当前阶段：待审核', '当前阶段：瞎写的阶段'))
  })
  const res = validateAutoMode(dir, TASK_REL)
  lines.push(`--- [④ 非法值] ok=${res.ok}${res.ok ? '' : ` message=${res.message}`}`)
  check('T10-4 真·非法值仍报「不在阶段枚举内」（校验本体未削弱）',
    res.ok === false && res.message.includes('不在阶段枚举内'))
}

check('T10-5 枚举总数 ≥ v2.0 基线（24）+新增 4', phaseValues.length >= 24,
  `v2.1 枚举 ${phaseValues.length} 项`)

writeResult()
