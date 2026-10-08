/**
 * T6（AC2）· 模板集改版 + §十索引双向对应（D8②）：
 * ① 索引行 ↔ 磁盘文件双向零差（文件在、索引有；索引有、文件在）；
 * ② 新增件齐备（含 00 区 6 件 / 场景2 件 / 测试·交付·归档骨架）；
 * ③ 改部件到位（调研清单泛化、调研报告 +2 小节、任务包 02 第十节+档位、
 *    状态模板技术调研储备、过程记录三件改名落任务根、预算基线分档）；
 * ④ 取消件不存在（过程记录/ 子目录、01/02/03/04 旧名、项目进度基线）。
 * Run: node tests/suites/t-templates.mjs
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

import { FIXTURES, ROOT, SPEC_DIR, TPL } from '../lib/paths.mjs'
import { reporter } from '../lib/test-harness.mjs'

const { check, writeResult } = reporter('t-templates')
const out = []

const spec = readFileSync(join(SPEC_DIR, '项目目录及协同开发规范-v2.1.md'), 'utf8')

// ── ① 索引 ↔ 磁盘双向 ─────────────────────────────────────────────────────
const indexSection = spec.split('## 十、模板索引')[1].split('## 十一、')[0]
const indexed = [...indexSection.matchAll(/^\|\s*`([^`]+)`\s*\|/gm)].map((m) => m[1].trim())
check('AC2-1a 索引条目解析成功', indexed.length > 30, `索引 ${indexed.length} 行`)
const indexedSet = new Set(indexed)
check('AC2-1b 索引无重复行', indexedSet.size === indexed.length,
  indexedSet.size === indexed.length ? `${indexed.length} 行唯一` : `重复：${indexed.filter((x, i) => indexed.indexOf(x) !== i).join(', ')}`)

function walk(dir, prefix = '') {
  const out = []
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${e.name}` : e.name
    if (e.isDirectory()) out.push(...walk(join(dir, e.name), rel))
    else out.push(rel)
  }
  return out
}
const onDisk = walk(TPL).sort()
// 索引里的 00-项目管理/项目目录及协同开发规范.md 是「规范本体」（由 spec/ 复制，不进 templates/）——单独豁免
const SPEC_BODY = '00-项目管理/项目目录及协同开发规范.md'
const indexedTpl = indexed.filter((p) => p !== SPEC_BODY)

const missingOnDisk = indexedTpl.filter((p) => !existsSync(join(TPL, p)))
check('AC2-1c 索引的每个模板文件存在于磁盘', missingOnDisk.length === 0,
  missingOnDisk.length ? `缺失：${missingOnDisk.join(' / ')}` : `索引 ${indexedTpl.length} 件全部落位（另有规范本体 1 件不入 templates/）`)
const notIndexed = onDisk.filter((p) => !indexedSet.has(p))
check('AC2-1d 磁盘无索引外文件', notIndexed.length === 0,
  notIndexed.length ? `索引外：${notIndexed.join(' / ')}` : `磁盘 ${onDisk.length} 件全被索引`)

const claimed = (spec.match(/模板总数 \*?\*?(\d+) 件\*?\*?/) || [])[1]
check('AC2-1e 索引总数声明与索引行数一致',
  claimed !== undefined && Number(claimed) === indexed.length,
  claimed === undefined ? '未找到「模板总数 N 件」声明' : `声明 ${claimed} 件 / 索引 ${indexed.length} 行`)
check('AC2-1f 索引总数声明与磁盘文件数一致',
  claimed !== undefined && Number(claimed) === onDisk.length,
  `声明 ${claimed} 件 / 磁盘 ${onDisk.length} 件`)

// ── ② 新增件齐备 ──────────────────────────────────────────────────────────
const mustExist = [
  ['00 区骨架 · README', '00-项目管理/README.md'],
  ['00 区骨架 · 当前状态', '00-项目管理/当前状态.md'],
  ['00 区骨架 · 产品路线图', '00-项目管理/产品路线图.md'],
  ['00 区骨架 · 任务索引', '00-项目管理/任务索引.md'],
  ['00 区骨架 · 决策索引', '00-项目管理/决策索引.md'],
  ['00 区骨架 · 发布批次规划', '00-项目管理/发布批次规划.md'],
  ['场景1 · 系统现状分析（六节）', '01-设计/02_系统现状分析.md'],
  ['场景2 · 调研汇总报告', '01-设计/技术调研/04_调研汇总报告.md'],
  ['测试骨架 · 测试基线 README', '04-测试/测试基线/README.md'],
  ['测试骨架 · 全局回归 README', '04-测试/全局回归/README.md'],
  ['交付 · 发布批次 README', '05-交付/发布批次/README.md'],
  ['交付 · 构建记录', '05-交付/构建记录-YYYYMMDD.md'],
  ['交付 · 推送记录', '05-交付/推送记录-YYYYMMDD.md'],
  ['交付 · 部署记录', '05-交付/部署记录-YYYYMMDD.md'],
  ['归档 · 旧目录映射', '90-历史归档/旧目录映射.md'],
  ['工作证据三件 · 计划评审', '03-开发协同/计划评审-vX.Y.md'],
  ['工作证据三件 · 执行自测', '03-开发协同/执行自测-YYYYMMDD.md'],
  ['工作证据三件 · 代码审查', '03-开发协同/代码审查-vX.Y.md'],
  ['M1 · 产品状态（两层状态源）', '03-开发协同/产品状态.md'],
  ['M5 · 设计基线示例（设计冻结哈希）', '01-设计/设计基线.example.json'],
  ['P2-1 · 修复包状态（父子归属）', '_任务模板/修复包/状态.md'],
]
const missingNew = mustExist.filter(([, p]) => !existsSync(join(TPL, p)))
check('AC2-2 新增件齐备（21 项，含 M1 产品状态 / M5 设计基线 / P2-1 修复包状态）', missingNew.length === 0,
  missingNew.length ? `缺：${missingNew.map(([l]) => l).join(' / ')}` : `${mustExist.length} 件全在`)

// ── ②b §十 对比句算术自洽（S-4，防 B-1 同类错误复发）──────────────────────
// S-4（M6 收编轮修复）：v2.0 基线模板件数原为硬编码常数 23，基线变更须人工同步。
// 现改为读 `tests/fixtures/t9-data/templates-v20.txt` —— 该文件由
// `tests/fixtures/t9-dump-bom.ps1` 用只读 `git ls-tree -r -z --name-only <立项期 chore>
// -- 02-代码/orchestrator2/spec/templates` 动态取数（本 node 进程 spawn git 会 EPERM，
// 故取数在 pwsh 侧完成）。缺文件即判 FAIL，不静默退化为常数。
const V20_COUNT_FILE = join(FIXTURES, 't9-data', 'templates-v20.txt')
let V20_TEMPLATE_COUNT = NaN
try {
  V20_TEMPLATE_COUNT = Number(readFileSync(V20_COUNT_FILE, 'utf8').trim())
} catch {
  V20_TEMPLATE_COUNT = NaN
}
check('AC2-2a0 S-4 v2.0 模板件数取数件可读（git 动态取数，非硬编码）',
  Number.isInteger(V20_TEMPLATE_COUNT) && V20_TEMPLATE_COUNT > 0,
  Number.isInteger(V20_TEMPLATE_COUNT) ? `读得 ${V20_TEMPLATE_COUNT} 件（${V20_COUNT_FILE.replace(ROOT, '')}）` : `读不到/非数字：${V20_COUNT_FILE}`)
const cmpLine = (indexSection.match(/与 v2\.0 的.*?明细见下.*/) || [])[0]
// 注意：「模板总数 N 件」声明位于本节首行（与对比句同一节、不同行），故总数取自 claimed
const cmpV20 = cmpLine ? Number((cmpLine.match(/与 v2\.0 的 \*{0,2}(\d+) 件/) || [])[1]) : NaN
const cmpAdd = cmpLine ? Number((cmpLine.match(/新增 (\d+) 件/) || [])[1]) : NaN
const cmpDel = cmpLine ? Number((cmpLine.match(/删除 (\d+) 件/) || [])[1]) : NaN
const cmpTotal = claimed === undefined ? NaN : Number(claimed)
check('AC2-2a §十 对比句三数可解析',
  [cmpTotal, cmpV20, cmpAdd, cmpDel].every(Number.isFinite),
  cmpLine || '未找到「与 v2.0 的 N 件相比…（明细见下）」对比句')
