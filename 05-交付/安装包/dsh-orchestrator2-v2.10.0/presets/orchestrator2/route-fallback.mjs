/**
 * orchestrator2 故障自动降级 hook（T3-TP1 · D4 / R2·R3·R8 / AC4~AC8，G1 硬闸门）。
 *
 * 两个 waterfall 监听：
 * - `agent/request`：按 child 绑定快照返回本次调用配置（已降级 → fallbackRoute，否则 primaryRoute），
 *   并自记 appliedRoute（H/dsh-agent/lib/types/runtime-types.d.ts:327-332）。
 * - `agent/request-error`：适用失败**独占处置**——标降级 + 返回 `{kind:'retry'}` 且不调 next，
 *   同 step 重走 request 时应用 fallback；fallback 再失败 → 终局传播，不二次切换、不循环
 *   （H /dsh-agent-loop/lib/index.js:1124-1134 的 waterfall 契约）。
 *
 * **G1 次序闸门（承重）**：RATE_LIMIT 在宿主默认 `retryableCodes` 内
 * （H/dsh-llm/lib/types/retry-policy.js:16-22），llm-retry 的 `agent/request-error` 监听
 * 若先于本插件执行，会先同模型重试、把适用失败消耗掉。本模块因此以 **`{ prepend: true }`**
 * 注册监听——`ctx.on` 对 `prepend` 走 `hooks.unshift`（H/cordis/lib/index.js:336），
 * 而 waterfall 是「列表顺序 = 最外层优先、不调 next 即否决其余链」
 * （同文件 317-325）；llm-retry 自身不 prepend（H/dsh-llm-retry/lib/index.js:175），
 * 故本插件稳定排在它前面。同时**不改**全局 provider maxRetries / retryPolicy，
 * 也**不**退化为「下次派工才换模型」。
 *
 * 取消优先：`signal.aborted` → 直接终局（返回 undefined，不请求模型、不吞取消）。
 *
 * AC8 分类面取证（静态）：适配器把 provider 错误归一为稳定 code ——
 * 429/rate_limit → `RATE_LIMIT`（H/dsh-llm-deepseek/lib/index.js:1752；
 * H/dsh-llm-pi-ai/lib/index.js:1383 同款），quota 类 → `QUOTA`（前两处前述行 1751/1382），
 * 定量语义见 H/dsh-llm/lib/types/error.js:22-26（CONTEXT_WINDOW_EXCEEDED / QUOTA / ACCOUNT_QUOTA）。
 */
import { resolveDshHome } from './model-routes.mjs'
import { getChildBinding, resolveEffectiveRoute, updateSessionState } from './session-routes.mjs'

/** Cordis 插件名。 */
export const name = 'orchestrator2-route-fallback'

/** 适用降级的稳定码（RATE_LIMIT = 429/限流；ACCOUNT_QUOTA = 可按账单页补充的账户配额窗口）。 */
export const DEGRADABLE_CODES = Object.freeze(['RATE_LIMIT', 'ACCOUNT_QUOTA'])

/** 明确不适用的稳定码（不误降级；未知码同样不降级）。 */
export const NON_DEGRADABLE_CODES = Object.freeze([
  'AUTH', 'INVALID_CREDENTIAL', 'INVALID_REQUEST', 'CONTEXT_WINDOW_EXCEEDED',
  'NO_ADAPTER', 'EMPTY_RESPONSE', 'IMAGE_OFFLOAD_REQUIRED',
])

/**
 * 错误分类（纯函数）。
 * - RATE_LIMIT / HTTP 429 → 适用（用户裁定「429/限流立即降级」）；
 * - ACCOUNT_QUOTA → 适用（可按账单页补充的账户配额窗口）；
 * - QUOTA → 仅当带 `providerRetryAfterMs`（provider 给出可恢复窗口证据）才适用；
 *   否则归「信息不足」如实报告、不自动降级（H/dsh-llm/lib/types/error.js:76-79 的措辞同时覆盖
 *   永久余额不足与窗口耗尽，无法从 code 单独区分）；
 * - AUTH / CONTEXT_WINDOW_EXCEEDED / INVALID_REQUEST / 无效模型 / 安全拒绝（失败未归一为稳定码）
 *   → 不适用，终局传播。
 * @param {{code?: string, status?: number, providerRetryAfterMs?: number}} failure
 * @returns {{kind: 'degradable'|'not-applicable'|'unknown', code: string, reason: string}}
 */
export function classifyFailure(failure) {
  const code = typeof failure?.code === 'string' ? failure.code.trim() : ''
  const status = typeof failure?.status === 'number' ? failure.status : undefined
  const retryAfterMs = typeof failure?.providerRetryAfterMs === 'number' && failure.providerRetryAfterMs > 0
    ? failure.providerRetryAfterMs
    : undefined
  if (code === 'RATE_LIMIT' || status === 429) {
    return { kind: 'degradable', code: code || 'RATE_LIMIT', reason: `限流/429（code=${code || '—'}${status === 429 ? ' status=429' : ''}）` }
  }
  if (code === 'ACCOUNT_QUOTA') {
    return { kind: 'degradable', code, reason: '账户配额窗口耗尽（ACCOUNT_QUOTA，可按账单页补充；用户裁定可恢复额度立即降级）' }
  }
  if (code === 'QUOTA') {
    return retryAfterMs === undefined
      ? { kind: 'unknown', code, reason: 'QUOTA 无法区分永久余额不足与可恢复窗口耗尽，且无 providerRetryAfterMs 证据 → 如实报告，不自动降级' }
      : { kind: 'degradable', code, reason: `QUOTA + providerRetryAfterMs=${retryAfterMs}ms（provider 给出的可恢复窗口证据）` }
  }
  if (code === '') {
    return { kind: 'unknown', code: '', reason: '失败未提供稳定 code（信息不足，如实报告，不自动降级）' }
  }
  return {
    kind: 'not-applicable',
    code,
    reason: NON_DEGRADABLE_CODES.includes(code)
      ? `${code} 属非适用集（认证/参数/上下文/安全等），不误降级`
      : `${code} 不在适用集内（未知分类按不适用处理，如实报告）`,
  }
}

