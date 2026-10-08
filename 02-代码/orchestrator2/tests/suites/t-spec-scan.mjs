/**
 * T5（AC1）· 规范 v2.1 主题词落盘扫描（D8①）：
 * 六主题（A1 连跑 / A2 五态 / B1 分档 / C1 问档 / E 目录六项 / F1·F2 场景扩展）
 * 的判据词逐词命中规范 v2.1；并断言 v2.0 文件保留、v2.1 头部版本行正确。
 * Run: node tests/suites/t-spec-scan.mjs
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { ROOT, SPEC_DIR } from '../lib/paths.mjs'
import { reporter } from '../lib/test-harness.mjs'

const { check, writeResult } = reporter('t-spec-scan')

const V20 = join(SPEC_DIR, '项目目录及协同开发规范-v2.0.md')
const V21 = join(SPEC_DIR, '项目目录及协同开发规范-v2.1.md')

/** 逐词命中：返回缺失词清单。 */
function missingWords(text, words) {
  return words.filter((w) => !text.includes(w))
}

check('AC1-0a v2.0 规范文件保留不删', existsSync(V20), V20.replace(ROOT, ''))
check('AC1-0b v2.1 规范文件存在', existsSync(V21), V21.replace(ROOT, ''))
const spec = readFileSync(V21, 'utf8')
check('AC1-0c 头部版本行为 v2.1', spec.startsWith('# 项目目录及协同开发规范 v2.1\n'))
check('AC1-0d 含 v2.1 变更说明段', spec.includes('> v2.1 变更（相对 v2.0）：'))
const old = readFileSync(V20, 'utf8')
check('AC1-0e v2.0 原文未被改动（头部仍为 v2.0）', old.startsWith('# 项目目录及协同开发规范 v2.0\n'))

// 六主题判据词（任务包 D8① 清单 + 各主题关键口径）
const themes = [
  ['A1 一次授权多包连跑', ['连跑', '测过自动放行', '能否构成一次有意义的人工测试', '异常硬停', '可随时喊停', '人工介入点（收敛为四处）', '一包一授权']],
  ['A2 验证并入审查 / 5 态', ['待审查', '验证审核并入代码审查', 'AC 证据核验', '无证驳回', '机械状态迁移', '待修订（回退态）']],
  ['B1 预算分档', ['8/8/48', '4/4/24', '档位', '按包复杂度分档', '小包', '大包']],
  ['C1 grill 开场问档', ['开场先问档位', '跳过 / 轻量 / 标准', '缺省不再固定', '短链任务默认轻量']],
  ['E 目录体系六项', ['00-项目管理', '计划评审', '执行自测', '代码审查', '测试基线', '全局回归', '发布批次', '90-历史归档', '规范本体', '构建记录-YYYYMMDD.md', '推送记录-YYYYMMDD.md', '部署记录-YYYYMMDD.md', '旧目录映射.md']],
  ['F1 场景1', ['现状研究中', '目标代码区', '影响面清单', '设计链档位', '短链', '可行性复核', 'git init', 'codegraph']],
  ['F2 场景2', ['方向确认中', '清单待确认', '技术调研储备', '只统计不控制', '逐批', '同类拓展候选', '技术路线对比矩阵', '封闭性']],
  ['场景落盘与双区', ['01-设计/技术调研/', '02_系统现状分析.md', '04_调研汇总报告.md', 'TR<编号>-<主题>']],
  ['TP-A1-D2 跨改动点冲突扫描条款', ['### 3.8 跨改动点冲突扫描（计划审核第 4 项', '改动点A', 'A产出', 'B消费', '共享项', '无共享项（已核查', '计划审核第 4 项', '**驳回计划**（状态回 待修订）', '回设计', '不得自行裁定技术冲突']],
  ['TP-A1-D8① 授权合并条款', ['设计确认即开发授权', '确认即开工', '仅定稿存档', '关卡2 并入关卡1', '机械动作，非人工关卡', '一包一授权']],
  ['差异与兼容', ['## 十三、与 v1.1 差异说明', '**v2.1**', '兼容性（v2.1）', '升级脚手架']],
  ['TP-A2-D2 无证或不可证伪驳回 + 不可自动化例外', ['无证或不可证伪驳回', '不可证伪', '不可自动化例外', '充分性判断权归审核员', '假 RED']],
  ['成本/费用口径（否定表述）', ['不统计费用', '无费用概念']],
]
for (const [name, words] of themes) {
  const miss = missingWords(spec, words)
  check(`AC1-1 主题「${name}」判据词全中`, miss.length === 0,
    miss.length ? `缺 ${miss.length} 词：${miss.join(' / ')}` : `${words.length} 词全中`)
}