check('AC2-2b §十 对比句算术自洽（v2.0 件数 − 删除 + 新增 = 声明总数）',
  cmpV20 === V20_TEMPLATE_COUNT && cmpV20 - cmpDel + cmpAdd === cmpTotal,
  `${cmpV20} − ${cmpDel} + ${cmpAdd} = ${cmpV20 - cmpDel + cmpAdd}（应 = 声明总数 ${cmpTotal}；v2.0 基线件数 ${V20_TEMPLATE_COUNT}，git 动态取数）`)
check('AC2-2c §十 对比句三数与磁盘实际件数交叉一致',
  cmpTotal === onDisk.length && cmpAdd === mustExist.length && cmpV20 - cmpDel + cmpAdd === onDisk.length,
  `声明总数 ${cmpTotal} / 磁盘 ${onDisk.length} / 新增声明 ${cmpAdd} / 齐备清单 ${mustExist.length}`)

// ── ③ 改部件到位 ──────────────────────────────────────────────────────────
const read = (p) => readFileSync(join(TPL, p), 'utf8')
const list = read('01-设计/02_同类产品调研清单.md')
check('AC2-3a 调研清单泛化（对象化 + 拓展来源列 + 双场景注明）',
  list.includes('调研对象') && list.includes('拓展来源') && list.includes('场景·新产品开发') && list.includes('场景2·技术调研储备'))
