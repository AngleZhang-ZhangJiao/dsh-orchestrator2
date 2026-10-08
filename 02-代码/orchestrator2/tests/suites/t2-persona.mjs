/**
 * T2（AC3）· persona 十项改写核验：
 * ① agent.cordis.yml YAML 可解析（dsh node_modules 内 js-yaml，harness 同款
 *     `tag:yaml.org,2002:js` 自定义标签）；② persona text 十项 grep 判据全中。
 * Run: node tests/suites/t2-persona.mjs
 */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'

import { ORCH2 } from '../lib/paths.mjs'
import { reporter } from '../lib/test-harness.mjs'

const { check, writeResult } = reporter('t2-persona')

const DSH = 'C:\\Users\\nicia\\AppData\\Roaming\\npm\\node_modules\\@deepseek-ai\\dsh'

const require = createRequire(import.meta.url)
const yaml = require(join(DSH, 'node_modules', 'js-yaml'))
const JsExpr = new yaml.Type('tag:yaml.org,2002:js', {
  kind: 'scalar',
  resolve: (data) => typeof data === 'string',
  construct: (data) => ({ __jsExpr: data }),
})
const schema = yaml.JSON_SCHEMA.extend(JsExpr)

// ── ① YAML 解析 ────────────────────────────────────────────────────────────
const cordisText = readFileSync(join(ORCH2, 'agent.cordis.yml'), 'utf8')
let cordis
try {
  cordis = yaml.load(cordisText, { schema })
  check('T2-1 agent.cordis.yml YAML 解析通过', Array.isArray(cordis), `顶层=${Array.isArray(cordis) ? `数组长度 ${cordis.length}` : typeof cordis}`)
} catch (error) {
  check('T2-1 agent.cordis.yml YAML 解析通过', false, `解析异常：${error.message}`)
}
if (Array.isArray(cordis)) {
  const ids = cordis.map((row) => row.id).filter(Boolean)
  check('T2-2 每行都有 id（无漏 id 行）', ids.length === cordis.length, `ids=${ids.length}/${cordis.length}`)
  const personaRow = cordis.find((row) => row.id === 'persona')
  check('T2-3 persona 行存在且 id/name 正确',
    personaRow !== undefined && personaRow.name === '@deepseek-ai/dsh-persona',
    personaRow ? `name=${personaRow.name}` : '未找到 persona 行')
} else {
  for (const l of ['T2-2', 'T2-3']) check(`${l} （解析失败后续断言跳过）`, false)
}

// 0.1.5 键适配（TP-B-修复1/D3）：persona 行配置键 text: → prefix:（宿主 breaking），
// 兼容读法优先新键、回退旧键；断言语义不变。
const personaConfig = cordis.find((row) => row.id === 'persona').config
const persona = personaConfig.prefix ?? personaConfig.text

// ── ② 十项改写 grep 判据 ────────────────────────────────────────────────────
const items = [
  ['① 铁律=目标代码区（缺省 02-代码/）', ['目标代码区（任务包 02 指定，缺省', '永不修改**目标代码区**']],
  ['② 保险丝扩三分支/多分支（含 v2.0 升级提示 + 场景1 分支）', ['规范版本识别保险丝（三分支）', 'v2.0** 规范 → 提示用户先升级脚手架', '无规范但有既有代码系统']],
  ['③ 开工判定增场景识别提示', ['**场景识别提示**', '场景2 不做环境自动探测']],
  ['④ 场景1 设计链变体（现状研究中+档位+降级）', ['现状研究中【新状态】', '设计链档位：短链/标准', '短链最小产物集', '未使用 codegraph', '目标代码区']],
  ['④ 场景2 独立流程段（四态+逐批拓展+汇总汇报+封闭性）', ['方向确认中【新状态】', '清单待确认【新状态】', '逐批拓展', '当面向用户汇报', '不存在从调研报告自动生成任务包的路径']],
  ['⑤ 研究员派工增现状研究型与技术调研型两变体', ['研究员·**现状研究型**', '研究员·**技术调研型**', 'codegraph sync', '搜索词脱敏', '注入免疫']],
  ['⑥ 关卡2 = A1 一次授权多包连跑 + 关卡1 场景1 提交物差异', ['一次授权多包连跑', '切分标准=能否构成一次有意义的人工测试', '无需用户重复授权', '异常硬停', '场景1 提交物差异']],
  ['⑦ 转移表收敛 5 态（验证并入审查）', ['开发 5 态主链', '待审查 → subagent_reviewer', 'AC 证据核验（无证驳回）', '验证环节已并入本环节', '待修订 → 你自己（**回退态**']],
  ['⑧ goal 轮动作按 A2 同步 + A1 连跑动作', ['A1 连跑动作', '再次 enter_auto_mode 为该包建 goal', '目标代码区**有非预期改动']],
  ['⑨ 预算分档 + 场景2 只统计不控制', ['小包** C 运行 ≤4 / B 运行 ≤6 / 工作轮 ≤24', '大包** C 运行 ≤8 / B 运行 ≤8 / 工作轮 ≤48', '只统计不控制', '不设 C/B/工作轮三项硬上限']],
  ['⑩ grill 开场先问档位', ['开场先问档位', '缺省不再固定「标准」', '短链任务按轻量']],
]
for (const [label, needles] of items) {
  const missing = needles.filter((n) => !persona.includes(n))
  check(`T2-4 ${label}`, missing.length === 0, missing.length ? `缺：${missing.join(' / ')}` : `判据 ${needles.length} 条全中`)
}

