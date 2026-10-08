/**
 * Orchestrator2 phase gate: the machine half of the phase switch.
 *
 * Registers the `enter_auto_mode` model tool and performs the deterministic
 * create -> pause -> (idle) compactNow -> resume handoff:
 *
 *   enter_auto_mode(taskDir, objective?)
 *     1. validate <root>/<taskDir>/状态.md (parseable fixed header block,
 *        当前阶段 = 待审核), then branch on the header:
 *           - 状态头含 `设计目录` 字段 -> v2.x 路径: the pointer must point at
 *             a directory holding 任务包 01_需求分析.md + 02_开发方案与任务包.md;
 *             when 流程类型 = 产品设计全流程 the pointer's PARENT PARENT (the
 *             产品任务目录, i.e. 01-设计/<产品任务>/) must hold
 *             04_产品设计方案.md and 06_设计定稿记录.md whose fixed block
 *             parses 确认版本：vX.Y; finally the machine fuse 预算台账.md
 *             (固定块: 上限三项 + 当前累计行) must be present and parseable.
 *           - 状态头无 `设计目录` 字段 (v1.1 旧式状态头) -> legacy 仅开发路径:
 *             <taskDir>/开发计划/01_需求分析.md + 02_开发方案与任务包.md.
 *     2. single-package rule (both paths): any OTHER task dir under
 *        03-开发协同/ whose 状态.md parses to a phase that is neither
 *        待启动 nor 已完成 rejects the start.
 *     A missing or unparseable package returns an error text with NO side
 *     effects (no goal is created).
 *     3. ctx.goals.create(agent, { objective, maxGoalRounds: 24 }) - NOTE:
 *        this is a SERVICE-level call with no authority check, deliberately
 *        different from the model-facing `create_goal` tool (which requires a
 *        direct human turn). Single-user design: enter_auto_mode is itself
 *        triggered by the user's 「开始自动推进」 instruction, and the persona
 *        forbids calling it before user confirmation.
 *     4. ctx.goals.pause(agent, ref) immediately after create. While the goal
 *        is paused the goal-round-driver does not queue a round (it only
 *        drives armed active goals), so this turn ends and the agent goes
 *        idle with nothing scheduled - the race that would otherwise make
 *        "compact before round 1" nondeterministic cannot happen.
 *     5. store the PAUSED view (id + revision) keyed by agent id and return.
 *
 *   on agent/status === 'idle' with a stored intent:
 *     take-and-delete the intent, call ctx.compaction.compactNow(agent,
 *     signal), then - whether compactNow threw synchronously, rejected, or
 *     succeeded - call ctx.goals.resume(agent, ref) with the PAUSED view's
 *     revision (never the create view's: pause bumped it). A resume failure
 *     only logs; the user can say 「继续」 to rearm the goal manually.
 *
 * Exports follow the local-plugin shape of the 1.0 `phase-gate.mjs`
 * (`export const name`, `export const inject`, `export function apply(ctx)`).
 * `validateAutoMode` is an ADDITIONAL pure export used by the package's own
 * self-tests (mock single tests + e2e fixtures); the loader only reads the
 * plugin contract fields.
 *
 * This file deliberately imports ONLY node: builtins. Bare `@deepseek-ai/*`
 * specifiers do not resolve from a user preset directory (only row names in
 * agent.cordis.yml are rebased onto the harness), so the tool is registered
 * as a plain ToolDefinition object - the exact contract
 * `ctx.tools.register()` validates: { name, description, parameters (raw
 * JSON Schema), output: { schema, render }, execute }.
 */

import { createHash } from 'node:crypto'
import { readFileSync, statSync, readdirSync } from 'node:fs'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'orchestrator2-phase-gate'

/** Hard dependencies: the compaction engine (group realm), the host goal service, the tool registry. */
export const inject = ['compaction', 'goals', 'tools']

/** Round cap for the auto-advance goal (spec v2.0: 上限 24 工作轮；前景阻塞派工下每轮=一个真实工作步). */
export const MAX_GOAL_ROUNDS = 24