const report = read('01-设计/03_调研报告/调研报告模板.md')
check('AC2-3b 调研报告 +2 小节', report.includes('技术路线对比矩阵') && report.includes('同类拓展候选'))
check('AC2-3b2 调研报告头部注释节号与实节一致（场景2 必填=第九/第十节，防 B-2 同类错误复发）',
  report.includes('第九节「技术路线对比矩阵」与第十节「同类拓展候选」') && !report.includes('第七节「技术路线对比矩阵」') && !report.includes('第八节「同类拓展候选」'))
const task = read('_任务模板/02_开发方案与任务包.md')
check('AC2-3c 任务包 02 含第十节 + 档位标注行',
  task.includes('## 十、现状引用与影响面约束') && task.includes('档位：小包（4/6/24）'))
const status = read('03-开发协同/状态.md')
check('AC2-3d 状态模板流程类型注释含技术调研储备', status.includes('技术调研储备'))
const baseline = read('03-开发协同/预算基线.md')
check('AC2-3e 预算基线默认档表增分档说明（小包缺省 / 大包 8/8/48）',
  baseline.includes('小包') && baseline.includes('大包') && baseline.includes('8/8/48') && baseline.includes('≤24'))
const review = read('03-开发协同/代码审查-vX.Y.md')
check('AC2-3f 代码审查模板含 AC 证据核验小节 + 复杂度发现小节',
  review.includes('AC 证据核验小节') && review.includes('复杂度发现') && review.includes('delete/stdlib/native/yagni/shrink'))
// TP1-D3：展示层上限声明行（模板侧；persona 审核员模板同句由 t2-persona ㊶ 核验）
check('AC-TP1-3 代码审查模板含展示层上限声明行（小节末）',
  review.includes('展示层上限：涉及展示/措辞类 AC 时须声明「展示层上限——形状约束不构成内容正确性证据」'),
  review.includes('展示层上限') ? '声明行在场' : '缺展示层上限声明行')
const plan = read('03-开发协同/计划评审-vX.Y.md')
check('AC2-3g 计划评审模板含可行性复核专用段（场景1 默认触发）',
  plan.includes('可行性复核专用段') && plan.includes('默认触发'))
// ── TP-A1-D4：计划评审模板增「跨改动点冲突扫描表」小节（AC-A1-1 下半）──────
check('AC-A1-1a 计划评审模板含跨改动点冲突扫描表小节 + 七列表头',
  plan.includes('## 跨改动点冲突扫描表（计划审核第 4 项，规范 §3.8）') &&
  plan.includes('| 改动点A | 改动点B | 共享项 | A产出 | B消费 | 发现 | 处置 |'),
  plan.includes('改动点A') ? '小节与七列表头全中' : '缺「跨改动点冲突扫描表」小节')
check('AC-A1-1b 计划评审模板含无共享声明格式与三条处置规则',
  plan.includes('无共享项（已核查 D1~Dn 两两关系）') &&
  plan.includes('调度员不得自行裁定技术冲突') && plan.includes('驳回计划'),
  '无共享声明 + 处置规则全中')
// ── TP-A1-D1：主包/修复包 02 模板契约行（消费/产出 + 五类 + 豁免写法）──────
const contractNeedles = ['**消费**：', '**产出**：', '五类接口类型', '代码符号', '工具与 schema', '状态字段', '文件格式', '标识关系', '无（原因']
const taskMissing = contractNeedles.filter((n) => !task.includes(n))
check('AC-A1-1c 主包 02 模板含契约行 + 五类接口 + 豁免写法',
  taskMissing.length === 0,
  taskMissing.length ? `缺：${taskMissing.join(' / ')}` : `判据 ${contractNeedles.length} 条全中`)
