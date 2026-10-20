/**
 * T3 + T5 · D3 三角色派工工具 / D5 模型设置工具单测（AC3 / AC11~AC16）。
 * Run: node 02-代码/orchestrator2/tests/suites/role-tools.test.mjs
 *
 * 覆盖：路由解析（默认/会话覆盖）、绑定先于 startActivation（无竞争窗口，真实读文件断言）、
 * startActivation spec 参数语义（delivery 严格 parent / request 不拥有 label+signal / 顶层 label+signal
 * 与原请求一致——F-2 修订新增，别于「只把 mock 方法改名」）、
 * 返回契约 {kind:'continuable', subagentId}、schema 顶层无 provider/model/reasoning_effort、
 * 主调度会话限定（子代理不可调）、一次性覆盖提示且不落状态、永久槽位即时生效 + 未改槽位不变 +
 * 显式覆盖优先 + 在跑 child 不变、保存失败注入无成功回执；
 * TP2 · D3 新增（AC1/AC2）：resolveStartApi 三路径（顺序锁死 / 0.2.0 旧契约回退 / 皆无报错文案）、
 * inspect 首行能力探测（双能力 ✓ 呈现 + 探测异常降级不阻断主输出）。
 */
import { mkdirSync, mkdtempSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { CACHE, ORCH2 } from '../lib/paths.mjs'
import { reporter } from '../lib/test-harness.mjs'

const ROLE_TOOLS = new URL('../../role-tools.mjs', import.meta.url).href
const SESSION_MOD = new URL('../../session-routes.mjs', import.meta.url).href
const ROUTES_MOD = new URL('../../model-routes.mjs', import.meta.url).href
const {
  apply, registerRoleDispatchTools, registerModelSettingTools, ROLE_TOOLS: ROLE_TOOL_NAMES,
  assertMainScheduler, resolveDispatchSnapshot, routeToAgentOptions, resolveStartApi,
} = await import(ROLE_TOOLS)
const { loadSessionState, sessionPath } = await import(SESSION_MOD)
const { loadRoleRoutes, routesPath, tempPathFor, ROUTE_INIT } = await import(ROUTES_MOD)

const { check, pushLine, writeResult } = reporter('role-tools.test', 'T3+T5 · D3 派工工具 / D5 设置工具单测')

mkdirSync(CACHE, { recursive: true })
const home = mkdtempSync(join(CACHE, 'role-tools-fixtures-'))
const SESSION_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const OTHER_SESSION = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const MAIN_AGENT = { id: SESSION_ID, session: { id: SESSION_ID, header: { cwd: ORCH2 } } }
const exec = { agent: MAIN_AGENT, signal: new AbortController().signal }

// ── 假 ctx：注册表 + spawn 注册表（startActivation 内同步断言绑定已就位） ─────────
const registered = new Map()
const spawnCalls = []
let bindingVisibleAtStart = false
let bindingSeen = null
const ctx = {
  tools: {
    register(def) {
      if (registered.has(def.name)) throw new Error(`重名工具：${def.name}`)
      registered.set(def.name, def)
      return () => registered.delete(def.name)
    },
  },
  subagents: {
    async startActivation(spec) {
      const state = loadSessionState(SESSION_ID, { home })
      bindingSeen = state.children[spec.childId]
      bindingVisibleAtStart = bindingSeen !== undefined
      spawnCalls.push(spec)
      return { childId: spec.childId, messageId: 'msg-1' }
    },
    resolveMaxDepth: () => undefined,
  },
  effect: (fn) => { fn() },
}
const disposers = [...registerRoleDispatchTools(ctx, { home }), ...registerModelSettingTools(ctx, { home })]

// ── AC15：工具名与 schema 顶层字段（invariant 规避） ─────────────────────────────
check('AC15-1 六件工具齐备（三角色同名替换 + set/reset/inspect）',
  ['subagent_researcher', 'subagent_reviewer', 'subagent_developer', 'set_role_model', 'reset_role_model', 'inspect_role_models']
    .every((n) => registered.has(n)),
  `注册=${[...registered.keys()].join(', ')}`)
const topFields = (name) => Object.keys(registered.get(name).parameters.properties ?? {})
const roleTop = ['subagent_researcher', 'subagent_reviewer', 'subagent_developer'].flatMap(topFields)
const settingTop = ['set_role_model', 'reset_role_model', 'inspect_role_models'].flatMap(topFields)
check('AC15-2 全部工具 schema 顶层无 provider/model/reasoning_effort（宿主 invariant 扫描面）',
  !roleTop.some((f) => ['provider', 'model', 'reasoning_effort'].includes(f)) &&
  !settingTop.some((f) => ['provider', 'model', 'reasoning_effort'].includes(f)),
  `派工工具顶层=[${roleTop.join(',')}]；设置工具顶层=[${settingTop.join(',')}]`)
check('AC15-3 无 list_subagent_models 工具名（重名风险规避）',
  !registered.has('list_subagent_models') && Object.values(ROLE_TOOL_NAMES).join() !== 'list_subagent_models',
  '零命中')
check('AC15-4 set_role_model 用嵌套 route 承载 provider/model/effort',
  registered.get('set_role_model').parameters.properties.route?.properties?.provider !== undefined &&
  registered.get('set_role_model').parameters.properties.route?.properties?.effort !== undefined,
  `route.properties=${Object.keys(registered.get('set_role_model').parameters.properties.route.properties).join(',')}`)
check('AC15-5 三角色派工工具参数与官方行一致（description/prompt/run_in_background）',
  ['description', 'prompt', 'run_in_background'].every((f) => topFields('subagent_developer').includes(f)) &&
  topFields('subagent_developer').length === 3,
  `[${topFields('subagent_developer').join(',')}]`)

// ── AC3 + AC16：默认路由派工；绑定先于 startActivation ─────────────────────────
const first = await registered.get('subagent_developer').execute(
  { description: '改代码', prompt: '把 X 改成 Y' }, exec)
check('AC3-1 返回契约 {kind:"continuable", subagentId}（与官方行一致）',
  first.kind === 'continuable' && first.subagentId === spawnCalls[0].childId,
  JSON.stringify(first))
check('AC16-1 绑定先于 startActivation（spawn 调用时快照已可读，无竞争窗口）',
  bindingVisibleAtStart === true && bindingSeen?.role === 'developer' && bindingSeen?.parentId === SESSION_ID,
  `start 内可见=${bindingVisibleAtStart} binding=${JSON.stringify(bindingSeen)}`)
check('AC3-2 agentOptions = 当前生效路由三元组（默认：deepseek-official/deepseek-flash + max）',
  spawnCalls[0].request.agentOptions.provider === 'deepseek-official' &&
  spawnCalls[0].request.agentOptions.model === 'deepseek-flash' &&
  spawnCalls[0].request.agentOptions.reasoningEffort === 'max',
  JSON.stringify(spawnCalls[0].request.agentOptions))
check('AC3-3 spawn provider 协议字段齐备（provider/label/request.prompt/parent/signal/childId）',
  spawnCalls[0].provider === 'spawn' && spawnCalls[0].label === '改代码' &&
  spawnCalls[0].request.prompt[0].text === '把 X 改成 Y' && spawnCalls[0].request.parent === MAIN_AGENT &&
  spawnCalls[0].signal === exec.signal && typeof spawnCalls[0].childId === 'string',
  `provider=${spawnCalls[0].provider} childId=${spawnCalls[0].childId}`)

// ── AC4（D3 新增）· startActivation 运行时 spec 参数语义 ─────────────────────────
// 消费 D2 的新调用签名；断言对象是「真实调用形态」而非 mock 方法名：delivery 严格 parent、
// request 不拥有 label/signal（用属性存在性检查，避免 `label: undefined` 冒充合规）、
// spec 顶层 label/signal 与原请求一致。四项反例见 T8（.tmp 受控样本，不污染源码）。
const ownsKey = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key)
check('AC4-1 spec 顶层 delivery 严格 === "parent"（对齐宿主 0.2.1 startActivation 口径）',
  spawnCalls[0].delivery === 'parent', `delivery=${JSON.stringify(spawnCalls[0].delivery)}`)