/**
 * Fixed-header field the scheduler machine parses; values must be one of
 * these. 完整枚举 = 待启动 + 设计 9 态 + v2.1 场景扩展 3 态 + 开发 5 态主链 +
 * 修复循环 5 态 + 收尾中 + 已完成。
 *
 * v2.1 增量（+4，均为**追加**）：`现状研究中`（场景1 修改已有系统：需求沟通中
 * 之后，替代「同类产品搜索中 + 调研中」）、`方向确认中` / `清单待确认`（场景2
 * 技术调研储备：调研中 之前）、`待审查`（A2 验证并入代码审查后的合并环节名）。
 * 旧值全部保留可解析（`同类产品搜索中`/`调研中`/`验证` 位上的 `待验证`/
 * `待代码审查`/`待推送` 等）——旧项目状态头不报错；但 5 态语义对 7 态状态头会
 * 漂移，故规范 §十三 兼容性段要求 v2.0 项目先升级脚手架。
 * `待修订` 保留为回退态（计划审核驳回 / 需求变更），不列 5 态主链。
 */
const PHASE_VALUES = [
  '待启动',
  // 设计阶段（9 态）
  '需求沟通中', '同类产品搜索中', '调研中', '方案设计中',
  '待可行性复核', '原型制作中', '待设计确认', '方案已定稿', '任务包生成中',
  // 设计阶段 · v2.1 场景扩展（3 态）
  '现状研究中',
  '方向确认中', '清单待确认',
  // 开发阶段（v2.1 收敛为 5 态主链；待修订 = 回退态）
  '待审核', '执行中', '待审查', '待构建', '待人工测试',
  '待修订',
  // 验收修复循环（5 态）
  '修复包生成中', '修复中', '待修复审查', '待调度员检查', '待构建更新',
  // 收尾 / 兼容（旧值保留）
  '收尾中', '已完成', '待推送',
  '待验证', '待代码审查',
]

/** Phases that count as "not running" for the single-package rule. */
const NOT_RUNNING_PHASES = new Set(['待启动', '已完成'])

/**
 * 本机插件所实现的规范版本（M4：状态头 `规范版本` 字段的**唯一合法 v2.x 值**）。
 * 状态头显式声明该字段后，校验才不再依赖「有没有 设计目录 字段」这种结构推断。
 */
export const SUPPORTED_SPEC_VERSION = 'v2.1'

/** 规范版本枚举：v1.1（旧项目，应改用 1.0 预设）/ v2.0（在途，需升级脚手架）/ v2.1（本预设）。 */
const SPEC_VERSIONS = ['v1.1', 'v2.0', 'v2.1']

/** 流程类型枚举（缺省 仅开发）。 */
const FLOW_TYPES = ['产品设计全流程', '仅开发', '技术调研储备']

/** 需要设计目录 + 04/06 全流程校验的流程类型。 */
const DESIGN_FLOW_TYPES = new Set(['产品设计全流程'])

/** 预算台账文件名与「不要求台账」的流程类型。
 *  技术调研储备（场景2）= 独立终态调研流程，协同区无预算台账，故豁免台账校验。
 *  其余 v2.x 流程类型（产品设计全流程 / 仅开发）一律要求台账存在且固定块可解析
 *  —— 不按「状态头有没有引用台账」做条件豁免（那会让存量包静默跳过机器保险丝）。 */
const BUDGET_LEDGER_NAME = '预算台账.md'
const LEDGER_EXEMPT_FLOW_TYPES = new Set(['技术调研储备'])

/** 台账固定块解析结果（M4/P2-2 fail-closed：缺席/不可解析都要能点出到底缺什么）。 */
const LEDGER_MISSING = { ok: false, reason: 'missing' }
const LEDGER_UNPARSABLE = { ok: false, reason: 'unparsable' }
const LEDGER_FORGIVEN = { ok: true, forgiven: true }

/** 台账固定块上限三项的规范措辞（共用，避免多处文案漂移）。 */
const LEDGER_FIELDS_HINT = '（固定块需含「上限：C运行≤N / B运行≤N / 工作轮≤N」与「当前累计：C运行= / B运行= / 工作轮= / token用量=」两行）'

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

/**
 * Parse a 状态.md / 06 定稿记录 / 预算台账 fixed header block (the only
 * machine-parsed source per the spec). Scans from the top of the file,
 * skips leading blank lines and `---` separators, collects `字段：值` lines,
 * and stops at the first blank line, `---` separator, a line without a `：`,
 * or a duplicate key.
 * @param {string} text - the whole document content.
 * @returns {Map<string, string>} the parsed header fields.
 */
