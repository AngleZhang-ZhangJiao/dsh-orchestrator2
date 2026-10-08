/**
 * T4 mock 单测：AC5 所列 12 场景 + 附加断言逐一断言并打印结果。
 * - 场景①~⑦⑪⑫+附加：以 fixture-valid 克隆变异，driver = 真实 validateAutoMode
 * - 场景⑧：MAX_GOAL_ROUNDS 与目标创建参数 = 24
 * - 场景⑨⑩：mock ctx 驱动真实 apply()（create→pause→(idle)compactNow→resume 编排）
 * Run: node tests/suites/phase-gate-mock.test.mjs
 */
import { rmSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { FX, PHASE_GATE, SCENARIO_UTILS } from '../lib/paths.mjs'
import { reporter } from '../lib/test-harness.mjs'

const { check, writeResult } = reporter('phase-gate-mock.test')
const lines = []

const { validateAutoMode, MAX_GOAL_ROUNDS, apply } = await import(
  PHASE_GATE
)
const { TASK_REL, scenario, write, PRODUCT, DESIGNTASK } = await import(
  SCENARIO_UTILS
)

function run(label, rootDir, taskRel) {
  const r = validateAutoMode(rootDir, taskRel)
  lines.push(`--- [${label}] ok=${r.ok}${r.ok ? '' : ` message=${r.message}`}`)
  return r
}

console.log('=== T4 phase-gate mock 单测（AC5 12 场景 + 附加） ===')

// ① v2.0 合法包接受（fixture 含预算台账、04/06 在设计目录上级、06 含确认版本）
let r = run('① v2.0 合法包', join(FX, 'fixture-valid'), TASK_REL)
check('① 接受', r.ok === true)

// ② 缺 04
r = run('② 缺 04', scenario('t4-missing-04', (d) => rmSync(join(PRODUCT(d), '04_产品设计方案.md'))), TASK_REL)
check('② 拒绝', r.ok === false && r.message.includes('04_产品设计方案.md'))

// ③ 缺 06
r = run('③ 缺 06', scenario('t4-missing-06', (d) => rmSync(join(PRODUCT(d), '06_设计定稿记录.md'))), TASK_REL)
check('③ 拒绝', r.ok === false && r.message.includes('06_设计定稿记录.md'))

// ④ 06 缺确认版本
r = run('④ 06 缺确认版本', scenario('t4-no-version', (d) => write(join(PRODUCT(d), '06_设计定稿记录.md'), '# 06（无固定块）\n')), TASK_REL)
check('④ 拒绝', r.ok === false && r.message.includes('确认版本'))

// ⑤ 当前阶段≠待审核（执行中）
r = run('⑤ 当前阶段=执行中', scenario('t4-phase-exec', (d) => {
  const p = join(d, '03-开发协同', 'TP1-玩具功能', '状态.md')
  write(p, readFileSync(p, 'utf8').replace('当前阶段：待审核', '当前阶段：执行中'))
}), TASK_REL)
check('⑤ 拒绝', r.ok === false && r.message.includes('「执行中」而非「待审核」'))

// ⑥ 他包在跑（单包校验，排除自身）
r = run('⑥ 他包在跑', scenario('t4-other-running', (d) => write(join(d, '03-开发协同', 'TP4-在跑', '状态.md'), `当前阶段：执行中\n当前环节负责方：模型C\n任务类型：大任务\n规范版本：v2.1\n本环节驳回轮次：0\n候选commit：无\n下一步：执行\n必读文件：无\n最近更新：2026-09-07 00:00\n阻塞/待办：无\n`)), TASK_REL)
check('⑥ 拒绝', r.ok === false && r.message.includes('单包串行铁则') && r.message.includes('TP4-在跑'))

// ⑦ v1.1 旧式状态头 → M4 起显式拒绝（不再由「缺设计目录」推断版本；旧项目改用 1.0 预设）
r = run('⑦ legacy(v1.1) 拒绝', join(FX, 'fixture-legacy'), '03-开发协同/TL1-旧任务')
check('⑦ 拒绝且点名改用 1.0 预设', r.ok === false && r.message.includes('1.0 预设') && r.message.includes('v1.1'))

// ⑧ maxGoalRounds=24
check('⑧ MAX_GOAL_ROUNDS=24', MAX_GOAL_ROUNDS === 24, `实际=${MAX_GOAL_ROUNDS}`)

// ⑨ 调用序 create→pause→compactNow→resume 且 resume 用 pause 的 revision
// ⑩ compactNow 抛错仍 resume
{
  function makeMockCtx() {
    const state = { create: null, pause: null, resume: null, compact: [], warns: [], tool: null, disposed: false, statusHandler: null }
    let cleanup = null
    const ctx = {
      goals: {
        create: (agent, opts) => { state.create = { agent, opts }; return { id: 'g1', revision: 1 } },
        pause: (agent, ref) => { state.pause = { agent, ref }; return { id: 'g1', revision: 2 } },
        resume: (agent, ref) => { state.resume = { agent, ref }; return {} },
      },
      compaction: {
        compactNow: (agent, signal) => {
          state.compact.push({ agent, signal })
          if (state.compactShouldThrow) throw new Error('compact exploded')
        },
      },
      logger: { warn: (...args) => state.warns.push(args) },
      on: (event, handler) => { if (event === 'agent/status') state.statusHandler = handler },
      effect: (fn) => { cleanup = fn() },
      tools: {
        register: (def) => {
          state.tool = def
          return () => { state.disposed = true }
        },
      },
    }
    return { ctx, state, cleanup: () => { const fn = cleanup; cleanup = null; if (fn) fn() } }
  }

  const wait = (ms = 50) => new Promise((r2) => setTimeout(r2, ms))

  // ⑨
  {
    const { ctx, state, cleanup } = makeMockCtx()
    apply(ctx)
    const agent = { id: 'a1', session: { header: { cwd: join(FX, 'fixture-valid') } } }
    const out = await state.tool.execute({ taskDir: TASK_REL }, { agent })
    check('⑨a execute 成功返回（ok + goalId）', out.ok === true && typeof out.goalId === 'string')
    check('⑨b create 用 maxGoalRounds=24', state.create?.opts?.maxGoalRounds === 24)
    check('⑨c create 后立即 pause（pause ref = create 的 revision 1）', state.pause?.ref?.id === 'g1' && state.pause?.ref?.revision === 1)
    state.statusHandler({ agent, status: 'idle' })
    await wait()
    check('⑨d compactNow 已调用', state.compact.length === 1)
    check('⑨e resume 用 pause 的 revision 2（非 create 的 1）', state.resume?.ref?.id === 'g1' && state.resume?.ref?.revision === 2)
    check('⑨f 调用序 create→pause→compactNow→resume', state.resume !== null && state.compact.length === 1 && state.pause !== null && state.create !== null)
    cleanup()
    check('⑨g 卸载可清理（tool disposed）', state.disposed === true)
  }

  // ⑩
  {
    const { ctx, state } = makeMockCtx()
    state.compactShouldThrow = true
    apply(ctx)
    const agent = { id: 'a1', session: { header: { cwd: join(FX, 'fixture-valid') } } }
    const out = await state.tool.execute({ taskDir: TASK_REL }, { agent })
    check('⑩a execute 成功（校验通过）', out.ok === true)
    state.statusHandler({ agent, status: 'idle' })
    await wait()
    check('⑩b compactNow 抛错后仍 resume（用 pause 的 revision 2）', state.resume?.ref?.revision === 2)
    check('⑩c 抛错被记录日志（降级为压力压缩）', state.warns.some((w) => String(w[0]).includes('compact exploded')))
  }
}

// ⑪ 设计目录下缺 01 或 02
r = run('⑪a 缺 01', scenario('t4-missing-d01', (d) => rmSync(join(DESIGNTASK(d), '01_需求分析.md'))), TASK_REL)
check('⑪a 拒绝', r.ok === false && r.message.includes('01_需求分析.md'))
r = run('⑪b 缺 02', scenario('t4-missing-d02', (d) => rmSync(join(DESIGNTASK(d), '02_开发方案与任务包.md'))), TASK_REL)
check('⑪b 拒绝', r.ok === false && r.message.includes('02_开发方案与任务包.md'))

// ⑫ v2.0 路径缺预算台账或固定块不可解析（legacy 路径同条件豁免见 ⑦）
r = run('⑫a 缺预算台账', scenario('t4-no-ledger', (d) => rmSync(join(d, '03-开发协同', 'TP1-玩具功能', '预算台账.md'))), TASK_REL)
check('⑫a 拒绝', r.ok === false && r.message.includes('预算台账'))
r = run('⑫b 台账固定块不可解析', scenario('t4-bad-ledger', (d) => write(join(d, '03-开发协同', 'TP1-玩具功能', '预算台账.md'), '任务包：TP（不完整）\n')), TASK_REL)
check('⑫b 拒绝', r.ok === false && r.message.includes('不可解析'))

// ⑬ 开发准备门禁（TP1-首次使用引导 · D2/D3）：三态拒绝 + 齐备放行（AC2-①②③）
const PREP_REL = ['00-项目管理', '开发准备.md']
const prepMissingDir = scenario('t4-no-devprep', (d) => rmSync(join(d, ...PREP_REL)))
r = run('⑬a 无开发准备记录', prepMissingDir, TASK_REL)
check('⑬a 拒绝且信息含缺失路径与引导语',
  r.ok === false && r.message.includes('开发准备门禁') && r.message.includes('开发准备.md') &&
  r.message.includes('请先完成开发准备') && r.message.includes(prepMissingDir))
r = run('⑬b 固定块缺字段（删「未通过项」行）', scenario('t4-devprep-missing-field', (d) => {
  const p = join(d, ...PREP_REL)
  write(p, readFileSync(p, 'utf8').split('\n').filter((l) => !l.startsWith('未通过项：')).join('\n'))
}), TASK_REL)
check('⑬b 拒绝且列出缺字段', r.ok === false && r.message.includes('缺少字段') && r.message.includes('未通过项'))
r = run('⑬c 未通过项>0', scenario('t4-devprep-failed', (d) => {
  const p = join(d, ...PREP_REL)
  write(p, readFileSync(p, 'utf8').replace('未通过项：0', '未通过项：2'))
}), TASK_REL)
check('⑬c 拒绝且写明未通过项=N 与记录路径',
  r.ok === false && r.message.includes('未通过项=2') && r.message.includes('开发准备.md'))
r = run('⑬d 最近复查非日期（占位 —）', scenario('t4-devprep-bad-date', (d) => {
  const p = join(d, ...PREP_REL)
  write(p, readFileSync(p, 'utf8').replace('最近复查：2026-09-07', '最近复查：—'))
}), TASK_REL)
check('⑬d 拒绝且点名「最近复查」与日期形态',
  r.ok === false && r.message.includes('最近复查') && r.message.includes('YYYY-MM-DD'))
r = run('⑬e 齐备记录（既有校验全过）', scenario('t4-devprep-clean', () => {}), TASK_REL)
check('⑬e 放行（五字段齐备 ∧ 必要项≥1 ∧ 未通过项=0 ∧ 最近复查为日期）', r.ok === true)

// 附加：04/06 误放设计目录内应拒（防错误层级固化）
r = run('附加 04/06 误放设计目录内', scenario('t4-misplaced', (d) => {
  write(join(DESIGNTASK(d), '04_产品设计方案.md'), readFileSync(join(PRODUCT(d), '04_产品设计方案.md'), 'utf8'))
  write(join(DESIGNTASK(d), '06_设计定稿记录.md'), readFileSync(join(PRODUCT(d), '06_设计定稿记录.md'), 'utf8'))
  rmSync(join(PRODUCT(d), '04_产品设计方案.md'))
  rmSync(join(PRODUCT(d), '06_设计定稿记录.md'))
}), TASK_REL)
check('附加 拒绝', r.ok === false && r.message.includes('04_产品设计方案.md'))

writeResult()