/** 从请求方 agent 反查 child 绑定：只有子代理才有 parentSession（主会话直接放行给宿主默认）。 */
export function bindingFor(agent, home) {
  const parentSession = agent?.session?.header?.parentSession
  if (typeof parentSession !== 'string' || parentSession.length === 0) return undefined
  const childId = agent?.id
  if (typeof childId !== 'string' || childId.length === 0) return undefined
  return getChildBinding(childId, { home, sessionId: parentSession })
}

/** 路由比较（用于判断 appliedRoute 是否需要回写）。 */
function sameRoute(a, b) {
  return a?.provider === b?.provider && a?.model === b?.model && (a?.effort ?? '') === (b?.effort ?? '')
}

/**
 * 建两个 hook 处理器（纯函数 + 注入 home，便于单测直接驱动）。
 * @param {{home?: string, logger?: object, strictWrite?: boolean}} [options]
 * @returns {{onRequest: Function, onRequestError: Function}}
 */
export function createRouteFallbackHandlers(options = {}) {
  const home = options.home ?? resolveDshHome()
  const logger = options.logger

  /** 回写 child 快照（bookkeeping）：失败按 options.strictWrite 决定抛出还是告警续跑。 */
  async function writeBinding(sessionId, childId, mutate, strict) {
    try {
      await updateSessionState(sessionId, (state) => {
        const child = state.children[childId]
        if (child === undefined) return
        mutate(state, child)
      }, { home })
    } catch (error) {
      const message = `route-fallback: 会话状态回写失败（session=${sessionId} child=${childId}）：${error instanceof Error ? error.message : String(error)}`
      if (strict) throw new Error(message)
      logger?.warn?.(message)
    }
  }

  async function onRequest(payload, next) {
    const agent = payload?.agent
    const binding = bindingFor(agent, home)
    if (binding === undefined) return next()
    const route = binding.degraded === true ? binding.fallbackRoute : binding.primaryRoute
    const base = await next()
    const out = { ...base, provider: route.provider, model: route.model }
    // effort 省略 = 不传该字段；路由变更时不得继承旧模型的档位（04 §三：不跨模型继承）。
    if (route.effort === undefined) delete out.reasoningEffort
    else out.reasoningEffort = route.effort
    const applied = { provider: route.provider, model: route.model, ...(route.effort === undefined ? {} : { effort: route.effort }) }
    if (!sameRoute(binding.appliedRoute, applied)) {
      await writeBinding(binding.parentId, agent.id, (_state, child) => { child.appliedRoute = applied }, options.strictWrite === true)
    }
    return out
  }

  async function onRequestError(payload, next) {
    if (payload?.signal?.aborted === true) return undefined
    const agent = payload?.agent
    const binding = bindingFor(agent, home)
    if (binding === undefined) return next()
    const verdict = classifyFailure(payload?.failure)
    if (verdict.kind !== 'degradable') {
      logger?.info?.(`route-fallback: 不降级（${verdict.reason}）`)
      return next()
    }
    if (binding.degraded === true) {
      // fallback 也失败 → 终局传播，不再切换、不循环（AC6）。
      logger?.warn?.(`route-fallback: fallback 路由仍失败（${verdict.code}），终局传播不再切换`)
      return undefined
    }
    const reason = `${verdict.reason} → 自动降级到 ${binding.fallbackRoute.provider}/${binding.fallbackRoute.model}`
    await writeBinding(binding.parentId, agent.id, (state, child) => {
      child.degraded = true
      // epoch 一致性：仅当主会话当前 epoch 与 child 快照 epoch 相同才写回 role 降级态，
      // 旧 epoch child 的故障不得污染用户新指令（AC10）。
      const roleState = state.roles[child.role]
      const currentEpoch = Number.isInteger(roleState?.epoch) ? roleState.epoch : 0
      if (currentEpoch !== child.epoch) return
      state.roles[child.role] = {
        ...roleState === undefined ? {} : { overrideRoute: roleState.overrideRoute },
        epoch: currentEpoch,
        degraded: true,
        reason,
      }
    }, true)
    // 独占处置：不调 next → llm-retry 不会先同模型重试；同 step 重走 request 时应用 fallback。
    return { kind: 'retry' }
  }

  return { onRequest, onRequestError }
}

/**
 * 插件入口：注册两个 waterfall 监听（`prepend: true` = G1 次序机制）。
 * @param {object} ctx - cordis 上下文（需 ctx.on / ctx.effect）。
 */
export function apply(ctx) {
  const handlers = createRouteFallbackHandlers({ home: resolveDshHome(), logger: ctx.logger })
  ctx.effect(() => {
    const offRequest = ctx.on('agent/request', handlers.onRequest, { prepend: true })
    const offError = ctx.on('agent/request-error', handlers.onRequestError, { prepend: true })
    return () => {
      offRequest?.()
      offError?.()
    }
  }, 'orchestrator2-route-fallback lifecycle')
}