function parseFixedBlock(text) {
  const fields = new Map()
  const lines = String(text).split(/\r\n|\r|\n/)
  let i = 0
  while (i < lines.length && lines[i].trim() === '') i++
  while (i < lines.length && lines[i].trim() === '---') i++
  for (; i < lines.length; i++) {
    const line = lines[i].trimEnd()
    if (line.length === 0) break
    if (line.trim() === '---') break
    const separator = line.indexOf('：')
    if (separator <= 0) break
    const key = line.slice(0, separator).trim()
    const value = line.slice(separator + 1).trim()
    if (key.length === 0) break
    if (fields.has(key)) break
    fields.set(key, value)
  }
  return fields
}

/** Parse one file's fixed block. @returns {Map<string,string> | undefined} fields, or undefined when unreadable. */
function parseFixedBlockFile(path) {
  let text
  try {
    text = readFileSync(path, 'utf8')
  } catch {
    return undefined
  }
  return parseFixedBlock(text)
}

/** 文件内容的 SHA-256（小写十六进制）；不可读返回 undefined。M5 设计冻结核实用。 */
function sha256OfFile(path) {
  try {
    return createHash('sha256').update(readFileSync(path)).digest('hex')
  } catch {
    return undefined
  }
}

/**
 * Whether the 06 定稿记录 fixed block parses 确认版本：vX.Y.
 * @returns {string | undefined} the version string, or undefined.
 */
function confirmVersionOf(designEntryPath) {
  const fields = parseFixedBlockFile(designEntryPath)
  if (fields === undefined) return undefined
  const version = fields.get('确认版本')
  if (typeof version !== 'string') return undefined
  return /^v\d+(\.\d+)+$/.test(version.trim()) ? version.trim() : undefined
}

/**
 * Whether the 预算台账 fixed block carries 上限三项 + 当前累计行 (the
 * machine fuse; v2.x 路径 + 引用台账的流程类型).
 * @returns {boolean} true when the block is present and parsable.
 */
function budgetLedgerParsable(path) {
  const fields = parseFixedBlockFile(path)
  if (fields === undefined) return false
  const cap = fields.get('上限')
  const used = fields.get('当前累计')
  if (typeof cap !== 'string' || typeof used !== 'string') return false
  const capOk = /C运行≤\d+/.test(cap) && /B运行≤\d+/.test(cap) && /工作轮≤\d+/.test(cap)
  const usedOk = /C运行=\d+/.test(used) && /B运行=\d+/.test(used) && /工作轮=\d+/.test(used) && /token用量=/.test(used)
  return capOk && usedOk
}

/**
 * 预算台账机器保险丝（M4/P2-2 fail-closed）：v2.x + 非豁免流程类型**必须**有台账。
 * 技术调研储备（场景2）无台账 → 放行（不核对）。
 * @returns {{ok: true, forgiven?: true} | {ok: false, reason: 'missing' | 'unparsable', path?: string}}
 */
function checkBudgetLedger({ taskDir, flowType }) {
  if (LEDGER_EXEMPT_FLOW_TYPES.has(flowType)) return LEDGER_FORGIVEN
  const ledger = join(taskDir, BUDGET_LEDGER_NAME)
  if (!isFile(ledger)) return { ok: false, reason: 'missing', path: ledger }
  if (!budgetLedgerParsable(ledger)) return { ok: false, reason: 'unparsable', path: ledger }
  return { ok: true }
}

/** Case-insensitive path equality on Windows, exact elsewhere. */
function samePath(a, b) {
  const left = resolve(a)
  const right = resolve(b)
  return process.platform === 'win32'
    ? left.toLowerCase() === right.toLowerCase()
    : left === right
}

/**
 * Other task dirs under 03-开发协同/ whose 状态.md parses to a phase that is
 * NOT 待启动 / 已完成 (single-package serialisation rule; excludes the target
 * task dir itself).
 * @returns {Array<{name: string, phase: string}>}
 */