// ── 附加：旧语义残留（不得再出现的写法）────────────────────────────────────
const stale = [
  ['旧铁律「永不修改 02-代码/」', '永不修改 02-代码/'],
  ['旧预算默认档「C 运行 ≤4 / B 运行 ≤4 / 工作轮 ≤24」独有措辞（缺分档）', '（缺省按 03-开发协同/预算基线.md 默认档'],
  ['旧「一包一授权」正文（应已改为 A1 连跑）', '一包一授权；先确认任务包'],
  ['旧过程记录路径 过程记录/01_计划审核.md', '过程记录/01_计划审核.md'],
  ['旧调度员验证环节行', '待验证 → 你自己'],
]
for (const [label, needle] of stale) {
  check(`T2-5 无旧语义残留：${label}`, !persona.includes(needle))
}

// ── T2-TP2 增量：六项机制的 persona 落点判据 ──────────────────────────────
const tp2Items = [
  ['⑪ M2 派工三段式原子对（dispatch_begin/end/status + 悬空识别）',
    ['dispatch_begin(taskDir, 环节, 角色)', 'dispatch_end(taskDir, runId, 结论)', 'dispatch_status(taskDir)',
      '达上限即派工前拒绝', '阶段前移合法性校验', '悬空', '`run_in_background:true` 后台派工']],
  ['⑫ M4 显式规范版本 fail-closed（状态头强制字段 + 台账必填）',
    ['强制字段 `规范版本`', '缺失/未知/v1.1 一律 fail-closed 拒绝', '不再由字段有无推断版本', '机器复核一次上限']],
  ['⑬ M3 幂等防护 + 24/48 解耦注记 + 固定 objective 文案',
    ['幂等防护（M3）', '只启动一次', '不得发起', '运行时幂等拦截接线另立项', '权威以 goal 工具与台账为准',
      '推进goal / goal状态 / 启动revision', '解耦注记（E-e）', '「推进 <任务目录名> 到『待人工测试』」']],
  ['⑭ M5 设计冻结（关卡1 生成设计基线.json + 改则重生成）',
    ['M5 设计冻结', '设计基线.json', '基线ID', 'SHA-256', '重走关卡1 并重新生成基线']],
  ['⑮ M1 两层状态源（产品状态.md 承担设计九态）',
    ['两层状态源 · M1', '产品状态.md', '别把设计期状态写进任务包状态头']],
  ['⑯ P2-1 修复包归属（状态头三字段 + 父子同步）',
    ['repairOf`=父包名', 'issueId`=用户实测问题编号', 'parentCandidateCommit`=被修复的父包候选 commit', '修复包父子同步口径（P2-1）']],
  ['⑰ T8 顺手项 E-a~E-d（阶段值纪律 / 幻影感知 / read 优先 / 量化可复算）',
    ['阶段值纪律（E-a 加固）', '幻影感知核查口径', '读文件用 read 工具优先', '量化陈述须可复算']],
  ['⑱ TP-A1-D3 计划审核第 4 项（跨改动点冲突扫描）',
    ['**第 4 项＝跨改动点冲突扫描**', '**只列确实共享的组合**', '无共享项（已核查 D1~Dn 两两关系）',
      '改动点A | 改动点B | 共享项 | A产出 | B消费 | 发现 | 处置', '计划评审-vX.Y.md', '不得自行裁定技术冲突']],
  ['⑲ TP-A1-D5 派工材料分层（五要素 + 入库/.tmp 分层）',
    ['【派工材料分层', '**只含五要素**', '任务目标 / 必读文件路径 / 本轮新增裁定 / 输出契约 / 停止条件',
      '以路径给出', '**权威材料必须入库**', '**可再生的材料才放 `.tmp/`**']],
  ['⑳ TP-A1-D6/D8② 授权合并 + #32 提示移至定稿确认时',
    ['**#32 配置提示（定稿确认时，仅首包一次', '**仅首包一次**', '修改从下一会话生效，本次推进沿用现配置',
      '**＝开发授权 · #33 授权合并**', '设计确认即开发授权', '「确认即开工」/「仅定稿存档」',
      '**机械动作，非人工关卡**', '「一包一授权」均已作废']],
]
for (const [label, needles] of tp2Items) {
  const missing = needles.filter((n) => !persona.includes(n))
  check(`T2-6 ${label}`, missing.length === 0, missing.length ? `缺：${missing.join(' / ')}` : `判据 ${needles.length} 条全中`)
}