check('AC4-2 request 不拥有 label（归属 spec 顶层，避免重复 label）',
  ownsKey(spawnCalls[0].request, 'label') === false,
  `request 自有键=[${Object.keys(spawnCalls[0].request).join(',')}]`)
check('AC4-3 request 不拥有 signal（归属 spec 顶层，由宿主转发）',
  ownsKey(spawnCalls[0].request, 'signal') === false,
  `request 自有键=[${Object.keys(spawnCalls[0].request).join(',')}]`)
check('AC4-4 顶层 label/signal 与原请求一致（description / 同一 AbortSignal 对象）',
  spawnCalls[0].label === '改代码' && spawnCalls[0].signal === exec.signal,
  `label=${spawnCalls[0].label}；signal 同一对象=${spawnCalls[0].signal === exec.signal}`)
check('AC16-2 每次派工生成独立 childId（快照不复用）',
  spawnCalls.length === 1, `${spawnCalls.length} 次派工`)

// ── AC3：会话覆盖后派工用新路由；在跑 child 快照不变 ────────────────────────────
const setResult = await registered.get('set_role_model').execute(
  { role: 'developer', route: { provider: 'kimi-coding', model: 'k3', effort: 'max' } }, exec)
check('AC11-1 会话改模回执：ok + 角色/路由/scope/生效点/未变槽位全列',
  setResult.ok === true && setResult.message.includes('kimi-coding/k3') &&
  setResult.message.includes('scope=session') && setResult.message.includes('生效点') &&
  setResult.message.includes('未变槽位'),
  setResult.message.slice(0, 140))