function runningTasks(rootDir, taskDir) {
  // ponytail: 每次调用全量扫描 03-开发协同；包数到几十个再考虑按修改时间缓存（单用户包规模小）。
  const coordDir = join(rootDir, '03-开发协同')
  let entries
  try {
    entries = readdirSync(coordDir, { withFileTypes: true })
  } catch {
    return []
  }
  const running = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const dir = join(coordDir, entry.name)
    if (samePath(dir, taskDir)) continue
    const statusPath = join(dir, '状态.md')
    if (!isFile(statusPath)) continue
    const header = parseFixedBlockFile(statusPath)
    if (header === undefined) continue
    const phase = header.get('当前阶段')
    if (phase === undefined) continue
    if (!NOT_RUNNING_PHASES.has(phase)) running.push({ name: entry.name, phase })
  }
  return running
}

/**
 * The model-visible JSON Schema (raw JSON Schema subset enforced by
 * dsh-tools) for the enter_auto_mode parameters.
 */
const ENTER_PARAMETERS = {
  type: 'object',
  properties: {
    taskDir: {
      type: 'string',
      description: '任务目录路径：相对项目根（如 03-开发协同/TP1-<名>）或绝对路径。',
    },
    objective: {
      type: 'string',
      description: '推进目标描述；缺省为「推进 <任务目录名> 到『待人工测试』」。',
    },
  },
  required: ['taskDir'],
}

/** Canonical output contract: { ok, message, goalId? }. */
const ENTER_OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    ok: { type: 'boolean', description: '是否成功建立推进目标并挂起压缩意图。' },
    message: { type: 'string', description: '给调度器（模型）的结果文本。' },
    goalId: { type: 'string', description: '已建立 goal 的 id（成功时）。' },
  },
  required: ['ok', 'message'],
  additionalProperties: false,
}

/**
 * Build the tool result value.
 * @param {boolean} ok - success flag.
 * @param {string} message - model-facing text.
 * @param {string} [goalId] - created goal id, success only.
 */
function result(ok, message, goalId) {
  return { ok, message, ...(goalId === undefined ? {} : { goalId }) }
}

/**
 * Resolve the project root for one agent: the session's selected workspace,
 * falling back to the process working directory.
 */
function sessionRoot(agent) {
  const cwd = agent?.session?.header?.cwd
  if (typeof cwd === 'string' && cwd.length > 0) return cwd
  return process.cwd()
}

/**
 * Validate the start conditions: 状态头 fail-closed 解析（M4）→ 规范版本分支 ×
 * 流程类型分支二维判定 → 预算台账机器保险丝（M4/P2-2）→ 设计目录 / 产品设计全流程
 * 校验（M4/M5）→ 幂等（M3）→ 单包串行。纯文件检查；NO side effects.
 *
 * 分支总览（M4 §2 的二维矩阵）：
 *   - 缺 `规范版本` 字段 / 未知值 / v1.1 → 拒绝（v1.1 应改用 1.0 预设，同项目不混用）；
 *   - v2.x + 设计目录缺失 → 拒绝（v2.1 起「设计目录」为 v2.x 必填；legacy 结构由 v1.1 分支覆盖）；
 *   - v2.x + 流程类型=产品设计全流程 → 需 04/06 + 确认版本（M5 另核设计基线哈希）；
 *   - v2.x + 引用预算台账 → 台账必须存在且固定块可解析；
 *   - 未知流程类型 → 拒绝。
 * @param {string} rootDir - project root (absolute).
 * @param {string} taskDirInput - task dir path, relative or absolute.
 * @param {Record<string, unknown>} [products] - 机器产品接口（M2/M3/M5）：
 *   `{ goalLookup?: (taskDirPath: string) => ({id: string, state?: string} | undefined) }`
 *   ——宿主/适配层注入，缺省无幂等检查（纯文件校验保持可单测）；
 *   `designFreeze` 由本模块自行从状态头/任务包推导，不需要注入。
 * @returns {{ok: true} | {ok: false, message: string}}
 */
