/**
 * dsh-orchestrator2 — 自动开发调度器2.0 agent preset plugin.
 *
 * Host half only: on startup it syncs the bundled `presets/orchestrator2`
 * tree into the harness-home agent-presets root (`~/.dsh/.agent-presets`),
 * making the 自动开发调度器2.0 preset selectable for new sessions without
 * copying files by hand, and announces the capability through a
 * system-prompt section. No browser half, no routes, no agent tools — the
 * preset itself provides the tools.
 *
 * Coexists with dsh-orchestrator (1.0): independent package id, independent
 * bundle row, independent preset directory (`orchestrator2` vs
 * `orchestrator`). Presets load per-session exclusively, so the two never
 * conflict; pick by the project's collaboration-spec version (v1.1 → 1.0,
 * v2.1 six-zone → 2.0; v2.0 projects upgrade the scaffold first), never mix
 * both presets in one project.
 *
 * Sync semantics: per-file byte comparison, copy on missing/different,
 * remove target files the bundle no longer ships — strictly inside the
 * `orchestrator2` preset directory; sibling presets (including 1.0's
 * `orchestrator`) are never touched. Uninstall:
 * `dsh plugin --profile web remove dsh-orchestrator2` (this bundle leaves
 * the roster; the synced preset directory stays behind and can be deleted
 * by hand).
 *
 * Plain ESM, node builtins only — no build step, no runtime dependencies.
 * Structure adapted from dsh-orchestrator (1.0), itself adapted from
 * @linxin666/dsh-liangshen (Apache-2.0).
 */

import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Stable cordis plugin name. */
export const name = 'orchestrator2'

/** Prompt assembly must exist before the announcement section can register. */
export const inject = ['systemPrompt']

/** Model-facing announcement: plugin presence, principle, requirements, limits. */
export const ORCHESTRATOR2_GUIDANCE = '本机已安装 dsh-orchestrator2 插件（自动开发调度器2.0 agent preset v2.8.0）：新建会话的预设选择器中可选「自动开发调度器2.0」。原理：三阶段——设计阶段（交互态：聊需求→并行研究员调研→设计方案→设计决策清点 grill-me 开场问档→原型→定稿）→ 开发阶段（goal 驱动、任务包串行、授权合并——设计定稿确认时选「确认即开工」即完成开发授权：任务包生成后调度器自动核查前置、激活首包并 enter_auto_mode 建立 ≤24 工作轮的推进 goal，调度引擎后台派工+看门狗轮内 tick 值班驱动 审核员计划审核→开发员执行自测→审核员审查（AC 证据核验+代码审查一次完成）→调度员构建，五态流水线推进到「待人工测试」硬停止；每次人工测试通过自动核查放行下一包，无需重复授权；异常硬停、随时可喊停；用户主动说「开始自动推进」属等效授权）→ 验收阶段（修复循环含审核员修复审查）。v2.1 新增两场景：修改已有系统（现状研究中+目标代码区）与技术调研储备（独立终态，不进开发）。任务包改动点带『消费/产出』接口契约行，计划审核含跨改动点冲突扫描（只扫确实共享的组合），派工材料分层（prompt 五要素、权威材料入库）。四角色：调度员（会话自身；默认模型走文档推荐——新建会话时自选 kimi-coding/k3 + max，预设层不声明会话模型）、研究员（subagent_researcher，钉 deepseek-official/deepseek-flash + max）、开发员（subagent_developer，钉 deepseek-official/deepseek-flash + max）、审核员（subagent_reviewer，钉 volcengine/glm-5.3，不声明 reasoningEffort，档位走 provider 默认值）；研究员/开发员另钉 reasoningEffort（均为 max）；**会话内可临时改三角色模型**（默认仅当次主会话生效，明确指定「默认/降级」槽位才持久保存；遇 429/限流或已确认可恢复的额度错误自动降级到该角色降级模型并在本会话保持，不自动回切）：设置工具 set_role_model / reset_role_model / inspect_role_models，持久路由文件 `<DSH_HOME>/orchestrator2/model-routes.json`、会话状态 `sessions/<主会话ID>.json`；预算按包分档三硬上限（小包 4/6/24、大包 8/8/48，派工即计次）+ budget_status token 用量纯统计（无费用概念）；ponytail 最小实现纪律。前提：被驱动项目须为规范 v2.1 六区结构（00-项目管理/01-设计/02-代码/03-开发协同/04-测试/05-交付 + 90-历史归档），规范与模板随预设 spec/ 目录提供，可由调度员初始化 v2.1 脚手架；v2.0 规范项目可先升级脚手架再使用，v1.1 规范项目请改用「自动开发调度器」（1.0）预设，同一项目不混用两个预设。0.1.7 起预设走声明式机制：包内 presets/agent-preset.patch.yml 在启动时把 preset-orchestrator2 声明进组合树（~/.dsh/.agent-presets 旧目录同步机制已移除，更新后重启前先用 web --dump-config 做组合树体检），升级插件时自动生效。用户提到「自动开发调度器2.0 / orchestrator2」时即指本插件，请据此协作。'

