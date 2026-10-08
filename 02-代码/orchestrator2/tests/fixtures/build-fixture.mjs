/**
 * Build the e2e fixture toy six-zone projects under tests/fixtures/e2e-fixture-projects/.
 * fixture-valid's task-package docs are INSTANTIATED from the D2 templates
 * (回环验证: 模板不对则构建失败/回环失败), not handwritten.
 *
 * F-3（收编时发现并修复；M6 收编轮）：原实现要求**每个**占位符 token 都在模板里命中，
 * 否则抛「回环失败」。但 TP1 把本模板的 `02-代码/<模块>/<文件>` 改写为
 * `<目标代码区>/<模块>/<文件>`（目标代码区泛化）后，本脚本未同步 → 自 TP1 起
 * `build-fixture.mjs` 一直抛错、夹具只能靠磁盘上的存量副本继续被套件读取
 * （存量副本恰在改名之前生成，故此前套件全绿，属「存量掩盖」的潜伏缺陷）。
 * 收编后本脚本是夹具的**唯一来源**（scenarios/ 每次重建），必须能跑通：
 *   - 逐个 token 命中则替换、不命中则跳过并记入 skipped（模板演进时不再硬失败）；
 *   - 回环验证责任移交给调用方：e2e-dryrun 断言「占位符已替换 + 模板专有标记行存在」，
 *     残留占位符仍会被该断言抓到（见 tests/suites/e2e-dryrun.mjs 回环断言）。
 */
import { mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { FX, TPL } from '../lib/paths.mjs'

const skipped = []

/** Instantiate one template into the design task dir with placeholders filled.
 * 缺失的 token 记入 skipped 并跳过（模板演进时不再硬失败）。 */
function instantiate(templateRel, targetPath, tokens) {
  let text = readFileSync(join(TPL, templateRel), 'utf8')
  for (const [from, to] of Object.entries(tokens)) {
    if (!text.includes(from)) {
      skipped.push(`${templateRel} 缺占位符 ${from}`)
      continue
    }
    text = text.split(from).join(to)
  }
  mkdirSync(dirname(targetPath), { recursive: true })
  writeFileSync(targetPath, text, 'utf8')
}

/** Write one file, creating parents. */
function write(path, text) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, text, 'utf8')
}

const VALID_ROOT = join(FX, 'fixture-valid')
const DESIGN = '01-设计/玩具项目'
const TASK = '任务包/TP1-玩具功能'
const PRODUCT_DIR = join(VALID_ROOT, DESIGN)
const TASK_DIR = join(VALID_ROOT, DESIGN, TASK)
const COORD = join(VALID_ROOT, '03-开发协同', 'TP1-玩具功能')

// 只清理本项目目录，不动脚本所在目录
rmSync(VALID_ROOT, { recursive: true, force: true })
rmSync(join(FX, 'fixture-legacy'), { recursive: true, force: true })
rmSync(join(FX, 'scenarios'), { recursive: true, force: true })
mkdirSync(FX, { recursive: true })

// ── fixture-valid：玩具五区项目（合法包）───────────────────────────────────

// 双区任务模板实例化（回环验证的载体：字节级来自模板 + 占位符替换）
instantiate('_任务模板/01_需求分析.md', join(TASK_DIR, '01_需求分析.md'), {
  '<TP编号>-<名>': 'TP1-玩具功能',
  '01-设计/<产品任务>/': '01-设计/玩具项目/',
  '<功能>': '玩具功能',
})
instantiate('_任务模板/02_开发方案与任务包.md', join(TASK_DIR, '02_开发方案与任务包.md'), {
  '03-开发协同/<TP编号>-<名>/': '03-开发协同/TP1-玩具功能/',   // 先替换限定 token，再替换通用 <TP编号>-<名>
  '<TP编号>-<名>': 'TP1-玩具功能',
  '01-设计/<产品任务>/': '01-设计/玩具项目/',
  '<目标代码区>/<模块>/<文件>': '02-代码/玩具模块/toy.js',
  '05-交付/安装包/<名>-v<版本>/': '05-交付/安装包/toy-v1.0/',
  '<模块>': '玩具模块',
  '<环节>': '计划审核',
})

// 04 / 06 在设计目录的上级产品任务目录（正确层级），06 带确认版本固定块
write(join(PRODUCT_DIR, '04_产品设计方案.md'), `# 04 · 产品设计方案（玩具项目）

> 版本：v1.0

玩具五区项目的总体方案（fixture 占位）。

## 风险与待决策事项

（本清单是设计决策清点输入清单）
`)