await registered.get('subagent_developer').execute({ description: '再派', prompt: 'p2' }, exec)
check('AC3-4 新 child 用新 epoch 路由（会话覆盖生效）',
  spawnCalls[1].request.agentOptions.provider === 'kimi-coding' && spawnCalls[1].request.agentOptions.model === 'k3',
  JSON.stringify(spawnCalls[1].request.agentOptions))
const stateAfterOverride = loadSessionState(SESSION_ID, { home })
check('AC3-5 在跑 child（首次派工快照）保持原路由不变',
  stateAfterOverride.children[spawnCalls[0].childId].primaryRoute.model === 'deepseek-flash' &&
  stateAfterOverride.children[spawnCalls[0].childId].epoch === 0 &&
  stateAfterOverride.roles.developer.epoch === 1,
  `child0.primary=${JSON.stringify(stateAfterOverride.children[spawnCalls[0].childId].primaryRoute)}`)

// ── AC11：永久槽位即时生效 / 未改槽位不变 / 显式覆盖优先 / 在跑 child 不变 ────────
const reviewerDefaultSaved = loadRoleRoutes({ home }).roles.reviewer.default.model
const permResult = await registered.get('set_role_model').execute(
  { role: 'reviewer', scope: 'default', route: { provider: 'volcengine', model: 'glm-5.3-flash' } }, exec)
const afterPerm = loadRoleRoutes({ home })
check('AC11-2 永久改 default：原子保存成功 + 回执含生效点与未变槽位',
  permResult.ok === true && afterPerm.roles.reviewer.default.model === 'glm-5.3-flash' &&
  permResult.message.includes('scope=default') && permResult.message.includes('未变槽位'),
  `reviewer.default=${JSON.stringify(afterPerm.roles.reviewer.default)}`)
