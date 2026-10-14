/**
 * orchestrator2 三角色派工工具与模型设置工具（T3-TP1 · D3 + D5 / R5·R7·R6·R9 / AC3·AC11~AC16）。
 *
 * 与官方 `@deepseek-ai/dsh-tool-subagent` 同名替换（`subagent_researcher` /
 * `subagent_reviewer` / `subagent_developer`）：**不得与官方三行并存**（同层重名抛错，
 * D6 负责从 agent.cordis.yml 删除官方行）。行为与原官方行一致的部分：continuable
 * 后台派工、返回 `{ kind:'continuable', subagentId }`、取消/结果协议交给 spawn provider；
 * 不同的部分：路由每次派工现读（D1 持久配置 + D2 会话状态），并**先 bindChild 再
 * startContinuable**（绑定先于首次 request，消除竞争窗口）。
 *
 * 设置工具：`set_role_model` / `reset_role_model` / `inspect_role_models`——
 * 嵌套 `route` 对象（顶层无 provider/model/reasoning_effort 三字段，规避宿主 invariant，
 * H/dsh-tool-subagent/lib/invariant.js:34-43），工具名不用 `list_subagent_models`。
 *
 * ponytail: 首版只支持后台 continuable（官方行的 `run_in_background` 参数保留、缺省 true）；
 * 传 false 显式报错而不是静默改语义（前景派工未实现）。升级触发 = persona 需要前景派工。
 */
import { randomUUID } from 'node:crypto'

import { ROLES, ROUTE_SLOTS, loadRoleRoutes, normalizeRoute, resolveDshHome, saveRoleRoute } from './model-routes.mjs'
import { bindChild, loadSessionState, nextEpoch, resolveEffectiveRoute, updateSessionState } from './session-routes.mjs'

/** Cordis 插件名。 */
export const name = 'orchestrator2-role-tools'

/** 依赖：工具注册表 + 子代理注册表（delegation 组 isolate 只隔离 workflowEngine，宿主面 subagents 仍可解析）。 */
export const inject = ['tools', 'subagents']

/** spawn provider 名（与官方行 config.provider 同值）。 */
export const SPAWN_PROVIDER = 'spawn'

/** 三角色 → 工具名（official 同名替换表）。 */
export const ROLE_TOOLS = Object.freeze({
  researcher: 'subagent_researcher',
  reviewer: 'subagent_reviewer',
  developer: 'subagent_developer',
})

const OUTPUT_TEXT = {
  type: 'object',
  properties: {
    ok: { type: 'boolean', description: '是否成功（false = 未写入任何状态，含一次性覆盖与校验失败）。' },
    message: { type: 'string', description: '给调度员（模型）的可读回执/报错文本。' },
  },
  required: ['ok', 'message'],
  additionalProperties: false,
}

// 返回契约与官方行一致（{kind:'continuable', subagentId}）；首版只此一支，故用单对象 schema —
// 宿主 dsh-tools 子集校验器要求 oneOf 至少两支（H/dsh-tools/lib/index.js:246 同款约束），
// 单支 oneOf 会在装配期报错（本套件 AC15-9 用同一校验器复核）。
const CONTINUABLE_OUTPUT = {
  type: 'object',
  additionalProperties: false,
  properties: {
    kind: { type: 'string', const: 'continuable' },
    subagentId: { type: 'string' },
  },
  required: ['kind', 'subagentId'],
}

/** 三角色派工工具参数（与官方行同名参数；**无** provider/model/reasoning_effort 顶层字段）。 */
function roleToolParameters(role, toolName) {
  return {
    type: 'object',
    properties: {
      description: { type: 'string', description: 'A short (3-5 word) description of the delegated task, for display.' },
      prompt: { type: 'string', description: 'The complete, self-contained task for the subagent.' },
      run_in_background: { type: 'boolean', description: 'Defaults to true. 本插件首版固定后台 continuable 派工；置 false 会显式报错（前景派工未实现）。' },
    },
    required: ['description', 'prompt'],
    additionalProperties: false,
  }
}

/** 路由 → 子代理 agentOptions 三元组（effort 省略即不传，规避宿主两次 effort 删除）。 */
export function routeToAgentOptions(route) {
  return {
    provider: route.provider,
    model: route.model,
    ...route.effort === undefined ? {} : { reasoningEffort: route.effort },
  }
}

/** 路由 → 展示串（回执/日志）。 */
export function formatRoute(route) {
  if (route === undefined || route === null) return '—'
  const effort = route.effort === undefined ? '未声明（模型默认档）' : route.effort
  return `${route.provider}/${route.model} + ${effort}`
}

