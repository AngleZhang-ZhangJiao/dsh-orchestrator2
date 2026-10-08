/**
 * T7（AC9）· 费用词扫描（D8③）：
 * 扫描 v2.1 规范 / 模板集 / persona / 手册 中的费用类词（费用|价格|单价|花费|计费|付费），
 * 逐行打印命中（文件:行 + 上下文）供人工标注「为何合规（否定表述）」。
 * 自动判定：命中行必须落在**否定/排除语境**（不统计费用 / 无费用 / 不含价格 / 不按量付费 …），
 * 否则判 FAIL（需人工确认后修正）。
 * Run: node tests/suites/t-cost-scan.mjs
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'

import { ROOT, ORCH2, TPL } from '../lib/paths.mjs'
import { reporter } from '../lib/test-harness.mjs'

const { check, writeResult } = reporter('t-cost-scan')
const out = []

const WORD = /费用|价格|单价|花费|计费|付费/
// 允许的否定/排除语境（命中行含其一即视为合规）
const NEGATORS = [
  '不统计费用', '不含任何价格', '不含价格', '无费用概念', '无费用项', '不按量付费',
  '不出现费用', '不出现费用、价格', '费用概念整体移除', '不作金额换算', '（无费用项',
  '无价格内容',   // 索引行「默认预算档（无价格内容）」
  '费用、价格、折算', // 「本文件与台账/预算块不出现费用、价格、折算」
]

const targets = []
targets.push(['spec/项目目录及协同开发规范-v2.1.md', join(ORCH2, 'spec', '项目目录及协同开发规范-v2.1.md')])
targets.push(['agent.cordis.yml', join(ORCH2, 'agent.cordis.yml')])
targets.push(['preset.yml', join(ORCH2, 'preset.yml')])
targets.push(['docs/使用手册.md', join(ORCH2, 'docs', '使用手册.md')])
function walk(dir, prefix = '') {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${e.name}` : e.name
    if (e.isDirectory()) walk(join(dir, e.name), rel)
    else targets.push([`spec/templates/${rel}`, join(dir, e.name)])
  }
}
walk(TPL)

let totalHits = 0
const badHits = []
for (const [label, path] of targets) {
  const lines = readFileSync(path, 'utf8').split('\n')
  lines.forEach((line, i) => {
    if (!WORD.test(line)) return
    totalHits++
    const ok = NEGATORS.some((n) => line.includes(n))
    const entry = `${relative(ROOT, path)}:${i + 1}  ${ok ? '合规(否定表述)' : '待人工标注'}  ${line.trim().slice(0, 110)}`
    out.push('    ' + entry)
    if (!ok) badHits.push(entry)
  })
}

out.unshift(`=== 费用词扫描（文件 ${targets.length} 件）===`)
check('AC9-1 费用词命中全部落在否定/排除语境', badHits.length === 0,
  badHits.length ? `${badHits.length} 行需人工标注：见下` : `命中 ${totalHits} 行，均合规`)
check('AC9-2 命中数 > 0（确有否定表述存在，非空扫）', totalHits > 0, `命中 ${totalHits} 行`)

writeResult()
