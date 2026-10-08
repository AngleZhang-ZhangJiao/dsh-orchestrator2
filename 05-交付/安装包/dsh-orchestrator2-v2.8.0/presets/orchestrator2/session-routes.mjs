/**
 * orchestrator2 会话路由状态（T3-TP1 · D2 / R4·R5 / AC2·AC9·AC10·AC16）。
 *
 * 数据位置：`<DSH_HOME>/orchestrator2/sessions/<主会话ID>.json`
 *
 * schema（v1）：
 *   { schemaVersion: 1, sessionId, roles: { <role>: { epoch, overrideRoute?, degraded, reason? } },
 *     children: { <childId>: { parentId, role, epoch, primaryRoute, fallbackRoute, appliedRoute, degraded } } }
 *
 * 纪律（04 §三/§四、05 §2）：
 * - 会话 ID 严格合法性校验，拒绝路径穿越（`../`、分隔符、空值等）；
 * - `roles[role]` 缺省即持久默认（ID 未命中 = 分叉/新建 → 自然重置，不复制源会话数据）；
 * - 用户新改/恢复 = epoch+1 并清该角色降级态；
 * - 旧 epoch child 的故障只作用自身快照，仅当 parent 当前 epoch 相同才写回 role 降级态；
 * - 读失败 → 显式抛错，不静默丢覆盖；写入串行 + temp/rename 原子提交。
 *
 * ponytail: 读取时**不落盘**（ID 未命中返回空状态即可，写盘只发生在真正有内容时）——
 * 省掉每会话一个空文件；升级触发 = 需要「会话已初始化」本身作为可观测事实时。
 */
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { ROLES, enqueueWrite, normalizeRoute, resolveDshHome } from './model-routes.mjs'

/** Cordis 插件名（组合树诊断用）。本模块只提供纯函数/读写函数。 */
export const name = 'orchestrator2-session-routes'

/**
 * Cordis 插件空载（v2.7.1 修复，同 model-routes.mjs）。本模块在组合树中作为 loader 行
 * 声明，cordis `registry.plugin()` 只接受函数或带 `apply` 的对象——纯库模块缺失 `apply`
 * 会同步抛 `invalid plugin`，loader 不建 fiber、审核报 `never started`，整个预设挂载
 * 被拒。空 `apply` 让该行正常启动，行为零变化。
 */
export function apply() {}

/** 会话状态 schema 版本。 */
export const SCHEMA_VERSION = 1

/** 会话 ID 白名单：字母数字开头，其后允许 `[-._]`，长度 1~128 —— 拒绝 `/`、`\`、`:`、`.`、`..`、空串。 */
const SESSION_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/

/** 会话 ID 合法性（防路径穿越的第一道闸门）。 */
export function isValidSessionId(id) {
  return typeof id === 'string' && SESSION_ID_RE.test(id) && !id.includes('..')
}

/** 会话状态目录 `<DSH_HOME>/orchestrator2/sessions`。 */
export function sessionsDir(home = resolveDshHome()) {
  return join(home, 'orchestrator2', 'sessions')
}

/** 单会话状态文件路径；ID 非法即抛（不做任何路径拼接）。 */
export function sessionPath(sessionId, home = resolveDshHome()) {
  if (!isValidSessionId(sessionId)) throw new Error(`非法会话 ID：${JSON.stringify(sessionId)}（拒绝路径穿越；合法值形如 UUID）`)
  return join(sessionsDir(home), `${sessionId}.json`)
}

/** 空会话状态（分叉/新建会话 ID 未命中时的自然形态）。 */
export function emptySessionState(sessionId) {
  return { schemaVersion: SCHEMA_VERSION, sessionId, roles: {}, children: {} }
}