/**
 * 调用者必须是主调度会话（子代理不得派工三角色、不得改父路由/永久配置）。
 * child 会话带 `header.parentSession`（H/dsh-subagent/lib/types/continuation.js:205 同款判据）。
 */
export function assertMainScheduler(agent, action) {
  if (agent === undefined || agent === null) throw new Error(`${action} 需要调用方代理（exec.agent 缺失）`)
  const parentSession = agent.session?.header?.parentSession
  if (typeof parentSession === 'string' && parentSession.length > 0) {
    throw new Error(`${action} 仅主调度会话可调用：当前调用方是子代理（parentSession=${parentSession}），子代理不得派工三角色或改父路由/永久配置`)
  }
  return agent.session.id
}

/** 一次派工的路由快照（D1 现读 + D2 会话状态 → 生效路由 + fallback + epoch）。 */
export function resolveDispatchSnapshot(role, sessionId, home) {
  const config = loadRoleRoutes({ home })
  const state = loadSessionState(sessionId, { home })
  const roleState = state.roles[role]
  return {
    config,
    state,
    route: resolveEffectiveRoute(role, state, config),
    fallbackRoute: { ...config.roles[role].fallback },
    epoch: Number.isInteger(roleState?.epoch) ? roleState.epoch : 0,
  }
}

/**
 * 建三条同名角色工具（execute 内：现读配置+会话状态 → 解析路由 → 先 bind 再 startContinuable）。
 * @param {object} ctx - cordis 上下文（需 ctx.tools）。
 * @param {{home?: string}} [options] - home 覆盖（测试注入）。
 * @returns {Array<() => void>} disposers。
 */
export function registerRoleDispatchTools(ctx, options = {}) {
  const disposers = []
  for (const [role, toolName] of Object.entries(ROLE_TOOLS)) {
    disposers.push(ctx.tools.register({
      name: toolName,
      description: `Delegate a self-contained task to a ${role} subagent（三角色派工工具，路由每次派工现读：持久默认/降级 + 本会话覆盖；自动降级由本插件 hook 承担）。It runs in the background and returns a subagent id you can continue with \`send_message\`. 首版固定 continuable 后台派工。`,
      parameters: roleToolParameters(role, toolName),
      output: {
        schema: CONTINUABLE_OUTPUT,
        render: (_args, value) => [{ type: 'text', text: `started subagent ${value.subagentId}` }],
      },
      isConcurrencySafe: () => true,
      async execute(args, exec) {
        const parent = exec.agent
        const sessionId = assertMainScheduler(parent, toolName)
        if (args?.run_in_background === false) {
          throw new Error(`${toolName}：首版仅支持后台 continuable 派工（run_in_background 缺省 true）`)
        }
        const subagents = ctx.subagents
        if (subagents === undefined || typeof subagents.startContinuable !== 'function') {
          throw new Error(`${toolName}：子代理注册表不可用（ctx.subagents.startContinuable 缺失）`)
        }
        const home = options.home ?? resolveDshHome()
        const snapshot = resolveDispatchSnapshot(role, sessionId, home)
        const childId = randomUUID()
        // 绑定先于首次 request：startContinuable 之前写入快照，消除竞争窗口（AC16）。
        await bindChild(childId, {
          parentId: sessionId,
          role,
          epoch: snapshot.epoch,
          primaryRoute: snapshot.route,
          fallbackRoute: snapshot.fallbackRoute,
          appliedRoute: snapshot.route,
          degraded: false,
        }, { home, sessionId })
        const maxDepth = typeof subagents.resolveMaxDepth === 'function' ? subagents.resolveMaxDepth(undefined) : undefined
        const started = await subagents.startContinuable({
          provider: SPAWN_PROVIDER,
          label: args.description,
          childId,
          request: {
            label: args.description,
            prompt: [{ type: 'text', text: args.prompt }],
            parent,
            agentOptions: routeToAgentOptions(snapshot.route),
            ...maxDepth === undefined ? {} : { maxDepth },
          },
          signal: exec.signal,
        })
        return { kind: 'continuable', subagentId: started.childId }
      },
      presentCall: (args) => ({
        card: 'generic',
        title: `派工 · ${role}`,
        kind: 'other',
        ...(typeof args?.description === 'string' ? { rawInput: args.description } : {}),
      }),
    }))
  }
  return disposers
}

