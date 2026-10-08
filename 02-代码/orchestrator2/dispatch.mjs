/**
 * Orchestrator2 dispatch half-step: the atomic pair around a subagent dispatch.
 *
 * Registers four model-facing tools that the scheduler must call as
 * `dispatch_begin → subagent_* → dispatch_end` (persona 【阶段二】三段式),
 * plus `dispatch_status`（恢复轮视图）与 `dispatch_migrate`（旧台账迁移）：
 *
 *   dispatch_begin(taskDir, 环节, 角色)
 *     原子完成：读 状态.md 固定块（fail-closed）→ 读 预算台账.md 固定块对照
 *     任务包预算块三项硬上限（**达上限即派工前拒绝**）→ 台账 schema v2 惰性升级
 *     （v1 → v2：补身份行+新列，写回前备份 v1 原文）→ 写 <taskDir>/.lock
 *     （内容含 环节/角色/时间戳/runId）→ 台账**预登记**一行（结论列 = 已派工，
 *     runId 列 = 完整 runId）→ 返回 runId。
 *
 *   dispatch_end(taskDir, runId, 结论, 结果态?)
 *     原子完成：读 .lock 核对 runId（防跨轮错配）→ 阶段前移合法性校验
 *     （结果态 DONE/DONE_WITH_CONCERNS 要求阶段已前移；DONE_WITH_CONCERNS 另要求
 *     执行自测文档含「concerns」固定小节，否则按证据缺失拒绝结算保留锁；
 *     NEEDS_CONTEXT/BLOCKED/FAILED/INTERRUPTED 四态允许不前移——仍结算本行、
 *     计次、释放锁，消息明示下一步）→ 台账按**完整 runId 精确匹配**回填该行
 *     （结论列 = 中文摘要照旧 +〔结果态枚举〕+ 结算后阶段/候选commit/token）
 *     → 删锁。无「第一条已派工行」回退路径：找不到 runId 对应的已派工行 =
 *     拒绝回填并保留锁。
 *
 *   dispatch_status(taskDir)（恢复轮用）
 *     台账明细 + 悬空识别 + **四方一致检查**（账本身份行 vs 状态.md 头 vs
 *     候选 commit vs 证据文件存在性）+ **续跑建议**（已有「通过结论行」
 *     = 结论列状态词为 DONE 或 DONE_WITH_CONCERNS 的结算行——的环节不得重派，
 *     指向第一个无结论环节）。
 *
 *   dispatch_migrate(taskDir)（D5 旧台账迁移）
 *     v1 → v2 一次性转换：补身份行（taskId/repoRelativeTaskPath/flowType 从任务
 *     目录与状态头推断）→ 明细列补齐（runId 等缺列填「—」）→ 不可解析行原样
 *     保留并标注；写回前备份原文到 预算台账-v1备份-YYYYMMDD.md；已是 v2 则空操作。
 *
 * 恢复轮语义：台账里存在「已派工」行且 <taskDir>/.lock 仍在 → 该环节为**悬空**
 * （派工已点火、回填未完成），凭 `dispatch_status` 即可一眼识别，不必猜。
 *
 * 形态说明（T0 只读探查结论 = 形态 A）：本模块与 `phase-gate.mjs` / `budget.mjs`
 * 同为**预设内本地插件**——`agent.cordis.yml` 里以相对路径 `./dispatch.mjs` 声明，
 * 库加载器的 `tree.import()` 对以 `.` 开头的 name 走 `new URL(name, ctx.baseUrl)`
 * 解析（baseUrl = 预设目录），命中的正是「预设内工具模块」这一形态；零宿主改动、
 * 零新增权限面（与既有两个工具同层）。故**不需要**形态 B（CLI 子命令 + pwsh 调用）
 * 降级；降级预案仍保留在 persona 的 M2 段说明里，供宿主机制变更时切换。
 *
 * 台账 schema v2（TP-B · D1）：固定块增「账本身份」行
 *   账本身份：<taskId> | schemaVersion：2 | <repoRelativeTaskPath> | <flowType>
 * 明细表头增列 runId / attempt / 派工前阶段 / 结算后阶段 / candidateCommit /
 * evidencePath（身份不符 = 拒绝派工，防串档）。v1 台账在派工/迁移时惰性升级。
 * 本模块只做「预登记 / 回填 / 累计 +1 / 视图 / 迁移」五件事；固定块「当前累计」
 * 行与「最近更新」行同步重算（计划评审-v1.0 O-3）。
 */

import { existsSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { basename, isAbsolute, join, relative, sep } from 'node:path'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'orchestrator2-dispatch'

/** Hard dependencies: the tool registry only (state lives in the project's markdown). */
export const inject = ['tools']

/** 台账明细表头 v1（历史格式；用于识别并惰性升级）。 */
const LEDGER_HEADER_V1 = '| 时间 | 环节 | 模型 | 结论 | 累计C运行 | 累计B运行 | 累计工作轮 | token用量 |'
/** 台账明细表头 v2（与 spec/templates/03-开发协同/预算台账.md 严格一致）。 */
const LEDGER_HEADER_V2 = '| 时间 | 环节 | 模型 | 结论 | runId | attempt | 派工前阶段 | 结算后阶段 | candidateCommit | evidencePath | 累计C运行 | 累计B运行 | 累计工作轮 | token用量 |'
/** v2 结论列单元格内缀状态词的定界：中文摘要照旧 +〔STATE〕。 */
const STATE_TAG = /〔([A-Z_]+)〕/

/** 结果态六枚举（TP-B · D3；06 §二-3 映射：中断↔INTERRUPTED、失败↔FAILED、通过↔DONE/DWC）。 */
const RESULT_STATES = ['DONE', 'DONE_WITH_CONCERNS', 'NEEDS_CONTEXT', 'BLOCKED', 'FAILED', 'INTERRUPTED']

/** 台账固定块「上限」行里的三项上限。 */
const CAP_PATTERN = { c: /C运行≤(\d+)/, b: /B运行≤(\d+)/, r: /工作轮≤(\d+)/ }
/** 台账固定块「当前累计」行里的三项累计。 */
const USED_PATTERN = { c: /C运行=(\d+)/, b: /B运行=(\d+)/, r: /工作轮=(\d+)/ }

/** 角色 → 计次口径（B = 审核员 subagent_reviewer；C = 开发员 subagent_developer）。 */
const ROLE_TO_COUNTER = {
  subagent_reviewer: 'b',
  subagent_developer: 'c',
}
/** 角色枚举（宽松：允许「调度员」这类自办环节，但不计 B/C 次数）。 */
const ROLES = ['subagent_reviewer', 'subagent_developer', 'subagent_researcher', '调度员']

/** 环节 → 证据文件名的映射（dispatch_status 四方一致检查用；修复包加「修复」前缀）。 */
const EVIDENCE_PATTERNS = [
  [/计划审核|可行性复核/, /^计划评审-v.+\.md$/],
  [/代码审查/, /^代码审查-v.+\.md$/],
  [/修复/, /^修复(执行自测|代码审查)-.+\.md$/],
  [/执行与自测/, /^执行自测-.+\.md$/],
]

/** Render any thrown value the way the goal-round-driver does. */
function renderThrown(value) {
  return value instanceof Error ? value.message : String(value)
}

/** Whether one path exists and is a regular file. */
function isFile(path) {
  try {
    return statSync(path).isFile()
  } catch {
    return false
  }
}

/** 解析固定块（与 phase-gate.parseFixedBlock 同规则的最小实现）。 */
function parseFixedBlock(text) {
  const fields = new Map()
  const lines = String(text).split(/\r\n|\r|\n/)
  let i = 0
  while (i < lines.length && lines[i].trim() === '') i++
  while (i < lines.length && lines[i].trim() === '---') i++
  for (; i < lines.length; i++) {
    const line = lines[i].trimEnd()
    if (line.length === 0 || line.trim() === '---') break
    const sep = line.indexOf('：')
    if (sep <= 0) break
    const key = line.slice(0, sep).trim()
    const value = line.slice(sep + 1).trim()
    if (key.length === 0 || fields.has(key)) break
    fields.set(key, value)
  }
  return fields
}

/** 读文件的固定块；不可读/不可解析返回 undefined。 */
function fixedBlockOf(path) {
  if (!isFile(path)) return undefined
  try {
    return parseFixedBlock(readFileSync(path, 'utf8'))
  } catch {
    return undefined
  }
}

/** ISO 本地时间戳（台账「时间」列口径：YYYY-MM-DD HH:MM）。 */
function nowStamp() {
  const d = new Date()
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

/** 备份文件名日期口径：YYYYMMDD。 */
function todayCompact() {
  return nowStamp().slice(0, 10).replace(/-/g, '')
}

/** 解析任务目录入参 → 绝对路径。 */
function resolveTaskDir(rootDir, input) {
  const trimmed = typeof input === 'string' ? input.trim() : ''
  if (trimmed.length === 0) return undefined
  return isAbsolute(trimmed) ? trimmed : join(rootDir, trimmed)
}

/** 项目根：会话工作区 cwd，缺省进程 cwd（与 phase-gate 同口径）。 */
function sessionRoot(agent) {
  const cwd = agent?.session?.header?.cwd
  if (typeof cwd === 'string' && cwd.length > 0) return cwd
  return process.cwd()
}

/** 任务目录相对项目根的正斜杠路径（账本身份行口径）。 */
function relTaskPath(rootDir, taskDir) {
  return relative(rootDir, taskDir).split(sep).join('/')
}

/** 把一行明细拆成单元格数组（去首尾空串、去空白）。 */
function splitCells(line) {
  return line.split('|').slice(1, -1).map((c) => c.trim())
}

/** 该行是否为表格分隔行（|---|---|…）。 */
function isSeparatorRow(line) {
  return /^\|[\s|:-]+\|$/.test(line.trim())
}

/**
 * 解析台账身份行：`账本身份：<taskId> | schemaVersion：2 | <repoRelativeTaskPath> | <flowType>`。
 * @returns {{taskId: string, schemaVersion: number, repoRelativeTaskPath: string, flowType: string} | undefined}
 */
function parseIdentity(text) {
  const m = text.match(/^账本身份：(.+)$/m)
  if (m === null) return undefined
  const parts = m[1].split(' | ').map((s) => s.trim())
  if (parts.length < 4) return undefined
  const sv = parts[1].match(/schemaVersion：(\d+)/)
  return {
    taskId: parts[0],
    schemaVersion: sv === null ? 1 : Number(sv[1]),
    repoRelativeTaskPath: parts[2],
    flowType: parts[3],
  }
}

/** 依据任务目录与状态头构造身份行文本。 */
function identityLineFor(rootDir, taskDir) {
  const header = fixedBlockOf(join(taskDir, '状态.md'))
  const flowType = header?.get('流程类型') ?? '—'
  return `账本身份：${basename(taskDir)} | schemaVersion：2 | ${relTaskPath(rootDir, taskDir)} | ${flowType}`
}

/**
 * v1 → v2 台账文本升级（纯字符串处理，保留人读 Markdown —— 与 P2-2 口径一致）。
 * 标准 v1 表头：换 v2 表头 + 既有数据行补 6 个「—」列；不可解析行原样保留并标注。
 * 非标准表头（历史自定义台账）：保留明细原样，仅补身份行 + 迁移标注。
 * @returns {{text: string, upgraded: boolean, note: string}}
 */
function upgradeLedgerText(text, rootDir, taskDir) {
  if (parseIdentity(text)?.schemaVersion === 2) {
    return { text, upgraded: false, note: '已是 schema v2' }
  }
  const lines = text.split(/\r\n|\r|\n/)
  const idLine = identityLineFor(rootDir, taskDir)
  // 身份行插在「任务包：」行之后（协同区台账第一行惯例），无该行则置顶。
  const anchor = lines.findIndex((l) => l.startsWith('任务包：'))
  lines.splice(anchor >= 0 ? anchor + 1 : 0, 0, idLine)

  const headerIdx = lines.findIndex((l) => l.trim() === LEDGER_HEADER_V1)
  let note = '标准 v1 → v2：明细列补齐（runId 等缺列填「—」）'
  if (headerIdx >= 0) {
    lines[headerIdx] = LEDGER_HEADER_V2
    for (let i = headerIdx + 1; i < lines.length; i++) {
      const l = lines[i]
      if (!l.startsWith('|')) break
      if (isSeparatorRow(l)) continue
      const cells = splitCells(l)
      // 标准 v1 数据行 = 8 列；新列插在「结论」之后（与 v2 表头列序一致）；其余按不可解析行处理。
      if (cells.length === 8) {
        lines[i] = `| ${[...cells.slice(0, 4), '—', '—', '—', '—', '—', '—', ...cells.slice(4)].join(' | ')} |`
      } else {
        lines.splice(i + 1, 0, '<!-- 迁移标注：上一行无法解析为 v1 明细行（列数不符），原样保留 -->')
        i++
      }
    }
  } else {
    note = '非标准表头：仅补身份行，明细原样保留（见迁移标注）'
    const tableIdx = lines.findIndex((l) => l.startsWith('|'))
    if (tableIdx >= 0) lines.splice(tableIdx, 0, '<!-- 迁移标注：本台账明细表头非标准 v1/v2 格式，明细行原样保留，仅补身份行 -->')
  }
  return { text: lines.join('\n'), upgraded: true, note }
}

/**
 * 读台账固定块（上限/当前累计）+ 身份行。
 * @returns {{ok: boolean, message: string, text?: string, caps?: object, useds?: object, identity?: object}}
 */
function readLedger(path) {
  if (!isFile(path)) {
    return { ok: false, message: `缺少 ${path}：v2.x 任务包的预算台账是机器保险丝必填件（先建台账再派工）。` }
  }
  let text
  try {
    text = readFileSync(path, 'utf8')
  } catch (error) {
    return { ok: false, message: `预算台账不可读（${path}）：${renderThrown(error)}。` }
  }
  const cap = text.match(/^上限：(.*)$/m)
  const used = text.match(/^当前累计：(.*)$/m)
  if (cap === undefined || used === undefined) {
    return { ok: false, message: `预算台账固定块不可解析（${path}）：需含「上限：…」与「当前累计：…」两行。` }
  }
  const pick = (pattern, source) => {
    const m = source.match(pattern)
    return m === null ? undefined : Number(m[1])
  }
  const caps = { c: pick(CAP_PATTERN.c, cap[1]), b: pick(CAP_PATTERN.b, cap[1]), r: pick(CAP_PATTERN.r, cap[1]) }
  const useds = { c: pick(USED_PATTERN.c, used[1]), b: pick(USED_PATTERN.b, used[1]), r: pick(USED_PATTERN.r, used[1]) }
  if ([caps.c, caps.b, caps.r, useds.c, useds.b, useds.r].some((n) => !Number.isFinite(n))) {
    return { ok: false, message: `预算台账固定块三项上限/累计不全（${path}）：上限需含 C运行≤N / B运行≤N / 工作轮≤N，当前累计需含 C运行= / B运行= / 工作轮=。` }
  }
  return { ok: true, message: '', text, caps, useds, identity: parseIdentity(text) }
}

/** 把「当前累计」行重算写回，并同步「最近更新」（计划评审-v1.0 O-3：预登记/回填均刷新）。 */
function writeUsageLine(text, useds, tokenText) {
  let next = text.replace(/^当前累计：.*$/m, `当前累计：C运行=${useds.c} / B运行=${useds.b} / 工作轮=${useds.r} / token用量=${tokenText}`)
  next = next.replace(/^最近更新：.*$/m, `最近更新：${nowStamp()}`)
  return next
}

/** 解析明细区数据行（v1/v2 表头均可定位）；返回行号索引（相对原始行数组）。 */
function ledgerRowsOf(text) {
  const lines = text.split(/\r\n|\r|\n/)
  const headerIdx = lines.findIndex((l) => l.trim() === LEDGER_HEADER_V2 || l.trim() === LEDGER_HEADER_V1)
  if (headerIdx < 0) return { rows: [], v2: false, lines }
  const v2 = lines[headerIdx].trim() === LEDGER_HEADER_V2
  const rows = []
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const l = lines[i]
    if (!l.startsWith('|')) break
    if (isSeparatorRow(l)) continue
    rows.push({ idx: i, cells: splitCells(l) })
  }
  return { rows, v2, lines }
}

/** 台账明细行（schema v2 预登记行：结论列=已派工，runId 列=完整 runId）。 */
function ledgerRowV2(stamp, 环节, 模型, 结论, runId, attempt, beforePhase, useds, tokenText) {
  return `| ${stamp} | ${环节} | ${模型} | ${结论} | ${runId} | ${attempt} | ${beforePhase} | — | — | — | ${useds.c} | ${useds.b} | ${useds.r} | ${tokenText} |`
}

/** 把一行追加到明细表末尾（WAL 时序：插在最后一条表格行之后，保持账本 chronological）。 */
function appendLedgerRow(text, row) {
  const lines = text.split(/\r\n|\r|\n/)
  const headerIdx = lines.findIndex((l) => l.trim() === LEDGER_HEADER_V2 || l.trim() === LEDGER_HEADER_V1)
  if (headerIdx < 0) {
    return { ok: false, message: `预算台账缺少明细表头（v1/v2 均未找到）：${LEDGER_HEADER_V2}` }
  }
  // 明细区 = 表头之后连续的表格行（含分隔行）；新行插在其后（时序追加，不在表顶）。
  let insertAt = headerIdx + 1
  while (insertAt < lines.length && lines[insertAt].startsWith('|')) insertAt++
  lines.splice(insertAt, 0, row)
  return { ok: true, message: '', text: lines.join('\n') }
}

/** 环节在本台账已出现的次数 + 1（attempt 列口径：含预登记行）。 */
function nextAttempt(rows, 环节) {
  return rows.filter((r) => r.cells[1] === 环节).length + 1
}

/** 结论中文摘要 → 结果态推断（06 §二-3 映射；显式传「结果态」参数时不走此分支）。 */
function inferResultState(结论) {
  if (/中断/.test(结论)) return 'INTERRUPTED'
  if (/失败/.test(结论)) return 'FAILED'
  if (/concerns|疑点/i.test(结论)) return 'DONE_WITH_CONCERNS'
  if (/通过/.test(结论)) return 'DONE'
  return 'NEEDS_CONTEXT'
}

/** 执行自测文档是否含「concerns」固定小节（DONE_WITH_CONCERNS 的证据要求，D3）。 */
function hasConcernsSection(taskDir) {
  let files = []
  try {
    files = readdirSync(taskDir)
  } catch {
    return false
  }
  return files
    .filter((f) => /^(修复)?执行自测-.+\.md$/.test(f))
    .some((f) => {
      try {
        return /(^|\n)#+\s*concerns\b/im.test(readFileSync(join(taskDir, f), 'utf8'))
      } catch {
        return false
      }
    })
}

/** 工具参数 schema 片段。 */
const DISPATCH_BEGIN_PARAMETERS = {
  type: 'object',
  properties: {
    taskDir: { type: 'string', description: '任务目录路径：相对项目根（如 03-开发协同/TP1-<名>）或绝对路径。' },
    环节: { type: 'string', description: '本环节名（如 计划审核 / 执行与自测 / 代码审查 / 待修订）。' },
    角色: { type: 'string', description: `派工角色：${ROLES.join(' / ')}。subagent_reviewer 计 B 运行，subagent_developer 计 C 运行。` },
    模型: { type: 'string', description: '（可选）本环节实际使用的模型标识，写入台账「模型」列。' },
  },
  required: ['taskDir', '环节', '角色'],
  additionalProperties: false,
}

const DISPATCH_END_PARAMETERS = {
  type: 'object',
  properties: {
    taskDir: { type: 'string', description: '任务目录路径（与 dispatch_begin 同一值）。' },
    runId: { type: 'string', description: 'dispatch_begin 返回的 runId。' },
    结论: { type: 'string', description: '本环节结论中文摘要（如 通过 / 驳回轮次1 / 异常返回），照旧写入台账结论列。' },
    结果态: { type: 'string', description: `（可选）结果态六枚举：${RESULT_STATES.join(' / ')}。缺省按结论摘要推断（中断↔INTERRUPTED、失败↔FAILED、通过↔DONE/DONE_WITH_CONCERNS、其余 NEEDS_CONTEXT）。DONE/DONE_WITH_CONCERNS 要求阶段已前移；后四态不前移亦可结算（计次+释锁）。` },
    token用量: { type: 'string', description: '（可选）本环节 token 用量（仅统计），缺省保留原值。' },
  },
  required: ['taskDir', 'runId', '结论'],
  additionalProperties: false,
}

const DISPATCH_OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    ok: { type: 'boolean', description: '本原子操作是否成功。' },
    message: { type: 'string', description: '给调度器（模型）的结果文本。' },
    runId: { type: 'string', description: '派工标识（成功时）。' },
  },
  required: ['ok', 'message'],
  additionalProperties: false,
}

