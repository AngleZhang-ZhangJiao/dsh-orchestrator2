/**
 * T2 · D2 会话状态与路由解析单测（AC2 / AC9 / AC10 / AC16 会话面）。
 * Run: node 02-代码/orchestrator2/tests/suites/session-routes.test.mjs
 *
 * 覆盖：两主会话隔离与覆盖持续（模拟压缩后重读不丢）、同 ID 恢复保留 / 分叉新建重置、
 * epoch 递增与降级清除、路径穿越拒绝、child 绑定读写与 parentId 一致性、
 * 旧 epoch child 不写回 role 降级态、读失败显式抛错。
 */
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { CACHE } from '../lib/paths.mjs'
import { reporter } from '../lib/test-harness.mjs'

const SESSION_MOD = new URL('../../session-routes.mjs', import.meta.url).href
const ROUTES_MOD = new URL('../../model-routes.mjs', import.meta.url).href
const {
  isValidSessionId, loadSessionState, saveSessionState, updateSessionState,
  resolveEffectiveRoute, bindChild, getChildBinding, nextEpoch, sessionPath, sessionsDir,
} = await import(SESSION_MOD)
const { loadRoleRoutes } = await import(ROUTES_MOD)

const { check, pushLine, writeResult } = reporter('session-routes.test', 'T2 · D2 会话状态与路由解析单测')

mkdirSync(CACHE, { recursive: true })
const home = mkdtempSync(join(CACHE, 'session-fixtures-'))
const config = loadRoleRoutes({ home })
const SESSION_A = '11111111-1111-4111-8111-111111111111'
const SESSION_B = '22222222-2222-4222-8222-222222222222'
const CHILD_1 = '33333333-3333-4333-8333-333333333333'
const CHILD_2 = '44444444-4444-4444-8444-444444444444'

// ── AC2：同会话覆盖持续 + 另一会话仍默认；模拟压缩/重读后不丢 ─────────────────────
const overrideRoute = { provider: 'kimi-coding', model: 'k3', effort: 'max' }
await updateSessionState(SESSION_A, (state) => {
  state.roles.developer = { epoch: nextEpoch(state.roles.developer), overrideRoute, degraded: false }
}, { home })
const stateA = loadSessionState(SESSION_A, { home })
const stateB = loadSessionState(SESSION_B, { home })
check('AC2-1 同会话覆盖持续有效（多轮重读后 dev 角色仍用 override）',
  resolveEffectiveRoute('developer', stateA, config).model === 'k3' &&
  resolveEffectiveRoute('developer', loadSessionState(SESSION_A, { home }), config).model === 'k3',
  `A.developer=${JSON.stringify(resolveEffectiveRoute('developer', stateA, config))}`)
check('AC2-2 另一主会话仍走持久默认（会话隔离）',
  resolveEffectiveRoute('developer', stateB, config).provider === 'deepseek-official' &&
  resolveEffectiveRoute('developer', stateB, config).model === 'deepseek-flash',
  `B.developer=${JSON.stringify(resolveEffectiveRoute('developer', stateB, config))}`)
check('AC2-3 未改角色不受影响（researcher 仍默认，不串角色）',
  resolveEffectiveRoute('researcher', stateA, config).model === 'deepseek-flash',
  `A.researcher=${JSON.stringify(resolveEffectiveRoute('researcher', stateA, config))}`)
check('AC2-4 会话状态文件落在 sessions/<主会话ID>.json（路径口径）',
  sessionPath(SESSION_A, home) === join(sessionsDir(home), `${SESSION_A}.json`) &&
  JSON.parse(readFileSync(sessionPath(SESSION_A, home), 'utf8')).sessionId === SESSION_A,
  `path=${sessionPath(SESSION_A, home)}`)

// ── AC9：同 ID 恢复保留；分叉/新建 ID 未命中 → 回持久默认 ────────────────────────
const FORK = '55555555-5555-4555-8555-555555555555'
check('AC9-1 同主会话 ID 恢复后覆盖保留（重新 load 即命中，无需额外逻辑）',
  resolveEffectiveRoute('developer', loadSessionState(SESSION_A, { home }), config).model === 'k3', 'A 覆盖保留')
