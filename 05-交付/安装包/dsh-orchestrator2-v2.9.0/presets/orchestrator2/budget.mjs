/**
 * Orchestrator2 budget meter: registers the `budget_status` model tool - a
 * PURE TOKEN USAGE STATISTICS view over the current project's sessions.
 *
 * Data source (priority per the budget design spec, layer 3): dsh-token-meter
 * exposes the `tokenUsage` projection (uncached input / output / cache read /
 * cache write; provider-reported values preferred, heuristic estimate as
 * fallback - the meter owns that policy), read through
 * ctx.sessionProjections.stateOf(session, 'tokenUsage') for every live
 * session whose workspace cwd equals the project root (the parent session +
 * child/subagent sessions inherit the parent's cwd). The tool aggregates
 * input / output / total per session and as a whole, returning text the
 * 调度员 can present directly in conversation (and optionally copy into the
 * 预算台账 usage column - the tool itself is read-only).
 *
 * Source unavailable -> explicit degradation message
 * （「计量不可用，以预算台账次数记录为准」）; NO fabricated data.
 *
 * Cost discipline: the tool counts tokens only. It performs no conversion,
 * and its output text contains no cost/price wording at all.
 *
 * Pure JS; same injection discipline as phase-gate (sits inside the
 * compaction group; host-plane `sessions` / `sessionProjections` remain
 * resolvable because the realm isolates only `compaction` and
 * `toolResultPruner`).
 *
 * Exports follow the local-plugin shape (`export const name`, `export const
 * inject`, `export function apply(ctx)`). `aggregateUsage` is an ADDITIONAL
 * pure export used by the package's own self-tests; the loader only reads the
 * plugin contract fields.
 */

import { resolve } from 'node:path'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'orchestrator2-budget'

/** Hard dependencies: the tool registry and the live-session store. The
 * projection registry is feature-detected at call time (layer-3 availability
 * is a runtime condition, not a load condition). */
export const inject = ['tools', 'sessions']

/** The projection key the token meter registers on ctx.sessionProjections. */
const TOKEN_USAGE_KEY = 'tokenUsage'

/** The `budget_status` output contract: { ok, message }. */
const OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    ok: { type: 'boolean', description: '是否成功取得 token 用量统计（false = 计量不可用降级）。' },
    message: { type: 'string', description: '给调度员（模型）的统计/降级文本。' },
  },
  required: ['ok', 'message'],
  additionalProperties: false,
}

/** Case-insensitive path equality on Windows, exact elsewhere. */
function samePath(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false
  const left = resolve(a)
  const right = resolve(b)
  return process.platform === 'win32'
    ? left.toLowerCase() === right.toLowerCase()
    : left === right
}

/** Read one session's token usage through the projection registry (feature-detected, never throws). */
function readUsage(stateOf, session) {
  if (typeof stateOf !== 'function') return undefined
  try {
    const u = stateOf(session, TOKEN_USAGE_KEY)
    const valid = u && Number.isFinite(u.uncachedInputTokens) && Number.isFinite(u.outputTokens)
    return valid ? u : undefined
  } catch {
    return undefined
  }
}

function formatNumber(n) {
  return typeof n === 'number' && Number.isFinite(n) ? String(n) : '—'
}

/**
 * Pure aggregation: project-root sessions -> token statistics text.
 * Used by the tool at run time and by the package self-tests with fixtures.
 * @param {string} rootCwd - the project root (workspace cwd of the calling agent).
 * @param {Array<{id: string, header: {cwd?: string}}>} sessions - live sessions.
 * @param {(session, key: string) => object | undefined} stateOf - projection read, or undefined.
 * @returns {{ok: boolean, message: string}}
 */