function result(ok, message, runId) {
  return { ok, message, ...(runId === undefined ? {} : { runId }) }
}

/** 锁文件路径与内容。 */
function lockPath(taskDir) {
  return join(taskDir, '.lock')
}

/** 不前移四态的下一步指引（dispatch_end 消息明示）。 */
function nextStepHint(state) {
  switch (state) {
    case 'NEEDS_CONTEXT':
      return '下一步：补充缺失上下文后下一轮重派本环节（不得同一模型原样重试）。'
    case 'BLOCKED':
      return '下一步：消除阻塞（依赖/环境/权限）后重派；持续阻塞请上报用户裁决。'
    case 'FAILED':
      return '下一步：先查根因再重派本环节；同环节重复失败 >3 轮出决策简报。'
    case 'INTERRUPTED':
      return '下一步：恢复轮按 dispatch_status 对账后续跑（中断条目照记）。'
    default:
      return ''
  }
}

/**
 * 原子派工前置：预算上限校验 + 台账 schema v2 惰性升级 + 预登记。
 * @returns {{ok: boolean, message: string, runId?: string}}
 */
export function dispatchBegin(rootDir, taskDirInput, 环节, 角色, 模型 = '—') {
  const taskDir = resolveTaskDir(rootDir, taskDirInput)
  if (taskDir === undefined) return result(false, '参数 taskDir 不能为空。')
  if (typeof 环节 !== 'string' || 环节.trim().length === 0) return result(false, '参数「环节」不能为空。')
  if (typeof 角色 !== 'string' || 角色.trim().length === 0) return result(false, '参数「角色」不能为空。')

  const statusPath = join(taskDir, '状态.md')
  const header = fixedBlockOf(statusPath)
  if (header === undefined) {
    return result(false, `状态.md 固定块不可解析或文件缺失（${statusPath}）：fail-closed 拒绝派工（不写锁、不记台账）。`)
  }
  const phase = header.get('当前阶段')
  if (phase === undefined) {
    return result(false, `状态.md 固定块缺少「当前阶段」字段（${statusPath}）：fail-closed 拒绝派工。`)
  }

  const lock = lockPath(taskDir)
  if (existsSync(lock)) {
    return result(false, `已有在跑环节：${lock} 存在（内容：${readFileSync(lock, 'utf8').trim().split('\n').join('；')}）。同一任务目录不得并发派工——请等该环节返回后 dispatch_end，或按失败与中断路径清残留锁（mtime > 30 分钟或对应子代理已不活跃）。`)
  }

  const ledgerPath = join(taskDir, '预算台账.md')
  const ledger = readLedger(ledgerPath)
  if (!ledger.ok) return result(false, ledger.message)

  // D1 · 账本身份防串档：身份行存在且与任务目录不符 → 拒绝派工。
  if (ledger.identity !== undefined) {
    const rel = relTaskPath(rootDir, taskDir)
    if (ledger.identity.taskId !== basename(taskDir) || ledger.identity.repoRelativeTaskPath !== rel) {
      return result(false, `账本身份不符（防串档）：台账登记的是「${ledger.identity.taskId} | ${ledger.identity.repoRelativeTaskPath}」，本次派工任务目录是「${basename(taskDir)} | ${rel}」。拒绝派工——请人工核对 ${ledgerPath} 是否放错任务目录。`)
    }
  }

  const counter = ROLE_TO_COUNTER[角色.trim()]
  const useds = { ...ledger.useds }
  const caps = ledger.caps
  // 预算派工前拒绝：先算「本次派工后」的用量，超上限即拒绝（不写锁、不记账）
  const planned = {
    c: useds.c + (counter === 'c' ? 1 : 0),
    b: useds.b + (counter === 'b' ? 1 : 0),
    r: useds.r + 1,
  }
  const over = []
  if (planned.c > caps.c) over.push(`C 运行 ${planned.c} > 上限 ${caps.c}`)
  if (planned.b > caps.b) over.push(`B 运行 ${planned.b} > 上限 ${caps.b}`)
  if (planned.r > caps.r) over.push(`工作轮 ${planned.r} > 上限 ${caps.r}`)
  if (over.length > 0) {
    return result(false, `预算触顶，派工前拒绝（${over.join('；')}）：本 goal 轮不派工。请按预算纪律停机 → 生成非技术化决策简报（决策记录.md 分歧类）→ 交用户裁决。`)
  }

  // D1 · schema v2 惰性升级（v1 → v2：补身份行+新列；写回前备份 v1 原文）
  let ledgerText = ledger.text
  let upgraded = false
  if (ledger.identity?.schemaVersion !== 2) {
    const up = upgradeLedgerText(ledger.text, rootDir, taskDir)
    ledgerText = up.text
    upgraded = up.upgraded
  }
  const rows = ledgerRowsOf(ledgerText).rows
  const runId = `${basename(taskDir)}-${nowStamp().replace(/[-: ]/g, '')}-${randomUUID().slice(0, 8)}`
  const stamp = nowStamp()
  const withRow = appendLedgerRow(ledgerText, ledgerRowV2(stamp, 环节.trim(), (模型 || '—').trim(), '已派工', runId, nextAttempt(rows, 环节.trim()), phase.trim(), planned, '—'))
  if (!withRow.ok) return result(false, `台账写入失败：${withRow.message}`)
  const nextText = writeUsageLine(withRow.text, planned, '—')

  // 写锁 → 落台账（预登记）。顺序：先锁后账；任何一步失败都回滚锁。
  const lockBody = [
    `任务目录：${basename(taskDir)}`,
    `环节：${环节.trim()}`,
    `角色：${角色.trim()}`,
    `runId：${runId}`,
    `派工时间：${stamp}`,
    `派工前阶段：${phase}`,
  ].join('\n')
  try {
    writeFileSync(lock, lockBody + '\n', 'utf8')
  } catch (error) {
    return result(false, `写锁失败（${lock}）：${renderThrown(error)}`)
  }
  if (upgraded) {
    // D5 口径：升级写回前备份 v1 原文（同名备份已存在则保留最早一份）
    const backupPath = join(taskDir, `预算台账-v1备份-${todayCompact()}.md`)
    try {
      if (!existsSync(backupPath)) writeFileSync(backupPath, ledger.text, 'utf8')
    } catch (error) {
      try { rmSync(lock, { force: true }) } catch { /* 回滚尽力而为 */ }
      return result(false, `台账 v1 备份失败（${backupPath}）：${renderThrown(error)}；已回滚锁文件。`)
    }
  }
  try {
    writeFileSync(ledgerPath, nextText, 'utf8')
  } catch (error) {
    try { rmSync(lock, { force: true }) } catch { /* 回滚尽力而为 */ }
    return result(false, `台账预登记失败（${ledgerPath}）：${renderThrown(error)}；已回滚锁文件。`)
  }
  return result(
    true,
    `已派工并预登记：runId=${runId}｜环节=${环节.trim()}｜角色=${角色.trim()}｜派工后累计 C=${planned.c}/${caps.c} B=${planned.b}/${caps.b} 工作轮=${planned.r}/${caps.r}${upgraded ? '｜台账已惰性升级 schema v2（v1 原文已备份）' : ''}。下一步用 run_in_background:false 调 ${角色.trim()}；子代理返回后调 dispatch_end(taskDir, runId, 结论, 结果态?)。`,
    runId,
  )
}