check('AC-A1-1d 主包 02 模板 §一 含粒度约束句（一次可自证测试周期 + 可单独否决单元）',
  task.includes('**粒度约束**') && task.includes('一次可自证测试周期') && task.includes('可单独否决的单元'),
  '粒度约束全中')
const fixTpl = read('_任务模板/修复包/02_开发方案与任务包.md')
const fixMissing = contractNeedles.filter((n) => !fixTpl.includes(n))
check('AC-A1-1e 修复包 02 模板同步契约行（消费/产出 + 豁免写法）',
  fixMissing.length === 0 && fixTpl.includes('- **消费**：') && fixTpl.includes('- **产出**：'),
  fixMissing.length ? `缺：${fixMissing.join(' / ')}` : '契约行同步到位')
// ── TP-A2-D1：修复包 02 模板 §四 接管为 T0~T3 证据链（原 AC-A1-1f「保持原样」判据
//   是 TP-A1 的领土占位——TP-A2 按任务包 D1 正式改写 §四，判据同步反转）──────────
check('TP-A2-D1a 修复包 02 模板 §四 为 T0~T3 四段证据链',
  fixTpl.includes('### T0 根因') && fixTpl.includes('### T1 RED') &&
  fixTpl.includes('### T2 GREEN') && fixTpl.includes('### T3 回归'),
  'T0 根因 / T1 RED / T2 GREEN / T3 回归 四段段名全中')
check('TP-A2-D1b 修复包 02 模板 T1 含 pre-fix 基线 + 修复前失败输出硬要求 + 有效 RED 判据',
  fixTpl.includes('pre-fix') && fixTpl.includes('修复前失败输出') && fixTpl.includes('不算有效 RED') &&
  fixTpl.includes('为什么这个失败正是目标缺陷') &&
  fixTpl.includes('编译失败') && fixTpl.includes('环境缺依赖') && fixTpl.includes('无关的旧测试失败'),
  'pre-fix / 修复前失败输出 / 有效 RED 判据（三类无效失败枚举）全中')
check('TP-A2-D1c 修复包 02 模板含不可证伪驳回口径与不可自动化例外条款',
  fixTpl.includes('不可证伪') && fixTpl.includes('不可自动化例外') && fixTpl.includes('充分性'),
  '不可证伪 / 不可自动化例外 / 充分性全中')
check('TP-A2-D1d 修复包 02 模板 T0 段禁捆绑重构与 T2 同命令同路径要求',
  fixTpl.includes('禁捆绑重构') && fixTpl.includes('同命令、同路径'),
  '禁捆绑重构 / 同命令同路径全中')
// ── TP-D1-D5：主包/修复包 02 模板「环境事实清单」节（三列表 + 「未验证」口径）──
const envNeedles = ['环境事实清单', '| 事实 | 状态（已实测/未验证） | 依据 |', '未验证']
const taskEnvMissing = envNeedles.filter((n) => !task.includes(n))
check('TP-D1-D5a 主包 02 模板含「环境事实清单」节（三列表头 + 「未验证」口径）',
  taskEnvMissing.length === 0,
  taskEnvMissing.length ? `缺：${taskEnvMissing.join(' / ')}` : '节与三列表头全中')
const fixEnvMissing = envNeedles.filter((n) => !fixTpl.includes(n))
check('TP-D1-D5b 修复包 02 模板同步「环境事实清单」节',
  fixEnvMissing.length === 0,
  fixEnvMissing.length ? `缺：${fixEnvMissing.join(' / ')}` : '节与三列表头全中')
// ── TP-C-D6：02 模板 §四 判断式引导（主包 + 修复包同步）───────────────────────
const judgeNeedles = ['开发员需要跑出哪些机器可验证据', '构建验证=调度员/人工测试=用户',
  '禁止以「见操作手册」甩路径', '先裁决、后部署']
const taskJudgeMissing = judgeNeedles.filter((n) => !task.includes(n))
check('TP-C-D6a 主包 02 模板 §四 判断式引导 + 摘录规则 + 先裁决后部署',
  taskJudgeMissing.length === 0,
  taskJudgeMissing.length ? `缺：${taskJudgeMissing.join(' / ')}` : `判据 ${judgeNeedles.length} 条全中`)
