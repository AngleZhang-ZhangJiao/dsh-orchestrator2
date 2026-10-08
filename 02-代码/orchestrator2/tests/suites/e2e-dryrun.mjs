/**
 * E2E dry-run (D6): fixture 干跑 + 回环验证。
 * - fixture-valid：用 D2 模板实例化的合法任务包（含预算台账.md、04/06 在设计目录
 *   上级的正确层级、06 含确认版本块）→ enter_auto_mode 校验接受（回环）
 * - 拒绝场景逐一（克隆变异：缺 04 / 缺 06 / 06 缺确认版本 / 当前阶段=执行中 /
 *   他包在跑 / 设计目录缺 01 或 02 / v2.0 缺预算台账或固定块不可解析 /
 *   04、06 误放设计目录内）
 * - fixture-legacy：旧式状态头（无设计目录字段）+ 仅 开发计划/01、02 → 接受
 * 输出全部入 03 记录。Run: node tests/suites/e2e-dryrun.mjs
 */
import { rmSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { FX, PHASE_GATE, SCENARIO_UTILS } from '../lib/paths.mjs'
import { reporter } from '../lib/test-harness.mjs'

const { check, writeResult } = reporter('e2e-dryrun')
const lines = []

const { validateAutoMode } = await import(PHASE_GATE)
const { TASK_REL, scenario, write, PRODUCT, DESIGNTASK } = await import(SCENARIO_UTILS)

function run(label, rootDir, taskRel) {
  const r = validateAutoMode(rootDir, taskRel)
  lines.push(`--- [${label}] ok=${r.ok}${r.ok ? '' : ` message=${r.message}`}`)
  return r
}

console.log('=== D6 e2e fixture 干跑 ===')

// 1) fixture-valid：接受（回环）
const r1 = run('fixture-valid 合法包（接受）', join(FX, 'fixture-valid'), TASK_REL)
check('① fixture-valid 接受（四句校验+分支判定+预算保险丝+单包校验）', r1.ok === true)

// 回环验证：fixture 任务包来自 D2 模板实例化
const f01 = readFileSync(join(FX, 'fixture-valid', '01-设计', '玩具项目', '任务包', 'TP1-玩具功能', '01_需求分析.md'), 'utf8')
const f02 = readFileSync(join(FX, 'fixture-valid', '01-设计', '玩具项目', '任务包', 'TP1-玩具功能', '02_开发方案与任务包.md'), 'utf8')
check(
  '回环：fixture 01/02 由 D2 模板实例化（模板专有标记行存在 + 占位符已替换）',
  f01.includes('## 三、验收标准（逐条可测试）') && f01.includes('【交接块】') &&
  f02.includes('## 九、预算块') && f02.includes('【预算块】') && f02.includes('## 六、追踪矩阵') &&
  !f01.includes('<TP编号>') && !f02.includes('<TP编号>') && !f02.includes('<产品任务>'),
)

// 2) 拒绝场景
let r
const cases = [
  ['缺 04', (d) => rmSync(join(PRODUCT(d), '04_产品设计方案.md')), '04_产品设计方案.md'],
  ['缺 06', (d) => rmSync(join(PRODUCT(d), '06_设计定稿记录.md')), '06_设计定稿记录.md'],
  ['06 缺确认版本', (d) => write(join(PRODUCT(d), '06_设计定稿记录.md'), '# 06（无固定块）\n'), '确认版本'],
  ['当前阶段=执行中', (d) => {
    const p = join(d, '03-开发协同', 'TP1-玩具功能', '状态.md')
    write(p, readFileSync(p, 'utf8').replace('当前阶段：待审核', '当前阶段：执行中'))
  }, '而非「待审核」'],
  ['他包在跑', (d) => {
    write(join(d, '03-开发协同', 'TP7-在跑', '状态.md'), `当前阶段：执行中\n当前环节负责方：模型C\n任务类型：大任务\n规范版本：v2.1\n本环节驳回轮次：0\n候选commit：无\n下一步：执行\n必读文件：无\n最近更新：2026-09-07 00:00\n阻塞/待办：无\n`)
    write(join(d, '03-开发协同', 'TP7-在跑', '预算台账.md'), `任务包：TP7-在跑\n上限：C运行≤4 / B运行≤4 / 工作轮≤24\n当前累计：C运行=0 / B运行=0 / 工作轮=0 / token用量=—\n最近更新：2026-09-07 00:00\n`)
  }, '单包串行铁则'],
  ['设计目录下缺 01', (d) => rmSync(join(DESIGNTASK(d), '01_需求分析.md')), '01_需求分析.md'],
  ['设计目录下缺 02', (d) => rmSync(join(DESIGNTASK(d), '02_开发方案与任务包.md')), '02_开发方案与任务包.md'],
  ['缺预算台账', (d) => rmSync(join(d, '03-开发协同', 'TP1-玩具功能', '预算台账.md')), '预算台账'],
  ['预算台账固定块不可解析', (d) => write(join(d, '03-开发协同', 'TP1-玩具功能', '预算台账.md'), '任务包：TP（不完整）\n'), '不可解析'],
  ['04/06 误放设计目录内', (d) => {
    write(join(DESIGNTASK(d), '04_产品设计方案.md'), readFileSync(join(PRODUCT(d), '04_产品设计方案.md'), 'utf8'))
    write(join(DESIGNTASK(d), '06_设计定稿记录.md'), readFileSync(join(PRODUCT(d), '06_设计定稿记录.md'), 'utf8'))
    rmSync(join(PRODUCT(d), '04_产品设计方案.md'))
    rmSync(join(PRODUCT(d), '06_设计定稿记录.md'))
  }, '应放在设计目录的上级产品任务目录'],
]
for (const [label, mutate, expect] of cases) {
  r = run(label, scenario(`e2e-${label}`, mutate), TASK_REL)
  check(`${label} 拒绝`, r.ok === false && r.message.includes(expect))
}

// 3) fixture-legacy（v1.1 旧式状态头）→ M4 起显式拒绝（不再由缺设计目录推断版本）
const r3 = run('fixture-legacy 旧式状态头', join(FX, 'fixture-legacy'), '03-开发协同/TL1-旧任务')
check('legacy(v1.1) 拒绝且点名改用 1.0 预设',
  r3.ok === false && r3.message.includes('v1.1') && r3.message.includes('1.0 预设'))

writeResult()
