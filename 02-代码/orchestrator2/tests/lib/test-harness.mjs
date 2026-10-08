/**
 * 套件结果记录器（M6 收编）。
 *
 * 为什么需要它：回归入口 run-all.mjs 要给出「逐件 pass/fail + 合计」的可复算汇总。
 * 常见做法是父进程 spawn 子进程并捕获 stdout —— 但本项目的执行环境（DSH 文件沙箱
 * workspace-write）**禁止子进程通过管道回传输出**：实测 `spawnSync(node, [...], {stdio:'pipe'})`
 * → `EPERM: spawnSync ... EPERM`，而 `stdio:'inherit'` 正常。因此套件改为把结果同时写两份：
 *   ① 人读 —— stdout 的 PASS/FAIL 明细行 + 末行 `pass=N fail=M`（保持既有格式，人工/日志可用）；
 *   ② 机读 —— `tests/.cache/results/<suite>.json`（run-all 直接读文件，不依赖捕获 stdout）。
 *
 * 用法：
 *   import { reporter } from '../lib/test-harness.mjs'
 *   const { check, writeResult } = reporter('suite-name', '人读标题')
 *   check('断言名', cond, '（可选证据）')
 *   writeResult()          // 打印明细 + 汇总行，并写 JSON；有失败时设置 exitCode=1
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { CACHE } from './paths.mjs'

/**
 * 建一个结果记录器。
 * @param {string} suite - 套件标识（用作 JSON 文件名，建议与脚本同名去扩展名）。
 * @param {string} [title] - 人读标题（首行打印；可省）。
 * @returns {{check: (label: string, cond: boolean, detail?: string) => boolean, pass: () => number, fail: () => number, writeResult: () => void, pushLine: (line: string) => void, lines: string[]}}
 */
export function reporter(suite, title) {
  let pass = 0
  let fail = 0
  const lines = []
  if (title !== undefined) lines.push(title)

  /** 记一条断言：cond 为真则 PASS，否则 FAIL。detail 作为证据附在括号内。 */
  function check(label, cond, detail) {
    const ok = Boolean(cond)
    lines.push(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  （${detail}）` : ''}`)
    if (ok) pass++
    else fail++
    return ok
  }

  /** 追加一行非断言输出（诊断/上下文）。 */
  function pushLine(line) {
    lines.push(line)
  }

  /** 打印全部输出 + 汇总行，并落 JSON；有失败则 exitCode=1。 */
  function writeResult() {
    console.log(lines.join('\n'))
    console.log(`\npass=${pass} fail=${fail}`)
    try {
      mkdirSync(join(CACHE, 'results'), { recursive: true })
      writeFileSync(
        join(CACHE, 'results', `${suite}.json`),
        JSON.stringify({ suite, pass, fail, ok: fail === 0 }, null, 2),
        'utf8',
      )
    } catch (error) {
      // 结果落盘失败不应掩盖断言结论：打印警告并继续
      console.error(`[test-harness] 结果落盘失败（${suite}）：${error.message}`)
    }
    if (fail > 0) process.exitCode = 1
  }

  return { check, pushLine, writeResult, lines, pass: () => pass, fail: () => fail }
}
