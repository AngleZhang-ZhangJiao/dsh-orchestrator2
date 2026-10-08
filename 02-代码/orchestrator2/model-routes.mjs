/**
 * orchestrator2 持久路由配置（T3-TP1 · D1 / R1·R6 / AC1·AC12）。
 *
 * 数据位置：`<DSH_HOME>/orchestrator2/model-routes.json`——**在预设同步树之外**
 * （同步树 = `<DSH_HOME>/.agent-presets/orchestrator2`；`lib/index.js` 的
 * `syncPreset()` 会删除清单外文件，故用户配置严禁落在那里）。
 *
 * schema（v1）：
 *   { schemaVersion: 1, roles: { <role>: { default: Route, fallback: Route } } }
 *   Route = { provider, model, effort? }（effort 省略 = 不传 reasoningEffort，
 *   即模型默认档；不写字符串 "default"）
 *
 * 纪律：
 * - 每次调用**现读**（不缓存注册期快照）；首次读不到 → 以 ROUTE_INIT（DEC-T3-05 表）初始化；
 * - 读/校验失败 → 显式抛错，不静默回退内置值覆盖用户配置；
 * - 保存 = 同目录 temp + rename 原子写 + 进程内写队列串行；失败不发布成功态。
 * - 依赖只有 node:fs / node:os / node:path（ponytail native，零新依赖）。
 *
 * ponytail: 多进程共用同一 DSH_HOME 的并发冲突为首版已知边界（最后写胜，见 04 §三），
 * 不建分布式锁平台；升级触发 = 用户报告多实例并发改模丢写。
 */
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

/** Cordis 插件名（组合树诊断用）。本模块只提供纯函数，注册行为由 role-tools/route-fallback 承担。 */
export const name = 'orchestrator2-model-routes'

/**
 * Cordis 插件空载（v2.7.1 修复）。本模块在组合树中作为 loader 行声明（delegation 组），
 * cordis `registry.plugin()` 只接受函数或带 `apply` 的对象——纯库模块没有 `apply` 会
 * 同步抛 `invalid plugin`，loader 捕获后不建 fiber，审核报 `never started`，进而整个
 * 预设挂载被拒（新会话选择器不可见、老会话 resume 失败）。空 `apply` 让该行正常启动，
 * 行为零变化：工具注册仍由 role-tools.mjs / route-fallback.mjs 承担。
 */
export function apply() {}

/** 配置 schema 版本。 */
export const SCHEMA_VERSION = 1

/** 三角色枚举（顺序=文档/回执展示顺序）。 */
export const ROLES = Object.freeze(['researcher', 'reviewer', 'developer'])

/** 路由槽位枚举。 */
export const ROUTE_SLOTS = Object.freeze(['default', 'fallback'])

/** 首次初始化值（DEC-T3-05 用户裁决表；config-check T3e 读本常量而非手抄字符串）。 */
export const ROUTE_INIT = Object.freeze({
  researcher: Object.freeze({
    default: Object.freeze({ provider: 'deepseek-official', model: 'deepseek-flash', effort: 'max' }),
    fallback: Object.freeze({ provider: 'openai-codex', model: 'gpt-5.6-luna', effort: 'xhigh' }),
  }),
  developer: Object.freeze({
    default: Object.freeze({ provider: 'deepseek-official', model: 'deepseek-flash', effort: 'max' }),
    fallback: Object.freeze({ provider: 'openai-codex', model: 'gpt-5.6-luna', effort: 'xhigh' }),
  }),
  reviewer: Object.freeze({
    default: Object.freeze({ provider: 'volcengine', model: 'glm-5.3' }),
    fallback: Object.freeze({ provider: 'openai-codex', model: 'gpt-6.1-sol' }),
  }),
})

/**
 * DSH_HOME 解析：`DSH_HOME` 覆盖（支持 `~` 展开，相对路径按 CWD 解析）→ 缺省 `~/.dsh`。
 *
 * ponytail: 语义与 `lib/index.js` 的 `dshHome()` 逐字一致，但**不 import 它**——
 * 预设树（交付包 `presets/orchestrator2/`）只装预设件、不含 `lib/`（实证：
 * `05-交付/安装包/dsh-orchestrator2-v2.6.1/presets/orchestrator2/` 无 lib 目录），
 * `./lib/index.js` 相对导入在交付包里是死引用 → 整个预设挂载失败。
 * 升级路径：若将来预设树随包携带共享 lib，改回 `import { dshHome } from './lib/index.js'`。
 * @param {string|undefined} override - 显式覆盖值（测试注入）；缺省读环境变量。
 * @returns {string} 绝对路径。
 */
export function resolveDshHome(override = process.env.DSH_HOME) {
  if (typeof override === 'string' && override.trim().length > 0) {
    let p = override.trim()
    if (p === '~' || p.startsWith('~/') || p.startsWith('~\\')) p = join(homedir(), p.slice(1))
    return resolve(p)
  }
  return join(homedir(), '.dsh')
}

/** 插件运行数据目录 `<DSH_HOME>/orchestrator2`。 */
export function routesDir(home = resolveDshHome()) {
  return join(home, 'orchestrator2')
}

/** 持久配置文件绝对路径。 */
export function routesPath(home = resolveDshHome()) {
  return join(routesDir(home), 'model-routes.json')
}

/** 原子写临时文件路径（同目录；测试用它注入写失败）。 */
export function tempPathFor(path) {
  return `${path}.tmp-${process.pid}`
}

/** 深拷贝初始化表（避免调用方改到 frozen 常量）。 */
function initConfig() {
  const roles = {}
  for (const role of ROLES) {
    roles[role] = {}
    for (const slot of ROUTE_SLOTS) roles[role][slot] = { ...ROUTE_INIT[role][slot] }
  }
  return { schemaVersion: SCHEMA_VERSION, roles }
}

