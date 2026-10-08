# orchestrator2（插件源码侧）

> 当前源码版本：**v2.9.0**（2026-10-08 TP1-首次使用引导：persona 新增【首次使用引导】小节（三段式：新会话首条消息秒级只读探查 → 有缺项才提示 → 按需授权补齐 → `enter_auto_mode` 开工门禁）+ `phase-gate.mjs` validateAutoMode 增开发准备门禁（读 `00-项目管理/开发准备.md` 固定块，fail-closed 三态拒绝，无流程类型豁免）+ 开发准备.md 模板与规范 v2.1.4，机器层同步，套件 529→540/0。此前 v2.8.0 为 2026-10-08 TP1-对话形态纪律：persona 新增【对话形态纪律】（人读消息 answer-first/结尾唯一下一步/分组≤5/提问纪律/过程消息一行制 + 不采用四项成文 + i-have-adhd 署名行），机器层零改动，套件 524→529/0；v2.7.1 为 2026-10-02 T3-TP1-修复1 · issueId=T3TP1-LIVE-01：两纯函数库模块补空 `apply` 空载修复预设挂载被拒（`config-check` 增 T3h 装配断言防回归）；v2.7.0 为 2026-10-01 T3-TP1 子代理模型路由与会话覆盖；v2.6.1 为 2026-09-28 版本元数据同步）。
> 本目录 = 插件「自动开发调度器2.0」的**源码**。`04-交付/安装包/dsh-orchestrator2-v<版本>/` 是它的构建产物。
> 交付包结构（`presets/orchestrator2/` + `lib/` + `docs/` + `cordis.patch.yml` + `package.json`）**不含本 README 与 `tests/`** —— `tests/` 是开发期回归资产，`package.json` 的 `files` 不收它。

## 目录

| 路径 | 内容 |
|---|---|
| `preset.yml` | 预设元信息（名称/描述/排序） |
| `agent.cordis.yml` | 预设组合：persona（双态调度员人格）+ 三角色路由装配（delegation 组内 `./model-routes.mjs` / `./session-routes.mjs` / `./role-tools.mjs` / `./route-fallback.mjs` 四模块行，官方三角色钉模型行已删除）+ 两组本地插件行（compaction 组内 `./phase-gate.mjs`、`./budget.mjs`） |
| `model-routes.mjs` | **D1 持久路由配置**：`<DSH_HOME>/orchestrator2/model-routes.json`（默认/降级六槽、每次派工现读、原子写、校验失败显式报错）；导出 `ROUTE_INIT` / `loadRoleRoutes` / `saveRoleRoute` 供自测与断言 |
| `session-routes.mjs` | **D2 会话状态**：`sessions/<主会话ID>.json`（epoch/override/degraded/reason + child 绑定快照）、会话 ID 合法性校验、`resolveEffectiveRoute` 纯函数；导出纯函数供自测 |
| `role-tools.mjs` | **D3+D5 自持工具**：`subagent_researcher/reviewer/developer`（同名替换官方行，先 bindChild 再 startContinuable）+ `set_role_model` / `reset_role_model` / `inspect_role_models`（嵌套 route 规避 invariant） |
| `route-fallback.mjs` | **D4 故障降级 hook**：`agent/request` + `agent/request-error` 监听（`prepend: true` 独占处置，G1 次序闸门），429/限流与可恢复额度错误一次切换降级、终局传播、不吞取消 |
| `phase-gate.mjs` | `enter_auto_mode` 工具 + create→pause→(idle)compactNow→resume 交接 + **M4 显式规范版本 fail-closed 校验 / M3 幂等守卫 / M5 设计冻结哈希核对**；导出纯函数 `validateAutoMode` 供自测 |
| `budget.mjs` | `budget_status` 工具（token 用量纯统计，零费用口径）；导出纯函数 `aggregateUsage` 供自测 |
| `dispatch.mjs` | **M2 派工原子半步**：`dispatch_begin`（预算派工前拒绝 + 写锁 + 台账预登记）/ `dispatch_end`（阶段前移校验 + 台账回填 + 删锁）/ `dispatch_status`（悬空派工识别）；三工具均为**预设内本地工具模块**（形态 A） |
| `spec/` | 规范 v2.0 / v2.1 + `templates/` 模板集（构建时全量同步进预设包） |
| `docs/使用手册.md` | 面向用户的使用手册（构建时同步进预设包 `presets/orchestrator2/docs/`） |
| `lib/index.js` | 宿主侧插件半体（预设同步 + systemPrompt 宣告）。**源码侧为该件唯一来源**，构建时按 `packaging.json` 的 `files` 复制进包 |
| `packaging.json` | **构建材料清单单一来源**：`files` 白名单 + `exclude`（`tests/**` 不进包、不进 zip）+ `version` |
| `tools/gen-preset-patch.mjs` | 0.1.7 声明文件生成器（default 写盘 / `--check <参照>` 语义比对；构建工具，不进交付包） |
| `presets/agent-preset.patch.yml` | **生成物**（gen-preset-patch.mjs 从 agent.cordis.yml + preset.yml 产出；0.1.7 声明进组合树的声明文件；`packaging.json` files 已列） |
| `tests/` | **开发期回归**（不进交付包，见下） |

