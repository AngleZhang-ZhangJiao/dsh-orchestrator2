/**
 * T5 budget.mjs 单测：fixture 计量数据→聚合输出断言；源不可用→降级声明断言；
 * 输出文本零费用词命中（费用|价格|单价|花费|计费|付费）。
 * Run: node tests/suites/budget-mock.test.mjs
 */
import { join } from 'node:path'

import { BUDGET_MODULE } from '../lib/paths.mjs'
import { reporter } from '../lib/test-harness.mjs'

const { check, writeResult } = reporter('budget-mock.test')
const lines = []

const { aggregateUsage } = await import(
  BUDGET_MODULE
)

const ROOT_CWD = 'C:\\proj'
const sessions = [
  { id: 'parent', header: { cwd: 'C:\\proj' } },
  { id: 'child-1', header: { cwd: 'C:\\proj' } },       // 子代理会话继承父 cwd
  { id: 'other-proj', header: { cwd: 'C:\\other' } },   // 非本项目 → 不聚合
]
const usageBySession = {
  parent: { uncachedInputTokens: 1000, outputTokens: 500, cacheReadTokens: 100, cacheWriteTokens: 50 },
  child1: { uncachedInputTokens: 300, outputTokens: 200, cacheReadTokens: 0, cacheWriteTokens: 0 },
}
function stateOf(session, key) {
  if (key !== 'tokenUsage') return undefined
  if (session.id === 'parent') return usageBySession.parent
  if (session.id === 'child-1') return usageBySession.child1
  return undefined
}

// 1) fixture 计量数据 → 聚合输出
const out = aggregateUsage(ROOT_CWD, sessions, stateOf)
lines.push(`--- 聚合输出文本 ---\n${out.message}`)
check('A1 ok=true', out.ok === true)
check('A2 只聚合约项目根会话（2 个有数据）', out.message.includes('2 个会话有计量数据'))
check('A3 每会话行（输入=未缓存+cache读+cache写 / 输出 / 合计）',
  out.message.includes('会话 parent：输入=1150 输出=500 合计=1650') &&
  out.message.includes('会话 child-1：输入=300 输出=200 合计=500'))
check('A4 合计行（输入=1450 输出=700 总计=2150）',
  out.message.includes('合计：输入=1450 输出=700 总计=2150'))
check('A5 非本项目会话未计入', !out.message.includes('other-proj'))

// 2) 源不可用 → 降级声明（不伪造数据）
const degraded = aggregateUsage(ROOT_CWD, sessions, undefined)
lines.push(`--- 降级输出 ---\n${degraded.message}`)
check('B1 降级：计量投影不可用 → 返回降级声明', degraded.ok === true && degraded.message.includes('token 计量不可用') && degraded.message.includes('以预算台账次数记录为准'))
check('B2 降级：不输出任何伪造数字', !/\d+\s+输出/.test(degraded.message))

// 3) 无匹配会话
const empty = aggregateUsage(ROOT_CWD, [], stateOf)
lines.push(`--- 空会话输出 ---\n${empty.message}`)
check('C1 无本项目会话 → 明确说明', empty.ok === true && empty.message.includes('未发现工作区'))

// 4) 输出文本零费用词命中（费用|价格|单价|花费|计费|付费）
const forbidden = /费用|价格|单价|花费|计费|付费/
const allText = [out.message, degraded.message, empty.message].join('\n')
const hits = allText.split('\n').filter((l) => forbidden.test(l))
check('D1 全部输出文本零费用词命中', hits.length === 0, hits.length ? `命中：${hits.join(' | ')}` : '零命中')

writeResult()