/**
 * 原子派工后置：runId 精确结算 + 阶段前移合法性校验（按结果态分支）+ 回填台账 + 删锁。
 * @returns {{ok: boolean, message: string}}
 */
export function dispatchEnd(rootDir, taskDirInput, runId, 结论, 结果态, token用量) {
  const taskDir = resolveTaskDir(rootDir, taskDirInput)
  if (taskDir === undefined) return result(false, '参数 taskDir 不能为空。')
  if (typeof runId !== 'string' || runId.trim().length === 0) return result(false, '参数 runId 不能为空。')
  if (typeof 结论 !== 'string' || 结论.trim().length === 0) return result(false, '参数「结论」不能为空。')

  // D3 · 结果态：显式参数优先，缺省按中文摘要推断（06 §二-3 映射）。
  const state = typeof 结果态 === 'string' && 结果态.trim().length > 0 ? 结果态.trim().toUpperCase() : inferResultState(结论)
  if (!RESULT_STATES.includes(state)) {
    return result(false, `结果态「${state}」不在六枚举内（${RESULT_STATES.join(' / ')}）：拒绝回填——请按六态返回格式重传。`)
  }

  const lock = lockPath(taskDir)
  if (!isFile(lock)) {
    return result(false, `无在跑环节：${lock} 不存在。runId 可能已回填（重复调用）或被中断清理——请用 dispatch_status 核对台账明细后再决定重派。`)
  }
  const lockText = readFileSync(lock, 'utf8')
  const lockRunId = (lockText.match(/^runId：(.*)$/m) ?? [])[1]
  if (typeof lockRunId !== 'string' || lockRunId.trim() !== runId.trim()) {
    return result(false, `runId 不匹配：锁文件登记的是 ${String(lockRunId)}，本次传 ${runId.trim()}。拒绝回填（防跨轮错配）——请核对本次派工返回的 runId。`)
  }
  const beforePhase = ((lockText.match(/^派工前阶段：(.*)$/m) ?? [])[1] ?? '').trim()

  const statusPath = join(taskDir, '状态.md')
  const header = fixedBlockOf(statusPath)
  if (header === undefined) {
    return result(false, `状态.md 固定块不可解析或文件缺失（${statusPath}）：拒绝回填，保留锁（该环节视同未完成）。`)
  }
  const afterPhase = header.get('当前阶段')
  if (typeof afterPhase !== 'string' || afterPhase.trim().length === 0) {
    return result(false, `状态.md 固定块缺少「当前阶段」字段（${statusPath}）：拒绝回填，保留锁。`)
  }

  // D3 · 阶段前移校验按结果态分支：DONE/DWC 必须前移；后四态不前移是合法结算。
  const advancing = state === 'DONE' || state === 'DONE_WITH_CONCERNS'
  if (advancing && beforePhase.length > 0 && afterPhase.trim() === beforePhase) {
    return result(false, `阶段未前移：派工前与当前「当前阶段」都是「${afterPhase.trim()}」。结果态 ${state} 要求子代理把阶段推进合法后继——请按失败路径重派或上报；确认要作废本次派工时手动删除 ${lock} 并在台账把该行结论改为「失败」。拒绝回填、保留锁。`)
  }
  if (state === 'DONE_WITH_CONCERNS' && !hasConcernsSection(taskDir)) {
    return result(false, `结果态 DONE_WITH_CONCERNS 要求执行自测文档含「concerns」固定小节（02 §三 D3 / 06 §二-5）：${taskDir} 下未找到含 concerns 小节的 执行自测/修复执行自测 文档——按证据缺失拒绝结算、保留锁。请补写 concerns 小节后再结算（或改报 DONE/FAILED 并说明）。`)
  }

  const ledgerPath = join(taskDir, '预算台账.md')
  const ledger = readLedger(ledgerPath)
  if (!ledger.ok) return result(false, `${ledger.message}（拒绝回填，保留锁）`)

  // D2 · runId 精确结算：只按完整 runId 匹配「已派工」行；找不到 = 拒绝回填保留锁；
  // 行已有结论 = 重复结算拒绝。无「第一条已派工行」回退路径。
  const { rows, lines } = ledgerRowsOf(ledger.text)
  const hit = rows.filter((r) => r.cells.length >= 5 && r.cells[3] === '已派工' && r.cells[4] === runId.trim())
  if (hit.length === 0) {
    const settledSameRun = rows.some((r) => r.cells.length >= 5 && r.cells[4] === runId.trim() && r.cells[3] !== '已派工')
    if (settledSameRun) {
      return result(false, `重复结算拒绝：runId=${runId.trim()} 的台账行已有结论（非「已派工」）。该行不能再次回填——请用 dispatch_status 核对，禁止重复计次。保留锁。`)
    }
    return result(false, `台账里找不到 runId=${runId.trim()} 的「已派工」行：台账可能被外部改写或锁为残留。拒绝回填、保留锁——请人工核对 ${ledgerPath}。`)
  }
  const row = hit[0]
  const candidateCommit = (header.get('候选commit') ?? '—').trim()
  const cells = [...row.cells]
  cells[3] = `${结论.trim().replace(/\|/g, '/')}〔${state}〕`
  if (cells.length >= 8) cells[7] = afterPhase.trim()
  if (cells.length >= 9) cells[8] = candidateCommit === '无' ? '—' : candidateCommit
  if (typeof token用量 === 'string' && token用量.trim().length > 0 && cells.length >= 14) cells[13] = token用量.trim()
  lines[row.idx] = `| ${cells.join(' | ')} |`
  const nextText = writeUsageLine(lines.join('\n'), ledger.useds, '—')

  try {
    writeFileSync(ledgerPath, nextText, 'utf8')
  } catch (error) {
    return result(false, `台账回填失败（${ledgerPath}）：${renderThrown(error)}；保留锁。`)
  }
  try {
    rmSync(lock, { force: true })
  } catch (error) {
    return result(false, `台账已回填，但删锁失败（${lock}）：${renderThrown(error)}。请手动删除该锁文件再继续。`)
  }
  const stateNote = advancing
    ? `阶段 ${beforePhase || '（未知）'} → ${afterPhase.trim()}`
    : `阶段未前移（${state} 为合法不前移态，已照常结算计次）`
  return result(
    true,
    `已回填并解锁：runId=${runId.trim()}｜${stateNote}｜结论=${结论.trim()}〔${state}〕。${nextStepHint(state)}本环节完成，可按状态.md 继续推进。`,
  )
}

