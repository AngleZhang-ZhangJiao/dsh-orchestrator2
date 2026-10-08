/**
 * Shared fixture helpers for the phase-gate self-tests (T4 mock + T6 e2e).
 * Scenario = a fresh copy of fixture-valid with one mutation (the only legal
 * variable in each rejection case).
 * Fixture projects live in tests/fixtures/e2e-fixture-projects/ (the builder
 * only cleans the project dirs; test/.cache 不入库).
 */
import { cpSync, rmSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { FX } from './paths.mjs'

export { FX }

export const TASK_REL = '03-开发协同/TP1-玩具功能'

export function write(path, text) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, text, 'utf8')
}

export function scenario(name, mutate) {
  const dir = join(FX, 'scenarios', name)
  rmSync(dir, { recursive: true, force: true })
  cpSync(join(FX, 'fixture-valid'), dir, { recursive: true })
  if (mutate) mutate(dir)
  return dir
}

/** Design-task dir (任务包/TP1-玩具功能) inside a scenario root. */
export const DESIGNTASK = (dir) => join(dir, '01-设计', '玩具项目', '任务包', 'TP1-玩具功能')

/** Product dir (01-设计/玩具项目) inside a scenario root. */
export const PRODUCT = (dir) => join(dir, '01-设计', '玩具项目')
