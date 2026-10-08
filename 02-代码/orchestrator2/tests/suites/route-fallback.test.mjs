/**
 * T4 · D4 故障自动降级 hook 单测（AC4 / AC5 / AC6 / AC7 / AC8，G1 硬闸门）。
 * Run: node 02-代码/orchestrator2/tests/suites/route-fallback.test.mjs
 *
 * G1 次序闸门的证明方式：**mock 事件总线逐字复刻宿主 waterfall 语义**——
 *   ① `ctx.on(name, fn, { prepend: true })` → `hooks.unshift`（H/cordis/lib/index.js:336）；
 *   ② `waterfall` 取列表顺序、最外层优先，`next()` = 剩余链，不调 next 即否决其余（同文件 317-325）；
 *   ③ mock llm-retry 监听按宿主策略语义（retryableCodes 含 RATE_LIMIT，
 *      H/dsh-llm/lib/types/retry-policy.js:16-22）先同模型重试。
 * 正例：本插件 prepend → 先于 llm-retry 处置（llm-retry 零调用）；反例（对照组）：不 prepend →
 * llm-retry 先消耗适用失败、降级不发生 —— 反例即「能证明失败的最小检查」。
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { CACHE } from '../lib/paths.mjs'
import { reporter } from '../lib/test-harness.mjs'

const FALLBACK_MOD = new URL('../../route-fallback.mjs', import.meta.url).href
const SESSION_MOD = new URL('../../session-routes.mjs', import.meta.url).href
const ROUTES_MOD = new URL('../../model-routes.mjs', import.meta.url).href
const {
  apply, createRouteFallbackHandlers, classifyFailure, bindingFor,
  DEGRADABLE_CODES, NON_DEGRADABLE_CODES,
} = await import(FALLBACK_MOD)
const { bindChild, loadSessionState, updateSessionState } = await import(SESSION_MOD)
const { loadRoleRoutes } = await import(ROUTES_MOD)

const { check, pushLine, writeResult } = reporter('route-fallback.test', 'T4 · D4 故障自动降级 hook 单测（G1 硬闸门）')

mkdirSync(CACHE, { recursive: true })
const home = mkdtempSync(join(CACHE, 'fallback-fixtures-'))
const CHILD_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
const SESSION_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
const CHILD_AGENT = { id: CHILD_ID, session: { id: CHILD_ID, header: { parentSession: SESSION_ID } } }
const MAIN_AGENT = { id: SESSION_ID, session: { id: SESSION_ID, header: {} } }
const signal = new AbortController().signal

/** mock 事件总线：逐字复刻 H/cordis 的 on(prepend) + waterfall 语义。 */
function createBus() {
  const hooks = new Map()
  return {
    registrations: [],
    on(name, listener, options = {}) {
      const list = hooks.get(name) ?? []
      hooks.set(name, list)
      const entry = { listener, options }
      list[options?.prepend === true ? 'unshift' : 'push'](entry) // H/cordis:336
      this.registrations.push({ name, prepend: options?.prepend === true })
      return () => { const i = list.indexOf(entry); if (i >= 0) list.splice(i, 1) }
    },
    waterfall(name, payload, inner) {
      const cbs = [...(hooks.get(name) ?? [])].map((e) => e.listener) // H/cordis:317-325
      const next = () => (cbs.shift() ?? inner)(payload, next)
      return next()
    },
  }
}

/** mock llm-retry：按宿主默认 retryableCodes 语义先同模型重试（会消耗 RATE_LIMIT）。 */
function llmRetryStub(record, retryableCodes = ['RATE_LIMIT', 'SERVER', 'TIMEOUT', 'TRANSPORT', 'EMPTY_RESPONSE']) {
  return async (payload, next) => {
    record.calls.push(payload.failure?.code ?? '')
    if (!retryableCodes.includes(payload.failure?.code)) return next()
    record.sameModelRetries.push(payload.failure?.code)
    return { kind: 'retry' }
  }
}

const seedRequest = () => ({ provider: 'kimi-coding', model: 'k3-256k', reasoningEffort: 'max', maxTokens: 4096 })
const config = loadRoleRoutes({ home })

async function bindChildWith(primary, epoch = 0, childId = CHILD_ID) {
  await bindChild(childId, {
    parentId: SESSION_ID, role: 'developer', epoch,
    primaryRoute: primary, fallbackRoute: config.roles.developer.fallback,
  }, { home, sessionId: SESSION_ID })
}