const fixJudgeMissing = judgeNeedles.filter((n) => !fixTpl.includes(n))
check('TP-C-D6b 修复包 02 模板 §四 同步判断式引导（T0~T3 段并存不冲突）',
  fixJudgeMissing.length === 0 && fixTpl.includes('### T0 根因'),
  fixJudgeMissing.length ? `缺：${fixJudgeMissing.join(' / ')}` : '判断式引导同步到位、证据链段保留')
const selfTest = read('03-开发协同/执行自测-YYYYMMDD.md')
check('AC2-3h 执行自测模板含 -N 同日多轮后缀规则 + 修复前缀',
  selfTest.includes('-YYYYMMDD-N') && selfTest.includes('修复执行自测-YYYYMMDD.md'))

// ── TP-D2-D4：模板四件新节（授权块〔节首四形态索引句〕/欠账小节/核销清单段/台账记法）──
check('TP-D2-D4a 02 模板含「快速通道授权块」可选节 + 节首四形态分名分义索引句（四要素齐备）',
  task.includes('## 九点五、快速通道授权块') && task.includes('**四形态分名分义索引（禁止混用）**') &&
  task.includes('快速通道／合并测试／归并／直修') && task.includes('规范「快速通道与合并测试」节（§4.5）') &&
  task.includes('禁止混用（欠账≠归并'),
  '授权块节 + 索引句（枚举/区分要点/权威源/禁混用）全中')
check('TP-D2-D4b 02 授权块含授权四要素字段与复审重点预写/覆盖清单写死',
  ['授权原话逐字', '授权编号', '授权对象（分列）', '失效边界', '复审重点（预写）', '覆盖清单（写死）', 'FT-<包>-<N>']
    .every((n) => task.includes(n)),
  '授权四要素字段全中')
check('TP-D2-D4c 决策记录模板含「快速通道欠账」固定小节（FT 编号/状态枚举/回落规则/核销回写位）',
  ['## 快速通道欠账（固定小节 · v2.1.2 新增）', 'FT-<包>-1', '未清偿／已清偿／失效回落',
    '转 X 消失则回落未清偿', '核销回写位'].every((n) => read('03-开发协同/决策记录.md').includes(n)),
  '欠账小节全中')
check('TP-D2-D4d 验收结论模板含「欠账核销清单」段（FT→复审结论→核销回写核对）',
  ['## 三、欠账核销清单', 'FT-<包>-1', '复审结论（集中复审回填）', '核销回写核对'].every((n) => read('04-测试/验收结论.md').includes(n)),
  '核销清单段全中')
check('TP-D2-D4e 台账模板含快速通道记法说明（B 计 0 不占上限 + 集中复审独立记一行）',
  ['快速通道记法', 'B 计 0、不占该包 B 上限', '快速通道-<授权编号>', '集中复审-<授权编号>']
    .every((n) => read('03-开发协同/预算台账.md').includes(n)),
  '台账记法全中')

// ── ④ 取消件不存在 ────────────────────────────────────────────────────────
const mustNotExist = [
  ['过程记录/ 子目录', '03-开发协同/过程记录'],
  ['旧名 01_计划审核.md（旧位）', '03-开发协同/过程记录/01_计划审核.md'],
  ['旧名 02_执行与自测记录.md（旧位）', '03-开发协同/过程记录/02_执行与自测记录.md'],
  ['旧名 03_验证审核.md', '03-开发协同/过程记录/03_验证审核.md'],
  ['旧名 04_代码审查.md（旧位）', '03-开发协同/过程记录/04_代码审查.md'],
  ['项目进度基线.md', '03-开发协同/项目进度基线.md'],
]
for (const [label, rel] of mustNotExist) {
  check(`AC2-4 取消件不存在：${label}`, !existsSync(join(TPL, rel)))
}
const allPaths = walk(TPL)
const legacyHits = allPaths.filter((p) => /过程记录\/|项目进度基线|01_计划审核\.md|02_执行与自测记录\.md|03_验证审核\.md|04_代码审查\.md/.test(p))
check('AC2-5 全树无旧名遗留', legacyHits.length === 0, legacyHits.length ? `命中：${legacyHits.join(' / ')}` : `零命中（${allPaths.length} 件）`)

// ── TP2 增量：SpecKit 证据裁决口径落地（D1~D4 模板锚点；D5①② 场景2 件在 t-scenario2）────
check('TP2-D1a 代码审查模板修复审查段含证据等级列＋逐项四态＋部分/缺失退回条款',
  review.includes('「证据等级：完整/部分/缺失」') && review.includes('「逐项状态：pass/fail/skipped/not-run」') &&
  review.includes('证据等级为部分/缺失时不得进入待构建更新，退回修复中'),
  '证据等级三值 / 逐项四态 / 退回条款全中')