// ── TP-A2 增量：修复质量三改动的 persona 落点判据 ────────────────────────────
const tpA2Items = [
  ['㉑ TP-A2-D3 loadBearing 字段（代码审查 + 修复审查两处；判定权归审核员）',
    ['每条发现必标 `loadBearing：承重/非承重`', '判定权归审核员，调度员只统计 #29',
      '每条发现标 `loadBearing：承重/非承重`']],
  ['㉒ TP-A2-D4 审核纪律 P1-8 重写（三层规则）',
    ['不机械重复全量测试套件', '选择性独立复跑', '仍不可读且无法独立复验时按「证据缺失」驳回']],
  ['㉓ TP-A2-D5 开发员派工句（能证明失败的最小可运行检查）',
    ['能证明失败**的最小可运行检查', '附修复前失败输出']],
]
for (const [label, needles] of tpA2Items) {
  const missing = needles.filter((n) => !persona.includes(n))
  check(`T2-7 ${label}`, missing.length === 0, missing.length ? `缺：${missing.join(' / ')}` : `判据 ${needles.length} 条全中`)
}
check('T2-8 无旧派工句残留（「留一个最小可运行检查（随自测证据提交）」应已被 TP-A2-D5 改写）',
  !persona.includes('留一个最小可运行检查（随自测证据提交）'), '旧句零命中')

// ── TP-C 增量：运行安全三层机制的 persona 落点判据 ────────────────────────────
const tpCItems = [
  ['㉔ TP-C-D1 三问裁定（写不出不点火 + 三强原则 + 尺度感）',
    ['写不出不点火', '改动形态——改几个文件、什么类型、条件项裁决没有', '验证成本与改动形态匹配',
      '程序性指令不甩手册', '人工级验证归用户', '秒级=热拷贝/curl', '数十分钟级=全量打包']],
  ['㉕ TP-C-D2 五条刹车纪律 + 心跳义务（上报原句 + 心跳格式/路径）',
    ['「上报是合格交付，死磕是失败」', '同一手段连续 2 次未取得新信息即停',
      'HH:MM | 节点 | 一句话', '.tmp/<TP>/heartbeat-<runId>.md']],
  ['㉖ TP-C-D3 计划审核第 5 项判断题',
    ['计划审核第 5 项（判断题）', '调度员的验证口径与改动形态匹配吗']],
  ['㉗ TP-C-D4 看门狗（后台派工 + tick + 两指纹 + L0~L3 + 裁定四件套 + 参数表）',
    ['【看门狗', '`run_in_background:true` 后台派工', '重复指纹', '违规指纹',
      'L0', 'L1', 'L2', 'L3', '裁定四件套', 'tick 15~30 分钟', 'dispatch_end(INTERRUPTED)']],
  ['㉘ TP-C-D5 孤儿子代理接管（list_agents → 接管或结算）',
    ['孤儿接管', 'list_agents', '接管续跑看门狗', 'interrupt_agent` 结算']],
]
for (const [label, needles] of tpCItems) {
  const missing = needles.filter((n) => !persona.includes(n))
  check(`T2-9 ${label}`, missing.length === 0, missing.length ? `缺：${missing.join(' / ')}` : `判据 ${needles.length} 条全中`)
}
check('T2-10 无旧前景阻塞派工口径残留（应已被 TP-C-D4 改为后台派工）',
  !persona.includes('run_in_background:false 前景阻塞'), '旧口径零命中')