export function validateAutoMode(rootDir, taskDirInput, products = {}) {
  const input = typeof taskDirInput === 'string' ? taskDirInput.trim() : ''
  if (input.length === 0) {
    return { ok: false, message: '参数 taskDir 不能为空：请传入任务目录路径（如 03-开发协同/<任务目录>）。' }
  }
  const taskDir = isAbsolute(input) ? input : join(rootDir, input)
  const statusPath = join(taskDir, '状态.md')
  if (!isFile(statusPath)) {
    return { ok: false, message: `任务状态不存在：缺少 ${statusPath}（请确认任务目录路径与协同区同名目录）。` }
  }
  const header = parseFixedBlockFile(statusPath)
  if (header === undefined) {
    return { ok: false, message: `状态.md 顶部固定格式块不可解析（${statusPath}）。` }
  }
  const phase = header.get('当前阶段')
  if (phase === undefined) {
    return { ok: false, message: `状态.md 顶部固定格式块不可解析：未找到「当前阶段」字段（${statusPath}）。` }
  }
  if (!PHASE_VALUES.includes(phase)) {
    return { ok: false, message: `状态.md 顶部固定格式块不可解析：「当前阶段」值 "${phase}" 不在阶段枚举内（${statusPath}）。` }
  }

  // ── M4 · 显式规范版本（缺失即拒绝，不再由「有无设计目录」推断版本）────────
  const specVersion = header.get('规范版本')
  if (specVersion === undefined) {
    return {
      ok: false,
      message: `状态.md 顶部固定格式块缺少必填字段「规范版本」（${statusPath}）。请补写一行 \`规范版本：${SUPPORTED_SPEC_VERSION}\`（升级脚手架引导：存量任务原地补写该字段，其余不动）。`,
    }
  }
  if (!SPEC_VERSIONS.includes(specVersion)) {
    return {
      ok: false,
      message: `「规范版本」值 "${specVersion}" 不在版本枚举内（${statusPath}）。合法值：${SPEC_VERSIONS.join(' / ')}。`,
    }
  }
  if (specVersion === 'v1.1') {
    return {
      ok: false,
      message: `规范版本 ${specVersion} 的项目请改用 1.0 预设「自动开发调度器」——同一项目不混用两个预设（状态机与校验逻辑不同，混用会错乱）。`,
    }
  }

  // ── M4 · 流程类型枚举（未知值 fail-closed）────────────────────────────────
  const flowType = header.get('流程类型') || '仅开发'
  if (!FLOW_TYPES.includes(flowType)) {
    return {
      ok: false,
      message: `「流程类型」值 "${flowType}" 不在枚举内（${statusPath}）。合法值：${FLOW_TYPES.join(' / ')}（缺省 仅开发）。`,
    }
  }

  // ── M4 · 设计目录指针（v2.x 必填；legacy 结构已由 v1.1 分支拦下）──────────
  const designDir = header.get('设计目录')
  if (designDir === undefined) {
    return {
      ok: false,
      message: `流程类型=${flowType} 的 v2.x 任务包缺少「设计目录」指针（${statusPath}）。请补写 \`设计目录：01-设计/<产品任务>/任务包/<TP编号>-<名>\`（场景2 技术调研储备写 \`01-设计/技术调研/<主题>\`）。`,
    }
  }

  // ── M4/P2-2 · 预算台账机器保险丝 ─────────────────────────────────────────
  const ledger = checkBudgetLedger({ taskDir, flowType })
  if (!ledger.ok && ledger.reason === 'missing') {
    return {
      ok: false,
      message: `机器保险丝：缺少 ${BUDGET_LEDGER_NAME}（${ledger.path}）。请在协同区任务目录建立预算台账${LEDGER_FIELDS_HINT}（流程类型=${flowType}；仅「技术调研储备」豁免台账）。`,
    }
  }
  if (!ledger.ok) {
    return {
      ok: false,
      message: `${BUDGET_LEDGER_NAME} 固定块不可解析${LEDGER_FIELDS_HINT}（${ledger.path}）。`,
    }
  }

  // ── 设计目录内容 + 产品设计全流程 04/06（含 M5 设计冻结哈希核对）──────────
  const invalid = validateV2Path(rootDir, taskDir, designDir, header, flowType, products)
  if (invalid !== undefined) return invalid

  // ── M3 · 幂等防护：同一任务目录不得有第二个推进 goal ──────────────────────
  const goalLookup = products?.goalLookup
  if (typeof goalLookup === 'function') {
    let existing
    try {
      existing = goalLookup(taskDir)
    } catch (error) {
      return { ok: false, message: `幂等守卫查询失败：${renderThrown(error)}（保守拒绝，避免重复建立推进目标）。` }
    }
    if (existing !== undefined && existing !== null) {
      const state = typeof existing.state === 'string' && existing.state.length > 0 ? `，状态=${existing.state}` : ''
      return {
        ok: false,
        message: `幂等拒绝：任务目录已存在推进 goal（goal ${String(existing.id)}${state}）。enter_auto_mode 对同一任务目录只启动一次——已 active/paused 的 goal 请用「继续」恢复，确需重来先 update_goal(complete/blocked) 关掉旧目标。`,
      }
    }
  }

  // ── M4 · 规范版本 × 流程类型的阶段闸门（只对 v2.1 放行待审核）────────────
  if (specVersion === SUPPORTED_SPEC_VERSION && phase !== '待审核') {
    return { ok: false, message: `当前阶段为「${phase}」而非「待审核」：enter_auto_mode 只在任务包激活（等待第一次授权）时启动自动推进。` }
  }
  if (specVersion !== SUPPORTED_SPEC_VERSION && phase !== '待审核') {
    return {
      ok: false,
      message: `规范版本 ${specVersion} 在途任务包（当前阶段「${phase}」）：请按旧流水线走完本包——${SUPPORTED_SPEC_VERSION} 的 5 态语义对旧状态头会漂移，本预设只对 ${SUPPORTED_SPEC_VERSION} 任务包的「待审核」放行。`,
    }
  }

  const running = runningTasks(rootDir, taskDir)
  if (running.length > 0) {
    return {
      ok: false,
      message: `单包串行铁则：以下任务尚未完成（既非「待启动」亦非「已完成」），请先完成在跑任务再启动本包：${running.map((r) => `${r.name}（${r.phase}）`).join('、')}。`,
    }
  }
  return { ok: true }
}