/** 设置工具参数：嵌套 route（顶层只有 role/scope/route[/once]）。 */
const SET_ROLE_MODEL_PARAMETERS = {
  type: 'object',
  properties: {
    role: { type: 'string', enum: [...ROLES], description: '目标角色：researcher / reviewer / developer。' },
    scope: { type: 'string', enum: ['session', ...ROUTE_SLOTS], description: '缺省 session（仅本主会话，epoch+1 持续生效）；default/fallback 为持久槽位（须用户明确永久指令）。' },
    route: {
      type: 'object',
      properties: {
        provider: { type: 'string', description: 'LLM provider id。' },
        model: { type: 'string', description: '模型 id。' },
        effort: { type: 'string', description: '可选 reasoningEffort；省略 = 不传该字段（模型默认档）。' },
      },
      required: ['provider', 'model'],
      additionalProperties: false,
      description: '嵌套路由对象（顶层不出现 provider/model/reasoning_effort，规避宿主 invariant）。',
    },
    once: { type: 'boolean', description: '（可选）显式声明「仅下一次」语义；首版不支持——置 true 即返回不支持提示且不写任何状态。' },
  },
  required: ['role', 'route'],
  additionalProperties: false,
}

const RESET_ROLE_MODEL_PARAMETERS = {
  type: 'object',
  properties: {
    role: { type: 'string', enum: [...ROLES], description: '目标角色。' },
  },
  required: ['role'],
  additionalProperties: false,
}

const INSPECT_PARAMETERS = { type: 'object', properties: {}, additionalProperties: false }

/** 回执统一渲染：{ok, message} → 文本块。 */
function receiptRender(_args, value) {
  return [{ type: 'text', text: value.message }]
}

/** 未变槽位清单（回执契约：必须点明哪些槽位没动）。 */
function untouchedSlots(role, scope) {
  const slots = scope === 'session' ? [...ROUTE_SLOTS] : ROUTE_SLOTS.filter((s) => s !== scope)
  return slots.map((s) => `${role}.${s}`).join('、')
}

/**
 * 建三个模型设置工具（set/reset/inspect）。仅主调度会话可用；子代理不可写。
 * @param {object} ctx
 * @param {{home?: string}} [options]
 * @returns {Array<() => void>} disposers。
 */
