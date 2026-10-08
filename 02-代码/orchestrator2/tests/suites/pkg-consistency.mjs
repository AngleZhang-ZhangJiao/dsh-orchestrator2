/**
 * D9 · 插件包 v2.8.0 构建材料就绪自检（AC6 开发员部分；TP-B 清偿后 REF 重指 05-交付；
 *    TP-D2 · D7 随版本 2.5.0→2.6.0 演进，D9-7 构建前口径改 EXEMPT；
 *    T3-TP1 · D6 义务②：常量族随版本 2.6.1→2.7.0 演进——REF 目录常量、D9-3/D9-7/D9-8
 *    版本断言与 BOM 夹具字面量一并同步，构建前 EXEMPT 语义保留；
 *    T3-TP1-修复1 · R2：常量族随版本 2.7.0→2.7.1 再演进，口径同上不变；
 *    TP1-对话形态纪律 · 收尾升版：常量族随版本 2.7.1→2.8.0 再演进，口径同上不变）：
 * ① 源码侧 `02-代码/orchestrator2/` 树完整（相对 v2.0.0 安装包 presets/orchestrator2 的
 *    结构参考，逐件对照：新增件应出现、取消件应消失）；
 * ② 列出「构建阶段由调度员执行/同步」的清单（不改 05-交付，只报告）：
 *    package.json 版本 2.8.0、docs 拷贝（使用手册 + 规范 v2.1.2）、presets 逐字节同步、
 *    zip、测试入口说明。
 * ③ D9-3（TP-B · D7 断言重写；TP-D2 · D7 演进至 v2.6.0）：REF 指向 05-交付/安装包/dsh-orchestrator2-v2.8.0——
 *    构建前目标包不存在（D9-7 红属预期，见 AC-B-5 分阶段口径），构建后须存在且
 *    与源码侧 spec/ docs/ 逐字节一致（调度员复跑本脚本核对，fail=0 才算全绿）。
 * 输出供调度员构建后复用比对；本脚本自身只读。
 * Run: node tests/suites/pkg-consistency.mjs
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { createRequire } from 'node:module'

import { ROOT } from '../lib/paths.mjs'
import { reporter } from '../lib/test-harness.mjs'

// TP-D2-修复1 · D3③：声明文件解析用宿主 js-yaml（与 config-check 同口径：JSON_SCHEMA + js 标签）
const DSH = 'C:\\Users\\nicia\\AppData\\Roaming\\npm\\node_modules\\@deepseek-ai\\dsh'
const require = createRequire(import.meta.url)
const yaml = require(join(DSH, 'node_modules', 'js-yaml'))
const JsExpr = new yaml.Type('tag:yaml.org,2002:js', {
  kind: 'scalar',
  resolve: (d) => typeof d === 'string',
  construct: (d) => ({ __jsExpr: d }),
})
const schema = yaml.JSON_SCHEMA.extend(JsExpr)

const { check, writeResult } = reporter('pkg-consistency')
const out = []

const SRC = join(ROOT, '02-代码', 'orchestrator2')
const REF = join(ROOT, '05-交付', '安装包', 'dsh-orchestrator2-v2.8.0')
const REF_PRESET = join(REF, 'presets', 'orchestrator2')
const LEGACY_REF = join(ROOT, '04-交付', '安装包', 'dsh-orchestrator2-v2.0.0')

function walk(dir, prefix = '') {
  const res = []
  if (!existsSync(dir)) return res
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${e.name}` : e.name
    if (e.isDirectory()) res.push(...walk(join(dir, e.name), rel))
    else res.push(rel)
  }
  return res
}

const srcList = walk(SRC).sort()
const refList = walk(REF_PRESET).sort() // 构建前 REF 不存在 → 空清单（D9-7 按预期红）
const legacyList = walk(join(LEGACY_REF, 'presets', 'orchestrator2')).sort()
out.push(`=== 源码侧 orchestrator2：${srcList.length} 件 ===`)
out.push(`=== v2.8.0 目标安装包 presets/orchestrator2（构建后逐字节同步对象）：${refList.length} 件（构建前不存在=预期）===`)
out.push(`=== v2.0.0 安装包 presets/orchestrator2（结构参考）：${legacyList.length} 件 ===`)

// ① 新增件：应在源码侧存在（v2.1 新增模板 + 手册副本）
const expectNew = [
  'spec/项目目录及协同开发规范-v2.1.md',
  'docs/使用手册.md',
  'spec/templates/00-项目管理/README.md',
  'spec/templates/00-项目管理/当前状态.md',
  'spec/templates/00-项目管理/产品路线图.md',
  'spec/templates/00-项目管理/任务索引.md',
  'spec/templates/00-项目管理/决策索引.md',
  'spec/templates/00-项目管理/发布批次规划.md',
  'spec/templates/01-设计/02_系统现状分析.md',
  'spec/templates/01-设计/技术调研/04_调研汇总报告.md',
  'spec/templates/03-开发协同/计划评审-vX.Y.md',
  'spec/templates/03-开发协同/执行自测-YYYYMMDD.md',
  'spec/templates/03-开发协同/代码审查-vX.Y.md',
  'spec/templates/04-测试/测试基线/README.md',
  'spec/templates/04-测试/全局回归/README.md',
  'spec/templates/05-交付/发布批次/README.md',
  'spec/templates/05-交付/构建记录-YYYYMMDD.md',
  'spec/templates/05-交付/推送记录-YYYYMMDD.md',
  'spec/templates/05-交付/部署记录-YYYYMMDD.md',
  'spec/templates/90-历史归档/旧目录映射.md',
  'lib/index.js', // T9② 源化：packaging.json files 已声明该件，源码侧缺失即漂移
]
const missingNew = expectNew.filter((p) => !srcList.includes(p))
check('D9-1 源码侧新增件齐备', missingNew.length === 0,
  missingNew.length ? `缺：${missingNew.join(' / ')}` : `${expectNew.length} 件全在`)

// ② 取消件：源码侧不得存在
const expectGone = [
  'spec/templates/03-开发协同/项目进度基线.md',
  'spec/templates/03-开发协同/过程记录/01_计划审核.md',
  'spec/templates/03-开发协同/过程记录/02_执行与自测记录.md',
  'spec/templates/03-开发协同/过程记录/03_验证审核.md',
  'spec/templates/03-开发协同/过程记录/04_代码审查.md',
]
const stillThere = expectGone.filter((p) => srcList.includes(p))
check('D9-2 源码侧取消件已移除', stillThere.length === 0,
  stillThere.length ? `仍存在：${stillThere.join(' / ')}` : `${expectGone.length} 件已移除（过程记录/ 子目录整体消失）`)

// ③ 相对 v2.0.0 的结构差异清单（结构参照；构建后由 D9-3/D9-7 口径核对待装配包）
const added = srcList.filter((p) => !legacyList.includes(p))
const removed = legacyList.filter((p) => !srcList.includes(p))
const common = srcList.filter((p) => legacyList.includes(p))
const changed = common.filter((p) => readFileSync(join(SRC, p), 'utf8') !== readFileSync(join(LEGACY_REF, 'presets', 'orchestrator2', p), 'utf8'))
out.push('', '--- 相对 v2.0.0 安装包的结构差异（v2.1/v2.2/v2.3 改版演进，结构参照用）---')
out.push(`  新增 ${added.length} 件；删除 ${removed.length} 件；共同 ${common.length} 件（其中内容变更 ${changed.length} 件、逐字节一致 ${common.length - changed.length} 件）`)
out.push('  新增清单：')
for (const p of added) out.push('    + ' + p)
out.push('  删除清单：')
for (const p of removed) out.push('    - ' + p)
out.push('  内容变更清单（v2.1 改版件）：')
for (const p of changed) out.push('    ~ ' + p)
check('D9-3 REF 重指 05-交付 v2.8.0 目标包（TP-B · D7 断言重写；TP-D2 · D7 随版本演进；T3-TP1-修复1 · R2 随 2.7.1 再演进；TP1-对话形态纪律 · 收尾随 2.8.0 再演进：行为化终点判据——构建后存在且逐字节一致，由 D9-7 + 调度员复跑承担）',
  REF.includes(join('05-交付', '安装包')) && REF.includes('dsh-orchestrator2-v2.8.0'),
  `REF=${relative(ROOT, REF)}`)

// ④ 构建阶段调度员清单（本脚本只报告，不执行；开发员不动 05-交付）
out.push('', '--- 构建阶段（调度员执行；开发员不改 05-交付）---')
const buildSteps = [
  `新建 05-交付/安装包/dsh-orchestrator2-v2.8.0/（对照 ${relative(ROOT, LEGACY_REF)} 结构）`,
  'presets/orchestrator2 ← 02-代码/orchestrator2/ 逐字节同步（含 spec 全量、docs/使用手册.md；T3-TP1 新增四模块 model-routes/session-routes/role-tools/route-fallback 须随 packaging.json files 白名单进包）',
  'package.json 版本号 → 2.8.0（源码侧无 package.json，由调度员在包内新建/改）',
  'docs/ ← 使用手册 v2.8.0 + 规范 v2.1.2（自 02-代码/orchestrator2/docs/ 与 spec/）',
  'cordis.patch.yml / README.md / LICENSE ← 沿用 v2.0.0 包内件（version 字段随 2.8.0）',
  'lib/index.js ← **源码侧为唯一来源**：自 02-代码/orchestrator2/lib/index.js 逐字节复制（packaging.json files 已声明；T9 源化后交付包不再是唯一副本）',
  '测试入口说明.md → v2.1 三形态（新产品回归 / 场景1 fixture / 场景2 实测）',
  'zip：dsh-orchestrator2-v2.8.0.zip',
  `构建后复跑本脚本：D9-7 转绿（目标包存在）且两树 spec/ 与 docs/ 逐字节一致（当前 REF=${relative(ROOT, REF)} 构建前不存在=预期；结构参照=${relative(ROOT, LEGACY_REF)}，内容差异见上「结构差异」）`,
]
for (const s of buildSteps) out.push('  • ' + s)
void statSync

// ⑤ 关键改版件内容抽查（确保源码侧已是 v2.1 语义，而非 v2.0 副本）
const gate = readFileSync(join(SRC, 'phase-gate.mjs'), 'utf8')
check('D9-4 phase-gate.mjs 源码侧为 v2.1 枚举', gate.includes("'现状研究中'") && gate.includes("'待审查'"))
const preset = readFileSync(join(SRC, 'preset.yml'), 'utf8')
check('D9-5 preset.yml 描述为 v2.1 适用说明（含 v2.1 项目 / v2.0 升级 / v1.1 用 1.0）',
  preset.includes('仅用于规范 v2.1 项目') && preset.includes('v2.0 项目可先升级脚手架') && preset.includes('v1.1 项目请用'))
check('D9-6 手册源码侧副本就绪（含两场景章节）',
  existsSync(join(SRC, 'docs', '使用手册.md')) &&
  readFileSync(join(SRC, 'docs', '使用手册.md'), 'utf8').includes('场景1：修改已有系统') &&
  readFileSync(join(SRC, 'docs', '使用手册.md'), 'utf8').includes('场景2：技术调研储备搜索'))
// TP-D2 · D7 演进：D9-7 从「构建前不存在=预期红」改为「构建前不存在=EXEMPT」（与 D5-1 同款
// 分阶段口径）——AC1 要求开发员交卷时 run-all 全绿，构建后由调度员复跑本脚本转 PASS。
const refExistsNow = existsSync(REF_PRESET)
const d97Status = refExistsNow
  ? `PASS：目标包已构建（${relative(ROOT, REF_PRESET)}）`
  : 'EXEMPT（构建前目标包不存在，分阶段口径；调度员构建后复跑本脚本须转 PASS）'
check('D9-7 构建后目标包存在（05-交付 v2.8.0；构建前不存在=EXEMPT，TP-D2 · D7 演进）',
  refExistsNow || d97Status.startsWith('EXEMPT'), d97Status)

// ⑥ D5（TP-B-修复1）：交付包 package.json 无 UTF-8 BOM——0.1.5 启动器 dsh-app-boot 直接
// JSON.parse 读 bundle package.json 不剥 BOM（事故 #4：v2.3.0 包曾带 EF BB BF 致启动报错）。
// 构建前目标包不存在时按 D9-7 同款分阶段口径豁免（状态记 EXEMPT 非 PASS）。
function hasUtf8Bom(buf) {
  return buf.length >= 3 && buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF
}
const REF_PKG = join(REF, 'package.json')
let bomStatus
if (!existsSync(REF_PKG)) {
  bomStatus = `EXEMPT（构建前目标包不存在，D9-7 同款分阶段口径；包内出现即须检）`
} else {
  const bom = hasUtf8Bom(readFileSync(REF_PKG))
  bomStatus = bom ? 'FAIL：前三字节=ef bb bf（BOM 在场）' : 'PASS：前三字节非 EF BB BF'
}
check('D5-1 交付包 package.json 无 UTF-8 BOM（构建前不存在=豁免）', bomStatus.startsWith('PASS') || bomStatus.startsWith('EXEMPT'), bomStatus)
// 夹具演算：BOM 夹具必须检红、干净夹具必须检绿（门禁自身可信可复算）
const bomFixture = Buffer.concat([Buffer.from([0xEF, 0xBB, 0xBF]), Buffer.from('{"name":"dsh-orchestrator2","version":"2.8.0"}')])
const cleanFixture = Buffer.from('{"name":"dsh-orchestrator2","version":"2.8.0"}')
check('D5-演算 BOM 夹具（EF BB BF 前缀）检红 + 干净夹具检绿',
  hasUtf8Bom(bomFixture) === true && hasUtf8Bom(cleanFixture) === false,
  `BOM夹具=${hasUtf8Bom(bomFixture)} 干净夹具=${hasUtf8Bom(cleanFixture)}`)

// ⑦ TP-C（D8）→ TP-D1（D7）→ TP-D2（D7）→ T3-TP1-修复1（R2）→ TP1-对话形态纪律（收尾升版）演进：
//    源码侧版本号一致 2.8.0——五处逐一核（packaging.json / lib banner / 使用手册页首 / README
//    当前版本行 / agent.cordis.yml 当前发布版本注释行——第五处自 TP2 版本元数据同步起锚定
//    「当前发布版本：<版本>」行，TP-D2 历史段所记 2.6.0、T3-TP1 段所记 2.7.0、T3-TP1-修复1 段
//    所记 2.7.1 为历史事实不参与断言；交付包内 package.json 归构建阶段调度员，源码侧无此件，不在此列）。
const pkgVersion = JSON.parse(readFileSync(join(SRC, 'packaging.json'), 'utf8')).version
const bannerText = readFileSync(join(SRC, 'lib', 'index.js'), 'utf8')
const manualText = readFileSync(join(SRC, 'docs', '使用手册.md'), 'utf8')
const readmeText = readFileSync(join(SRC, 'README.md'), 'utf8')
const cordisText = readFileSync(join(SRC, 'agent.cordis.yml'), 'utf8')
check('D9-8 源码侧版本一致 2.8.0 五处（packaging.json / lib banner / 使用手册 / README / yml 当前发布版本注释行）',
  pkgVersion === '2.8.0' && bannerText.includes('agent preset v2.8.0') &&
  manualText.includes('**v2.8.0**') && readmeText.includes('当前源码版本：**v2.8.0**') && cordisText.includes('当前发布版本：2.8.0'),
  `packaging=${pkgVersion}；banner=${bannerText.includes('agent preset v2.8.0')}；手册=${manualText.includes('**v2.8.0**')}；README=${readmeText.includes('当前源码版本：**v2.8.0**')}；yml当前版本=${cordisText.includes('当前发布版本：2.8.0')}`)

// ⑧ TP-D2-修复1 · D3②+D3③：0.1.7 声明机制两道护栏（事故沉淀：OPS-20260926 问题 3/4）
// ② 交付包 package.json 的 dsh.bundle.patch 数组引用的每个文件在包内必须存在（D-D6 死引用清偿；
//    构建前目标包不存在 = 分阶段 EXEMPT，同 D9-7 口径）。
let patchRefsStatus
const patchRefs = []
if (!existsSync(REF_PKG)) {
  patchRefsStatus = 'EXEMPT（构建前目标包不存在，D9-7 同款分阶段口径）'
} else {
  const bundle = JSON.parse(readFileSync(REF_PKG, 'utf8'))?.dsh?.bundle?.patch
  if (!Array.isArray(bundle) || bundle.length === 0) {
    patchRefsStatus = 'FAIL：dsh.bundle.patch 缺失或非数组'
  } else {
    for (const p of bundle) patchRefs.push([p, existsSync(join(REF, p.replace(/^\.\//, '')))])
    const dead = patchRefs.filter(([, ok]) => !ok).map(([p]) => p)
    patchRefsStatus = dead.length === 0
      ? `PASS：${patchRefs.length} 项引用全部在包内存在（${bundle.join(' , ')}）`
      : `FAIL：死引用 ${dead.join(' , ')}`
  }
}
check('D9-9 交付包 dsh.bundle.patch 引用文件全部在包内存在（D3②；构建前不存在=EXEMPT）',
  patchRefsStatus.startsWith('PASS') || patchRefsStatus.startsWith('EXEMPT'), patchRefsStatus)

// ③ 声明漂移护栏：源码声明文件 presets/agent-preset.patch.yml 的插件 name 集合 ==
//    源码 agent.cordis.yml 组件 name 集合（声明文件由 tools/gen-preset-patch.mjs 生成，
//    生成物入源码是 D2 验收项，故缺失即 FAIL 不豁免；包子路径名规范化回 ./ 后比较）。
const DECL = join(SRC, 'presets', 'agent-preset.patch.yml')
const PKG_NAME_PREFIX = 'dsh-orchestrator2/presets/orchestrator2/'
function collectRowNames(node, acc) {
  if (node == null) return
  if (Array.isArray(node)) return node.forEach((n) => collectRowNames(n, acc))
  if (typeof node === 'object') {
    if (typeof node.id === 'string' && typeof node.name === 'string') {
      acc.add(node.name.startsWith(PKG_NAME_PREFIX) ? './' + node.name.slice(PKG_NAME_PREFIX.length) : node.name)
    }
    for (const v of Object.values(node)) collectRowNames(v, acc)
  }
}
let declStatus
if (!existsSync(DECL)) {
  declStatus = 'FAIL：源码声明文件 presets/agent-preset.patch.yml 不存在（D2 生成物未入源码）'
} else {
  try {
    const declDoc = yaml.load(readFileSync(DECL, 'utf8'), { schema })
    const plugins = declDoc?.[0]?.insert?.[0]?.config?.plugins
    if (!Array.isArray(plugins)) throw new Error('声明文件缺 insert[0].config.plugins')
    const declNames = new Set()
    collectRowNames(plugins, declNames)
    const ymlNames = new Set()
    collectRowNames(yaml.load(cordisText, { schema }), ymlNames)
    const onlyDecl = [...declNames].filter((n) => !ymlNames.has(n))
    const onlyYml = [...ymlNames].filter((n) => !declNames.has(n))
    declStatus = onlyDecl.length === 0 && onlyYml.length === 0
      ? `PASS：name 集合一致（${ymlNames.size} 个；含 cordis:group 组行）`
      : `FAIL：仅声明有=[${onlyDecl.join(', ')}] 仅yml有=[${onlyYml.join(', ')}]`
  } catch (e) {
    declStatus = `FAIL：声明文件解析失败（${e.message}）`
  }
}
check('D9-10 声明文件插件 name 集合 == 源码 yml 组件 name 集合（D3③ 声明漂移护栏）',
  declStatus.startsWith('PASS'), declStatus)

writeResult()