write(join(PRODUCT_DIR, '06_设计定稿记录.md'), `---
文档：06_设计定稿记录
确认版本：v1.0
确认日期：2026-09-07
设计目录：01-设计/玩具项目
---

# 06 · 设计定稿记录（玩具项目）

fixture 占位：定稿结论。

## 决策清点段

无未清零项。
`)

// 协同区：状态.md（v2.x 头全字段，含 M4 强制 规范版本）+ 预算台账.md（固定块可解析）
write(join(COORD, '状态.md'), `当前阶段：待审核
当前环节负责方：审核员
任务类型：大任务
规范版本：v2.1
流程类型：产品设计全流程
设计目录：${DESIGN}/${TASK}
本环节驳回轮次：0
候选commit：无
下一步：审核员计划审核 → 通过后用户说「开始自动推进」
必读文件：${DESIGN}/${TASK}/02_开发方案与任务包.md
最近更新：2026-09-07 00:00
阻塞/待办：无
`)
/** 写一份固定块可解析的预算台账（M4 起：v2.x + 非「技术调研储备」流程类型为必填件）。 */
function writeLedger(taskName, taskRel) {
  write(join(VALID_ROOT, '03-开发协同', taskName, '预算台账.md'), `任务包：${taskName}
预算块引用：${taskRel}/02_开发方案与任务包.md §预算块
上限：C运行≤4 / B运行≤4 / 工作轮≤24（仅三项硬上限；token 用量仅统计，不作停机依据）
当前累计：C运行=0 / B运行=0 / 工作轮=0 / token用量=—
最近更新：2026-09-07 00:00
---
| 时间 | 环节 | 模型 | 结论 | 累计C运行 | 累计B运行 | 累计工作轮 | token用量 |
|---|---|---|---|---|---|---|---|
`)
}

writeLedger('TP1-玩具功能', `${DESIGN}/${TASK}`)

// 他包（未激活）：待启动 —— 单包校验必须放行（台账同为必填件）
write(join(VALID_ROOT, '03-开发协同', 'TP2-闲置包', '状态.md'), `当前阶段：待启动
当前环节负责方：调度员
任务类型：大任务
规范版本：v2.1
流程类型：产品设计全流程
设计目录：${DESIGN}/任务包/TP2-闲置包
本环节驳回轮次：0
候选commit：无
下一步：待前置包完成后再激活
必读文件：${DESIGN}/任务包/TP2-闲置包/02_开发方案与任务包.md
最近更新：2026-09-07 00:00
阻塞/待办：无
`)
writeLedger('TP2-闲置包', `${DESIGN}/任务包/TP2-闲置包`)

// ── fixture-legacy：v1.1 旧式状态头（无设计目录字段）+ 开发计划/01、02 ───
// M4 起「规范版本」是强制字段；v1.1 值必须被显式拒绝（不再由缺设计目录推断版本）。
const LEGACY_ROOT = join(FX, 'fixture-legacy')
const LEGACY_TASK = join(LEGACY_ROOT, '03-开发协同', 'TL1-旧任务')
write(join(LEGACY_TASK, '状态.md'), `当前阶段：待审核
当前环节负责方：模型B
任务类型：大任务
规范版本：v1.1
本环节驳回轮次：0
候选commit：无
下一步：计划审核
必读文件：开发计划/02_开发方案与任务包.md
最近更新：2026-09-07 00:00
阻塞/待办：无
`)
write(join(LEGACY_TASK, '开发计划', '01_需求分析.md'), '# 01 · 需求分析（TL1-旧任务）\n\nfixture 占位。\n')
write(join(LEGACY_TASK, '开发计划', '02_开发方案与任务包.md'), '# 02 · 开发方案与任务包（TL1-旧任务）\n\nfixture 占位。\n')

console.log('[build-fixture] 完成：', FX)
console.log('[build-fixture] fixture-valid/ 与 fixture-legacy/ 已生成（回环：任务包文档由 D2 模板实例化）')
if (skipped.length > 0) {
  console.log(`[build-fixture] 跳过 ${skipped.length} 个模板未含占位符（模板演进；残留占位符由 e2e-dryrun 回环断言兜底）：`)
  for (const s of skipped) console.log('  - ' + s)
}