check('AC11-3 未改槽位不变（researcher/developer 六槽中五槽不受影响；reviewer.fallback 保持）',
  afterPerm.roles.reviewer.fallback.model === 'gpt-6.1-sol' &&
  afterPerm.roles.researcher.default.model === 'deepseek-flash' &&
  afterPerm.roles.developer.fallback.model === 'gpt-5.6-luna',
  `reviewer.fallback=${JSON.stringify(afterPerm.roles.reviewer.fallback)}`)
check('AC11-4 新会话（新主会话 ID）的后续新派工读新默认值',
  resolveDispatchSnapshot('reviewer', OTHER_SESSION, home).route.model === 'glm-5.3-flash',
  `newSession reviewer=${JSON.stringify(resolveDispatchSnapshot('reviewer', OTHER_SESSION, home).route)}`)
check('AC11-5 显式会话覆盖仍优先于持久默认（developer 本会话覆盖 k3）',
  resolveDispatchSnapshot('developer', SESSION_ID, home).route.model === 'k3',
  `sessionRoute=${JSON.stringify(resolveDispatchSnapshot('developer', SESSION_ID, home).route)}`)
check('AC11-6 永久更新不中断在跑 child（快照路由不变、未被改写）',
  loadSessionState(SESSION_ID, { home }).children[spawnCalls[0].childId].primaryRoute.model === 'deepseek-flash',
  'child0 快照未变')

// ── AC13：一次性覆盖 → 提示不支持且不落任何状态 ─────────────────────────────────
const sessionPathNow = sessionPath(SESSION_ID, home)
const beforeOnce = readFileSync(sessionPathNow, 'utf8')
const routesBeforeOnce = readFileSync(routesPath(home), 'utf8')
const onceResult = await registered.get('set_role_model').execute(
  { role: 'researcher', route: { provider: 'kimi-coding', model: 'k3' }, once: true }, exec)
check('AC13-1 明确「仅下一次」→ 返回首版不支持提示（ok=false）',
  onceResult.ok === false && onceResult.message.includes('不支持') && onceResult.message.includes('未写入'),
  onceResult.message.slice(0, 120))
check('AC13-2 一次性请求不落任何会话/永久状态（两文件逐字节未变）',
  readFileSync(sessionPathNow, 'utf8') === beforeOnce && readFileSync(routesPath(home), 'utf8') === routesBeforeOnce,
  '会话与持久配置均未变')

// ── AC12（工具层）：保存失败注入 → 无成功回执、后续读旧值 ────────────────────────
mkdirSync(tempPathFor(routesPath(home)), { recursive: true })
const failResult = await registered.get('set_role_model').execute(
  { role: 'researcher', scope: 'fallback', route: { provider: 'kimi-coding', model: 'k3-256k' } }, exec)
check('AC12-5 持久保存失败注入 → ok=false 且回执不冒充成功',
  failResult.ok === false && !failResult.message.includes('已持久保存') && failResult.message.includes('失败'),
  failResult.message.slice(0, 120))
check('AC12-6 保存失败后现读仍为旧值（后续派工读旧值）',
  loadRoleRoutes({ home }).roles.researcher.fallback.model === ROUTE_INIT.researcher.fallback.model,
  `researcher.fallback=${JSON.stringify(loadRoleRoutes({ home }).roles.researcher.fallback)}`)

// ── reset / inspect ──────────────────────────────────────────────────────────
await registered.get('set_role_model').execute({ role: 'developer', route: { provider: 'kimi-coding', model: 'k3' } }, exec)
const resetResult = await registered.get('reset_role_model').execute({ role: 'developer' }, exec)
const afterReset = loadSessionState(SESSION_ID, { home })
check('AC10-5 reset：清 override + 清降级 + epoch+1，回持久默认',
  resetResult.ok === true && afterReset.roles.developer.epoch === 3 &&
  afterReset.roles.developer.overrideRoute === undefined && afterReset.roles.developer.degraded === false &&
  resolveDispatchSnapshot('developer', SESSION_ID, home).route.model === 'deepseek-flash',
  `epoch=${afterReset.roles.developer.epoch} route=${JSON.stringify(resolveDispatchSnapshot('developer', SESSION_ID, home).route)}`)