// ══ AC5 / G1：正例（prepend）══
const busA = createBus()
const recordA = { calls: [], sameModelRetries: [] }
busA.on('agent/request-error', llmRetryStub(recordA)) // 先注册（模拟宿主启动期注册）
const prevHome = process.env.DSH_HOME
process.env.DSH_HOME = home // apply() 内部经 resolveDshHome() 读环境变量
const fallbackCtx = { logger: { info: () => {}, warn: () => {} }, effect: (fn) => fn(), on: (n, l, o) => busA.on(n, l, o) }
apply(fallbackCtx)
process.env.DSH_HOME = prevHome
const appliedRegistrations = busA.registrations.filter((r) => r.prepend === true)
check('AC5-1 本插件两个监听均以 { prepend: true } 注册（G1 次序机制，代码级证据）',
  appliedRegistrations.length === 2 &&
  appliedRegistrations.map((r) => r.name).sort().join(',') === 'agent/request,agent/request-error' &&
  busA.registrations[0].prepend === false,
  `apply 注册=${JSON.stringify(appliedRegistrations)}；此前 llm-retry stub 注册 prepend=${busA.registrations[0].prepend}`)

const handlers = createRouteFallbackHandlers({ home })
await bindChildWith(config.roles.developer.default)
const reqWithHandlers = (bus) => bus.waterfall('agent/request', { agent: CHILD_AGENT, turn: 1, step: 1, signal }, seedRequest)
const errWithHandlers = (bus, code, extra = {}) => bus.waterfall('agent/request-error', {
  agent: CHILD_AGENT, turn: 1, step: 1, provider: 'deepseek-official',
  failure: { message: `${code} injected`, code, ...extra }, retryPolicy: undefined, signal,
}, () => undefined)

// 正例链：本插件监听 prepend 在最外层；mock llm-retry 在链上但不该被调用
busA.on('agent/request', handlers.onRequest, { prepend: true })
const busAErrCount = busA.registrations.length
busA.on('agent/request-error', handlers.onRequestError, { prepend: true })

const first = await reqWithHandlers(busA)
check('AC5-2 request hook 按 child 绑定返回主路由（覆盖宿主 seed 的会话默认模型）',
  first.provider === 'deepseek-official' && first.model === 'deepseek-flash' && first.reasoningEffort === 'max' && first.maxTokens === 4096,
  JSON.stringify(first))
const verdictRateLimit = classifyFailure({ code: 'RATE_LIMIT', status: 429 })
const err401 = await errWithHandlers(busA, 'RATE_LIMIT', { status: 429 })
check('AC5-3 429/RATE_LIMIT → 本插件独占处置返回 {kind:"retry"}（不调 next）', err401?.kind === 'retry', JSON.stringify(err401))
check('AC5-4 **G1 硬闸门**：llm-retry 同模型重试零发生（适用失败未被它先消耗）',
  recordA.sameModelRetries.length === 0 && recordA.calls.length === 0,
  `llm-retry 调用=${recordA.calls.length} 同模型重试=${recordA.sameModelRetries.length}`)
const degradedState = loadSessionState(SESSION_ID, { home })
check('AC5-5 降级写入：child 快照 degraded=true + role 降级态（同 epoch）+ 可读 reason',
  degradedState.children[CHILD_ID].degraded === true && degradedState.roles.developer.degraded === true &&
  typeof degradedState.roles.developer.reason === 'string' && degradedState.roles.developer.reason.includes('RATE_LIMIT'),
  `reason=${degradedState.roles.developer.reason}`)
const second = await reqWithHandlers(busA)
check('AC5-6 同 step 重走 request → 应用 fallback 路由（同 childId，无新派工）',
  second.provider === 'openai-codex' && second.model === 'gpt-5.6-luna' && second.reasoningEffort === 'xhigh' &&
  loadSessionState(SESSION_ID, { home }).children[CHILD_ID].appliedRoute.model === 'gpt-5.6-luna',
  JSON.stringify(second))
void busAErrCount
void verdictRateLimit