/**
 * 派工台账状态视图（恢复轮用）：明细 + 悬空识别 + 四方一致检查 + 续跑建议。
 * 四方一致 = 账本身份行 vs 状态.md 头（当前阶段/候选commit）vs 证据文件存在性；
 * 「通过结论行」= 结论列状态词为 DONE 或 DONE_WITH_CONCERNS 的结算行——
 * 已有通过结论行的环节**不得重派**，续跑建议指向第一个无结论环节。
 * @returns {{ok: boolean, message: string}}
 */
export function dispatchStatus(rootDir, taskDirInput) {
  const taskDir = resolveTaskDir(rootDir, taskDirInput)
  if (taskDir === undefined) return result(false, '参数 taskDir 不能为空。')
  const ledgerPath = join(taskDir, '预算台账.md')
  const ledger = readLedger(ledgerPath)
  if (!ledger.ok) return result(false, ledger.message)
  const parsed = ledgerRowsOf(ledger.text)
  const rows = parsed.rows
  const pending = rows.filter((r) => r.cells[3] === '已派工')
  const lock = lockPath(taskDir)
  const lockExists = isFile(lock)

  // ── D4 · 四方一致检查 ──────────────────────────────────────────────────────
  const inconsistency = []
  const rel = relTaskPath(rootDir, taskDir)
  if (ledger.identity === undefined) {
    inconsistency.push('账本身份行缺失（schema v1，可 dispatch_migrate 迁移）')
  } else {
    if (ledger.identity.taskId !== basename(taskDir) || ledger.identity.repoRelativeTaskPath !== rel) {
      inconsistency.push(`账本身份与任务目录不符（台账=${ledger.identity.taskId} | ${ledger.identity.repoRelativeTaskPath}；实际=${basename(taskDir)} | ${rel}）`)
    }
    if (ledger.identity.schemaVersion === 2 && !parsed.v2) {
      inconsistency.push('身份行登记 schemaVersion 2 但明细表头仍为 v1')
    }
  }
  const header = fixedBlockOf(join(taskDir, '状态.md'))
  const headerPhase = header?.get('当前阶段')
  const headerCommit = (header?.get('候选commit') ?? '').trim()
  const settledV2 = rows.filter((r) => r.cells.length >= 9 && r.cells[3] !== '已派工')
  const lastSettled = settledV2[settledV2.length - 1]
  if (lastSettled !== undefined) {
    const settledPhase = lastSettled.cells[7]
    if (settledPhase !== '—' && headerPhase !== undefined && settledPhase !== headerPhase.trim()) {
      inconsistency.push(`状态头当前阶段（${headerPhase.trim()}）与最近结算行结算后阶段（${settledPhase}）不一致`)
    }
    const settledCommit = lastSettled.cells[8]
    if (settledCommit !== '—' && headerCommit.length > 0 && headerCommit !== '无' && settledCommit !== headerCommit) {
      inconsistency.push(`状态头候选commit（${headerCommit}）与最近结算行 candidateCommit（${settledCommit}）不一致`)
    }
    // 证据文件存在性（最近结算行的环节）
    const h = lastSettled.cells[1]
    const ev = EVIDENCE_PATTERNS.find(([re]) => re.test(h))
    if (ev !== undefined) {
      let files = []
      try {
        files = readdirSync(taskDir)
      } catch { /* 目录不可读：按缺失处理 */ }
      if (!files.some((f) => ev[1].test(f))) {
        inconsistency.push(`最近结算行环节「${h}」的证据文件缺失（期望匹配 ${ev[1]}）`)
      }
    }
  } else if (headerPhase === undefined) {
    inconsistency.push('状态.md 固定块不可解析（无法对照当前阶段）')
  }

  // ── D4 · 续跑建议 ──────────────────────────────────────────────────────────
  let resume = ''
  if (rows.length > 0) {
    const order = []
    for (const r of rows) {
      if (!order.includes(r.cells[1])) order.push(r.cells[1])
    }
    const passed = new Set(
      settledV2
        .filter((r) => { const m = r.cells[3].match(STATE_TAG); return m !== null && (m[1] === 'DONE' || m[1] === 'DONE_WITH_CONCERNS') })
        .map((r) => r.cells[1]),
    )
    const next = order.find((h) => !passed.has(h))
    const noResend = order.filter((h) => passed.has(h))
    resume = next === undefined
      ? `续跑建议：各环节均已有通过结论行${noResend.length > 0 ? `（${noResend.join('、')} 不得重派）` : ''}，按状态.md 当前阶段「${headerPhase ?? '（未知）'}」继续。`
      : `续跑建议：下一环节 = ${next}${noResend.length > 0 ? `（${noResend.join('、')} 已有通过结论行，不得重派）` : ''}。`
  }

  const head = `派工台账：${rows.length} 行明细（schema ${parsed.v2 ? 'v2' : 'v1'}${ledger.identity ? `；身份=${ledger.identity.taskId}` : ''}；上限 C=${ledger.caps.c} B=${ledger.caps.b} 工作轮=${ledger.caps.r}；累计 C=${ledger.useds.c} B=${ledger.useds.b} 工作轮=${ledger.useds.r}）`
  const checksLine = inconsistency.length > 0
    ? `**四方一致检查：${inconsistency.length} 项不一致**（${inconsistency.join('；')}）——恢复轮先处置再推进。`
    : '四方一致检查：一致（账本身份 / 状态头 / 候选commit / 证据文件）。'
  if (pending.length > 0) {
    return result(true, `${head}\n${checksLine}\n**悬空派工 ${pending.length} 行**（已点火、未回填）：\n${pending.map((r) => '  ' + parsed.lines[r.idx]).join('\n')}\n锁文件 ${lock} ${lockExists ? '仍在（确认子代理已不活跃则可按失败路径处理）' : '已不在（可视为中断残留行，按「失败/中断」补记结论）'}。\n${resume}`)
  }
  return result(true, `${head}\n${checksLine}\n无悬空派工（零「已派工」行）；锁文件 ${lockExists ? '存在（异常：无悬空行却有锁，请人工核对）' : '不在'}。\n${resume}`)
}