// ── TP-C-修复1 增量：v2.4.0 六项合并修复的 persona 落点判据 ───────────────────
const tpCRepairItems = [
  ['㉙ TP-C-修复1 R-D3 三问来源约束句（来源=任务包 02/既有材料；答不出→待修订；禁现场读码勘察）',
    ['三问答案一律出自任务包 02 与设计期既有材料', '答不出即计划欠账，回待修订补 02',
      '不得为答三问现场读码勘察']],
]
for (const [label, needles] of tpCRepairItems) {
  const missing = needles.filter((n) => !persona.includes(n))
  check(`T2-11 ${label}`, missing.length === 0, missing.length ? `缺：${missing.join(' / ')}` : `判据 ${needles.length} 条全中`)
}
check('T2-12 M3 旧宣称零命中（回写进状态头 / 会被机器拒绝 / 幂等拒绝 均不得再出现）',
  !persona.includes('回写进状态头') && !persona.includes('会被机器拒绝') && !persona.includes('幂等拒绝'),
  '旧宣称零命中')

// ── TP-D1 增量：文本层沉淀五段的 persona 落点判据（跨项目复盘沉淀首包）──────────
const tpD1Items = [
  ['㉚ TP-D1-D1 瘦身重组（重复语义合并为单一权威句：全式仅一处、短式两处）',
    ['先写产出最后更新状态.md（写临时文件+Move-Item -Force 原子替换）', '新环节驳回轮次清零']],
  ['㉛ TP-D1-D2 预算触顶放弃驳回＝决策简报触发条件',
    ['因预算触顶而放弃驳回', '不得静默延后']],
  ['㉜ TP-D1-D3 证据采集口径三义务（禁 plain > 捕 Write-Host / 空壳自检 / 算术一致）',
    ['禁 plain `>` 捕含 Write-Host 的输出', '证据文件非空壳自检', '统计行与逐项证据算术一致']],
  ['㉝ TP-D1-D4 驳回修复边界默认条款（边界清单 + 默认禁改驳回项以外逻辑）',
    ['驳回必须给出修复边界清单', '默认禁止改动驳回项以外的代码逻辑']],
  ['㉞ TP-D1-D5 环境事实前置核查 + 计划审核第 5 项「未验证」核查句',
    ['生成 02 前对环境事实做前置核查', '「未验证」标注是否如实']],
]
for (const [label, needles] of tpD1Items) {
  const missing = needles.filter((n) => !persona.includes(n))
  check(`T2-14 ${label}`, missing.length === 0, missing.length ? `缺：${missing.join(' / ')}` : `判据 ${needles.length} 条全中`)
}
check('T2-15 D1 合并句命中数精确（全式 1 处 / 短式 2 处）',
  (persona.split('先写产出最后更新状态.md（写临时文件+Move-Item -Force 原子替换）').length - 1) === 1 &&
  (persona.split('先写产出最后更新状态.md').length - 1) === 2 &&
  (persona.split('新环节驳回轮次清零').length - 1) === 1,
  `全式=${persona.split('先写产出最后更新状态.md（写临时文件+Move-Item -Force 原子替换）').length - 1} 短式=${persona.split('先写产出最后更新状态.md').length - 1} 清零=${persona.split('新环节驳回轮次清零').length - 1}`)

// ── R-D1 banner 句改核验（lib/index.js 可读入校验）────────────────────────────
const bannerText = readFileSync(join(ORCH2, 'lib', 'index.js'), 'utf8')
check('T2-13 banner 新口径命中且旧口径零命中（R-D1 / ISS-1）',
  bannerText.includes('调度引擎后台派工+看门狗轮内 tick 值班驱动')
    && !bannerText.includes('调度引擎前景阻塞派工驱动'),
  'banner 口径已如实化')