// ══ 对照组：不 prepend（后注册 = 最内层）→ llm-retry 先消耗，降级不发生 ══
const busB = createBus()
const recordB = { calls: [], sameModelRetries: [] }
busB.on('agent/request-error', llmRetryStub(recordB))
busB.on('agent/request', handlers2().onRequest) // append（naive 实现）
busB.on('agent/request-error', handlers2().onRequestError)
function handlers2() { return createRouteFallbackHandlers({ home }) }
const CHILD_ID_2 = 'ffffffff-ffff-4fff-8fff-ffffffffffff'
await bindChildWith(config.roles.developer.default, 1, CHILD_ID_2)
const CHILD_AGENT_2 = { id: CHILD_ID_2, session: { id: CHILD_ID_2, header: { parentSession: SESSION_ID } } }
await busB.waterfall('agent/request', { agent: CHILD_AGENT_2, turn: 1, step: 1, signal }, seedRequest)
const err402 = await busB.waterfall('agent/request-error', {
  agent: CHILD_AGENT_2, turn: 1, step: 1, provider: 'deepseek-official',
  failure: { message: 'RATE_LIMIT injected', code: 'RATE_LIMIT', status: 429 }, retryPolicy: undefined, signal,
}, () => undefined)
const stateB = loadSessionState(SESSION_ID, { home })
check('AC5-7 反例（不 prepend）：llm-retry 先同模型重试，本插件未获处置机会 → 该 child 降级不发生（证明 prepend 承重）',
  err402?.kind === 'retry' && recordB.sameModelRetries.length === 1 &&
  stateB.children[CHILD_ID_2].degraded === false,
  `llm-retry 同模型重试=${recordB.sameModelRetries.length} 反例 child.degraded=${stateB.children[CHILD_ID_2].degraded}（正例 child=${degradedState.children[CHILD_ID].degraded} 对照）`)

// ══ AC4：临时覆盖模型遇 429 也降级到该角色 fallback ══
const CHILD_ID_3 = '1a1a1a1a-1a1a-4a1a-8a1a-1a1a1a1a1a1a'
const overrideRoute = { provider: 'kimi-coding', model: 'k3', effort: 'max' }
const busC = createBus()
const recordC = { calls: [], sameModelRetries: [] }
busC.on('agent/request-error', llmRetryStub(recordC))
busC.on('agent/request', handlers.onRequest, { prepend: true })
busC.on('agent/request-error', handlers.onRequestError, { prepend: true })
await bindChildWith(overrideRoute, 1, CHILD_ID_3)
const CHILD_AGENT_3 = { id: CHILD_ID_3, session: { id: CHILD_ID_3, header: { parentSession: SESSION_ID } } }
const overridden = await busC.waterfall('agent/request', { agent: CHILD_AGENT_3, turn: 1, step: 1, signal }, seedRequest)
check('AC4-1 临时覆盖模型作为主路由派工（primary=override）',
  overridden.provider === 'kimi-coding' && overridden.model === 'k3', JSON.stringify(overridden))
await busC.waterfall('agent/request-error', {
  agent: CHILD_AGENT_3, turn: 1, step: 1, provider: 'kimi-coding',
  failure: { message: '429', code: 'RATE_LIMIT', status: 429 }, retryPolicy: undefined, signal,
}, () => undefined)
const degradedOverride = await busC.waterfall('agent/request', { agent: CHILD_AGENT_3, turn: 1, step: 1, signal }, seedRequest)
check('AC4-2 临时覆盖模型遇 429 同样自动降级到该角色 fallback（gpt-5.6-luna/xhigh）',
  degradedOverride.provider === 'openai-codex' && degradedOverride.model === 'gpt-5.6-luna' && degradedOverride.reasoningEffort === 'xhigh',
  JSON.stringify(degradedOverride))

// ══ AC6：fallback 再失败 → 终局传播、无二次切换、无循环 ══
const recordC2 = recordC.calls.length
const errAfterFallback = await busC.waterfall('agent/request-error', {
  agent: CHILD_AGENT_3, turn: 1, step: 1, provider: 'openai-codex',
  failure: { message: '429 again', code: 'RATE_LIMIT', status: 429 }, retryPolicy: undefined, signal,
}, () => undefined)
const stateC = loadSessionState(SESSION_ID, { home })
check('AC6-1 fallback 再失败 → 返回 undefined（终局传播，不再交给下游无限重试）',
  errAfterFallback === undefined && recordC.calls.length === recordC2,
  `action=${JSON.stringify(errAfterFallback)} 下游额外调用=${recordC.calls.length - recordC2}`)
check('AC6-2 无二次切换（快照仍为已降级态，appliedRoute 未回切主路由）',
  stateC.children[CHILD_ID_3].degraded === true && stateC.children[CHILD_ID_3].appliedRoute.model === 'gpt-5.6-luna',
  `appliedRoute=${JSON.stringify(stateC.children[CHILD_ID_3].appliedRoute)}`)