/**
 * D5 · 旧台账迁移（v1 → v2 一次性转换）：补身份行 → 明细列补齐（缺列填「—」）→
 * 不可解析行原样保留并标注；写回前备份原文到 预算台账-v1备份-YYYYMMDD.md。
 * 历史任务目录迁移演练请在 `.tmp/` 副本上做（02 §二 禁止触碰项：不改他任务目录原件）。
 * @returns {{ok: boolean, message: string}}
 */
export function migrateLedger(rootDir, taskDirInput) {
  const taskDir = resolveTaskDir(rootDir, taskDirInput)
  if (taskDir === undefined) return result(false, '参数 taskDir 不能为空。')
  const ledgerPath = join(taskDir, '预算台账.md')
  if (!isFile(ledgerPath)) {
    return result(false, `迁移失败：${ledgerPath} 不存在。`)
  }
  let text
  try {
    text = readFileSync(ledgerPath, 'utf8')
  } catch (error) {
    return result(false, `迁移失败：预算台账不可读（${ledgerPath}）：${renderThrown(error)}。`)
  }
  const up = upgradeLedgerText(text, rootDir, taskDir)
  if (!up.upgraded) {
    return result(true, `无需迁移：${ledgerPath} 已是 schema v2。`)
  }
  const backupPath = join(taskDir, `预算台账-v1备份-${todayCompact()}.md`)
  try {
    if (!existsSync(backupPath)) writeFileSync(backupPath, text, 'utf8')
    writeFileSync(ledgerPath, up.text, 'utf8')
  } catch (error) {
    return result(false, `迁移写回失败（${ledgerPath}）：${renderThrown(error)}（v1 原文仍在）。`)
  }
  return result(true, `迁移完成：${relTaskPath(rootDir, taskDir)} 预算台账 v1 → v2（${up.note}）；v1 原文备份 = ${backupPath}。`)
}