/**
 * v2.x 路径校验：设计目录指针指向的任务包 01/02；（流程类型=产品设计全流程时）
 * 设计目录的上级产品任务目录下的 04/06 + 确认版本 + 设计冻结哈希核对（M5）。
 * 内容与「预算台账」已在 validateAutoMode 中前置校验（顺序由 M4 二维分支决定）。
 * @returns {{ok: false, message: string} | undefined} an error result, or undefined when valid.
 */
function validateV2Path(rootDir, taskDir, designDir, header, flowType, products) {
  const designTaskDirAbs = isAbsolute(designDir) ? designDir : join(rootDir, designDir)
  for (const label of ['01_需求分析.md', '02_开发方案与任务包.md']) {
    const path = join(designTaskDirAbs, label)
    if (!isFile(path)) {
      return { ok: false, message: `设计目录校验失败：缺少 ${label}（${path}）。状态头「设计目录」指针应指向 01-设计/<产品任务>/任务包/<TP编号>-<名>/。` }
    }
  }
  if (DESIGN_FLOW_TYPES.has(flowType)) {
    // 04/06 在 设计目录 的上级产品任务目录（= 设计目录/../..，即 01-设计/<产品任务>/），
    // 不是设计任务包目录内——防错误层级固化（误放设计目录内应拒）。
    // ponytail: 固定两级上溯（设计目录=…/任务包/<TP>，规范固化布局）；布局可自定义时再引入配置。
    const productDir = join(designTaskDirAbs, '..', '..')
    if (!isFile(join(productDir, '04_产品设计方案.md'))) {
      return { ok: false, message: `流程类型=产品设计全流程：缺少 04_产品设计方案.md（${join(productDir, '04_产品设计方案.md')}）。04/06 应放在设计目录的上级产品任务目录（01-设计/<产品任务>/），不是任务包目录内。` }
    }
    const designEntry = join(productDir, '06_设计定稿记录.md')
    if (!isFile(designEntry)) {
      return { ok: false, message: `流程类型=产品设计全流程：缺少 06_设计定稿记录.md（${designEntry}）。` }
    }
    const version = confirmVersionOf(designEntry)
    if (version === undefined) {
      return { ok: false, message: `06_设计定稿记录.md 顶部固定块缺少可解析的「确认版本：vX.Y」字段（${designEntry}）。` }
    }
    const freeze = verifyDesignFreeze({ taskDir, productDir, header, products })
    if (freeze !== undefined) return freeze
  }
  return undefined
}

