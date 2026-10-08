# t9 基线更新记录（2026-09-16 · TP-B-修复1 / D2）

## 背景

宿主 0.1.5 把 persona 行配置键 `text:` 更名为必填 `prefix:`（breaking，详见
《宿主0.1.5升级问题与解决记录》§二-6）。调度员核验后裁定：`02-代码/orchestrator/agent.cordis.yml`
（1.0 预设文件）需「去乱码保适配」——属**有意修改**，t9-verify 的 1.0 零触碰
基线须同步更新，否则 AC10-1 会永久拦截合法改动。

## 本次更新（有记录）

| 项 | 旧基线（9ac16b8） | 新基线（2026-09-16 工作区重采） |
|---|---|---|
| 02-代码/orchestrator/agent.cordis.yml | `4de36c238d144dcc23a21d7e860aa5df31692ad1` | `b3d92088cd15e0ca89b3a9da68389b61a0583d98` |

其余三件（phase-gate.mjs / preset.yml / orchestrator2/budget.mjs）逐字节未动，基线值不变。

## 纪律

- 基线更新依据：用户解决记录 §三-6/7/8 + 修复包 TP-B-修复1 任务包 02 §三 D2（用户已授权扩范围）。
- 采集脚本 `t9-dump-bom.ps1` 已内嵌本记录（1b 段：钉住新 blob，工作区不符即抛错），run-all
  的准备性采集**不会**把基线打回旧树；也无「基线自动跟随工作区」的弱化——再改须走新裁定。
- 后续若 1.0 文件再被合法修改：更新本文件 + `t9-dump-bom.ps1` 的 `$INTENTIONAL_BASELINE`
  钉住值（两处同改，缺一不可），不得原地无痕改。
