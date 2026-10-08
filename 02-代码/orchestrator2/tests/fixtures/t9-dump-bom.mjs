/**
 * T9 基线数据采集入口（pwsh 包装）。
 *
 * 为什么是 pwsh 包装而不是纯 node：t9-verify 要逐 blob 比对 1.0 全树，baseline 清单必须由
 * `git ls-tree -z` 导出 —— 而本沙箱下 **node 进程 spawn 子进程会拿到 EPERM**（已实测，
 * 见 .tmp 记录），只有在 pwsh 里跑 git 才可行。采集侧必须逐字节落盘（NUL 分隔），
 * PowerShell 的字符串管道会丢 NUL，故 t9-dump-bom.ps1 内部经 `cmd /c ... > file` 写出。
 *
 * 用法：node tests/fixtures/t9-dump-bom.mjs
 * 输出：tests/fixtures/t9-data/{baseline.txt, relpaths.txt, worktree-hashes.txt, templates-v20.txt}
 *       —— 本脚本用 stdio: 'inherit'（不捕获子进程 stdout，避免触碰沙箱 stdio 限制）。
 */
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT, TEST_DIR, T9_DATA } from '../lib/paths.mjs'

const ps1 = join(TEST_DIR, 'fixtures', 't9-dump-bom.ps1')
if (!existsSync(ps1)) throw new Error(`未找到采集脚本：${ps1}`)

const r = spawnSync(
  'powershell',
  ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ps1],
  { cwd: ROOT, stdio: 'inherit', shell: false },
)
if (r.error) throw new Error(`pwsh 采集失败：${r.error.message}`)
if (r.status !== 0) throw new Error(`pwsh 采集退出码 ${r.status}`)
if (!existsSync(T9_DATA)) throw new Error(`采集产物缺失：${T9_DATA}`)
