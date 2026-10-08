/**
 * 开发期回归总入口（M6 收编）。
 *
 * 顺序执行「夹具重建 → T9 基线采集 → 生成器校验 → 断言套件 → e2e 干跑」，逐件透传
 * 退出码，最后汇总「逐件 PASS/FAIL 明细 + 断言合计」。任一失败 → 自身退出码 1
 * （供构建前门槛 / CI）。
 *
 * 用法：
 *   node 02-代码/orchestrator2/tests/run-all.mjs              # 全跑（含夹具重建与基线采集）
 *   node 02-代码/orchestrator2/tests/run-all.mjs --no-fixture # 跳过夹具重建（已就位时）
 *   node 02-代码/orchestrator2/tests/run-all.mjs --log         # 汇总写 tests/.cache/run-log-*.txt
 *
 * 分级（规范 §三 开发期回归）：
 *   构建前必跑 —— 本入口全跑；断言套件 20 个（含 T3-TP1 新增四件：route-config /
 *   session-routes / role-tools / route-fallback，含生成器校验与 T9 blob 比对）。
 *   按需（fixture 类）—— e2e-dryrun.mjs（enter_auto_mode 全路径矩阵干跑）。
 *
 * 断言总数口径（E-d 量化陈述须可复算）：每个套件经 lib/test-harness.mjs 落
 * `tests/.cache/results/<suite>.json`，本入口读该文件求合计并逐件打印 —— 汇总行数字是
 * 逐件实测相加，不是估计值；人读的 PASS/FAIL 明细继承到本进程 stdout。
 */

import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, join, relative } from 'node:path'
import { CACHE, ORCH2, ROOT, TEST_DIR } from './lib/paths.mjs'

const argv = process.argv.slice(2)
const SKIP_FIXTURE = argv.includes('--no-fixture')
const WANT_LOG = argv.includes('--log')

/** 套件清单（顺序固定：夹具重建 → 基线采集 → 生成器 → 静态断言 → fixture 类）。
 *  `fixture: true` → 受 --no-fixture 控制；`noAsserts: true` → 准备性步骤（只报退出码，不参与断言合计）。 */
const STEPS = [
  { name: 'build-fixture（夹具重建）', path: join(TEST_DIR, 'fixtures', 'build-fixture.mjs'), fixture: true, noAsserts: true },
  { name: 't9-dump-bom（T9 基线数据采集，pwsh）', path: join(TEST_DIR, 'fixtures', 't9-dump-bom.mjs'), noAsserts: true },
  { name: 'build-v21-spec --check（生成器逐字节校验）', path: join(TEST_DIR, 'suites', 'build-v21-spec.mjs'), args: ['--check', join(ORCH2, 'spec', '项目目录及协同开发规范-v2.1.md')], noAsserts: true },
  { name: 't-spec-scan（规范文本）', path: join(TEST_DIR, 'suites', 't-spec-scan.mjs') },
  { name: 't-templates（模板索引双向）', path: join(TEST_DIR, 'suites', 't-templates.mjs') },
  { name: 't2-persona（persona 判据）', path: join(TEST_DIR, 'suites', 't2-persona.mjs') },
  { name: 'config-check（yml 结构 + 钉模型）', path: join(TEST_DIR, 'suites', 'config-check.mjs') },
  { name: 't-cost-scan（无费用概念）', path: join(TEST_DIR, 'suites', 't-cost-scan.mjs') },
  { name: 't-residual-scan（旧名残留）', path: join(TEST_DIR, 'suites', 't-residual-scan.mjs') },
  { name: 't-scenario1（场景1）', path: join(TEST_DIR, 'suites', 't-scenario1.mjs') },
  { name: 't-scenario2（场景2）', path: join(TEST_DIR, 'suites', 't-scenario2.mjs') },
  { name: 't10-enum-cases（枚举 + 拒绝矩阵）', path: join(TEST_DIR, 'suites', 't10-enum-cases.mjs') },
  { name: 'budget-mock（budget.mjs 单测）', path: join(TEST_DIR, 'suites', 'budget-mock.test.mjs') },
  { name: 'phase-gate-mock（phase-gate 单测）', path: join(TEST_DIR, 'suites', 'phase-gate-mock.test.mjs') },
  { name: 'route-config（T3-TP1 · D1 持久路由配置）', path: join(TEST_DIR, 'suites', 'route-config.test.mjs') },
  { name: 'session-routes（T3-TP1 · D2 会话状态与路由解析）', path: join(TEST_DIR, 'suites', 'session-routes.test.mjs') },
  { name: 'role-tools（T3-TP1 · D3/D5 派工与设置工具）', path: join(TEST_DIR, 'suites', 'role-tools.test.mjs') },
  { name: 'route-fallback（T3-TP1 · D4 故障降级 hook + G1 次序闸门）', path: join(TEST_DIR, 'suites', 'route-fallback.test.mjs') },
  { name: 't9-verify（1.0 零触碰 blob 比对）', path: join(TEST_DIR, 'suites', 't9-verify.mjs') },
  { name: 'pkg-consistency（插件包材料就绪）', path: join(TEST_DIR, 'suites', 'pkg-consistency.mjs') },
  { name: 'e2e-dryrun（fixture 干跑矩阵）', path: join(TEST_DIR, 'suites', 'e2e-dryrun.mjs'), fixture: true },
  { name: 'v2-mechanisms（M1~M6 机制矩阵：T2-TP2 新增）', path: join(TEST_DIR, 'suites', 'v2-mechanisms.test.mjs') },
  { name: 't11-fault-injection（TP-B · 故障注入五项 + 六态结算）', path: join(TEST_DIR, 'suites', 't11-fault-injection.mjs') },
]