// ══ AC7：非适用错误不误降级、终局传播 ══
const CHILD_ID_4 = '2b2b2b2b-2b2b-4b2b-8b2b-2b2b2b2b2b2b'
const busD = createBus()
const recordD = { calls: [], sameModelRetries: [] }
busD.on('agent/request-error', llmRetryStub(recordD))
busD.on('agent/request', handlers.onRequest, { prepend: true })
busD.on('agent/request-error', handlers.onRequestError, { prepend: true })
await bindChildWith(config.roles.developer.default, 1, CHILD_ID_4)
const CHILD_AGENT_4 = { id: CHILD_ID_4, session: { id: CHILD_ID_4, header: { parentSession: SESSION_ID } } }
const nonApplicable = ['AUTH', 'CONTEXT_WINDOW_EXCEEDED', 'INVALID_REQUEST', 'SOME_PROVIDER_REFUSAL']
const nonApplicableResult = []
for (const code of nonApplicable) {
  const action = await busD.waterfall('agent/request-error', {
    agent: CHILD_AGENT_4, turn: 1, step: 1, provider: 'deepseek-official',
    failure: { message: code, code }, retryPolicy: undefined, signal,
  }, () => undefined)
  nonApplicableResult.push(`${code}:${JSON.stringify(action) ?? 'undefined'}`)
}
const stateD = loadSessionState(SESSION_ID, { home })
check('AC7-1 AUTH / CONTEXT_WINDOW_EXCEEDED / INVALID_REQUEST / 未知（无效模型·安全拒绝）→ 不降级',
  stateD.children[CHILD_ID_4].degraded === false &&
  stateD.roles.developer.epoch === stateC.roles.developer.epoch &&
  stateD.roles.developer.reason === stateC.roles.developer.reason,
  `${nonApplicableResult.join(' | ')}；child4.degraded=${stateD.children[CHILD_ID_4].degraded}（role 降级态与前一场景逐字段相同，未被本组触碰）`)
check('AC7-2 非适用错误交下游并终局传播（下游 llm-retry 收到调用且未同模型重试）',
  recordD.calls.length === nonApplicable.length && recordD.sameModelRetries.length === 0,
  `下游调用=${recordD.calls.length}/${nonApplicable.length} 同模型重试=${recordD.sameModelRetries.length}`)
check('AC7-3 QUOTA 无 providerRetryAfterMs → 信息不足不降级；带 providerRetryAfterMs → 适用',
  classifyFailure({ code: 'QUOTA' }).kind === 'unknown' &&
  classifyFailure({ code: 'QUOTA', providerRetryAfterMs: 30000 }).kind === 'degradable',
  `无证据=${classifyFailure({ code: 'QUOTA' }).kind} 有证据=${classifyFailure({ code: 'QUOTA', providerRetryAfterMs: 30000 }).kind}`)

// ══ 取消优先：signal.aborted → 直接终局，不降级、不请求模型 ══
const CHILD_ID_5 = '3c3c3c3c-3c3c-4c3c-8c3c-3c3c3c3c3c3c'
await bindChildWith(config.roles.developer.default, 1, CHILD_ID_5)
const CHILD_AGENT_5 = { id: CHILD_ID_5, session: { id: CHILD_ID_5, header: { parentSession: SESSION_ID } } }
const abortController = new AbortController()
abortController.abort()
const recordE = { calls: [], sameModelRetries: [] }
const busE = createBus()
busE.on('agent/request-error', llmRetryStub(recordE))
busE.on('agent/request-error', handlers.onRequestError, { prepend: true })
const abortedAction = await busE.waterfall('agent/request-error', {
  agent: CHILD_AGENT_5, turn: 1, step: 1, provider: 'deepseek-official',
  failure: { message: '429', code: 'RATE_LIMIT', status: 429 }, retryPolicy: undefined, signal: abortController.signal,
}, () => undefined)
check('AC4~AC8 取消注入：signal.aborted → 直接终局（undefined），不降级、不吞取消、不请求模型',
  abortedAction === undefined && recordE.calls.length === 0 &&
  loadSessionState(SESSION_ID, { home }).children[CHILD_ID_5].degraded === false,
  `action=${JSON.stringify(abortedAction)} 下游调用=${recordE.calls.length}`)