check('TP2-D1b 行序：展示层上限声明在前、证据等级列说明在后（任务包 §二-1 行序约束）',
  review.indexOf('展示层上限：涉及展示/措辞类 AC 时须声明') !== -1 &&
  review.indexOf('展示层上限：涉及展示/措辞类 AC 时须声明') < review.indexOf('修复审查证据等级（TP2-D1）') &&
  review.indexOf('修复审查证据等级（TP2-D1）') !== -1,
  `展示层行 idx=${review.indexOf('展示层上限：涉及展示/措辞类 AC 时须声明')} / 证据等级行 idx=${review.indexOf('修复审查证据等级（TP2-D1）')}`)
// ── TP2-D1 修复轮（代码审查-v0.1 §六 驳回修复）：AC 表实际结构断言——解析表头/分隔行/示例行
//    列数与列序，不再只 includes（substring 只证文字存在、不证两列真实落表）──
const reviewSec1 = review.split('## 一、AC 证据核验小节')[1].split('## 二、')[0]
const tblCells = reviewSec1.split('\n').map((l) => l.trim()).filter((l) => l.startsWith('|'))
  .map((l) => l.replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim()))
const TP2_HDR = ['#', '验收标准（AC 原文摘要）', '声明结论', '证据（文件/行/命令 + 输出片段）',
  '证据等级（完整/部分/缺失）', '逐项状态（pass/fail/skipped/not-run）', '核验判定']
const hdr = tblCells[0] ?? []
check('TP2-D1c AC 核验表实际表头为 7 列且逐列相等（两新列在第5/6列）',
  hdr.length === TP2_HDR.length && TP2_HDR.every((h, i) => hdr[i] === h),
  `实际表头 ${hdr.length} 列：${hdr.join(' ／ ') || '未解析到表行'}`)
const sepRow = tblCells[1] ?? []
const exRow = tblCells[2] ?? []
const isSep = (c) => /^:?-{3,}:?$/.test(c)
check('TP2-D1d AC 核验表分隔/示例行与表头列数一致，示例行两新列为合法可填写值',
  sepRow.length === TP2_HDR.length && sepRow.every(isSep) && exRow.length === TP2_HDR.length &&
  ['完整', '部分', '缺失'].includes(exRow[4]) && ['pass', 'fail', 'skipped', 'not-run'].includes(exRow[5]),
  `分隔 ${sepRow.length} 列（全为分隔线=${sepRow.length > 0 && sepRow.every(isSep)}）/ 示例 ${exRow.length} 列；示例等级=${exRow[4] ?? '—'} 状态=${exRow[5] ?? '—'}`)
const fix01 = read('_任务模板/修复包/01_需求分析.md')
check('TP2-D2a 修复包 01 模板含未决澄清项闸门行（非空不得置修复中）',
  fix01.includes('未决澄清项：[NEEDS CLARIFICATION] / 无') && fix01.includes('非空不得置修复中'),
  '闸门行 + 闸门句全中')
check('TP2-D2b 修复包 01 模板根因初判为开发员必读契约（不符须显式写不符+新证据）',
  fix01.includes('开发员必读契约') && fix01.includes('与 01 初判不符 + 新证据') && fix01.includes('不得静默改口'),
  '契约句全中')
check('TP2-D3a 执行自测模板范围核查含第三态正当扩围 + 判定权归审核员 + 无登记越界仍硬停',
  selfTest.includes('正当扩围（新证据+理由）') && selfTest.includes('判定权归审核员') && selfTest.includes('无登记越界仍硬停'),
  '第三态 / 判定权 / 硬停全中')
check('TP2-D4a 执行自测模板头部含上游指针行（01 §一 / 02 §四 / issueId 三指针对象）',
  selfTest.includes('上游指针（TP2-D4，修复自测适用）') && selfTest.includes('修复包 01 §一（问题陈述）') &&
  selfTest.includes('修复 02 §四（T0~T3）') && selfTest.includes('issueId=<编号>'),
  '上游指针行 + 三指针对象全中')
check('TP2-D4b 代码审查模板头部含上游指针行（修复审查适用；repairOf/issueId/parentCandidateCommit 并列）',
  review.includes('上游指针（TP2-D4，修复审查适用）') && review.includes('repairOf/issueId/parentCandidateCommit'),
  '上游指针行 + 状态头三字段并列全中')

writeResult()