/**
 * Harness-home resolution: DSH_HOME override (with ~ expansion) falling back
 * to the platform home (~/.dsh). A relative DSH_HOME resolves against the
 * process CWD (absolute), matching the family-shared contract.
 */
export function dshHome() {
  const override = process.env.DSH_HOME
  if (typeof override === 'string' && override.trim().length > 0) {
    let p = override.trim()
    if (p === '~' || p.startsWith('~/') || p.startsWith('~\\')) p = join(homedir(), p.slice(1))
    return resolve(p)
  }
  return join(homedir(), '.dsh')
}

/** Absolute path of the bundled preset tree inside this package. */
export function bundledPresetDir() {
  return join(fileURLToPath(new URL('../presets/', import.meta.url)), 'orchestrator2')
}

/** All files under one directory, absolute paths, recursive. */
function filesUnder(root) {
  const out = []
  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry)
      if (statSync(path).isDirectory()) walk(path)
      else out.push(path)
    }
  }
  walk(root)
  return out
}

/**
 * Sync the bundled preset into `~/.dsh/.agent-presets/orchestrator2`:
 * copy files that are missing or byte-different, remove files the bundle no
 * longer ships. Returns { copied: string[], removed: string[] }.
 */
export function syncPreset(sourceDir, targetDir) {
  const result = { copied: [], removed: [] }
  const sourceFiles = filesUnder(sourceDir)
  const keep = new Set(sourceFiles.map((f) => relative(sourceDir, f)))
  mkdirSync(targetDir, { recursive: true })
  for (const source of sourceFiles) {
    const rel = relative(sourceDir, source)
    const target = join(targetDir, rel)
    const stale = !existsSync(target) || !readFileSync(target).equals(readFileSync(source))
    if (stale) {
      mkdirSync(dirname(target), { recursive: true })
      cpSync(source, target)
      result.copied.push(rel)
    }
  }
  for (const target of filesUnder(targetDir)) {
    const rel = relative(targetDir, target)
    if (!keep.has(rel)) {
      rmSync(target, { force: true })
      result.removed.push(rel)
    }
  }
  return result
}

/**
 * Mount the plugin: sync the bundled preset into the harness-home
 * agent-presets root, then announce through a system-prompt section.
 * @param {object} ctx - host plugin context carrying systemPrompt.
 */
export function apply(ctx) {
  try {
    const targetRoot = join(dshHome(), '.agent-presets')
    mkdirSync(targetRoot, { recursive: true })
    const result = syncPreset(bundledPresetDir(), join(targetRoot, 'orchestrator2'))
    if (result.copied.length > 0 || result.removed.length > 0) {
      ctx.logger?.info?.(`dsh-orchestrator2: preset synced into ${targetRoot} (copied: ${result.copied.length}, removed: ${result.removed.length})`)
    }
  } catch (error) {
    ctx.logger?.warn?.(`dsh-orchestrator2: preset sync failed: ${error instanceof Error ? error.message : String(error)}`)
  }
  const disposeSection = ctx.systemPrompt.section({
    name: 'plugin:dsh-orchestrator2',
    order: 152,
    text: ORCHESTRATOR2_GUIDANCE,
  })
  ctx.effect(() => () => { disposeSection() }, 'dsh-orchestrator2: announcement')
}