// ══ 非本插件派工的 child / 主会话：零副作用放行 ══
const busF = createBus()
const recordF = { calls: [], sameModelRetries: [] }
busF.on('agent/request-error', llmRetryStub(recordF))
busF.on('agent/request', handlers.onRequest, { prepend: true })
busF.on('agent/request-error', handlers.onRequestError, { prepend: true })
const mainReq = await busF.waterfall('agent/request', { agent: MAIN_AGENT, turn: 1, step: 1, signal }, seedRequest)
const foreignErr = await busF.waterfall('agent/request-error', {
  agent: { id: '4d4d4d4d-4d4d-4d4d-8d4d-4d4d4d4d4d4d', session: { id: '4d4d4d4d-4d4d-4d4d-8d4d-4d4d4d4d4d4d', header: {} } },
  turn: 1, step: 1, provider: 'deepseek-official', failure: { message: 'AUTH', code: 'AUTH' }, retryPolicy: undefined, signal,
}, () => undefined)
check('主会话 / 非本插件 child → 原样放行（不覆盖宿主默认路由、无绑定查询副作用）',
  mainReq.provider === 'kimi-coding' && mainReq.model === 'k3-256k' && foreignErr === undefined &&
  bindingFor(MAIN_AGENT, home) === undefined,
  `主会话路由=${mainReq.provider}/${mainReq.model}`)

// ══ AC8：适配器分类面静态取证（稳定 code 表） ══
const HOST = 'C:\\Users\\nicia\\AppData\\Roaming\\npm\\node_modules\\@deepseek-ai\\dsh\\node_modules\\@deepseek-ai'
const deepseekAdapter = join(HOST, 'dsh-llm-deepseek', 'lib', 'index.js')
const piAdapter = join(HOST, 'dsh-llm-pi-ai', 'lib', 'index.js')
const llmError = join(HOST, 'dsh-llm', 'lib', 'types', 'error.js')
const readIf = (p) => (existsSync(p) ? readFileSync(p, 'utf8') : '')
const deepseekText = readIf(deepseekAdapter)
const piText = readIf(piAdapter)
const errorText = readIf(llmError)
check('AC8-1 deepseek 适配器把 429/限流归一为 RATE_LIMIT、额度类归一为 QUOTA（静态行证据）',
  deepseekText.includes('code = "RATE_LIMIT"') && deepseekText.includes('code = "QUOTA"'),
  `dsh-llm-deepseek/lib/index.js:${deepseekText.split('\n').findIndex((l) => l.includes('code = "RATE_LIMIT"')) + 1} / :${deepseekText.split('\n').findIndex((l) => l.includes('code = "QUOTA"')) + 1}`)
check('AC8-2 pi-ai 适配器（volcengine 面）同款归一（429→RATE_LIMIT / quota→QUOTA）',
  piText.includes('return "RATE_LIMIT"') && piText.includes('QUOTA_EXCEEDED_CODE'),
  `dsh-llm-pi-ai/lib/index.js:${piText.split('\n').findIndex((l) => l.includes('return "RATE_LIMIT"')) + 1}`)
check('AC8-3 稳定 code 词表在位（CONTEXT_WINDOW_EXCEEDED / QUOTA / ACCOUNT_QUOTA）',
  errorText.includes("CONTEXT_WINDOW_EXCEEDED_CODE = 'CONTEXT_WINDOW_EXCEEDED'") &&
  errorText.includes("QUOTA_EXCEEDED_CODE = 'QUOTA'") &&
  errorText.includes("ACCOUNT_QUOTA_EXCEEDED_CODE = 'ACCOUNT_QUOTA'"),
  `dsh-llm/lib/types/error.js:22-26`)
check('AC8-4 适用集是本插件自持常量且不含非适用码（不误降级）',
  DEGRADABLE_CODES.join(',') === 'RATE_LIMIT,ACCOUNT_QUOTA' &&
  !NON_DEGRADABLE_CODES.some((c) => DEGRADABLE_CODES.includes(c)),
  `degradable=[${DEGRADABLE_CODES.join(',')}] non-degradable=[${NON_DEGRADABLE_CODES.join(',')}]`)
pushLine('（AC8 残余面登记：openai-codex 适配器包不在本机 @deepseek-ai 宿主树可读范围（`Get-ChildItem *codex*` 仅得 dsh-hooks-codex），其分类面按「未取证」登记，不宣告无缝；流内 throw 归一化路径（H/dsh-agent-loop/lib/index.js:1156-1158 直抛旁路）与 middleware/consumer 旁路同样登记为未覆盖面。）')

writeResult()