/** 校验一份会话状态结构；失败即抛。 */
function normalizeState(raw, label, sessionId) {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) throw new Error(`${label}：顶层应为对象`)
  if (raw.schemaVersion !== SCHEMA_VERSION) {
    throw new Error(`${label}：schemaVersion=${JSON.stringify(raw.schemaVersion)} 不受支持（期望 ${SCHEMA_VERSION}）`)
  }
  if (raw.sessionId !== sessionId) throw new Error(`${label}：sessionId=${JSON.stringify(raw.sessionId)} 与文件名不符（期望 ${sessionId}）`)
  const roles = {}
  const rawRoles = raw.roles ?? {}
  if (typeof rawRoles !== 'object' || Array.isArray(rawRoles)) throw new Error(`${label}.roles：应为对象`)
  for (const [role, entry] of Object.entries(rawRoles)) {
    if (!ROLES.includes(role)) throw new Error(`${label}.roles.${role}：未知角色（合法值：${ROLES.join(' / ')}）`)
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) throw new Error(`${label}.roles.${role}：应为对象`)
    if (!Number.isInteger(entry.epoch) || entry.epoch < 0) throw new Error(`${label}.roles.${role}.epoch：应为 ≥0 的整数（0 = 用户尚无本会话指令的基线）`)
    const normalized = { epoch: entry.epoch, degraded: entry.degraded === true }
    if (entry.overrideRoute !== undefined) normalized.overrideRoute = normalizeRoute(entry.overrideRoute, `${label}.roles.${role}.overrideRoute`)
    if (entry.reason !== undefined) {
      if (typeof entry.reason !== 'string') throw new Error(`${label}.roles.${role}.reason：应为字符串`)
      normalized.reason = entry.reason
    }
    roles[role] = normalized
  }
  const children = {}
  const rawChildren = raw.children ?? {}
  if (typeof rawChildren !== 'object' || Array.isArray(rawChildren)) throw new Error(`${label}.children：应为对象`)
  for (const [childId, entry] of Object.entries(rawChildren)) {
    if (!isValidSessionId(childId)) throw new Error(`${label}.children["${childId}"]：childId 非法（拒绝路径分隔符/空值）`)
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) throw new Error(`${label}.children.${childId}：应为对象`)
    if (!ROLES.includes(entry.role)) throw new Error(`${label}.children.${childId}.role：未知角色`)
    if (typeof entry.parentId !== 'string' || !isValidSessionId(entry.parentId)) throw new Error(`${label}.children.${childId}.parentId：非法会话 ID`)
    if (!Number.isInteger(entry.epoch) || entry.epoch < 0) throw new Error(`${label}.children.${childId}.epoch：应为 ≥0 的整数（0 = 该角色尚无用户会话指令的基线）`)
    children[childId] = {
      parentId: entry.parentId,
      role: entry.role,
      epoch: entry.epoch,
      primaryRoute: normalizeRoute(entry.primaryRoute, `${label}.children.${childId}.primaryRoute`),
      fallbackRoute: normalizeRoute(entry.fallbackRoute, `${label}.children.${childId}.fallbackRoute`),
      appliedRoute: normalizeRoute(entry.appliedRoute, `${label}.children.${childId}.appliedRoute`),
      degraded: entry.degraded === true,
    }
  }
  return { schemaVersion: SCHEMA_VERSION, sessionId, roles, children }
}

/** 原子写（同 model-routes：temp + rename，失败不发布成功态）。 */
function writeAtomic(path, data) {
  const text = `${JSON.stringify(data, null, 2)}\n`
  const tmp = `${path}.tmp-${process.pid}`
  mkdirSync(dirname(path), { recursive: true })
  try {
    writeFileSync(tmp, text, 'utf8')
    renameSync(tmp, path)
  } catch (error) {
    try { rmSync(tmp, { force: true }) } catch { /* 清理失败不掩盖主错误 */ }
    throw new Error(`会话状态保存失败（${path}）：${error instanceof Error ? error.message : String(error)}`)
  }
}

/**
 * 读取会话状态；文件不存在 → 返回空状态（ID 未命中 = 分叉/新建，自然重置）。
 * @param {string} sessionId - 主会话 ID。
 * @param {{home?: string}} [options]
 * @returns {{schemaVersion: number, sessionId: string, roles: object, children: object}}
 */
export function loadSessionState(sessionId, options = {}) {
  const path = sessionPath(sessionId, options.home)
  if (!existsSync(path)) return emptySessionState(sessionId)
  let text
  try {
    text = readFileSync(path, 'utf8')
  } catch (error) {
    throw new Error(`会话状态读取失败（${path}）：${error instanceof Error ? error.message : String(error)}`)
  }
  let raw
  try {
    raw = JSON.parse(text)
  } catch (error) {
    throw new Error(`会话状态解析失败（${path}）：${error instanceof Error ? error.message : String(error)}`)
  }
  return normalizeState(raw, path, sessionId)
}