// ── TP-D2 增量：合并测试正式语义的 persona 落点判据（跨项目复盘沉淀第二包）──────
const tpD2Items = [
  ['㊱ TP-D2-D2【快速通道与欠账】段（四形态+六要素+预算三句+待人工测试态三件套）',
    ['【快速通道与欠账（v2.1.2 · TP-D2）】', '四形态分名分义', '**快速通道**＝用户显式授权豁免指定 B 环节',
      '**合并测试**＝多包各自走完全流程', '**归并**＝审核员在 AC 核验中单包裁定', '**直修**＝免流水线单点修复',
      '调度员判断＋用户授权双键', '授权四要素＝原话逐字转录／授权编号／**授权对象分列**', '失效边界',
      '`FT-<包>-N` 唯一', '复审重点（预写，延后消费）', '覆盖清单写死', '未清偿·已清偿·失效回落',
      '转 X 消失则回落未清偿', '集中复审双触发＝产品任务验收前欠账必须清零 **或** 累计达授权上限条数即触发',
      '复审后修改须审核员复看', '豁免 B 不豁免取证',
      '计 0、不占该包 B 上限', '「快速通道-<授权编号>」', '集中复审＝独立 B 派工记一行',
      '改动即欠账', '后续测试窗口**必复验**', '必须**写切回路径**']],
  ['㊲ TP-D2-D5 触顶简报第三选项话术 + 抬档入账三处条款',
    ['预算触顶决策简报选项集（三选项，预写各选项落盘动作）', '**方案一 扩档**', '**方案二 快速通道**',
      '**方案三 缩小范围**', '入账三处（任务包 02 §九预算块＋预算台账上限行＋决策记录裁决条目）',
      '**不得默认推荐跳过（快速通道）**', '取舍权归用户当场风险判断']],
  ['㊳ TP-D2-D8 验收小结固定七节（阶段二第5条改写 + 待构建更新复测同口径）',
    ['**验收小结固定七节**', '七节', '缺节即交付不合格', '改动规模（文件数+新增/删除/net 行数',
      '建议测试路径（最小实测顺序', '复测交付小结同七节口径']],
]
for (const [label, needles] of tpD2Items) {
  const missing = needles.filter((n) => !persona.includes(n))
  check(`T2-16 ${label}`, missing.length === 0, missing.length ? `缺：${missing.join(' / ')}` : `判据 ${needles.length} 条全中`)
}

// ── TP1 增量：人读汇报形态优化 + ponytail 清偿 + 钉模型回源的 persona 落点判据 ────
const tp1Items = [
  ['㊴ TP1-D1 产物双清单纪律小节（两清单成员 + 第一消费者判定规则）',
    ['【产物双清单纪律】', '人读清单＝七节验收小结/决策简报/当面汇报/项目看板/测试入口说明',
      'AI 间通信清单＝派工 prompt/状态.md 固定块/预算台账/工作证据三件', '判定规则＝第一消费者是人还是模型',
      'AI 间通信不做人读化、以省 token 为主', '仅人读清单允许可读性优化']],
  ['㊵ TP1-D2 人读形状约束（answer-first + 首尾自检 + 禁止压缩证据；决策简报句同补）',
    ['answer-first（①结论一行首置）', '首尾自检（⑦请你做的事与①结论呼应）',
      '禁止为省 token 压缩证据——证据/核验/风险优先于简洁', '决策简报同样 answer-first']],
  ['㊶ TP1-D3 展示层上限声明（审核员派工模板句，与代码审查模板同句）',
    ['展示层上限——形状约束不构成内容正确性证据', '涉及展示/措辞类 AC 时，AC 证据核验须声明']],
  ['㊷ TP1-D4 ponytail 七档（第 2 档＝本仓库已有→复用，不重写）',
    ['七档阶梯（第 2 档＝本仓库已有→复用，不重写）',
      '需求不存在→本仓库已有→复用，不重写→标准库→平台原生→已装依赖→一行代码→最小实现']],
]
for (const [label, needles] of tp1Items) {
  const missing = needles.filter((n) => !persona.includes(n))
  check(`T2-17 ${label}`, missing.length === 0, missing.length ? `缺：${missing.join(' / ')}` : `判据 ${needles.length} 条全中`)
}
check('T2-18 无六档旧枚举残留（「六档阶梯」零命中）', !persona.includes('六档阶梯'), '旧枚举零命中')
// TP1-D5 MIT 署名行两处逐字一致（yml 注释行 + persona【ponytail 注入】段末各一处）
const SIGN = 'MIT, © 2026 DietrichGebert — 基线 v4.10.0 / commit e3ba2aa6f1e6f0bc4d69eb09c9f0d0a93af56156'
check('T2-19 TP1-D5 署名行两处存在且逐字一致',
  cordisText.split(SIGN).length - 1 === 2, `署名行命中 ${cordisText.split(SIGN).length - 1} 处（应=2）`)