## 装机与更新（0.1.7 声明式预设机制）

- **权威装机**：`dsh plugin --profile web add link:<包目录>`——插件机制是唯一方式。包内 `presets/agent-preset.patch.yml` 在 DSH 启动时把 preset-orchestrator2 声明进组合树；`~/.dsh/.agent-presets` 旧目录同步机制已移除。
- **更新后必做（重启前体检）**：`node $env:APPDATA\npm\node_modules\@deepseek-ai\dsh\lib\bin.js web --dump-config`——确认 ① preset-orchestrator2 在组合树在位、② 零死引用、③ profiles\web 注册指向新包，三过才宣告「请重启」。细节与判据见 `docs/使用手册.md` 第一节（事故沉淀：OPS-20260926，见 `04-测试/DSH运维问题记录-2026-09-26.md` 问题 3/4）。

## 默认模型与档位（v2.7.0：默认 + 降级双槽）

| 角色 | 默认路由 | 档位 | 降级路由 | 降级档位 | 声明位置 |
|---|---|---|---|---|---|
| 调度员（主会话） | `kimi-coding/k3` | `max` | —（无自动降级） | — | **仅文档推荐**——新建会话时自选；`preset.yml` 只承载显示文本，**预设层无法声明会话模型** |
| 研究员 `subagent_researcher` | `deepseek-official/deepseek-flash` | `max` | `openai-codex/gpt-5.6-luna` | `xhigh` | `<DSH_HOME>/orchestrator2/model-routes.json`（`ROUTE_INIT` 初始化值） |
| 开发员 `subagent_developer` | `deepseek-official/deepseek-flash` | `max` | `openai-codex/gpt-5.6-luna` | `xhigh` | 同上 → `roles.developer` |
| 审核员 `subagent_reviewer` | `volcengine/glm-5.3` | 未声明（provider 默认） | `openai-codex/gpt-6.1-sol` | 未声明（provider 默认） | 同上 → `roles.reviewer` |

档位口径：研究员与开发员同为 `deepseek-flash` + `max`（2026-09-30 第二项裁决把开发员由 `high` 抬到 `max`）；审核员 `glm-5.3` 与两条降级路由均不声明 `reasoningEffort`（provider 默认值；effort 省略 = 不传该字段，不写字符串 `default`）。v2.7.0 起三个角色的路由不再写死在 `agent.cordis.yml`，而是由 `model-routes.mjs` 每次派工现读：会话内可临时改（仅本会话）、明确说「默认/降级」才持久保存。核验：`node 02-代码/orchestrator2/tests/suites/config-check.mjs`（T3e 读 `ROUTE_INIT` 断言装配）、`node 02-代码/orchestrator2/tests/suites/route-config.test.mjs`（AC1 六条路由）。沿革见 `docs/使用手册.md` 修订记录。