// 结构断言：六区 + 归档区
check('AC1-2 目录体系标题为「六区 + 归档区」', spec.includes('## 二、目录体系（六区 + 归档区）'))
check('AC1-3 区语义表含 90-历史归档 行', spec.includes('| `90-历史归档/` |'))
check('AC1-4 场景章节存在（第十四节）', spec.includes('## 十四、场景扩展（v2.1 新增）'))
check('AC1-5 含 §3.1b 场景转移链', spec.includes('### 3.1b 场景1 / 场景2 转移链（v2.1 新增）'))
check('AC1-6 修订记录含 2026-09-14 升版 v2.0→v2.1 行', spec.includes('升版 v2.0→v2.1'))
check('AC1-7 修订记录含 TP-A1-D2/D8① 两处文本改动行（2026-09-16）', spec.includes('TP-A1-计划质量 · 规范文本两处'))

// ── TP-A1 结构断言（D2 七列表格 + D8① 关卡表形态）─────────────────────────
// §3.8 取段：自 §3.8 标题起至下一小节/节标题止（B-2 修复后 §3.7 不再位于 §3.8 之后，
// 原「至 ### 3.7 止」的取法会一路取到文末，故改为按标题边界截断）。
const d2 = spec.split('### 3.8 跨改动点冲突扫描')[1]?.split(/\n#{2,3} /)[0] ?? ''
check('TP-A1-D2a §3.8 七列表头逐列齐备（改动点A/改动点B/共享项/A产出/B消费/发现/处置）',
  ['| 改动点A | 改动点B | 共享项 | A产出 | B消费 | 发现 | 处置 |'].every((h) => d2.includes(h)),
  d2 ? '表头全中' : '未取到 §3.8 正文')
check('TP-A1-D2b §3.8 含三条处置规则（①②③ 各一句）',
  d2.includes('① 包内矛盾') && d2.includes('② 与冻结设计/显式需求冲突') && d2.includes('③ **调度员不得自行裁定技术冲突**'),
  '三条处置规则全中')
check('TP-A1-D2c §3.8 只扫确实共享组合 + 无共享声明格式',
  d2.includes('只扫确实共享的组合') && d2.includes('无共享项（已核查 D1~Dn 两两关系）'),
  '两口径全中')
check('TP-A1-D2d §3.8 落点指向 计划评审-vX.Y.md 且扫描输入＝02 契约行',
  d2.includes('计划评审-vX.Y.md') && d2.includes('消费/产出') && d2.includes('接口五类'),
  '落点与输入口径全中')
check('TP-A1-D8a §七 关卡1 行含「设计确认即开发授权」与分流两句',
  spec.includes('| 关卡1 · 设计确认**（＝开发授权 · #33 授权合并）**') &&
  spec.includes('**设计确认即开发授权**') && spec.includes('「确认即开工」/「仅定稿存档」'),
  '关卡1 合并口径全中')
check('TP-A1-D8b §七 含 #32 提示与旧口径保留块（标注不再执行）',
  spec.includes('#32 模型配置提示') && spec.includes('从下一会话生效') && spec.includes('保留备查、不再执行'),
  '提示与旧口径块全中')
check('TP-A2-D2a 修订记录含 2026-09-16 TP-A2 行（§七 验收硬规则）',
  spec.includes('TP-A2-修复质量 · 规范文本一处'),
  'TP-A2 修订记录行命中')

// ── TP-D1-D2：§4.1 新档位落地产物（op-A/op-B）+ 变更记录 v2.1.1 行 ──────────
const seg41 = spec.split('### 4.1 预算基线')[1]?.split('### 4.2')[0] ?? ''
check('TP-D1-D2a §4.1 段内「B 运行 ≤6」命中 1 且「4/4/24」命中 0（op-A/op-B 落地）',
  (seg41.split('B 运行 ≤6').length - 1) === 1 && !seg41.includes('4/4/24'),
  `B≤6=${seg41.split('B 运行 ≤6').length - 1}；段内含 4/4/24=${seg41.includes('4/4/24')}`)
check('TP-D1-D2b spec 全文件含「缺省档 = **小包 4/6/24**」且 v2.1.1 变更记录行在案',
  spec.includes('缺省档 = **小包 4/6/24**') && spec.includes('TP-D1-文本层沉淀 · 规范 v2.1.1'),
  '缺省档新值 + v2.1.1 变更记录行全中')

// ── TP-D2-D3：§4.5「快速通道与合并测试」新节钉串 + 变更记录 v2.1.2 行 ────────
const seg45 = spec.split('### 4.5 快速通道与合并测试')[1]?.split('## 五、')[0] ?? ''
check('TP-D2-D3a §4.5 节存在且四形态分名分义表齐备（快速通道/合并测试/归并/直修）',
  seg45.includes('四形态分名分义') && ['| 快速通道 |', '| 合并测试 |', '| 归并 |', '| 直修 |'].every((r) => seg45.includes(r)),
  seg45 ? '四形态表四行全中' : '未取到 §4.5 正文')
check('TP-D2-D3b §4.5 快速通道六要素条款级齐备',
  ['调度员判断＋用户授权双键', '授权四要素', 'FT-<包>-N', '集中复审双触发', '幂等保护', '豁免 B 不豁免取证']
    .every((w) => seg45.includes(w)),
  '六要素全中')
check('TP-D2-D3c §4.5 预算口径三句 + 待人工测试态纪律三件套',
  ['计 0、不占该包 B 上限', '快速通道-<授权编号>', '决策简报第三选项', '不得默认推荐跳过',
    '改动即欠账', '必复验', '写切回路径'].every((w) => seg45.includes(w)),
  '三句 + 三件套全中')
check('TP-D2-D3d 修订记录含 v2.1.2 TP-D2 行',
  spec.includes('TP-D2-合并测试正式语义 · 规范 v2.1.2'),
  'v2.1.2 变更记录行命中')

// ── TP2-D5⑤：规范 v2.1.3（版本行 + §3.4 修复证据链口径 + §14.2 裁决门槛 + §10 五行 + 修订记录）──
check('TP2-A 头部含 v2.1.3 当前版本行',
  spec.includes('> 当前版本：**v2.1.3**（2026-09-28 · TP2-SpecKit证据裁决口径落地'),
  'v2.1.3 版本行命中')
const seg34 = spec.split('### 3.4 验收阶段转移表（修复循环）')[1]?.split('### 3.5')[0] ?? ''
check('TP2-B §3.4 修复证据链口径段（等级三值+四态+退回 / 闸门 / 第三态 / 上游指针）',
  ['证据等级：完整/部分/缺失', 'pass/fail/skipped/not-run', '证据等级为部分/缺失时不得进入待构建更新，退回修复中',
    '未决澄清项：[NEEDS CLARIFICATION]/无', '非空不得置修复中', '与 01 初判不符 + 新证据',
    '正当扩围（新证据+理由）', '无登记越界仍硬停', '上游指针：修复包 01 §一', 'repairOf/issueId/parentCandidateCommit']
    .every((w) => seg34.includes(w)),
  seg34 ? '口径段判据全中' : '未取到 §3.4 正文')
const seg142 = spec.split('### 14.2 场景2 · 技术调研储备搜索')[1]?.split('## 修订记录')[0] ?? ''
check('TP2-C §14.2 裁决门槛块（清单裁决列/汇总三态/反证强制/ASSUMPTION，可退回条款）',
  ['裁决门槛（v2.1.3 · TP2，可退回条款；不新增状态/环节/角色）', 'go / needs-clarification / kill',
    '反证小节缺失即按对象退回重派', 'ASSUMPTION', '评级判据自定，不给量化假装精确'].every((w) => seg142.includes(w)),
  seg142 ? '裁决门槛判据全中' : '未取到 §14.2 正文')
check('TP2-D §10 五行说明含 v2.1.3 增补',
  ['未决澄清项闸门行（**非空不得置修复中**）＋根因初判必读契约',
    '「裁决」列**（go/needs-clarification/kill，场景2 必填；v2.1.3）',
    '批次三态裁决段（go/needs-clarification/kill）＋反证强制小节＋ASSUMPTION 标注',
    '范围核查三态（符合/正当扩围（新证据+理由）/越界）＋修复变体上游指针头行',
    '修复审查证据等级列（完整/部分/缺失）＋逐项四态（pass/fail/skipped/not-run）＋部分/缺失退回条款']
    .every((w) => spec.includes(w)),
  '五行 v2.1.3 说明全中')
check('TP2-E 修订记录含 v2.1.3 TP2 行',
  spec.includes('TP2-SpecKit证据裁决口径落地 · 规范 v2.1.3'),
  'v2.1.3 变更记录行命中')
check('TP2-F AC7 辅证：§3.1 状态枚举三段注释串未变（不新增状态）',
  spec.includes('# 设计阶段（9 态 + v2.1 场景扩展 3 态）') &&
  spec.includes('# 开发阶段（v2.1 收敛为 5 态主链）') &&
  spec.includes('# 验收阶段：修复循环（5 态）+ 收尾'),
  '三段状态枚举注释串原样命中')

writeResult()