/** Install the dispatch_begin / dispatch_end / dispatch_status / dispatch_migrate tools. */
export function apply(ctx) {
  ctx.effect(() => {
    const disposers = []
    disposers.push(ctx.tools.register({
      name: 'dispatch_begin',
      description: '派工原子半步（前段）：读任务 状态.md 固定块 + 读 预算台账.md 固定块对照任务包预算块三项硬上限（**达上限即派工前拒绝**）→ 台账 schema v2 惰性升级（v1→v2 备份原文）→ 写 <taskDir>/.lock → 台账**预登记**一行（结论列=已派工，runId 列=完整 runId）→ 返回 runId。随后用 run_in_background:false 调 subagent_reviewer/subagent_developer，返回后调 dispatch_end 回填。同一任务目录已有锁时拒绝并发派工；账本身份行与任务目录不符时拒绝派工（防串档）。',
      parameters: DISPATCH_BEGIN_PARAMETERS,
      output: {
        schema: DISPATCH_OUTPUT_SCHEMA,
        render: (_args, value) => [{ type: 'text', text: value.message }],
      },
      async execute(args, exec) {
        const root = sessionRoot(exec.agent)
        return dispatchBegin(root, args?.taskDir, args?.环节, args?.角色, args?.模型)
      },
      presentCall: (args) => ({
        card: 'generic',
        title: '派工点火（预登记）',
        kind: 'other',
        ...(typeof args?.环节 === 'string' ? { rawInput: `${args.taskDir ?? ''} · ${args.环节} · ${args.角色 ?? ''}` } : {}),
      }),
    }))

    disposers.push(ctx.tools.register({
      name: 'dispatch_end',
      description: '派工原子半步（后段）：核对 runId → **runId 精确结算**（台账按完整 runId 匹配「已派工」行；找不到=拒绝回填保留锁；行已有结论=重复结算拒绝；无「第一条已派工行」回退）→ 阶段前移合法性校验按**结果态六枚举**分支（DONE/DONE_WITH_CONCERNS 必须前移，DWC 另要求执行自测含「concerns」小节否则按证据缺失拒；NEEDS_CONTEXT/BLOCKED/FAILED/INTERRUPTED 不前移亦结算计次释锁）→ 台账回填该行结论（中文摘要照旧+〔状态词〕+结算后阶段/候选commit/token）→ 删锁。用于开发/验收阶段每次 B/C 派工返回后。',
      parameters: DISPATCH_END_PARAMETERS,
      output: {
        schema: DISPATCH_OUTPUT_SCHEMA,
        render: (_args, value) => [{ type: 'text', text: value.message }],
      },
      async execute(args, exec) {
        const root = sessionRoot(exec.agent)
        return dispatchEnd(root, args?.taskDir, args?.runId, args?.结论, args?.结果态, args?.token用量)
      },
      presentCall: (args) => ({
        card: 'generic',
        title: '派工回填（回填+解锁）',
        kind: 'other',
        ...(typeof args?.taskDir === 'string' ? { rawInput: args.taskDir } : {}),
      }),
    }))

    disposers.push(ctx.tools.register({
      name: 'dispatch_status',
      description: '派工台账状态视图（恢复轮用）：列出预算台账明细行与累计、标出**悬空派工**（有「已派工」行且 .lock 仍在 = 已点火未回填）与锁文件状态；**四方一致检查**（账本身份行 vs 状态.md 头 vs 候选 commit vs 证据文件存在性）+ **续跑建议**（有通过结论行〔DONE/DONE_WITH_CONCERNS〕的环节不得重派，指向第一个无结论环节），供对账补记与悬空识别。',
      parameters: {
        type: 'object',
        properties: {
          taskDir: { type: 'string', description: '任务目录路径：相对项目根或绝对路径。' },
        },
        required: ['taskDir'],
        additionalProperties: false,
      },
      output: {
        schema: DISPATCH_OUTPUT_SCHEMA,
        render: (_args, value) => [{ type: 'text', text: value.message }],
      },
      async execute(args, exec) {
        const root = sessionRoot(exec.agent)
        return dispatchStatus(root, args?.taskDir)
      },
      presentCall: (args) => ({
        card: 'generic',
        title: '查看派工台账',
        kind: 'other',
        ...(typeof args?.taskDir === 'string' ? { rawInput: args.taskDir } : {}),
      }),
    }))

    disposers.push(ctx.tools.register({
      name: 'dispatch_migrate',
      description: '旧预算台账迁移（v1 → v2 一次性转换）：补账本身份行（taskId/schemaVersion/repoRelativeTaskPath/flowType）→ 明细列补齐（runId/attempt/派工前阶段/结算后阶段/candidateCommit/evidencePath 缺列填「—」）→ 不可解析行原样保留并标注；写回前备份原文到 预算台账-v1备份-YYYYMMDD.md。历史任务目录迁移演练在 .tmp/ 副本上做，不改原文件。',
      parameters: {
        type: 'object',
        properties: {
          taskDir: { type: 'string', description: '任务目录路径：相对项目根或绝对路径。' },
        },
        required: ['taskDir'],
        additionalProperties: false,
      },
      output: {
        schema: DISPATCH_OUTPUT_SCHEMA,
        render: (_args, value) => [{ type: 'text', text: value.message }],
      },
      async execute(args, exec) {
        const root = sessionRoot(exec.agent)
        return migrateLedger(root, args?.taskDir)
      },
      presentCall: (args) => ({
        card: 'generic',
        title: '迁移预算台账 v1→v2',
        kind: 'other',
        ...(typeof args?.taskDir === 'string' ? { rawInput: args.taskDir } : {}),
      }),
    }))

    return () => {
      for (const dispose of disposers) dispose()
    }
  }, 'orchestrator2-dispatch lifecycle')
}
