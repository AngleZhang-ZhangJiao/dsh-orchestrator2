/**
 * T4（AC8）· 场景2「技术调研储备」干跑断言（D7）：
 * ① 调研报告模板含「技术路线对比矩阵」「同类拓展候选」两小节；
 * ② `04_调研汇总报告.md` 模板存在且四要素齐备（对比矩阵汇总/推荐/未解决问题/报告索引）；
 * ③ 调研清单模板泛化（对象化表头 + 拓展来源列 + 双场景用法注明）；
 * ④ `方向确认中`/`清单待确认` 在 PHASE_VALUES 且 validateAutoMode 对 fixture 拒绝并报当前阶段非待审核；
 * ⑤ TR fixture（流程类型=技术调研储备）固定块可解析。
 * Run: node tests/suites/t-scenario2.mjs
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { ROOT, ORCH2, TPL, PHASE_GATE, SCENARIO_UTILS } from '../lib/paths.mjs'
import { reporter } from '../lib/test-harness.mjs'

const { check, writeResult } = reporter('t-scenario2')
const lines = []

const { validateAutoMode } = await import(PHASE_GATE)
const { TASK_REL, scenario, write } = await import(
  SCENARIO_UTILS
)

// PHASE_VALUES（模块内 const，未导出 → 正则取数组体）
const gateSrc = readFileSync(join(ORCH2, 'phase-gate.mjs'), 'utf8')
const arrMatch = gateSrc.match(/const PHASE_VALUES = \[([\s\S]*?)\n\]/)
const phaseValues = arrMatch === null ? [] : [...arrMatch[1].matchAll(/'([^']+)'/g)].map((m) => m[1])

// ── ① 调研报告模板两小节 ──────────────────────────────────────────────────
const report = readFileSync(join(TPL, '01-设计', '03_调研报告', '调研报告模板.md'), 'utf8')
check('D7-1a 含「技术路线对比矩阵」小节', report.includes('技术路线对比矩阵'))
check('D7-1b 含「同类拓展候选」小节', report.includes('同类拓展候选'))
check('D7-1c 对比矩阵六维度齐备',
  ['适用场景', '成熟度', '社区与维护', 'License 与复用风险', '接入成本', '与本主题契合度'].every((d) => report.includes(d)))
check('D7-1d 标注场景2 必填 / 产品调研选填', report.includes('场景2 必填') && report.includes('选填'))

// ── ② 调研汇总报告模板四要素 ──────────────────────────────────────────────
const summaryPath = join(TPL, '01-设计', '技术调研', '04_调研汇总报告.md')
let summary = ''
try {
  summary = readFileSync(summaryPath, 'utf8')
  check('D7-2a 04_调研汇总报告.md 模板存在', true, summaryPath.replace(ROOT, ''))
} catch {
  check('D7-2a 04_调研汇总报告.md 模板存在', false, '文件缺失')
}
const four = [
  ['对比矩阵汇总', '对比矩阵汇总'],
  ['分场景推荐', '分场景推荐'],
  ['未解决问题', '未解决问题'],
  ['各对象报告索引', '报告索引'],
]
const missFour = four.filter(([, n]) => !summary.includes(n)).map(([l]) => l)
check('D7-2b 四要素齐备（对比矩阵汇总/推荐/未解决问题/报告索引）', missFour.length === 0,
  missFour.length ? `缺：${missFour.join(' / ')}` : '四要素全中')
check('D7-2c 含当面向用户汇报记录段', summary.includes('汇报记录'))
check('D7-2d 含封闭性声明（不生成任务包）', summary.includes('不生成任务包'))

// ── ③ 调研清单泛化 ────────────────────────────────────────────────────────
const list = readFileSync(join(TPL, '01-设计', '02_同类产品调研清单.md'), 'utf8')
check('D7-3a 表头对象化（调研对象）', list.includes('调研对象'))
check('D7-3b 含「拓展来源」列', list.includes('拓展来源'))
check('D7-3c 双场景用法注明（产品调研 / 技术调研储备）',
  list.includes('场景·新产品开发') && list.includes('场景2·技术调研储备'))
check('D7-3d 含逐批拓展机制（建议规模与理由）', list.includes('建议规模与理由'))

// ── ④ 枚举 + fixture 拒绝（两态）──────────────────────────────────────────
for (const phase of ['方向确认中', '清单待确认']) {
  check(`D7-4a \`${phase}\` 在 PHASE_VALUES`, phaseValues.includes(phase), `枚举 ${phaseValues.length} 项`)
  const dir = scenario(`t-scenario2-${phase}`, (d) => {
    const p = join(d, '03-开发协同', 'TP1-玩具功能', '状态.md')
    write(p, readFileSync(p, 'utf8').replace('当前阶段：待审核', `当前阶段：${phase}`))
  })
  const r = validateAutoMode(dir, TASK_REL)
  lines.push(`--- [场景2 fixture ${phase}] ok=${r.ok}${r.ok ? '' : ` message=${r.message}`}`)
  check(`D7-4b ${phase} fixture 被 enter_auto_mode 拒绝`, r.ok === false)
  check(`D7-4c ${phase} 拒绝原因报「当前阶段为「${phase}」而非「待审核」」`,
    r.ok === false && r.message.includes(`「${phase}」而非「待审核」`))
}

// ── ⑤ TR fixture（流程类型=技术调研储备）固定块可解析 ─────────────────────
// 复用 e2e 固定块解析口径：与 phase-gate.parseFixedBlock 同规则的最小实现
// （phase-gate 仅导出 validateAutoMode，parseFixedBlock 为模块内私有）。
function parseFixedBlock(text) {
  const fields = new Map()
  const ls = String(text).split(/\r\n|\r|\n/)
  let i = 0
  while (i < ls.length && ls[i].trim() === '') i++
  while (i < ls.length && ls[i].trim() === '---') i++
  for (; i < ls.length; i++) {
    const line = ls[i].trimEnd()
    if (line.length === 0) break
    if (line.trim() === '---') break
    const sep = line.indexOf('：')
    if (sep <= 0) break
    const key = line.slice(0, sep).trim()
    const val = line.slice(sep + 1).trim()
    if (key.length === 0 || fields.has(key)) break
    fields.set(key, val)
  }
  return fields
}
const trDir = scenario('t-scenario2-TR', (d) => {
  write(join(d, '03-开发协同', 'TR1-同步框架', '状态.md'), [
    '当前阶段：方向确认中',
    '当前环节负责方：调度员',
    '任务类型：小任务',
    '流程类型：技术调研储备',
    '设计目录：01-设计/技术调研/同步框架',
    '本环节驳回轮次：0',
    '候选commit：无',
    '下一步：用户确认方向 → 拟首批清单',
    '必读文件：01-设计/技术调研/同步框架/01_调研方向确认.md',
    '最近更新：2026-09-14 12:00',
    '阻塞/待办：无',
    '',
  ].join('\n'))
})
const trFields = parseFixedBlock(readFileSync(join(trDir, '03-开发协同', 'TR1-同步框架', '状态.md'), 'utf8'))
check('D7-5a TR fixture 固定块可解析', trFields.size > 0, `字段数=${trFields.size}`)
check('D7-5b 流程类型=技术调研储备', trFields.get('流程类型') === '技术调研储备', `实际=${trFields.get('流程类型')}`)
check('D7-5c 设计目录指向 01-设计/技术调研/<主题>',
  (trFields.get('设计目录') || '').startsWith('01-设计/技术调研/'), `实际=${trFields.get('设计目录')}`)
check('D7-5d 状态头无预算计数字段',
  ![...trFields.keys()].some((k) => /C运行|B运行|工作轮|预算/.test(k)), `字段=${[...trFields.keys()].join('/')}`)
// 场景2 不建 goal：TR fixture 即便阶段=待审核也不应产生开发流水线（此处只断言模板口径）
const trTpl = readFileSync(join(TPL, '03-开发协同', '状态.md'), 'utf8')
check('D7-5e 状态模板流程类型注释含「技术调研储备」', trTpl.includes('技术调研储备'))

// ── TP2-D5：场景2 裁决门槛（清单裁决列 / 汇总三态裁决段 + 反证强制小节 + ASSUMPTION）──
check('TP2-D5a 02 清单模板含「裁决」列（go/needs-clarification/kill，场景2 必填）',
  list.includes('裁决') && list.includes('go / needs-clarification / kill') &&
  list.includes('needs-clarification＝带澄清问题按对象退回重派'),
  '裁决列三态 + 退回口径全中')
check('TP2-D5b 04 汇总模板含批次三态裁决段（go / needs-clarification / kill 三态一行）',
  summary.includes('批次裁决段（三态）') && summary.includes('go / needs-clarification / kill'),
  '三态裁决段全中')
check('TP2-D5c 04 汇总模板含反证强制小节（不得省略；缺失即按对象退回重派）',
  summary.includes('反证强制小节（不得省略）') &&
  summary.includes('反证小节缺失 → 批次校验不通过，按对象退回重派'),
  '反证强制小节 + 退回条款全中')
check('TP2-D5d 04 汇总模板含 ASSUMPTION 标注规则 + 评级判据自定条款（不新增状态/环节/角色）',
  summary.includes('ASSUMPTION') && summary.includes('评级判据自定，不给量化假装精确') &&
  summary.includes('不新增状态/环节/角色'),
  'ASSUMPTION 规则 + 判据条款 + 不新增声明全中')

writeResult()