/**
 * M5 · 设计冻结哈希核对。
 * 口径（计划审核注意事项④）：**任务包 02 引用基线 ID 才核对哈希**（未引用不核，
 * 历史包不强制）；基线文件位于产品任务目录 `设计基线.json`（模板
 * `spec/03-开发协同/设计基线.example.json` / `01-设计/设计基线.example.json`）。
 * @returns {{ok: false, message: string} | undefined} an error result, or undefined when ok/skipped.
 */
function verifyDesignFreeze({ taskDir, productDir, header, products }) {
  void products
  const referenced = [...header.values()].some((v) => v.includes('设计基线'))
  const baselinePath = join(productDir, '设计基线.json')
  const baselineReferenced = referenced || isFile(baselinePath)
  if (!baselineReferenced) return undefined
  if (!isFile(baselinePath)) {
    return {
      ok: false,
      message: `设计冻结校验失败：状态头/任务包引用了设计基线但找不到 ${baselinePath}（基线 ID 未知）。请在关卡1 用调度员动作生成「设计基线.json」（基线 ID + 确认版本 + 确认时间 + 04/05/原型/06 的 SHA-256 映射）。`,
    }
  }
  let baseline
  try {
    baseline = JSON.parse(readFileSync(baselinePath, 'utf8'))
  } catch (error) {
    return { ok: false, message: `设计基线.json 不是合法 JSON（${baselinePath}）：${renderThrown(error)}。` }
  }
  const baselineId = String(baseline?.baselineId ?? baseline?.['基线ID'] ?? '?')
  const confirmedVersion = String(baseline?.confirmedVersion ?? baseline?.['确认版本'] ?? '?')
  const files = baseline?.files
  if (files === null || typeof files !== 'object') {
    return { ok: false, message: `设计基线.json（ID ${baselineId}，确认版本 ${confirmedVersion}）缺少 files 清单（${baselinePath}）：需为 { 相对路径: SHA-256 } 映射。` }
  }
  const mismatched = []
  const absent = []
  for (const [rel, expected] of Object.entries(files)) {
    const target = isAbsolute(rel) ? rel : join(productDir, ...String(rel).split('/'))
    if (!isFile(target)) {
      absent.push(rel)
      continue
    }
    const actual = sha256OfFile(target)
    if (typeof expected !== 'string' || actual !== expected.toLowerCase()) {
      mismatched.push(`${rel}（基线 ${String(expected).slice(0, 12)}… / 当前 ${String(actual).slice(0, 12)}…）`)
    }
  }
  if (absent.length > 0 || mismatched.length > 0) {
    const parts = []
    if (absent.length > 0) parts.push(`文件缺失：${absent.join('、')}`)
    if (mismatched.length > 0) parts.push(`哈希不符：${mismatched.join('、')}`)
    return {
      ok: false,
      message: `设计冻结校验失败：设计基线（ID ${baselineId}，确认版本 ${confirmedVersion}）与当前设计件不符——${parts.join('；')}。设计件在确认后被改动，请重新走关卡1 或回退重生成基线（ID 递增），再启动自动推进。`,
    }
  }
  return undefined
}