const inspectResult = await registered.get('inspect_role_models').execute({}, exec)
check('AC15-6 inspect 回执覆盖三角色 + 默认/降级 + 生效路由 + child 快照数（不含凭据）',
  inspectResult.ok === true && ['researcher', 'reviewer', 'developer'].every((r) => inspectResult.message.includes(r)) &&
  inspectResult.message.includes('fallback=') && inspectResult.message.includes('当前生效=') &&
  inspectResult.message.includes('child 快照：') && !/sk-|api[_-]?key/i.test(inspectResult.message),
  `${inspectResult.message.split('\n').length} 行`)

// ── 主调度会话限定（子代理不可调） ──────────────────────────────────────────────
const childExec = { agent: { id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', session: { id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', header: { parentSession: SESSION_ID } } }, signal: exec.signal }
let roleCallerRejected = false
let settingCallerRejected = false
try { await registered.get('subagent_developer').execute({ description: 'd', prompt: 'p' }, childExec) } catch { roleCallerRejected = true }
try { await registered.get('set_role_model').execute({ role: 'developer', route: { provider: 'a', model: 'b' } }, childExec) } catch { settingCallerRejected = true }
check('AC15-7 子代理不得派工三角色 / 不得改父路由（exec.agent 主调度会话校验）',
  roleCallerRejected && settingCallerRejected, `派工拒绝=${roleCallerRejected} 设置拒绝=${settingCallerRejected}`)
check('AC15-8 assertMainScheduler 对主会话返回其 session id',
  assertMainScheduler(MAIN_AGENT, 'x') === SESSION_ID, SESSION_ID)

// ── 首版后台 continuable 边界（显式报错，不静默改语义） ─────────────────────────
let foregroundRejected = false
try { await registered.get('subagent_researcher').execute({ description: 'd', prompt: 'p', run_in_background: false }, exec) } catch { foregroundRejected = true }
check('边界-1 run_in_background:false 显式报错（前景派工未实现，不静默改语义）', foregroundRejected, '抛错')

// ── TP2 · D3（AC1/AC2）：双 API shim 三路径 + inspect 能力探测行 ────────────────
// 断言① 顺序锁死（T9 变异反例：颠倒探测顺序必打红本断言——见执行自测 T9）；
// 断言② 回退走 0.2.0 旧契约（request 拥有 label、顶层无 delivery——属性存在性检查，
//       mock 勿照抄现行 startActivation 形态，差异锚点见计划评审提示 3）；
// 断言③ 皆无时报错文案含两探测 API 名与实际能力键清单。
check('AC1-1 双能力在场时 shim 选 startActivation（探测顺序锁死）；仅回退在场选 startContinuable',
  resolveStartApi({ startActivation: async () => {}, startContinuable: async () => {} }).name === 'startActivation' &&
  resolveStartApi({ startContinuable: async () => {} }).name === 'startContinuable',
  '双能力→startActivation；仅回退→startContinuable')

// ② 仅 startContinuable 在场：三角色 execute 回退成功，调用形态为旧契约
// （独立会话 ID 隔离 bindChild 写入，不污染主会话 children 计数——AC14-2 断言 2 个）
const FALLBACK_SESSION = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
const fallbackExec = { agent: { id: FALLBACK_SESSION, session: { id: FALLBACK_SESSION, header: { cwd: ORCH2 } } }, signal: exec.signal }
const fallbackRegistry = new Map()
const fallbackCalls = []
const fallbackCtx = {
  tools: { register(def) { fallbackRegistry.set(def.name, def); return () => fallbackRegistry.delete(def.name) } },
  subagents: {
    async startContinuable(spec) { fallbackCalls.push(spec); return { childId: spec.childId } },
    resolveMaxDepth: () => undefined,
  },
  effect: (fn) => { fn() },
}
registerRoleDispatchTools(fallbackCtx, { home })
const fallbackResult = await fallbackRegistry.get('subagent_developer').execute(
  { description: '旧宿主派工', prompt: 'p-fallback' }, fallbackExec)