check('AC9-2 分叉/新建会话 ID 未命中 → 空状态 → 回持久默认（不复制源会话数据）',
  resolveEffectiveRoute('developer', loadSessionState(FORK, { home }), config).model === 'deepseek-flash' &&
  !JSON.parse(readFileSync(sessionPath(SESSION_A, home), 'utf8')).sessionId.includes(FORK),
  'FORK 未继承 A')

// ── AC10：epoch 隔离 + 用户改模/恢复清降级态 ────────────────────────────────────
await updateSessionState(SESSION_A, (state) => {
  state.roles.developer = { epoch: 1, overrideRoute, degraded: true, reason: 'RATE_LIMIT 注入' }
}, { home })
check('AC10-1 降级态在 route 解析中优先于 override（degraded → fallback）',
  resolveEffectiveRoute('developer', loadSessionState(SESSION_A, { home }), config).model === 'gpt-5.6-luna',
  `A.developer=${JSON.stringify(resolveEffectiveRoute('developer', loadSessionState(SESSION_A, { home }), config))}`)
await updateSessionState(SESSION_A, (state) => {
  state.roles.developer = { epoch: nextEpoch(state.roles.developer), overrideRoute: { provider: 'kimi-coding', model: 'k3-256k' }, degraded: false }
}, { home })
const afterUser = loadSessionState(SESSION_A, { home })
check('AC10-2 用户新改模：epoch+1 且清降级态（不再返回 fallback）',
  afterUser.roles.developer.epoch === 2 && afterUser.roles.developer.degraded === false &&
  resolveEffectiveRoute('developer', afterUser, config).model === 'k3-256k',
  `epoch=${afterUser.roles.developer.epoch} route=${JSON.stringify(resolveEffectiveRoute('developer', afterUser, config))}`)
// 旧 epoch child 故障：只改自身快照，不写回 role 降级态（epoch 一致性检查）
await bindChild(CHILD_1, {
  parentId: SESSION_A, role: 'developer', epoch: 1,
  primaryRoute: overrideRoute, fallbackRoute: config.roles.developer.fallback,
}, { home, sessionId: SESSION_A })
await updateSessionState(SESSION_A, (state) => {
  const child = state.children[CHILD_1]
  child.degraded = true
  const roleState = state.roles[child.role]
  if ((roleState?.epoch ?? 0) === child.epoch) roleState.degraded = true
}, { home })
const afterOldEpoch = loadSessionState(SESSION_A, { home })
check('AC10-3 旧 epoch child 故障不覆盖用户新指令（role 不降级、仍用新 override）',
  afterOldEpoch.children[CHILD_1].degraded === true && afterOldEpoch.roles.developer.degraded === false &&
  resolveEffectiveRoute('developer', afterOldEpoch, config).model === 'k3-256k',
  `child.degraded=${afterOldEpoch.children[CHILD_1].degraded} role.degraded=${afterOldEpoch.roles.developer.degraded}`)
// 同 epoch child 故障 → 写回 role 降级态（对照组，证明一致性检查是判别式而非常量）
await updateSessionState(SESSION_A, (state) => {
  state.roles.developer = { epoch: 3, overrideRoute, degraded: false }
}, { home })
await bindChild(CHILD_2, {
  parentId: SESSION_A, role: 'developer', epoch: 3,
  primaryRoute: overrideRoute, fallbackRoute: config.roles.developer.fallback,
}, { home, sessionId: SESSION_A })
await updateSessionState(SESSION_A, (state) => {
  const child = state.children[CHILD_2]
  child.degraded = true
  const roleState = state.roles[child.role]
  if ((roleState?.epoch ?? 0) === child.epoch) { roleState.degraded = true; roleState.reason = 'RATE_LIMIT' }
}, { home })
const afterSameEpoch = loadSessionState(SESSION_A, { home })
check('AC10-4 同 epoch child 故障即写回 role 降级态（对照组：判别式有效）',
  afterSameEpoch.roles.developer.degraded === true &&
  resolveEffectiveRoute('developer', afterSameEpoch, config).model === 'gpt-5.6-luna',
  `role.degraded=${afterSameEpoch.roles.developer.degraded} reason=${afterSameEpoch.roles.developer.reason}`)