/** Install the enter_auto_mode tool and the idle-compaction handoff. */
export function apply(ctx) {
  /** Paused-goal intents waiting for the agent's next idle transition, keyed by agent id. */
  const pendingByAgent = new Map()
  /** Abort controllers of in-flight handoffs, so plugin unload can cancel them. */
  const activeControllers = new Set()

  /** One deterministic handoff: compact now, then resume no matter what. */
  async function runHandoff(agent, ref) {
    const controller = new AbortController()
    activeControllers.add(controller)
    try {
      await ctx.compaction.compactNow(agent, controller.signal)
    } catch (error) {
      // Compaction is an optimization, not a gate: any failure (busy,
      // cancelled, summary, commit, ...) degrades to the pressure-driven
      // automatic compaction and the goal still resumes.
      ctx.logger.warn(`orchestrator2-phase-gate: compaction before the first round failed for agent "${agent.id}": ${renderThrown(error)}`)
    } finally {
      activeControllers.delete(controller)
      try {
        // Resume with the PAUSED view's revision - pause bumped it past the
        // create revision, and goals.resume rejects stale refs.
        ctx.goals.resume(agent, { id: ref.id, revision: ref.revision })
      } catch (error) {
        ctx.logger.warn(`orchestrator2-phase-gate: could not resume goal "${ref.id}" (revision ${ref.revision}) for agent "${agent.id}": ${renderThrown(error)}；用户可说「继续」手动 resume`)
      }
    }
  }

  ctx.on('agent/status', ({ agent, status }) => {
    if (status !== 'idle') return
    const ref = pendingByAgent.get(agent.id)
    if (ref === undefined) return
    pendingByAgent.delete(agent.id)
    void runHandoff(agent, ref)
  })

  ctx.effect(() => {
    const disposeTool = ctx.tools.register({
      name: 'enter_auto_mode',
      description: '进入自动推进模式（阶段二）。前置条件：任务包已齐备且用户已明确确认并说「开始自动推进」。校验任务目录的 状态.md（顶部固定格式块可解析、当前阶段=待审核；按「设计目录」字段分支 v2.x 路径——设计目录下 01、02、上级产品任务目录 04/06+确认版本、预算台账机器保险丝——或 legacy 仅开发路径）+ 单包串行校验（排除在跑任务），然后建立推进 goal（推进到『待人工测试』，上限 24 轮）并挂起：本会话本轮结束转 idle 后先压缩上下文，再自动开始第一轮推进。不得在用户未确认时调用。',
      parameters: ENTER_PARAMETERS,
      output: {
        schema: ENTER_OUTPUT_SCHEMA,
        render: (_args, value) => [{ type: 'text', text: value.message }],
      },
      async execute(args, exec) {
        const agent = exec.agent
        if (agent === undefined) {
          return result(false, 'enter_auto_mode 需要一个调用方 agent（当前工具调用无 agent 上下文）。')
        }
        const invalid = validateAutoMode(sessionRoot(agent), typeof args?.taskDir === 'string' ? args.taskDir : '')
        if (!invalid.ok) return result(false, invalid.message)
        const taskDirInput = typeof args?.taskDir === 'string' ? args.taskDir.trim() : ''
        const taskDir = isAbsolute(taskDirInput) ? taskDirInput : join(sessionRoot(agent), taskDirInput)
        const taskDirName = basename(taskDir.replace(/[\\/]+$/, ''))
        const objective = typeof args?.objective === 'string' && args.objective.trim().length > 0
          ? args.objective.trim()
          : `推进 ${taskDirName} 到『待人工测试』`
        // Service-level goal creation: no authority check by design (see the
        // module header) - the model-facing create_goal tool is the
        // human-gated layer; this call is the scheduler's own machine path.
        let created
        try {
          created = ctx.goals.create(agent, { objective, maxGoalRounds: MAX_GOAL_ROUNDS })
        } catch (error) {
          return result(false, `建立推进目标失败：${renderThrown(error)}`)
        }
        let paused
        try {
          paused = ctx.goals.pause(agent, { id: created.id, revision: created.revision })
        } catch (error) {
          return result(false, `推进目标已建立（goal ${created.id}）但挂起失败：${renderThrown(error)}；goal 处于活动状态，自动推进将在未做首压缩的情况下开始（压缩退化为压力自动压缩）。`)
        }
        pendingByAgent.set(agent.id, { id: paused.id, revision: paused.revision })
        return result(
          true,
          `已建立推进目标（goal ${paused.id}，上限 ${MAX_GOAL_ROUNDS} 轮）并挂起压缩：本轮结束后会话转 idle 时将先压缩上下文，然后自动开始第一轮推进。`,
          paused.id,
        )
      },
      presentCall: (args) => ({
        card: 'generic',
        title: '进入自动推进模式',
        kind: 'other',
        ...(typeof args?.taskDir === 'string' ? { rawInput: args.taskDir } : {}),
      }),
    })
    return () => {
      disposeTool()
      pendingByAgent.clear()
      for (const controller of activeControllers) controller.abort()
      activeControllers.clear()
    }
  }, 'orchestrator2-phase-gate lifecycle')
}