// T2-20（T3-TP1 · D6 义务③）：官方三行删除后「备选」注释锚失效 → 锚点迁移到新装配形态。
// 迁移选择：保留该断言的**锚定职能**（角色模型装配在 yml 里必须可读可查），改锚新语义——
// 旧两行「备选」注释零命中（退役）+ ./role-tools.mjs 装配行在位 + 六条路由语义注释在位。
// 理由：直接移除会让角色模型装配失去 persona 层人读锚（config-check T3e 只断机器结构）；
// 保留为负断言 + 新锚，能同时守住「旧行不得回来」与「新装配必须写明」。
const t220Missing = [
  ['旧锚 备选/K3 已退役', !cordisText.includes('备选：如需换回 K3')],
  ['旧锚 备选/glm 已退役', !cordisText.includes('备选：如需换回 glm')],
  ['./role-tools.mjs 装配行在位', /id: role-tools[\s\S]{0,60}name: \.\/role-tools\.mjs/.test(cordisText)],
  ['默认路由语义（deepseek-official/deepseek-flash + max）在位', cordisText.includes('deepseek-official/deepseek-flash + max')],
  ['降级路由语义（openai-codex/gpt-5.6-luna + xhigh）在位', cordisText.includes('openai-codex/gpt-5.6-luna + xhigh')],
  ['审核员默认值（volcengine/glm-5.3）在位', cordisText.includes('volcengine/glm-5.3')],
  ['审核员降级值（openai-codex/gpt-6.1-sol）在位', cordisText.includes('openai-codex/gpt-6.1-sol')],
].filter(([, ok]) => !ok).map(([label]) => label)
check('T2-20 钉模型锚点迁移（T3-TP1 · D6）：旧「备选」注释退役 + ./role-tools.mjs 装配与六条路由语义在位',
  t220Missing.length === 0,
  t220Missing.length ? `未命中：${t220Missing.join(' / ')}` : '7 条判据全中（旧锚退役 2 + 新装配锚 1 + 六条路由语义 4）')
// ── TP2 增量：SpecKit 证据裁决口径落地的 persona 同步句（D1~D4 + D5③）─────────
const tpSkItems = [
  ['㊸ TP2-D1 修复审查证据等级句（审核员派工模板；三值+四态+退回条款）',
    ['修复审查证据等级（TP2-D1）', '「证据等级：完整/部分/缺失」', '「逐项状态：pass/fail/skipped/not-run」',
      '证据等级为部分/缺失时不得进入待构建更新、退回修复中']],
  ['㊹ TP2-D2 修复包闸门与根因契约句（非空不得置修复中 + 与 01 初判不符 + 新证据）',
    ['未决澄清项：[NEEDS CLARIFICATION]/无', '非空不得置修复中', '与 01 初判不符 + 新证据', '不得静默改口']],
  ['㊺ TP2-D3 正当扩围第三态句（判定权归审核员，无登记越界仍硬停）',
    ['正当扩围（新证据+理由）', '判定权归审核员，无登记越界仍硬停']],
  ['㊻ TP2-D4 上游指针句（与 repairOf/issueId/parentCandidateCommit 并列成链）',
    ['上游指针', '修复包 01 §一', '04-测试 测试记录 issueId=<编号>', '与状态头 repairOf/issueId/parentCandidateCommit 并列构成可追链']],
  ['㊼ TP2-D5 场景2 裁决门槛可退回条款（反证缺失退回 + 判据自定 + 不新增状态/环节/角色）',
    ['裁决门槛（TP2-D5，可退回条款）', '反证小节缺失即按对象退回重派', '评级判据自定，不给量化假装精确', '不新增状态/环节/角色']],
]
for (const [label, needles] of tpSkItems) {
  const missing = needles.filter((n) => !persona.includes(n))
  check(`T2-22 ${label}`, missing.length === 0, missing.length ? `缺：${missing.join(' / ')}` : `判据 ${needles.length} 条全中`)
}