export function aggregateUsage(rootCwd, sessions, stateOf) {
  // ponytail: 只读统计，不做台账写回（写回由调度员对话完成）——省掉写盘/并发/格式耦合；
  // 需要工具侧自动回写时再加（天花板=当前零副作用契约，升级触发=用户要求自动填写用量列）。
  const matched = Array.isArray(sessions)
    // ponytail: 按 header.cwd 精确匹配项目根即可覆盖父会话+子代理会话（spawn 驱动继承父 cwd）；
    // 不推断 lineage 树——父/子 cwd 不一致的复杂场景出现后再升级递归枚举。
    ? sessions.filter((s) => s?.header && samePath(s.header.cwd, rootCwd))
    : []
  if (matched.length === 0) {
    return { ok: true, message: `未发现工作区=项目根（${rootCwd}）的会话：当前无本项目会话的 token 用量记录。` }
  }
  const rows = []
  let withoutData = 0
  for (const session of matched) {
    const usage = readUsage(stateOf, session)
    if (usage === undefined) {
      withoutData++
      continue
    }
    const input = usage.uncachedInputTokens + usage.cacheReadTokens + usage.cacheWriteTokens
    const output = usage.outputTokens
    rows.push({
      id: typeof session.id === 'string' ? session.id : '?',
      input,
      output,
      total: input + output,
    })
  }
  if (rows.length === 0) {
    return {
      ok: true,
      message: 'token 计量不可用：当前环境未提供 token 用量投影（dsh-token-meter 未挂载或尚无计量数据）。以预算台账次数记录为准（token 用量列填「—」）。',
    }
  }
  const shown = rows.length
  const lines = []
  lines.push(`token 用量（工作区=${rootCwd}，${shown} 个会话有计量数据${withoutData > 0 ? `，${withoutData} 个会话无数据` : ''}；仅统计参考，不作停机依据）：`)
  for (const row of rows) {
    lines.push(`- 会话 ${row.id}：输入=${formatNumber(row.input)} 输出=${formatNumber(row.output)} 合计=${formatNumber(row.total)}`)
  }
  const totalInput = rows.reduce((a, r) => a + r.input, 0)
  const totalOutput = rows.reduce((a, r) => a + r.output, 0)
  lines.push(`合计：输入=${formatNumber(totalInput)} 输出=${formatNumber(totalOutput)} 总计=${formatNumber(totalInput + totalOutput)}`)
  return { ok: true, message: lines.join('\n') }
}

/** Install the budget_status tool. */
export function apply(ctx) {
  ctx.effect(() => {
    const disposeTool = ctx.tools.register({
      name: 'budget_status',
      description: '查看本项目的 token 用量统计（纯统计，仅作参考，不作停机依据）：枚举工作区=项目根的会话（父会话+子代理会话），聚合输入/输出/合计 token，输出可直接对话呈现的统计文本；可选回写预算台账用量列由调度员执行。计量源不可用时返回降级说明（以预算台账次数记录为准），不伪造数据。',
      parameters: {
        type: 'object',
        properties: {},
        additionalProperties: false,
      },
      output: {
        schema: OUTPUT_SCHEMA,
        render: (_args, value) => [{ type: 'text', text: value.message }],
      },
      async execute(_args, exec) {
        const agent = exec.agent
        const rootCwd = agent?.session?.header?.cwd
        if (typeof rootCwd !== 'string' || rootCwd.length === 0) {
          return { ok: false, message: 'budget_status 需要调用方代理的工作区上下文（当前无 agent 会话或缺少 cwd）。' }
        }
        let sessions
        try {
          sessions = typeof ctx.sessions?.list === 'function' ? ctx.sessions.list() : undefined
        } catch {
          sessions = undefined
        }
        if (sessions === undefined) {
          return {
            ok: true,
            message: 'token 计量不可用：当前环境未提供会话枚举服务（ctx.sessions 不可用）。以预算台账次数记录为准（token 用量列填「—」）。',
          }
        }
        const stateOf = typeof ctx.sessionProjections?.stateOf === 'function'
          ? ctx.sessionProjections.stateOf.bind(ctx.sessionProjections)
          : undefined
        return aggregateUsage(rootCwd, sessions, stateOf)
      },
      presentCall: () => ({
        card: 'generic',
        title: '查看 token 用量',
        kind: 'other',
      }),
    })
    return () => disposeTool()
  }, 'orchestrator2-budget lifecycle')
}