export function registerModelSettingTools(ctx, options = {}) {
  const disposers = []
  const homeOf = () => options.home ?? resolveDshHome()

  disposers.push(ctx.tools.register({
    name: 'set_role_model',
    description: '设置某个角色子代理的模型路由。scope 缺省 session（仅本主会话、持续后续新派工、epoch+1 并清降级）；scope=default/fallback 为持久槽位（原子保存，当前会话及新会话的后续新派工立即读取，仅用户明确永久指令时使用）。显式会话覆盖优先于持久默认；在跑 child 保持派工快照不变。首版不支持「仅下一次」一次性覆盖（once=true 即返回不支持提示且不落状态）。',
    parameters: SET_ROLE_MODEL_PARAMETERS,
    output: { schema: OUTPUT_TEXT, render: receiptRender },
    async execute(args, exec) {
      const sessionId = assertMainScheduler(exec.agent, 'set_role_model')
      const role = args?.role
      const scope = args?.scope ?? 'session'
      if (!ROLES.includes(role)) return { ok: false, message: `set_role_model 失败：未知角色「${role}」（合法值：${ROLES.join(' / ')}）。未写入任何状态。` }
      if (scope !== 'session' && !ROUTE_SLOTS.includes(scope)) return { ok: false, message: `set_role_model 失败：未知 scope「${scope}」（合法值：session / default / fallback）。未写入任何状态。` }
      if (args?.once === true) {
        return { ok: false, message: '首版不支持「仅下一次」一次性覆盖：普通改模持续当前会话，直到再改/恢复或新建会话。本次未写入任何会话/永久状态。' }
      }
      let route
      try {
        route = normalizeRoute(args?.route, 'route')
      } catch (error) {
        return { ok: false, message: `set_role_model 失败：${error.message}。未写入任何状态。` }
      }
      const home = homeOf()
      try {
        if (scope === 'session') {
          await updateSessionState(sessionId, (state) => {
            state.roles[role] = { epoch: nextEpoch(state.roles[role]), overrideRoute: route, degraded: false }
          }, { home })
          return {
            ok: true,
            message: `已设置（scope=session）：${role} → ${formatRoute(route)}。生效点：本会话后续**新派工**（在跑 child 保持派工快照不变）。显式会话覆盖优先于持久默认/降级；降级态已清除。未变槽位：${untouchedSlots(role, scope)}；持久配置未改。`,
          }
        }
        await saveRoleRoute(role, scope, route, { home })
        return {
          ok: true,
          message: `已持久保存（scope=${scope}）：${role}.${scope} → ${formatRoute(route)}。生效点：当前会话及新会话的后续**新派工**立即读取。显式会话覆盖仍优先（若存在 session 覆盖，本会话继续用它）；在跑 child 不变。未变槽位：${untouchedSlots(role, scope)}。`,
        }
      } catch (error) {
        return { ok: false, message: `set_role_model 失败（未发布成功态、未写内存成功标记）：${error instanceof Error ? error.message : String(error)}` }
      }
    },
    presentCall: (args) => ({ card: 'generic', title: '设置角色模型', kind: 'other', ...(typeof args?.role === 'string' ? { rawInput: `${args.role} · ${args.scope ?? 'session'}` } : {}) }),
  }))

  disposers.push(ctx.tools.register({
    name: 'reset_role_model',
    description: '清除某角色的本会话覆盖与降级态（epoch+1），回到持久默认路由；持久配置槽位不变。仅主调度会话可用。',
    parameters: RESET_ROLE_MODEL_PARAMETERS,
    output: { schema: OUTPUT_TEXT, render: receiptRender },
    async execute(args, exec) {
      const sessionId = assertMainScheduler(exec.agent, 'reset_role_model')
      const role = args?.role
      if (!ROLES.includes(role)) return { ok: false, message: `reset_role_model 失败：未知角色「${role}」（合法值：${ROLES.join(' / ')}）。未写入任何状态。` }
      const home = homeOf()
      try {
        const config = loadRoleRoutes({ home })
        let epoch = 0
        await updateSessionState(sessionId, (state) => {
          epoch = nextEpoch(state.roles[role])
          state.roles[role] = { epoch, degraded: false }
        }, { home })
        return {
          ok: true,
          message: `已恢复（scope=session）：${role} 的本会话覆盖与降级态已清除（epoch=${epoch}）→ 生效路由 ${formatRoute(config.roles[role].default)}。生效点：本会话后续**新派工**；在跑 child 保持快照。持久槽位 default/fallback 未改。`,
        }
      } catch (error) {
        return { ok: false, message: `reset_role_model 失败（未发布成功态）：${error instanceof Error ? error.message : String(error)}` }
      }
    },
    presentCall: (args) => ({ card: 'generic', title: '恢复角色模型', kind: 'other', ...(typeof args?.role === 'string' ? { rawInput: args.role } : {}) }),
  }))

  disposers.push(ctx.tools.register({
    name: 'inspect_role_models',
    description: '查看三角色的持久默认/降级路由、本会话覆盖与降级态、epoch 及在跑 child 快照数（不含任何凭据）。',
    parameters: INSPECT_PARAMETERS,
    output: { schema: OUTPUT_TEXT, render: receiptRender },
    async execute(_args, exec) {
      const sessionId = assertMainScheduler(exec.agent, 'inspect_role_models')
      const home = homeOf()
      try {
        const config = loadRoleRoutes({ home })
        const state = loadSessionState(sessionId, { home })
        const lines = [`角色模型路由（持久配置：<DSH_HOME>/orchestrator2/model-routes.json；会话状态：sessions/${sessionId}.json）`]
        for (const role of ROLES) {
          const roleState = state.roles[role]
          const children = Object.entries(state.children).filter(([, c]) => c.role === role)
          const degradedChildren = children.filter(([, c]) => c.degraded === true).length
          lines.push(`- ${role}：default=${formatRoute(config.roles[role].default)}；fallback=${formatRoute(config.roles[role].fallback)}`)
          lines.push(`  本会话：epoch=${roleState?.epoch ?? 0}；显式覆盖=${roleState?.overrideRoute === undefined ? '无' : formatRoute(roleState.overrideRoute)}；降级态=${roleState?.degraded === true ? `已降级（${roleState.reason ?? '无原因记录'}）` : '未降级'}；当前生效=${formatRoute(resolveEffectiveRoute(role, state, config))}`)
          lines.push(`  child 快照：${children.length} 个（其中已降级 ${degradedChildren} 个）`)
        }
        lines.push('说明：会话覆盖仅本会话有效；持久槽位改动对当前及新会话的后续新派工生效；显式会话覆盖优先于持久默认。')
        return { ok: true, message: lines.join('\n') }
      } catch (error) {
        return { ok: false, message: `inspect_role_models 失败：${error instanceof Error ? error.message : String(error)}` }
      }
    },
    presentCall: () => ({ card: 'generic', title: '查看角色模型', kind: 'other' }),
  }))

  return disposers
}

/** 插件入口：一次注册六件工具，随 fiber 释放。 */
export function apply(ctx) {
  ctx.effect(() => {
    const disposers = [...registerRoleDispatchTools(ctx), ...registerModelSettingTools(ctx)]
    return () => { for (const dispose of disposers) dispose() }
  }, 'orchestrator2-role-tools lifecycle')
}
