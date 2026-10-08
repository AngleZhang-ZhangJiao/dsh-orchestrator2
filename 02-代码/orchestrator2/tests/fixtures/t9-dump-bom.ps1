# T9 数据采集（只读 git 命令；不含 index 写操作）
# 用法：任意目录下执行 —— & <tests>\fixtures\t9-dump-bom.ps1（脚本自定位输出目录）
#
# 收编时的两点修复（M6）：
#   F-1  基线清单改用 `git ls-tree -z`（NUL 分隔 + 原样 UTF-8 路径），消费侧
#        （t9-verify.mjs）不再需要还原「git quotepath 八进制转义 / 双引号」的启发式代码。
#        采集侧必须**逐字节**落盘：PowerShell 的字符串管道会丢 NUL、`>` 重定向会写成
#        UTF-16 —— 故统一走 `cmd /c ... > file`（cmd 直接把子进程 stdout 写文件，
#        PowerShell 不参与编码）。
#   S-4  v2.0 模板基线件数由 git 动态取数（原为 t-templates.mjs 内的硬编码常数 23），
#        落 templates-v20.txt 供套件读取 —— 基线变更不再依赖人工同步常数。
#
# 本文件带 UTF-8 BOM：PowerShell 5.1 依据 BOM 正确解码中文路径（无 BOM 会按 cp936 乱码）。
$ErrorActionPreference = 'Stop'
$BASE = '9ac16b8'
$OUT = Join-Path $PSScriptRoot 't9-data'
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)

if (!(Test-Path $OUT)) { New-Item -ItemType Directory -Path $OUT | Out-Null }

# 1) baseline blob 清单：1.0 全树 + budget.mjs（NUL 分隔，逐字节落盘）
$baselinePath = Join-Path $OUT 'baseline.txt'
$tmpPath = Join-Path $OUT '_baseline.part'
$parts = @()
$i = 0
foreach ($p in @('02-代码/orchestrator/', '02-代码/orchestrator2/budget.mjs')) {
  $i++
  $part = "$tmpPath$i"
  cmd /c "git -c core.quotepath=false ls-tree -r -z $BASE -- `"$p`" > `"$part`""
  if ($LASTEXITCODE -ne 0) { throw "git ls-tree 失败（$p）" }
  $parts += $part
}
foreach ($c in (Get-ChildItem '02-代码' -Directory -ErrorAction SilentlyContinue | Where-Object { $_.Name -like 'codex*' })) {
  $i++
  $part = "$tmpPath$i"
  cmd /c "git -c core.quotepath=false ls-tree -r -z $BASE -- `"02-代码/$($c.Name)/`" > `"$part`""
  if ($LASTEXITCODE -ne 0) { throw "git ls-tree 失败（codex $($c.Name)）" }
  $parts += $part
}
$ms = New-Object System.IO.MemoryStream
foreach ($part in $parts) {
  $bytes = [System.IO.File]::ReadAllBytes($part)
  $ms.Write($bytes, 0, $bytes.Length)
}
[System.IO.File]::WriteAllBytes($baselinePath, $ms.ToArray())
$ms.Dispose()
foreach ($part in $parts) { Remove-Item $part -Force }
if ((Get-Item $baselinePath).Length -eq 0) { throw 'baseline 采集为空（git ls-tree 无输出）' }

# 1b) 有记录基线更新（TP-B-修复1 / D2 · 2026-09-16）：宿主 0.1.5 把 persona 行配置键
#     text: 更名为 prefix:（breaking），02-代码/orchestrator/agent.cordis.yml 被**有意修改**
#     （去乱码保适配，用户已授权扩范围）。基线该件 blob 钉为下值；工作区现值与钉住值
#     不符即抛错（防「基线自动跟随」削弱门禁——再改须走新裁定并更新记录，见
#     t9-data/baseline-note-20260916.md）。无新裁定不得删除本段。
$INTENTIONAL_BASELINE = @{
  '02-代码/orchestrator/agent.cordis.yml' = 'b3d92088cd15e0ca89b3a9da68389b61a0583d98'
}
foreach ($kv in $INTENTIONAL_BASELINE.GetEnumerator()) {
  $actual = ((cmd /c "git hash-object -- `"$($kv.Key)`"") | Select-Object -First 1).Trim()
  if ($actual -ne $kv.Value) {
    throw "有记录基线更新冲突：$($kv.Key) 工作树 blob=$actual，与钉住基线 $($kv.Value) 不符——须先更新 baseline-note 与钉住值（新裁定）"
  }
  $raw = [System.Text.Encoding]::UTF8.GetString([System.IO.File]::ReadAllBytes($baselinePath))
  $escaped = [regex]::Escape($kv.Key)
  $m = [regex]::Match($raw, "100644 blob ([0-9a-f]{40})\t$escaped")
  if (-not $m.Success) { throw "有记录基线更新失败：baseline 中未找到 $($kv.Key) 记录" }
  $updated = $raw.Substring(0, $m.Groups[1].Index) + $kv.Value + $raw.Substring($m.Groups[1].Index + 40)
  [System.IO.File]::WriteAllBytes($baselinePath, $utf8NoBom.GetBytes($updated))
  Write-Host "intentional baseline update: $($kv.Key) -> $($kv.Value)"
}

# 2) 从 baseline 提取相对路径清单（NUL 分隔）
$raw = [System.Text.Encoding]::UTF8.GetString([System.IO.File]::ReadAllBytes($baselinePath))
$records = @($raw -split "`0" | Where-Object { $_ -ne '' })
$rel = @()
foreach ($rec in $records) {
  if ($rec -match '^\d+\s+\w+\s+[0-9a-f]{40}\t(.+)$') { $rel += $Matches[1] }
}
if ($rel.Count -ne $records.Count) { throw "baseline 记录口径不一致：$($records.Count) 条记录中仅 $($rel.Count) 条可解析" }
[System.IO.File]::WriteAllLines((Join-Path $OUT 'relpaths.txt'), $rel, $utf8NoBom)

# 3) 工作树 blob 哈希（逐件显式路径，git hash-object 只读）
$hashLines = @()
foreach ($p in $rel) {
  $h = (git hash-object -- $p)
  $hashLines += "$h`t$p"
}
[System.IO.File]::WriteAllLines((Join-Path $OUT 'worktree-hashes.txt'), $hashLines, $utf8NoBom)

# 4) S-4：v2.0 模板基线件数（git 动态取数，非硬编码）
$tplOut = Join-Path $OUT 'templates-v20.txt'
cmd /c "git -c core.quotepath=false ls-tree -r -z --name-only $BASE -- `"02-代码/orchestrator2/spec/templates`" > `"$tplOut`""
if ($LASTEXITCODE -ne 0) { throw 'git ls-tree 失败（templates 计数）' }
$tplRaw = [System.Text.Encoding]::UTF8.GetString([System.IO.File]::ReadAllBytes($tplOut))
$tplCount = @($tplRaw -split "`0" | Where-Object { $_ -ne '' }).Count
if ($tplCount -le 0) { throw "模板基线件数取数失败：$tplCount" }
[System.IO.File]::WriteAllText($tplOut, "$tplCount`n", $utf8NoBom)

Write-Host "baseline entries: $($rel.Count)"
Write-Host "v2.0 template baseline count: $tplCount"
Get-ChildItem $OUT | Select-Object Name, Length | Format-Table -AutoSize