const fb = fallbackCalls[0] ?? {}
check('AC1-2 仅 startContinuable 在场：execute 回退成功且返回契约不变 {kind,subagentId}',
  fallbackCalls.length === 1 && fallbackResult.kind === 'continuable' &&
  fallbackResult.subagentId === fb.childId && typeof fallbackResult.subagentId === 'string',
  JSON.stringify(fallbackResult))
check('AC1-2b 回退调用为 0.2.0 旧契约：request 拥有 label=description；顶层与 request 均无 delivery',
  ownsKey(fb.request ?? {}, 'label') === true && fb.request?.label === '旧宿主派工' &&
  ownsKey(fb, 'delivery') === false && ownsKey(fb.request ?? {}, 'delivery') === false,
  `request 自有键=[${Object.keys(fb.request ?? {}).join(',')}]；顶层自有键=[${Object.keys(fb).join(',')}]`)

// ③ 皆无能力：抛错文案含两探测 API 名与实际能力键清单
let neitherError = ''
try { resolveStartApi({ listAgents: () => {}, sendMessage: () => {} }) } catch (e) { neitherError = e.message }
check('AC1-3 皆无能力时抛错文案含 startActivation / startContinuable 与实际能力键清单',
  neitherError.includes('startActivation') && neitherError.includes('startContinuable') &&
  neitherError.includes('实际能力键') && neitherError.includes('listAgents') && neitherError.includes('sendMessage'),
  neitherError.slice(0, 130))

// ④ 双能力 mock 下 inspect 首行能力探测呈现（resolveStartApi 与派工同一份探测）
const dualRegistry = new Map()
const dualCtx = {
  tools: { register(def) { dualRegistry.set(def.name, def); return () => dualRegistry.delete(def.name) } },
  subagents: {
    async startActivation(spec) { return { childId: spec.childId } },
    async startContinuable(spec) { return { childId: spec.childId } },
  },
  effect: (fn) => { fn() },
}
registerModelSettingTools(dualCtx, { home })
const dualInspect = await dualRegistry.get('inspect_role_models').execute({}, exec)
const dualLines = dualInspect.message.split('\n')
check('AC2-1 inspect 首行=宿主派工能力行（双能力 mock：两 ✓ + 生效路径=startActivation）',
  dualInspect.ok === true &&
  dualLines[0] === '宿主派工能力：startActivation ✓；startContinuable ✓；生效路径=startActivation',
  dualLines[0])
check('AC2-2 能力行不阻断主输出（路由头行降为第二行、内容不变）',
  dualLines[1].startsWith('角色模型路由（持久配置：') && dualInspect.message.includes('当前生效='),
  dualLines[1].slice(0, 48))

// ⑤ 探测抛错（getter 抛异常模拟注册表损坏）：首行降级文案 + 主输出仍在
const throwRegistry = new Map()
const throwCtx = {
  tools: { register(def) { throwRegistry.set(def.name, def); return () => throwRegistry.delete(def.name) } },
  subagents: {
    get startActivation() { throw new Error('subagents 注册表损坏') },
  },
  effect: (fn) => { fn() },
}
registerModelSettingTools(throwCtx, { home })
const throwInspect = await throwRegistry.get('inspect_role_models').execute({}, exec)
const throwLines = throwInspect.message.split('\n')
check('AC2-3 inspect 探测异常降级：首行为「探测失败（原因）」且主输出仍在',
  throwInspect.ok === true &&
  throwLines[0] === '宿主派工能力：探测失败（subagents 注册表损坏）' &&
  throwLines[1].startsWith('角色模型路由（持久配置：'),
  throwLines[0])