## 开发期回归

**T0 宿主工具注册机制探查结论（形态 A）**：`dispatch.mjs`（M2 派工原子半步）与既有的
`phase-gate.mjs` / `budget.mjs` 同为**预设内本地工具模块** —— `agent.cordis.yml` 里以
相对路径 `./dispatch.mjs` 声明，库加载器（`@deepseek-ai/cordis-plugin-loader`）对以 `.`
开头的 name 走 `tree.import()` 的 `new URL(name, ctx.baseUrl)` 分支（`ctx.baseUrl` =
本预设目录），命中的正是「预设内工具模块」这一形态；`ctx.tools.register()` 直接把插件
对象挂成模型可见工具。**零宿主改动、零新增权限面**，故不需要形态 B（phase-gate CLI 子
命令 + pwsh 调用）降级。降级预案保留在 persona 的 M2 段说明里，供宿主加载机制变更时切换。

```powershell
node 02-代码/orchestrator2/tests/run-all.mjs              # 全量（夹具重建 + 基线采集 + 全部套件）
node 02-代码/orchestrator2/tests/run-all.mjs --no-fixture # 跳过夹具重建
node 02-代码/orchestrator2/tests/run-all.mjs --log        # 另存汇总到 tests/.cache/run-log-*.txt
```

**分级**：断言套件 20 个 = 构建前必跑（`run-all.mjs` 全跑即覆盖；含 T3-TP1 新增 `route-config` / `session-routes` / `role-tools` / `route-fallback` 四件）；`suites/e2e-dryrun.mjs`（`enter_auto_mode` 全路径矩阵干跑）= 按需。

**tests/ 结构**：

| 路径 | 内容 |
|---|---|
| `run-all.mjs` | 总入口：顺序跑全部步骤并打印「逐件 PASS/FAIL + 断言合计」 |
| `suites/` | 16 个断言套件 + T3-TP1 四件（`route-config` / `session-routes` / `role-tools` / `route-fallback`）+ `build-v21-spec.mjs`（规范 v2.0→v2.1 生成器）+ `e2e-dryrun.mjs`（按需干跑） |
| `lib/paths.mjs` | 路径**单一来源**（项目根 / 目标代码区 / 规范 / 模板 / 夹具 / 被测模块 file URL） |
| `lib/test-harness.mjs` | 断言记录器：stdout 明细 + `tests/.cache/results/<套件>.json` 机读结果 |
| `lib/scenario-utils.mjs` | 夹具助手（克隆 `fixture-valid` 并做单点变异） |
| `fixtures/build-fixture.mjs` | 夹具项目树生成器（任务包文档由模板实例化，回环验证） |
| `fixtures/t9-dump-bom.mjs` / `.ps1` | T9 基线数据采集（只读 `git ls-tree -z`；采集侧必须逐字节落盘） |
| `fixtures/t9-data/` | T9 基线件（1.0 全树 blob 清单 + 路径清单 + 工作树哈希 + v2.0 模板件数） |

**可重生成产物（已 gitignore）**：`tests/.cache/`（结果 JSON 与汇总日志）、`tests/fixtures/e2e-fixture-projects/`（夹具项目树，`run-all.mjs` 每次重建）。

**断言口径（可复算）**：每个套件末行 `pass=N fail=M`，同时写 `.cache/results/<套件>.json`；`run-all.mjs` 读 JSON 逐件求和 —— 汇总行的数字是逐件实测相加，不是估计值。