/**
 * 归一化并校验一条路由：provider/model 必填非空字符串；effort 可选，省略即不传。
 * @param {unknown} route - 候选路由。
 * @param {string} label - 报错定位标签。
 * @returns {{provider: string, model: string, effort?: string}}
 */
export function normalizeRoute(route, label = 'route') {
  if (route === null || typeof route !== 'object' || Array.isArray(route)) {
    throw new Error(`${label}：应为 { provider, model, effort? } 对象，实际为 ${Array.isArray(route) ? '数组' : typeof route}`)
  }
  const provider = route.provider
  const model = route.model
  if (typeof provider !== 'string' || provider.trim().length === 0) throw new Error(`${label}.provider 必须是非空字符串`)
  if (typeof model !== 'string' || model.trim().length === 0) throw new Error(`${label}.model 必须是非空字符串`)
  const out = { provider: provider.trim(), model: model.trim() }
  if (route.effort !== undefined) {
    if (typeof route.effort !== 'string' || route.effort.trim().length === 0) throw new Error(`${label}.effort 省略即模型默认档；给出时须为非空字符串（不接受字符串 "default"）`)
    if (route.effort.trim().toLowerCase() === 'default') throw new Error(`${label}.effort 不接受字符串 "default"：省略即模型默认档（不把文字 default 当 effort ID）`)
    out.effort = route.effort.trim()
  }
  return out
}

/** 校验整份配置结构；失败即抛（不静默回退）。 */
function normalizeConfig(raw, label) {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) throw new Error(`${label}：顶层应为对象`)
  if (raw.schemaVersion !== SCHEMA_VERSION) {
    throw new Error(`${label}：schemaVersion=${JSON.stringify(raw.schemaVersion)} 不受支持（期望 ${SCHEMA_VERSION}）`)
  }
  if (raw.roles === null || typeof raw.roles !== 'object' || Array.isArray(raw.roles)) throw new Error(`${label}.roles：应为对象`)
  const roles = {}
  for (const role of ROLES) {
    const entry = raw.roles[role]
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) throw new Error(`${label}.roles.${role}：应为 { default, fallback } 对象`)
    roles[role] = {}
    for (const slot of ROUTE_SLOTS) {
      roles[role][slot] = normalizeRoute(entry[slot], `${label}.roles.${role}.${slot}`)
    }
  }
  return { schemaVersion: SCHEMA_VERSION, roles }
}

/** 进程内写队列：同一路径的保存串行执行（首版单进程语义，见文件头）。 */
let writeQueue = Promise.resolve()

/** 把一个返回 Promise 的任务排入写队列（前序失败不阻塞后序）。 */
export function enqueueWrite(task) {
  const run = writeQueue.then(task, task)
  writeQueue = run.then(() => undefined, () => undefined)
  return run
}

/** 原子写：同目录 temp 写 → rename 提交；任一步失败则清 temp 并抛。 */
function writeAtomic(path, data) {
  const text = `${JSON.stringify(data, null, 2)}\n`
  const tmp = tempPathFor(path)
  mkdirSync(dirname(path), { recursive: true })
  try {
    writeFileSync(tmp, text, 'utf8')
    renameSync(tmp, path)
  } catch (error) {
    try { rmSync(tmp, { force: true }) } catch { /* 清理失败不掩盖主错误 */ }
    throw new Error(`model-routes.json 保存失败（${path}）：${error instanceof Error ? error.message : String(error)}`)
  }
}

/**
 * 读取持久路由配置；文件不存在 → 以初始化表落地并返回。
 * @param {{home?: string}} [options] - home 覆盖（测试注入）。
 * @returns {{schemaVersion: number, roles: object}}
 */
export function loadRoleRoutes(options = {}) {
  const path = routesPath(options.home)
  if (!existsSync(path)) {
    const config = initConfig()
    writeAtomic(path, config)
    return config
  }
  let text
  try {
    text = readFileSync(path, 'utf8')
  } catch (error) {
    throw new Error(`model-routes.json 读取失败（${path}）：${error instanceof Error ? error.message : String(error)}`)
  }
  let raw
  try {
    raw = JSON.parse(text)
  } catch (error) {
    throw new Error(`model-routes.json 解析失败（${path}）：${error instanceof Error ? error.message : String(error)}`)
  }
  return normalizeConfig(raw, path)
}

/**
 * 仅当文件存在时读取（不初始化、不写盘）；不存在 → undefined。
 * 供无需副作用的分支（如 error hook 的廉价探测）使用。
 */
export function peekRoleRoutes(options = {}) {
  const path = routesPath(options.home)
  return existsSync(path) ? loadRoleRoutes(options) : undefined
}

/**
 * 保存一个角色槽位（read-modify-write，写队列串行；成功后新派工即读到新值）。
 * @param {string} role - researcher / reviewer / developer。
 * @param {string} slot - default / fallback。
 * @param {object} route - { provider, model, effort? }。
 * @param {{home?: string}} [options]
 * @returns {Promise<{schemaVersion: number, roles: object}>} 保存后的完整配置。
 */
export function saveRoleRoute(role, slot, route, options = {}) {
  if (!ROLES.includes(role)) throw new Error(`未知角色「${role}」（合法值：${ROLES.join(' / ')}）`)
  if (!ROUTE_SLOTS.includes(slot)) throw new Error(`未知槽位「${slot}」（合法值：${ROUTE_SLOTS.join(' / ')}）`)
  const normalized = normalizeRoute(route, `roles.${role}.${slot}`)
  const path = routesPath(options.home)
  return enqueueWrite(() => {
    const current = loadRoleRoutes(options)
    current.roles[role][slot] = normalized
    writeAtomic(path, current)
    return current
  })
}
