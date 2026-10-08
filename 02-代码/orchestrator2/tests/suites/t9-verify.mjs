/**
 * T9（AC10）· 1.0 全树与 budget.mjs 零触碰核验（判定侧）。
 *
 * 数据来源（两段式，绕过沙箱对 node 子进程的 EPERM 限制 —— 本 node 进程 spawn git
 * 会得到 EPERM，故 git 侧一律在 pwsh 夹具里做完）：
 *   ① pwsh 侧（tests/fixtures/t9-dump-bom.ps1）用只读 `git ls-tree -r -z 9ac16b8`
 *      导出基线 blob 清单 → tests/fixtures/t9-data/baseline.txt
 *      格式：**NUL 分隔**的 `<mode> <type> <sha1>\t<path>` 记录流（F-1：-z 输出原样
 *      UTF-8 路径，无 quotepath 八进制转义、无引号，消费侧无需还原启发式）；
 *   ② 本脚本直读工作树文件字节，用 node:crypto 计算 git blob 哈希
 *      （sha1("blob " + byteLength + "\0" + content)），与基线逐 blob 比对。
 * 全程不写 index（git 侧只读 ls-tree），不受 .git/index 用户侧锁定影响。
 * Run: node 02-代码/orchestrator2/tests/suites/t9-verify.mjs
 *
 * 【基线更新记录 · TP-B-修复1 / D2】2026-09-16：宿主 0.1.5 把 persona 行配置键
 * `text:` 更名为必填 `prefix:`（breaking），`02-代码/orchestrator/agent.cordis.yml`
 * 被**有意修改**（去乱码保适配，见修复执行自测-20260916 T0）。基线数据件
 * `fixtures/t9-data/baseline.txt` 中该件 blob 由 4de36c2… 更新为 b3d9208…
 * （同目录 sidecar `baseline-note-20260916.md` 留痕）。其余三件未动。
 * 重新跑 t9-dump-bom 采集脚本会按 9ac16b8 旧树采集、再经脚本 1b 段的「有记录基线
 * 更新」钉为本更新值（工作区该件与钉住值不符即抛错）——基线不会被打回旧树。
 */
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT, T9_DATA, BUDGET_MODULE } from '../lib/paths.mjs'
import { reporter } from '../lib/test-harness.mjs'

const { check, writeResult } = reporter('t9-verify')
const out = []

void BUDGET_MODULE // 说明性引入：本套件比对的目标之一（路径口径与 paths.mjs 单一来源一致）

// ponytail: 在 node 内自算 git blob 哈希（sha1("blob <len>\0" + content)）以规避沙箱对 node
// 子进程的 EPERM 限制（实测 `spawnSync git` → EPERM）；天花板：仅等价于 `git hash-object`
// 的裸 blob 口径，不覆盖 .gitattributes 的 filter/CRLF 归一化差异；升级路径：宿主放开
// node 子进程后改回 `git hash-object` 逐条比对（口径等价、免自维护哈希实现）。
/** git blob 哈希：sha1("blob <len>\0" + content) */
function gitBlobHash(bytes) {
  const header = Buffer.from(`blob ${bytes.length}\0`, 'utf8')
  return createHash('sha1').update(Buffer.concat([header, bytes])).digest('hex')
}
function diskHash(relPath) {
  const abs = join(ROOT, ...relPath.split('/'))
  if (!existsSync(abs) || !statSync(abs).isFile()) return undefined
  return gitBlobHash(readFileSync(abs))
}
/** 工作树某前缀下全部文件（相对路径，/ 分隔） */
function workTreeFiles(dirRel) {
  const abs = join(ROOT, ...dirRel.replace(/\/$/, '').split('/'))
  const res = []
  if (!existsSync(abs)) return res
  const walk = (d, prefix) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const rel = prefix ? `${prefix}/${e.name}` : e.name
      if (e.isDirectory()) walk(join(d, e.name), rel)
      else res.push(rel)
    }
  }
  walk(abs, '')
  return res.map((p) => `${dirRel.replace(/\/$/, '')}/${p}`)
}