/**
 * 写回完整会话状态（结构与 sessionId 先校验）。
 * @returns {object} 写回的（归一化后的）状态。
 */
export function saveSessionState(sessionId, state, options = {}) {
  const path = sessionPath(sessionId, options.home)
  const normalized = normalizeState(state, path, sessionId)
  return enqueueWrite(() => {
    writeAtomic(path, normalized)
    return normalized
  })
}

/**
 * read-modify-write：在写队列内现读 → 交给 mutator 修改 → 原子写回。
 * mutator 收到的是可自由修改的副本；返回 undefined 时用改后的状态。
 * @param {string} sessionId
 * @param {(state: object) => object|void} mutator
 * @param {{home?: string}} [options]
 */
export function updateSessionState(sessionId, mutator, options = {}) {
  const path = sessionPath(sessionId, options.home)
  return enqueueWrite(() => {
    const current = loadSessionState(sessionId, options)
    const mutated = mutator(current) ?? current
    const normalized = normalizeState(mutated, path, sessionId)
    writeAtomic(path, normalized)
    return normalized
  })
}

/**
 * 解析角色当前生效路由（纯函数，AC1 核心判据）。
 * 当前 epoch 已降级 → 持久 fallback；否则显式覆盖；否则持久 default。
 * @param {string} role
 * @param {object} sessionState - loadSessionState 结果（可为空状态）。
 * @param {object} persistentConfig - loadRoleRoutes 结果。
 * @returns {{provider: string, model: string, effort?: string}}
 */
export function resolveEffectiveRoute(role, sessionState, persistentConfig) {
  const config = persistentConfig?.roles?.[role]
  if (config === undefined) throw new Error(`持久配置缺少角色「${role}」的 default/fallback 槽位`)
  const roleState = sessionState?.roles?.[role]
  if (roleState?.degraded === true) return { ...config.fallback }
  if (roleState?.overrideRoute !== undefined) return { ...roleState.overrideRoute }
  return { ...config.default }
}

/**
 * 绑定 child 派工快照（**必须在 startContinuable 之前**调用：绑定先于首次 request）。
 * @param {string} childId - 子代理 session id。
 * @param {{parentId: string, role: string, epoch: number, primaryRoute: object, fallbackRoute: object, appliedRoute?: object}} binding
 * @param {{home?: string, sessionId: string}} options - sessionId = 主会话 ID（children 存在它名下）。
 */
export function bindChild(childId, binding, options) {
  if (typeof childId !== 'string' || childId.length === 0) throw new Error('bindChild：childId 必填')
  const sessionId = options?.sessionId
  const parentId = binding?.parentId
  if (parentId !== sessionId) throw new Error(`bindChild：binding.parentId（${parentId}）必须等于 options.sessionId（${sessionId}）`)
  return updateSessionState(sessionId, (state) => {
    state.children[childId] = {
      parentId,
      role: binding.role,
      epoch: binding.epoch,
      primaryRoute: binding.primaryRoute,
      fallbackRoute: binding.fallbackRoute,
      appliedRoute: binding.appliedRoute ?? binding.primaryRoute,
      degraded: binding.degraded === true,
    }
  }, options)
}

/**
 * 读 child 绑定快照。绑定存在主会话文件内，故需 sessionId（由 child 的
 * `session.header.parentSession` 取得——continuation.js 用它做 lineage 授权）。
 * @param {string} childId
 * @param {{home?: string, sessionId: string}} options
 * @returns {object|undefined}
 */
export function getChildBinding(childId, options) {
  const sessionId = options?.sessionId
  if (typeof sessionId !== 'string' || !isValidSessionId(sessionId)) return undefined
  if (typeof childId !== 'string' || childId.length === 0) return undefined
  return loadSessionState(sessionId, options).children[childId]
}

/** 语义化 epoch 递增：用户新改/恢复 → epoch+1（新建时为 1）。 */
export function nextEpoch(roleState) {
  const current = Number.isInteger(roleState?.epoch) && roleState.epoch >= 1 ? roleState.epoch : 0
  return current + 1
}