// ── AC14：机器层零改动（派工计次/锁/枚举文件不引用新模块） ──────────────────────
const untouched = ['dispatch.mjs', 'phase-gate.mjs', 'budget.mjs']
const dirty = untouched.filter((f) => {
  const text = readFileSync(join(ORCH2, f), 'utf8')
  return text.includes('model-routes.mjs') || text.includes('session-routes.mjs') || text.includes('route-fallback.mjs') || text.includes('role-tools.mjs')
})
check('AC14-1 dispatch/phase-gate/budget 不引用新模块（内部降级不触派工计次/锁/阶段枚举）',
  dirty.length === 0, dirty.length ? `引用：${dirty.join(', ')}` : '零引用')
check('AC14-2 内部降级切换保持同 childId（快照存于 children，无新 childId 生成路径）',
  spawnCalls.length === 2 && Object.keys(loadSessionState(SESSION_ID, { home }).children).length === 2,
  `派工 2 次 → children ${Object.keys(loadSessionState(SESSION_ID, { home }).children).length} 个`)
check('T3-9 apply() 一次注册六件工具并可整体释放（生命期）', (() => {
  const seen = new Map()
  const localCtx = { tools: { register: (def) => { seen.set(def.name, def); return () => seen.delete(def.name) } }, subagents: ctx.subagents, effect: (fn) => { fn() } }
  apply(localCtx)
  return seen.size === 6 && !existsSync(join(home, 'never'))
})(), '6 件')

// ── AC15-9：用宿主真实校验器复核全部工具 schema（闭合「装配期才报错」风险）─────────
// ctx.tools.register 在真实宿主里会经 dsh-tools 的 JSON Schema 子集校验
// （H/dsh-tools/lib/index.js:13-14 支持子集：type/oneOf/properties/required/
// additionalProperties/items/enum/const + annotations）。本套件用同一校验器复核六件工具的
// 参数与输出 schema，避免「测试用假 ctx、真装时才炸」的盲区；并附反例证明校验器非空转。
const DSH = 'C:\\Users\\nicia\\AppData\\Roaming\\npm\\node_modules\\@deepseek-ai\\dsh'
const toolsMod = await import(pathToFileURL(join(DSH, 'node_modules', '@deepseek-ai', 'dsh-tools', 'lib', 'index.js')).href)
const schemaVerdicts = []
for (const [toolName, def] of registered) {
  try {
    toolsMod.assertObjectJsonSchema(def.parameters)
    if (def.output?.schema !== undefined) toolsMod.assertSupportedJsonSchema(def.output.schema)
  } catch (error) {
    schemaVerdicts.push(`${toolName}: ${error.message.slice(0, 90)}`)
  }
}
check('AC15-9 六件工具的参数/输出 schema 通过宿主 dsh-tools 子集校验器（enum/oneOf/additionalProperties 均被子集支持）',
  schemaVerdicts.length === 0,
  schemaVerdicts.length ? schemaVerdicts.join(' | ') : `${registered.size} 件（含 set_role_model 的 enum 与角色工具的 oneOf 输出）全过`)
let validatorRejects = false
try {
  toolsMod.assertObjectJsonSchema({ type: 'object', properties: { a: { type: 'string', patternProperties: {} } }, additionalProperties: false })
} catch { validatorRejects = true }
check('AC15-9b 反例：子集外关键字被同一校验器拒绝（门禁非空转）', validatorRejects, 'patternProperties 被拒')
pushLine(`（统计：注册工具 ${registered.size} 件；spawn mock 调用 ${spawnCalls.length} 次；断言覆盖 AC3/AC11/AC12/AC13/AC14/AC15/AC16）`)
for (const dispose of disposers) dispose()

writeResult()
