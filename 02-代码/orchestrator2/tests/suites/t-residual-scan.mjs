/**
 * T8（AC1/A2）· 残留扫描与人工标注清单（D8④）：
 * 扫描 v2.1 规范 / persona / 模板集 / 手册 中的**旧机制/旧件名**残留：
 *   03_验证审核、待验证、待代码审查、项目进度基线、过程记录/01_计划审核、
 *   过程记录/02_执行与自测记录、过程记录/04_代码审查
 * T9（R9/AC-TP2-11）· 追加**旧钉模型指纹**残留：k3-256k、kimi-for-coding
 *   （2026-09-26 用户裁决把审核员/开发员从 kimi 系改钉 volcengine/glm-5.3 与
 *   deepseek-official/deepseek-flash 后，旧指纹口径随之反转——glm-5.3 变为现钉，
 *   kimi-coding/k3-256k、kimi-for-coding 变为旧钉；与 config-check T3e 负断言同口径。
 *   注意 kimi-coding/k3 仍是调度员文档推荐现值，不在指纹内）。
 * 允许出现在：兼容性说明、§十三差异表、旧目录映射.md、命名沿革说明等**迁移语境**；
 * 其余逐条打印为「待人工标注」。
 *
 * 扫描范围界定（计划审核报告 §五-1）：只扫**目标代码区源码树的产品面**——
 *   spec v2.1 / agent.cordis.yml / preset.yml / docs/使用手册.md / README.md /
 *   lib/index.js / 模板集 / 归档区旧目录映射.md。
 * 以下三类**不计残留**（刻意不在扫描面内）：① tests/ 内断言字符串自身（负断言含旧 ID
 * 子串，属机器断言语境；注意 `-max` 拼接子串陷阱）；② 04-交付/ 历史构建包
 * （v2.0.0/v2.1.0/v2.1.1 含旧模型文案，按断点恢复决策保留不删，亦为禁区）；
 * ③ 03-开发协同/ 协同文档（非产品面）。
 * Run: node tests/suites/t-residual-scan.mjs
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'

import { ROOT, ORCH2, TPL } from '../lib/paths.mjs'
import { reporter } from '../lib/test-harness.mjs'

const { check, writeResult } = reporter('t-residual-scan')
const out = []

const PATTERNS = [
  ['旧验证环节名', /03_验证审核/],
  ['旧开发态 待验证', /待验证(?![方式])/],
  ['旧开发态 待代码审查', /待代码审查/],
  ['取消件 项目进度基线', /项目进度基线/],
  ['旧位 过程记录\/01_计划审核', /过程记录\/01_计划审核/],
  ['旧位 过程记录\/02_执行与自测记录', /过程记录\/02_执行与自测记录/],
  ['旧位 过程记录\/04_代码审查', /过程记录\/04_代码审查/],
  ['旧目录 历史记录\/', /历史记录\//],
  ['旧位 过程记录\/ 泛引', /过程记录\//],
  // T9/R9 → TP-D2-修复1 反转：旧钉模型指纹（新钉见 config-check T3e；此处专查产品面是否残留旧 ID）
  ['旧钉模型 k3-256k / kimi-for-coding', /k3-256k|kimi-for-coding/],
  ['旧模型 deepseek-v4-flash-vision-exp', /deepseek-v4-flash-vision-exp/],
]
const LEGACY_MODEL_PATTERNS = ['旧钉模型 k3-256k / kimi-for-coding', '旧模型 deepseek-v4-flash-vision-exp']
// ponytail: 白名单语境启发式（命中行含任一语境词即视为合规迁移语境）——天花板：词表驱动的
// 判定对新的合法/非法语境组合可能同时漏放与误放；升级路径：正式回归收编（04 记录 P1-⑥）时
// 改为「逐条人工标注表 + 强制人工确认」，白名单仅作预筛。
// 迁移/兼容语境白名单（命中行含其一即视为合规）
const ALLOWED_CONTEXT = [
  '兼容', '已作废', '旧名', '沿革', '迁移', '旧路径', '旧目录映射', '差异', 'v2.0', 'v1.1',
  '保留', '不再沿用', '取消', '旧项目', '旧布局', '旧式', '旧任务', '改名', '旧位',
  '并入', '扁平化', '取代',   // 「职责并入本文件」/「v2.1 扁平化后…」/「本文件取代 v2.0 的…」
  '备选',   // TP1-D6：审核员/开发员「备选：如需换回…」注释行按装机件逐字回源，旧模型名属回源语境非产品钉
]

const targets = []
targets.push(['spec v2.1', join(ORCH2, 'spec', '项目目录及协同开发规范-v2.1.md')])
targets.push(['persona', join(ORCH2, 'agent.cordis.yml')])
targets.push(['preset', join(ORCH2, 'preset.yml')])
targets.push(['手册', join(ORCH2, 'docs', '使用手册.md')])
// T9/R9 追加：源码产品面的另两处宣告点（README 为源码侧说明，lib 为宿主半体宣告文案）
targets.push(['README', join(ORCH2, 'README.md')])
targets.push(['lib/index.js', join(ORCH2, 'lib', 'index.js')])
// 归档区旧目录映射.md 是**迁移映射表本体**（规范第十四节/10 文档 §八 明确允许旧路径出现在此语境）
targets.push(['归档·旧目录映射', join(TPL, '90-历史归档', '旧目录映射.md')])
function walk(dir, prefix = '') {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${e.name}` : e.name
    if (e.isDirectory()) {
      if (rel === '90-历史归档') continue
      walk(join(dir, e.name), rel)
    } else targets.push([`tpl:${rel}`, join(dir, e.name)])
  }
}
walk(TPL)

const stats = new Map()
const pending = []
const annotated = []
for (const [label, path] of targets) {
  const lines = readFileSync(path, 'utf8').split('\n')
  lines.forEach((line, i) => {
    for (const [name, re] of PATTERNS) {
      if (!re.test(line)) continue
      const s = stats.get(name) || { total: 0, allowed: 0 }
      s.total++
      stats.set(name, s)
      const ruleHit = ALLOWED_CONTEXT.find((c) => line.includes(c))
      // 归档区旧目录映射.md = 迁移映射表本体（规范 §八/10 文档 §八 明确允许旧路径出现于本语境）
      const isMigrationTable = path.endsWith(join('90-历史归档', '旧目录映射.md'))
      const entry = `[${name}] ${relative(ROOT, path)}:${i + 1}  ${line.trim().slice(0, 110)}`
      if (ruleHit !== undefined || isMigrationTable) {
        s.allowed++
        annotated.push(`${entry}\n        合规依据：${ruleHit !== undefined ? `迁移/兼容语境词「${ruleHit}」` : '归档区迁移映射表本体（规范 §八 允许旧路径出现于本语境）'}`)
      } else {
        pending.push(entry)
      }
      break
    }
  })
}

out.unshift(`=== 残留扫描（文件 ${targets.length} 件）===`)
out.push('', '--- 逐模式统计（命中/合规迁移语境）---')
for (const [name] of PATTERNS) {
  const s = stats.get(name) || { total: 0, allowed: 0 }
  out.push(`  ${name}: 命中 ${s.total} 行，其中迁移语境 ${s.allowed} 行，待人工标注 ${s.total - s.allowed} 行`)
}
out.push('', '--- 逐条命中行（自动标注：迁移/兼容语境）---')
if (annotated.length === 0) out.push('  （无）')
else for (const a of annotated) out.push('  ' + a)
out.push('', '--- 待人工标注清单（无迁移语境词，须逐条人工判定）---')
if (pending.length === 0) out.push('  （无）')
else for (const p of pending) out.push('  ' + p)

check('AC1/A2-1 全部残留命中均落在迁移/兼容语境', pending.length === 0,
  pending.length ? `${pending.length} 行待人工标注（见上）` : '零待标注')
check('AC1/A2-2 扫描确有效（至少命中旧机制名，证明词表有效）',
  [...stats.values()].reduce((a, b) => a + b.total, 0) > 0,
  `总命中 ${[...stats.values()].reduce((a, b) => a + b.total, 0)} 行`)
const legacyTotal = LEGACY_MODEL_PATTERNS.reduce((a, n) => a + (stats.get(n)?.total ?? 0), 0)
const legacyPending = LEGACY_MODEL_PATTERNS.reduce((a, n) => a + ((stats.get(n)?.total ?? 0) - (stats.get(n)?.allowed ?? 0)), 0)
check('AC-TP2-11 源码产品面无旧模型指纹残留（除迁移/兼容语境）',
  legacyPending === 0, `命中 ${legacyTotal} 行，迁移语境外 ${legacyPending} 行`)

writeResult()
