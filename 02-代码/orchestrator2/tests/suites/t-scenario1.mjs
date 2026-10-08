/**
 * T3（AC7）· 场景1「修改已有系统」干跑断言（D6）：
 * ① persona 含保险丝三分支文案（读 agent.cordis.yml）；
 * ② `02_系统现状分析.md` 模板六节标题齐备；
 * ③ 任务包 02 模板含第十节「现状引用与影响面约束」；
 * ④ `现状研究中` 在 PHASE_VALUES（读 phase-gate.mjs 正则取数组）且
 *    validateAutoMode 对该状态 fixture 拒绝且报「当前阶段非待审核」。
 * Run: node tests/suites/t-scenario1.mjs
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { ROOT, ORCH2, TPL, FX, PHASE_GATE, SCENARIO_UTILS } from '../lib/paths.mjs'
import { reporter } from '../lib/test-harness.mjs'

const { check, writeResult } = reporter('t-scenario1')
const lines = []

const { validateAutoMode } = await import(PHASE_GATE)
const { TASK_REL, scenario, write } = await import(
  SCENARIO_UTILS
)

// 读 phase-gate.mjs 的 PHASE_VALUES（模块内 const 数组，未导出 → 正则取数组体）
const gateSrc = readFileSync(join(ORCH2, 'phase-gate.mjs'), 'utf8')
const arrMatch = gateSrc.match(/const PHASE_VALUES = \[([\s\S]*?)\n\]/)
check('D6-0 PHASE_VALUES 数组可正则取出', arrMatch !== null, arrMatch ? `数组体 ${arrMatch[1].length} 字符` : '未匹配')
const phaseValues = arrMatch === null
  ? []
  : [...arrMatch[1].matchAll(/'([^']+)'/g)].map((m) => m[1])

// ── ① persona 保险丝三分支 ─────────────────────────────────────────────────
const persona = readFileSync(join(ORCH2, 'agent.cordis.yml'), 'utf8')
const fuseNeedles = [
  ['保险丝段标题（三分支）', '规范版本识别保险丝（三分支）'],
  ['分支① v2.1 主流程', '① 有 **v2.1** 规范'],
  ['分支② v2.0 升级脚手架提示', 'v2.0** 规范 → 提示用户先升级脚手架'],
  ['分支③ 空白项目脚手架初始化', '无规范且项目空白'],
  ['分支④ 既有代码系统 → 场景1', '无规范但有既有代码系统'],
  ['分支⑤ v1.1 → 1.0 预设', 'v1.1 规范'],
  ['场景1 四个动作：确认/补建/项目根索引/git init 代办', '代为 git init + 首次 commit'],
]
for (const [label, needle] of fuseNeedles) {
  check(`D6-1 保险丝三分支：${label}`, persona.includes(needle))
}

// ── ② 系统现状分析模板六节 ────────────────────────────────────────────────
const tplPath = join(TPL, '01-设计', '02_系统现状分析.md')
let tpl = ''
try {
  tpl = readFileSync(tplPath, 'utf8')
  check('D6-2a 02_系统现状分析.md 模板存在', true, tplPath.replace(ROOT, ''))
} catch {
  check('D6-2a 02_系统现状分析.md 模板存在', false, '文件缺失')
}
const sections = ['一、系统概览', '二、关键调用链与数据流', '三、修改意向相关现状详查', '四、影响面初判', '五、事实 / 推断标注与未解决问题', '六、安全纪律声明']
const missingSec = sections.filter((s) => !tpl.includes(s))
check('D6-2b 六节标题齐备', missingSec.length === 0, missingSec.length ? `缺：${missingSec.join(' / ')}` : sections.length + ' 节全中')
check('D6-2c 含降级口径（未使用 codegraph）', tpl.includes('未使用 codegraph'))
check('D6-2d 含只读安全纪律声明（未执行脚本/未起服务/未改文件）',
  tpl.includes('未执行任何脚本') && tpl.includes('未启动服务') && tpl.includes('未修改任何文件'))

// ── ③ 任务包 02 模板第十节 ────────────────────────────────────────────────
const taskTpl = readFileSync(join(TPL, '_任务模板', '02_开发方案与任务包.md'), 'utf8')
check('D6-3a 含第十节「现状引用与影响面约束」', taskTpl.includes('## 十、现状引用与影响面约束'))
check('D6-3b 场景1 必填 / 新产品任务写「不适用」', taskTpl.includes('场景1 必填') && taskTpl.includes('不适用'))
check('D6-3c 含影响面清单 + 越界即范围漂移', taskTpl.includes('影响面清单') && taskTpl.includes('范围漂移'))
check('D6-3d 含预算块档位标注行', taskTpl.includes('档位：小包（4/6/24）'))

// ── ④ 枚举 + fixture 拒绝 ─────────────────────────────────────────────────
check('D6-4a `现状研究中` 在 PHASE_VALUES', phaseValues.includes('现状研究中'), `枚举 ${phaseValues.length} 项`)
check('D6-4b 旧值全保留（同类产品搜索中/调研中/待验证/待代码审查）',
  ['同类产品搜索中', '调研中', '待验证', '待代码审查'].every((p) => phaseValues.includes(p)))

const dir = scenario('t-scenario1-现状研究中', (d) => {
  const p = join(d, '03-开发协同', 'TP1-玩具功能', '状态.md')
  write(p, readFileSync(p, 'utf8').replace('当前阶段：待审核', '当前阶段：现状研究中'))
})
const r = validateAutoMode(dir, TASK_REL)
lines.push(`--- [场景1 fixture 现状研究中] ok=${r.ok}${r.ok ? '' : ` message=${r.message}`}`)
check('D6-4c 现状研究中 fixture 被 enter_auto_mode 拒绝', r.ok === false)
check('D6-4d 拒绝原因报「当前阶段为「现状研究中」而非「待审核」」',
  r.ok === false && r.message.includes('「现状研究中」而非「待审核」'))

writeResult()