// ── 读基线清单（F-1：NUL 分隔记录流，路径为原样 UTF-8）──────────────────────
if (!existsSync(T9_DATA)) {
  console.error(`基线数据缺失：${T9_DATA}\n请先跑 node tests/fixtures/t9-dump-bom.mjs（pwsh 采集）`)
  process.exit(2)
}
const baseline = new Map()
const malformed = []
for (const rec of readFileSync(T9_DATA).toString('utf8').split('\0')) {
  if (rec === '') continue
  const m = rec.match(/^(\d+)\s+(\w+)\s+([0-9a-f]{40})\t(.+)$/)
  if (m === null) {
    malformed.push(rec)
    continue
  }
  baseline.set(m[4].replace(/\\/g, '/'), m[3])
}
out.push(`=== 基线（9ac16b8）blob 清单：${baseline.size} 件（data=${T9_DATA.replace(ROOT, '')}）===`)
for (const p of baseline.keys()) out.push('  ' + p)
check('T9-0a 基线清单非空且含 1.0 全树与 budget.mjs',
  baseline.size > 0 && [...baseline.keys()].some((p) => p.includes('orchestrator/')) &&
  [...baseline.keys()].some((p) => p.endsWith('orchestrator2/budget.mjs')),
  `${baseline.size} 件`)
check('T9-0b F-1：基线记录全部可解析（NUL 分隔 + 原样 UTF-8 路径，零残留转义）',
  malformed.length === 0 && ![...baseline.keys()].some((p) => p.includes('\\3') || p.includes('"')),
  malformed.length ? `不可解析 ${malformed.length} 条：${malformed.slice(0, 3).join(' | ')}` : `${baseline.size} 条记录全解析`)

// ── 逐 blob 比对 ──────────────────────────────────────────────────────────
const missing = []
const changed = []
let same = 0
for (const [p, hash] of baseline) {
  const h = diskHash(p)
  if (h === undefined) missing.push(p)
  else if (h === hash) same++
  else changed.push({ p, base: hash, now: h })
}
out.push('', '--- 逐 blob 比对结果 ---')
out.push(`  基线 ${baseline.size} 件 / 工作树逐 blob 一致 ${same} 件 / 缺失 ${missing.length} 件 / 变更 ${changed.length} 件`)
for (const p of missing) out.push('  缺失：' + p)
for (const c of changed) out.push(`  变更：${c.p}  ${c.base.slice(0, 10)}… -> ${c.now.slice(0, 10)}…`)

// F-3（收编轮修复）：原实现 `r10Dir = r10[0]?.replace(...)` 依赖 keys 顺序 ——
// 基线首键恰为 orchestrator2/budget.mjs 时会被截成 `02-代码/orchestrator2`，
// 导致「1.0 全树无新增文件」断言比对错目录（假绿）。改为按前缀直接定位。
const R10_PREFIX = '02-代码/orchestrator/'
const r10 = [...baseline.keys()].filter((p) => p.startsWith(R10_PREFIX))
const r10Miss = missing.filter((p) => p.startsWith(R10_PREFIX))
const r10Chg = changed.filter((c) => c.p.startsWith(R10_PREFIX))
check('AC10-1 1.0 全树逐 blob 与基线一致（无缺失无变更）',
  r10Miss.length === 0 && r10Chg.length === 0,
  `基线 ${r10.length} 件，一致 ${r10.length - r10Miss.length - r10Chg.length} 件`)

const bPath = [...baseline.keys()].find((p) => p.endsWith('orchestrator2/budget.mjs'))
const bHash = baseline.get(bPath)
const bNow = diskHash(bPath)
check('AC10-2 budget.mjs 逐字节与基线一致', bHash !== undefined && bNow === bHash,
  `基线 ${String(bHash).slice(0, 10)}… / 当前 ${String(bNow).slice(0, 10)}…`)

// 附加：1.0 全树无新增文件（工作树多出的文件即越界写入）
const r10Now = workTreeFiles(R10_PREFIX)
const r10Extra = r10Now.filter((p) => !baseline.has(p))
check('AC10-3 1.0 全树无新增文件（越界写入检查）', r10Extra.length === 0,
  r10Extra.length ? `新增：${r10Extra.join(' / ')}` : `比对目录 ${R10_PREFIX}｜工作树 ${r10Now.length} 件全在基线内（基线同前缀 ${r10.length} 件）`)

// 附加：orchestrator2 侧改动面（应仅本包 D 项文件）
const r2Now = workTreeFiles('02-代码/orchestrator2/')
out.push('', `--- 附：orchestrator2 工作树 ${r2Now.length} 件（本包目标代码区）---`)
out.push('  （完整性由 T6/D9 断言；此处仅列件数以佐证零触碰比对范围）')

writeResult()
