/**
 * 测试路径单一来源（M6 收编：`.tmp/mock/` → `02-代码/orchestrator2/tests/`）。
 *
 * 收编前每个套件各自 `const ROOT = resolve(HERE,'..','..')`（当时 HERE = `.tmp/mock/`，
 * 两级上溯正好是项目根）。收编后 HERE = `…/orchestrator2/tests/suites/`，层级变了 ——
 * 若逐个改写上溯级数，路径口径会散落在十几个文件里，改一处漏一处。因此收编时集中到
 * 本模块：所有套件/夹具只从这里取路径。
 *
 * 目录约定（tests/ 内部）：
 *   tests/lib/        共享库（本文件 + scenario-utils.mjs）
 *   tests/suites/     14 个断言套件 + 1 生成器 + 1 e2e 干跑
 *   tests/fixtures/   夹具脚本与夹具数据（build-fixture.mjs / t9-dump-bom.ps1 / t9-data/ /
 *                     e2e-fixture-projects/）
 *   tests/run-all.mjs 总入口（顺序跑全部套件并汇总）
 *   tests/.cache/     生成物（运行日志）——不入库，见 .gitignore
 */

import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** `tests/` 目录绝对路径。 */
export const TEST_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** 项目根绝对路径（= 仓库根；测试读 `02-代码/` 与 `04-交付/` 均以此为锚）。 */
export const ROOT = resolve(TEST_DIR, '..', '..', '..')

/** 目标代码区根：`02-代码/orchestrator2/`。 */
export const ORCH2 = join(ROOT, '02-代码', 'orchestrator2')

/** 规范目录：`02-代码/orchestrator2/spec/`。 */
export const SPEC_DIR = join(ORCH2, 'spec')

/** 模板集：`02-代码/orchestrator2/spec/templates/`。 */
export const TPL = join(SPEC_DIR, 'templates')

/** 夹具脚本与夹具数据目录：`tests/fixtures/`。 */
export const FIXTURES = join(TEST_DIR, 'fixtures')

/** 夹具项目树根（fixture-valid / fixture-legacy / scenarios/，由 build-fixture.mjs 生成）。 */
export const FX = join(FIXTURES, 'e2e-fixture-projects')

/** `tests/.cache/`：可重生成产物与运行日志（不入库）。 */
export const CACHE = join(TEST_DIR, '.cache')

/** T9 基线数据件（git ls-tree 导出的 1.0 全树 blob 清单）。 */
export const T9_DATA = join(FIXTURES, 't9-data', 'baseline.txt')

/** 被测模块：`phase-gate.mjs`（file URL，供 `await import()`）。层级：tests/lib/ → ../../phase-gate.mjs */
export const PHASE_GATE = new URL('../../phase-gate.mjs', import.meta.url).href

/** 被测模块：`budget.mjs`（file URL，供 `await import()`）。层级：tests/lib/ → ../../budget.mjs */
export const BUDGET_MODULE = new URL('../../budget.mjs', import.meta.url).href

/** 共享夹具助手：`tests/lib/scenario-utils.mjs`（file URL，供 `await import()`）。 */
export const SCENARIO_UTILS = new URL('./scenario-utils.mjs', import.meta.url).href