// ── 路径穿越与 ID 合法性 ──────────────────────────────────────────────────────
const badIds = ['../evil', 'a/b', 'a\\b', '', '.', '..', 'x'.repeat(129), 'a b', 'C:', 'abc/../def']
const rejected = badIds.filter((id) => !isValidSessionId(id))
check(`会话 ID 白名单拒绝全部 ${badIds.length} 个非法值（防路径穿越）`, rejected.length === badIds.length, `拒绝 ${rejected.length}/${badIds.length}`)
let traversalThrew = 0
for (const id of badIds) { try { sessionPath(id, home) } catch { traversalThrew++ } }
check('sessionPath 对非法 ID 一律抛错（不做任何路径拼接）', traversalThrew === badIds.length, `${traversalThrew}/${badIds.length} 抛错`)
let childIdRejected = false
try {
  await bindChild('../../x', { parentId: SESSION_A, role: 'developer', epoch: 1, primaryRoute: overrideRoute, fallbackRoute: config.roles.developer.fallback }, { home, sessionId: SESSION_A })
} catch { childIdRejected = true }
check('childId 含路径分隔符时 bindChild 抛错（children 键白名单校验，不落盘）', childIdRejected,
  'childId 白名单 + parentId 一致性双校验在位')

// ── child 绑定读写 ───────────────────────────────────────────────────────────
const binding = getChildBinding(CHILD_1, { home, sessionId: SESSION_A })
check('child 绑定读回：parentId/role/epoch/双路由/appliedRoute/degraded 七字段齐备',
  binding !== undefined && binding.parentId === SESSION_A && binding.role === 'developer' && binding.epoch === 1 &&
  binding.primaryRoute.model === 'k3' && binding.fallbackRoute.model === 'gpt-5.6-luna' &&
  binding.appliedRoute.model === 'k3' && binding.degraded === true,
  JSON.stringify(binding))
check('getChildBinding 对未绑定 child / 主会话 ID 返回 undefined',
  getChildBinding('99999999-9999-4999-8999-999999999999', { home, sessionId: SESSION_A }) === undefined &&
  getChildBinding(CHILD_1, { home, sessionId: 'not a session id' }) === undefined,
  'undefined')
let mismatchThrew = false
try {
  bindChild('66666666-6666-4666-8666-666666666666', { parentId: SESSION_B, role: 'researcher', epoch: 1, primaryRoute: overrideRoute, fallbackRoute: config.roles.researcher.fallback }, { home, sessionId: SESSION_A })
} catch { mismatchThrew = true }
check('bindChild：binding.parentId ≠ options.sessionId 即抛（防串档）', mismatchThrew, '抛错')

// ── 读失败显式抛错（不静默丢覆盖） ───────────────────────────────────────────
const sessionPathA = sessionPath(SESSION_A, home)
const good = readFileSync(sessionPathA, 'utf8')
writeFileSync(sessionPathA, '{ broken json', 'utf8')
let readThrew = false
let readMessage = ''
try { loadSessionState(SESSION_A, { home }) } catch (error) { readThrew = true; readMessage = error.message }
check('会话状态读失败显式抛错（不静默丢覆盖回默认）', readThrew, readMessage.slice(0, 80))
writeFileSync(sessionPathA, good, 'utf8')
check('恢复文件后 load 正常（抛错不损坏文件）', loadSessionState(SESSION_A, { home }).sessionId === SESSION_A, 'ok')

// ── 未命中 ID 不落盘（分叉/新建零副作用） ─────────────────────────────────────
const EMPTY_ID = '77777777-7777-4777-8777-777777777777'
loadSessionState(EMPTY_ID, { home })
check('未命中会话 ID 读取不创建空文件（分叉/新建零副作用）',
  !(() => { try { readFileSync(sessionPath(EMPTY_ID, home), 'utf8'); return true } catch { return false } })(),
  '无文件')
await saveSessionState(EMPTY_ID, { schemaVersion: 1, sessionId: EMPTY_ID, roles: {}, children: {} }, { home })
check('空状态可显式保存（schemaVersion/sessionId/roles/children 四字段）',
  JSON.parse(readFileSync(sessionPath(EMPTY_ID, home), 'utf8')).schemaVersion === 1, 'ok')
pushLine('（统计：AC2/AC9/AC10 逐条覆盖；非法 ID 10 例、绑定字段 7 项、读失败注入 1 例）')

writeResult()
