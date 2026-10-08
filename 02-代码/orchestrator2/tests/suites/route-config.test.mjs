/**
 * T1 · D1 持久路由配置单测（AC1 / AC12）。
 * Run: node 02-代码/orchestrator2/tests/suites/route-config.test.mjs
 *
 * 覆盖：初始化值=DEC-T3-05 表（六条路由独立、effort 省略=键不存在）、路径红线（不在预设
 * 同步树内）、每次调用现读、校验失败显式抛错且不覆盖用户文件、原子保存失败注入（temp 占位为
 * 目录）→ 无成功态且后续读回旧值。
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { CACHE } from '../lib/paths.mjs'
import { reporter } from '../lib/test-harness.mjs'

const MOD = new URL('../../model-routes.mjs', import.meta.url).href
const {
  ROUTE_INIT, ROLES, ROUTE_SLOTS, SCHEMA_VERSION,
  loadRoleRoutes, peekRoleRoutes, saveRoleRoute, normalizeRoute, routesPath, tempPathFor, resolveDshHome,
} = await import(MOD)

const { check, pushLine, writeResult } = reporter('route-config.test', 'T1 · D1 持久路由配置单测')

mkdirSync(CACHE, { recursive: true })
const home = mkdtempSync(join(CACHE, 'route-fixtures-'))
const path = routesPath(home)

// ── AC1：初始化值 = DEC-T3-05 表；六条路由独立；effort 省略 = 不传字段 ──────────────
const init = loadRoleRoutes({ home })
check('AC1-1 首次读即初始化落盘（文件存在）', existsSync(path), `path=${path}`)
const expectedInit = {
  researcher: { default: ['deepseek-official', 'deepseek-flash', 'max'], fallback: ['openai-codex', 'gpt-5.6-luna', 'xhigh'] },
  developer: { default: ['deepseek-official', 'deepseek-flash', 'max'], fallback: ['openai-codex', 'gpt-5.6-luna', 'xhigh'] },
  reviewer: { default: ['volcengine', 'glm-5.3', undefined], fallback: ['openai-codex', 'gpt-6.1-sol', undefined] },
}
let routeOk = true
const routeDetail = []
for (const role of ROLES) {
  for (const slot of ROUTE_SLOTS) {
    const got = init.roles[role][slot]
    const [p, m, e] = expectedInit[role][slot]
    const okTriple = got.provider === p && got.model === m
    const okEffort = e === undefined ? !('effort' in got) : got.effort === e
    if (!okTriple || !okEffort) { routeOk = false; routeDetail.push(`${role}.${slot}=${JSON.stringify(got)}`) }
  }
}
check('AC1-2 六条初始化路由与 DEC-T3-05 表逐条一致（含 effort 省略=键不存在，不写字符串 default）',
  routeOk, routeOk ? '6/6 命中（researcher/developer 同值但独立对象，reviewer 无 effort 键）' : routeDetail.join(' ; '))
check('AC1-3 三角色对象互不相同（不串角色）',
  init.roles.researcher !== init.roles.developer && init.roles.developer !== init.roles.reviewer &&
  init.roles.researcher.default !== init.roles.developer.default,
  '对象身份隔离')
check('AC1-4 初始化文件 schemaVersion=1 且可 JSON 解析',
  JSON.parse(readFileSync(path, 'utf8')).schemaVersion === SCHEMA_VERSION, `schemaVersion=${SCHEMA_VERSION}`)

// ── 路径红线：配置在 DSH_HOME/orchestrator2/ 下，不在预设同步树（.agent-presets）内 ──
check('AC12-0 配置路径不在预设同步树内（D1 路径红线）',
  path === join(resolveDshHome(home), 'orchestrator2', 'model-routes.json') && !path.includes('.agent-presets'),
  `path=${path}`)

// ── 现读（无注册期快照）：外部改文件后再次 load 即读到新值 ────────────────────────
const extern = JSON.parse(readFileSync(path, 'utf8'))
extern.roles.reviewer.default = { provider: 'volcengine', model: 'glm-5.3', effort: 'high' }
writeFileSync(path, `${JSON.stringify(extern, null, 2)}\n`, 'utf8')
const reread = loadRoleRoutes({ home })
check('AC1-5 现读（外部改文件后 load 立即读到新值，无快照缓存）',
  reread.roles.reviewer.default.effort === 'high' && reread.roles.researcher.default.model === 'deepseek-flash',
  `reviewer.default=${JSON.stringify(reread.roles.reviewer.default)}`)

// ── 保存：原子、未指定槽位不变、无残留 tmp ────────────────────────────────────
await saveRoleRoute('researcher', 'default', { provider: 'kimi-coding', model: 'k3' }, { home })
const afterSave = loadRoleRoutes({ home })
check('AC12-1 saveRoleRoute 只改指定槽位（其余五槽与改动前逐字节同值）',
  afterSave.roles.researcher.default.provider === 'kimi-coding' &&
  !('effort' in afterSave.roles.researcher.default) &&
  afterSave.roles.researcher.fallback.model === 'gpt-5.6-luna' &&
  afterSave.roles.developer.default.model === 'deepseek-flash' &&
  afterSave.roles.reviewer.default.effort === 'high',
  `researcher.default=${JSON.stringify(afterSave.roles.researcher.default)}`)
check('AC12-2 原子写无残留 tmp 文件', !existsSync(tempPathFor(path)), `tmp=${tempPathFor(path)}`)

// ── 校验失败显式抛错，且不静默覆盖用户配置 ─────────────────────────────────────
const before = readFileSync(path, 'utf8')
const badCases = [
  ['坏 JSON', '{ not json'],
  ['schemaVersion 未知', JSON.stringify({ schemaVersion: 99, roles: {} })],
  ['缺角色', JSON.stringify({ schemaVersion: SCHEMA_VERSION, roles: { researcher: { default: { provider: 'a', model: 'b' }, fallback: { provider: 'a', model: 'b' } } } })],
  ['provider 空串', JSON.stringify({ schemaVersion: SCHEMA_VERSION, roles: ROLES.reduce((acc, r) => (acc[r] = { default: { provider: ' ', model: 'b' }, fallback: { provider: 'a', model: 'b' } }, acc), {}) })],
  ['effort 非字符串', JSON.stringify({ schemaVersion: SCHEMA_VERSION, roles: ROLES.reduce((acc, r) => (acc[r] = { default: { provider: 'a', model: 'b', effort: 5 }, fallback: { provider: 'a', model: 'b' } }, acc), {}) })],
]
let threw = 0
let lastBad = ''
const throwDetail = []
for (const [label, text] of badCases) {
  lastBad = text
  writeFileSync(path, text, 'utf8')
  try { loadRoleRoutes({ home }); } catch (error) { threw++; throwDetail.push(`${label}:${error.message.slice(0, 40)}`) }
}
check(`AC1-6 读/校验失败显式抛错（${badCases.length} 类坏输入全抛，不静默回退内置值）`,
  threw === badCases.length, `${threw}/${badCases.length}；${throwDetail.join(' | ')}`)
check('AC1-7 校验失败不覆盖用户文件（坏文件按原样保留，未被隐式重写为内置值）',
  readFileSync(path, 'utf8') === lastBad, `保留=${readFileSync(path, 'utf8') === lastBad}`)

// 恢复正常配置供后续断言
writeFileSync(path, before, 'utf8')

// ── AC12：保存失败注入（temp 路径被目录占位 → writeFileSync EISDIR），无成功态且后续读旧值 ──
const oldValue = loadRoleRoutes({ home }).roles.developer.fallback.model
mkdirSync(tempPathFor(path), { recursive: true })
let saveFailed = false
let saveMessage = ''
try {
  await saveRoleRoute('developer', 'fallback', { provider: 'kimi-coding', model: 'k3-256k' }, { home })
} catch (error) {
  saveFailed = true
  saveMessage = error.message
}
check('AC12-3 保存失败注入：saveRoleRoute 抛错（不发布成功态）', saveFailed, saveMessage.slice(0, 90))
check('AC12-4 保存失败后现读仍为旧值（内存未标成功、后续派工读旧值）',
  loadRoleRoutes({ home }).roles.developer.fallback.model === oldValue,
  `developer.fallback.model=${loadRoleRoutes({ home }).roles.developer.fallback.model}（旧值 ${oldValue}）`)

// ── 归一化函数边界 ───────────────────────────────────────────────────────────
let normalizeThrew = 0
for (const bad of [null, [], { provider: '', model: 'x' }, { provider: 'x', model: '' }, { provider: 'x', model: 'y', effort: 'default' }]) {
  try { normalizeRoute(bad, 't') } catch { normalizeThrew++ }
}
check('AC1-8 normalizeRoute 拒绝空串与字符串 "default"（effort 省略=不传字段）', normalizeThrew === 5, `${normalizeThrew}/5 拒绝`)
const parsed = normalizeRoute({ provider: ' volcengine ', model: ' glm-5.3 ' }, 't')
check('AC1-9 normalizeRoute 去空白且省略 effort 时不产生该键',
  parsed.provider === 'volcengine' && parsed.model === 'glm-5.3' && !('effort' in parsed), JSON.stringify(parsed))
check('T1-10 peekRoleRoutes 对缺失 home 返回 undefined（不产生副作用）',
  peekRoleRoutes({ home: join(home, 'nope') }) === undefined, 'undefined')
pushLine(`（统计：本套件覆盖 AC1 六条初始化路由 + AC12 保存失败注入 + 路径红线；配置路径=${path}）`)

writeResult()