**已知环境约束**：本项目执行环境（DSH 文件沙箱 workspace-write）禁止**子进程经管道回传输出**（实测 `spawnSync(node, [...], {stdio:'pipe'})` → `EPERM`，`inherit` 正常），也禁止 node 进程 spawn git（`EPERM`）。因此：① `run-all.mjs` 用 `stdio:'inherit'` + 结果 JSON 双通道；② 需要 git 的采集（T9 基线）在 pwsh 侧完成（`fixtures/t9-dump-bom.ps1` → 由 `.mjs` 包装调用），套件侧只用 node 内自算的 blob 哈希（口径等价于 `git hash-object`）。

## 版本记录

- **v2.9.0（2026-10-08 · TP1-首次使用引导）**：persona 新增【首次使用引导】小节（三段式：新会话首条消息秒级只读探查 → 有缺项才提示 → 按需授权补齐 → 开工门禁复查；探查零副作用，凭据只查 `configured`），`phase-gate.mjs` validateAutoMode 增开发准备门禁（fail-closed 读 `00-项目管理/开发准备.md` 固定块，无流程类型豁免），新增模板 `spec/templates/00-项目管理/开发准备.md` + 规范 v2.1.4，`t2-persona`/`t-templates`/`phase-gate-mock`/`t-spec-scan`/`v2-mechanisms` 断言同步（套件 529→540/0）；`dispatch`/`budget` 零改动，工具契约与流程语义不变。
- **v2.8.0（2026-10-08 · TP1-对话形态纪律）**：persona 新增【对话形态纪律】小节（人读消息 answer-first / 结尾唯一下一步 / 正文分组 ≤5 / 提问纪律 / 过程消息一行制 + 不采用四项成文 + i-have-adhd 署名行），`t2-persona` 断言同步（套件 524→529/0）；机器层 `dispatch`/`phase-gate`/`budget` 零改动，工具契约与流程语义不变。
- **v2.7.1（2026-10-02 · T3-TP1-修复1）**：两库模块补空 `apply` 空载修复组合树挂载被拒（`invalid plugin` → `never started`）；`config-check` 增本地模块行 `apply` 导出断言防回归。
- **v2.7.0（2026-10-01 · T3-TP1 子代理模型路由与会话覆盖）**：新增四模块 —— `model-routes.mjs`（持久默认/降级路由，`<DSH_HOME>/orchestrator2/model-routes.json`，每次派工现读 + 原子写 + 校验失败显式报错）、`session-routes.mjs`（会话状态 epoch/override/degraded + child 绑定快照 + `resolveEffectiveRoute` 纯函数）、`role-tools.mjs`（三角色自持派工工具同名替换官方行 + set/reset/inspect 设置工具，嵌套 route 规避 invariant）、`route-fallback.mjs`（`agent/request(-error)` 监听，`prepend: true` 独占处置适用失败 → 一次切换降级、终局传播、不吞取消）；`agent.cordis.yml` 删除官方三角色钉模型三行并新增四模块行；`config-check` T3e 重写为「官方行零残留 + 四模块行在位 + 读 `ROUTE_INIT` 的初始化值断言」，`t2-persona` T2-20 锚点迁移，`pkg-consistency` 版本常量族/REF/BOM 夹具同步，`packaging.json` 版本 2.7.0 + 四模块入 files 白名单，run-all 注册四新套件（断言套件 20 个）；README/手册双文档同步。persona 与流程语义不变，`dispatch`/`phase-gate`/`budget` 零改动（AC14）。
- **2026-09-30 用户裁决 · 第二项（版本仍为 v2.6.1）**：开发员 `reasoningEffort` 由 `high` 抬到 `max`（研究员不变＝`max`，审核员维持不声明＝provider 默认）；研究员与开发员现同为 `deepseek-official/deepseek-flash/max`。同步 `agent.cordis.yml`（开发员 agentOptions 行 + 头注释 + delegation 注释块）、`presets/agent-preset.patch.yml`（生成器重生成）、systemPrompt 宣告、config-check T3e、README/手册；persona 与流程语义不变。
- **2026-09-30 用户裁决（版本仍为 v2.6.1）**：审核员移除 `reasoningEffort` 键（保持 `volcengine/glm-5.3`，档位走 provider 默认值）；研究员/开发员不变。同步 `agent.cordis.yml`（审核员 agentOptions 行 + 头注释 + delegation 注释块）、`presets/agent-preset.patch.yml`（生成器重生成）、systemPrompt 宣告、config-check T3e、README/手册；persona 与流程语义不变。
- **2026-09-28 用户裁决 / 引导修复（版本仍为 v2.6.0）**：审核员改钉 `openai-codex/gpt-5.6-luna` + `xhigh`（极高，不是 `max`）；开发员保持 `volcengine/glm-5.3-flash`，移除 `reasoningEffort` 键并使用 provider 默认值；研究员保持 `deepseek-official/deepseek-flash` + `max`。同步 `agent.cordis.yml`、说明、systemPrompt 宣告与 config-check T3e；persona 与流程语义不变。
- **v2.6.0（TP-D2-修复1 · OPS-20260926 会话故障回源）**：agent.cordis.yml 补 workflow-ptc 引擎行（防「waiting for workflowEngine」回退）+【转移表】待构建/待构建更新两行增「更新前体检」句；新增 `tools/gen-preset-patch.mjs` 生成器与源码声明物 `presets/agent-preset.patch.yml`（0.1.7 声明式机制回源）；config-check T3g 引擎-工具配对护栏 + pkg-consistency D9-9/D9-10（patch 死引用 + 声明漂移）两道护栏；README/手册装机口径更正（`.agent-presets` 同步机制已移除、权威装机=`dsh plugin add link`、更新前体检=dump-config）。机器层零改动。
- **v2.6.0（TP-D2 合并测试正式语义）**：D-D4 宿主 0.1.7 适配清偿（agent.cordis.yml 移除 workflow-worker-thread 组件条目整段 + config-check T3a 翻转断言，run-all 复绿）；persona 新增【快速通道与欠账】段（四形态分名分义＋快速通道六要素＋预算口径三句＋待人工测试态纪律三件套）；规范 v2.1.2（经生成器 op：§4.5「快速通道与合并测试」新节＋变更记录 v2.1.2 行）；模板四件新节（02 快速通道授权块〔节首四形态索引句〕／决策记录欠账小节／验收结论核销清单段／台账快速通道记法说明）；【驳回与裁决】增触顶简报第三选项话术（不得默认推荐跳过）＋抬档入账三处条款；套件断言同步（t2-persona/t-templates/t-spec-scan/pkg-consistency）。机器层零改动。
- **v2.5.0（TP-D1 文本层沉淀与 persona 瘦身）**：persona 瘦身重组（零语义丢失，净减 ~2.7KB）；规范 v2.1.1（经生成器 op-A/B/C：§4.1 小包 B 档位 4→6、缺省档 4/6/24、变更记录 v2.1.1 行，示例旧数字有意保留）；预算基线/台账/任务模板 02 档位同步；开发员证据采集口径三义务 + 审核员驳回修复边界默认条款 + 环境事实前置核查（02 模板主/修复包增「环境事实清单」节）；版本 2.5.0 文档同步。机器层零改动。
- **v2.4.1 验收期清偿（TP-C-修复1）**：banner 与规范口径如实化（后台派工+看门狗轮内 tick；M3 三字段=预留不回写、幂等接线另立项）；派工三问裁定补来源约束（答案出自任务包 02 与既有材料，答不出回待修订，**不得为答三问现场读码勘察**）；规范 v2.1 两处句改（行 256/§4 行 291）经生成器同步。机器层零改动。
- v2.4.0（SP-TP-C 运行安全）：派工三问裁定 / 开发员五纪律+心跳 / 审核第 5 项判断题 / 看门狗 / 模板判断式引导；机器层零改动。