const rows = []

for (const step of STEPS) {
  if (step.fixture && SKIP_FIXTURE) {
    rows.push({ name: step.name, exit: null, pass: null, fail: null, note: '跳过（--no-fixture）' })
    continue
  }
  const rel = relative(ROOT, step.path).replace(/\\/g, '/')
  if (!existsSync(step.path)) {
    rows.push({ name: step.name, exit: 127, pass: null, fail: null, note: '文件缺失：' + rel, noAsserts: step.noAsserts })
    continue
  }
  process.stdout.write(`\n===== ${step.name} =====\n`)
  // 说明：子进程输出**不捕获**（stdio: 'inherit'）。本项目的执行环境（DSH 文件沙箱
  // workspace-write）禁止子进程经管道回传输出 —— 实测 `spawnSync(node, [...], {stdio:'pipe'})`
  // → `EPERM: spawnSync ... EPERM`，而 inherit 正常。故断言结果的机读通道 = 各套件经
  // lib/test-harness.mjs 写出的 tests/.cache/results/<suite>.json（run-all 直接读文件），
  // 人读通道 = 继承到本进程 stdout 的 PASS/FAIL 明细。
  const result = spawnSync(process.execPath, [step.path, ...(step.args ?? [])], {
    cwd: ROOT,
    stdio: 'inherit',
    shell: false,
  })
  if (result.error) {
    rows.push({ name: step.name, exit: -1, pass: null, fail: null, note: `spawn 失败：${result.error.code ?? result.error.message}` })
    continue
  }
  const json = readSuiteResult(step)
  rows.push({
    name: step.name,
    exit: result.status,
    pass: json ? json.pass : null,
    fail: json ? json.fail : null,
    noAsserts: step.noAsserts === true,
  })
}

/** 读套件经 test-harness 落盘的结果 JSON（机读通道）。 */
function readSuiteResult(step) {
  const suite = basename(step.path).replace(/\.mjs$/, '')
  const path = join(CACHE, 'results', `${suite}.json`)
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return undefined
  }
}

// ── 汇总（数字全部来自逐件实测解析，可复算）───────────────────────────────
const lines = []
lines.push('', '='.repeat(72), '开发期回归汇总（逐件实测）', '='.repeat(72))
let totalPass = 0
let totalFail = 0
let ran = 0
let broken = 0
for (const r of rows) {
  if (r.exit === null) {
    lines.push(`  SKIP  ${r.name}`)
    continue
  }
  ran++
  // 准备性步骤（夹具重建 / 基线采集）：只报退出码，不参与断言合计
  if (r.noAsserts === true) {
    if (r.exit !== 0) broken++
    lines.push(`  ${r.exit === 0 ? 'OK  ' : 'FAIL'}  ${r.name}  （准备性步骤，exit=${r.exit}${r.note ? `；${r.note}` : ''}）`)
    continue
  }
  if (r.pass === null) {
    broken++
    lines.push(`  FAIL  ${r.name}  （无结果 JSON；exit=${r.exit}${r.note ? `；${r.note}` : ''}）`)
    continue
  }
  totalPass += r.pass
  totalFail += r.fail
  if (r.exit !== 0 || r.fail > 0) lines.push(`  FAIL  ${r.name}  pass=${r.pass} fail=${r.fail} exit=${r.exit}`)
  else lines.push(`  PASS  ${r.name}  pass=${r.pass}`)
}
lines.push('-'.repeat(72))
lines.push(`  步骤执行：${ran} 件（其中异常 ${broken} 件）｜ 断言合计：pass=${totalPass} fail=${totalFail}`)
const ok = totalFail === 0 && broken === 0 && rows.every((r) => r.exit === 0 || r.exit === null)
lines.push(`  结论：${ok ? '全绿' : '有失败'}（回归门槛：全部断言套件 fail=0 且准备性步骤 exit=0）`)
console.log(lines.join('\n'))

if (WANT_LOG) {
  mkdirSync(CACHE, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const logPath = join(CACHE, `run-log-${stamp}.txt`)
  writeFileSync(logPath, [...lines, '', '（子进程输出继承到 stdout，见终端/会话记录）'].join('\n'), 'utf8')
  console.log(`\n汇总日志：${logPath}`)
}

if (!ok) process.exitCode = 1