// ── TP1-对话形态纪律增量：人读消息形状约束的 persona 落点判据 ─────────────────
// 回源：04 产品设计方案 v1.0 §三 TP1-D1~D5 + 06 设计定稿记录 v1.0 §五-1~5；
// 锚点词逐条清点见任务包 02 §三各改动点「产出」列。
// 计划评审 v1.0 第④项提示：断言绑定**小节内匹配**——先切出【对话形态纪律】小节再逐锚点匹配，
// 避免「首行」「分组」等通用词命中 persona 其他小节造成假绿。
const dlgStart = persona.indexOf('【对话形态纪律')
// 段落切法 CRLF 容忍：本仓库 core.autocrlf=true 且无 .gitattributes，全新检出为 CRLF——
// 故不按 '\n\n' 字面切分，改按「首个空行」正则切出小节（LF 工作区与 CRLF 检出同判）。
// ponytail: 小节切法用「首个空行」而非 YAML 结构定位——天花板：小节自身不得含空行（当前 11 行无空行）；
// 升级路径：若小节需要空行分段，改为显式起止标记或按标题正则切分。
const dlgSection = dlgStart >= 0 ? persona.slice(dlgStart).split(/\r?\n[ \t]*\r?\n/)[0] : ''
check('T2-23 TP1-D1 小节【对话形态纪律】存在且落在 persona 段落边界内',
  dlgSection.length > 0, `切片长度 ${dlgSection.length} B`)

const t2DlgItems = [
  ['㊽ TP1-D1【对话形态纪律】五条 + 适用范围句（第一消费者=人；AI 间不适用）',
    ['首行＝结论或请你做的事（一句', '结尾＝唯一下一步（2 分钟内可完成，写明怎么回话）', '首尾双问',
      '正文分组 ≤5', '**证据/核验/风险条目完整保留**', '证据优先于简洁', '时间给具体单位',
      '错误三件套＝位置＋原因＋修法', '第一消费者＝人', 'AI 间通信清单成员', '不适用、不人读化']],
  ['㊾ TP1-D2/D3 提问纪律句 + 过程消息一行制句（AC2 一验两改）',
    ['一次一个决策点', '选项 ≤4', '推荐置顶', 'ask_user_question',
      '过程消息一行制', '环节｜结果｜下一步', '以状态.md/台账为真源']],
  ['㊿ TP1-D4 不采用四项成文（四项齐 + 与措辞预算并存）',
    ['不采用', '不逐轮散文重述状态', '不删限定词', '不无差别删限定词',
      '列表 ≤5 不套 AC·证据·债务清单', '「输出更短」非优化目标']],
]
for (const [label, needles] of t2DlgItems) {
  const missing = needles.filter((n) => !dlgSection.includes(n))
  check(`T2-24 ${label}`, missing.length === 0, missing.length ? `缺：${missing.join(' / ')}` : `判据 ${needles.length} 条全中`)
}
// N-2（计划评审 v1.0）：新署名行按完整串匹配，与既有 ponytail 署名行（MIT, © 2026 DietrichGebert，
// T2-19 断言计数=2）区分——两条署名并存、互不计数。
const IHAVE_ADHD_SIGN = 'MIT, © 2026 Ayoub Ghriss'
const iHaveAdhdSignCount = cordisText.split(IHAVE_ADHD_SIGN).length - 1
check('T2-25 TP1-D4 i-have-adhd 署名行（小节内完整串命中 + 与 ponytail 署名行并存）',
  dlgSection.includes(IHAVE_ADHD_SIGN) && iHaveAdhdSignCount === 1 && cordisText.split(SIGN).length - 1 === 2,
  `小节内=${dlgSection.includes(IHAVE_ADHD_SIGN)} AyoubGhriss 计数=${iHaveAdhdSignCount}（应=1） ponytail 计数=${cordisText.split(SIGN).length - 1}（应=2）`)

// T2（02 §四）persona 字节预算断言：条款字数预算的机器护栏（此前套件无此断言，本包新增）。
// 预算 49152 B = 48 KiB；抬升须随包修订记录显式进行（token 税纪律，04 §五-1）。
const PERSONA_BYTE_CAP = 49152
check('T2-21 persona prefix 字节预算 ≤ 49152（条款字数预算机器护栏）',
  Buffer.byteLength(persona, 'utf8') <= PERSONA_BYTE_CAP,
  `当前 ${Buffer.byteLength(persona, 'utf8')} B / 上限 ${PERSONA_BYTE_CAP} B`)

writeResult()
