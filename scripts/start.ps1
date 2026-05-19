<#
.SYNOPSIS
codeviz 一键启动 — 装依赖(按需) → 跑端到端 pipeline → 打开浏览器查看。

.DESCRIPTION
默认用 mock provider:免费、5 秒跑完,所有 JSON 落到 reports/m1-out/。
切真实 LLM 时传 -Provider claude-code:复用本机 claude CLI 的订阅认证,无需 ANTHROPIC_API_KEY,产物落 reports/m1-out-claude-code/。
脚本会自动设置 CODETRACE_DATA_DIR 让 vite dev server 读对应目录,不用手动改 vite.config.ts。

.PARAMETER Provider
LLM provider。默认 mock。可选:mock | claude | ollama | claude-code。

.PARAMETER SkipE2e
跳过端到端 pipeline,直接启动 web。当 reports/m1-out-*/ 已有数据时用,节省 30 秒到 5 分钟。

.PARAMETER SkipInstall
跳过 npm install 检查。当确认 cli/web 依赖已装齐时用,节省几秒。

.PARAMETER OpenBrowser
启动 web 后自动打开 http://localhost:5174。

.PARAMETER WebOnly
等同于 -SkipE2e -SkipInstall — 极速看图模式。

.EXAMPLE
.\scripts\start.ps1
默认:mock + 装依赖 + e2e + web dev server。

.EXAMPLE
.\scripts\start.ps1 -Provider claude-code -OpenBrowser
用本机 Claude Code 跑真实 LLM 翻译,跑完自动开浏览器。

.EXAMPLE
.\scripts\start.ps1 -WebOnly
跳过所有 build 步骤直接起 web,看上一次的产物。
#>
[CmdletBinding()]
param(
  [ValidateSet("mock", "claude", "ollama", "claude-code")]
  [string]$Provider = "mock",

  [switch]$SkipE2e,
  [switch]$SkipInstall,
  [switch]$OpenBrowser,
  [switch]$WebOnly
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repoRoot

if ($WebOnly) {
  $SkipE2e = $true
  $SkipInstall = $true
}

function Write-Step($msg) {
  Write-Host ""
  Write-Host "==> $msg" -ForegroundColor Cyan
}

function Test-NodeModules($path) {
  Test-Path (Join-Path $path "node_modules")
}

# ---------- 1) 依赖检查 ----------
if (-not $SkipInstall) {
  Write-Step "依赖检查"
  if (-not (Test-NodeModules "cli")) {
    Write-Host "cli/node_modules 缺失,跑 npm install --prefix cli" -ForegroundColor Yellow
    npm install --prefix cli
    if ($LASTEXITCODE -ne 0) { throw "npm install --prefix cli failed (exit $LASTEXITCODE)" }
  } else {
    Write-Host "cli/node_modules OK"
  }
  if (-not (Test-NodeModules "web")) {
    Write-Host "web/node_modules 缺失,跑 npm install --prefix web" -ForegroundColor Yellow
    npm install --prefix web
    if ($LASTEXITCODE -ne 0) { throw "npm install --prefix web failed (exit $LASTEXITCODE)" }
  } else {
    Write-Host "web/node_modules OK"
  }
}

# ---------- 2) Provider 前置校验 ----------
if (-not $SkipE2e) {
  if ($Provider -eq "claude-code") {
    $claudeCmd = Get-Command claude -ErrorAction SilentlyContinue
    if (-not $claudeCmd) {
      throw "Provider=claude-code 需要 'claude' CLI 在 PATH 上。安装见 https://docs.anthropic.com/en/docs/claude-code,或换 -Provider mock。"
    }
    Write-Host "claude CLI 已就绪:$($claudeCmd.Source)" -ForegroundColor DarkGray
  }
  if ($Provider -eq "claude" -and -not $env:ANTHROPIC_API_KEY) {
    throw "Provider=claude 需要环境变量 ANTHROPIC_API_KEY。设置后重试,或用 -Provider claude-code 复用本机订阅。"
  }
}

# ---------- 3) 数据目录推导(与 cli/src/eval/e2e.ts deriveOutDir 对齐) ----------
$dataDir = if ($Provider -eq "mock") { "reports/m1-out" } else { "reports/m1-out-$Provider" }

# ---------- 4) 端到端 pipeline ----------
if (-not $SkipE2e) {
  Write-Step "运行端到端 pipeline (provider=$Provider, 输出 → $dataDir)"
  if ($Provider -eq "mock") {
    npm run e2e:m1
  } else {
    npm run e2e:m1 -- --provider $Provider
  }
  if ($LASTEXITCODE -ne 0) {
    Write-Host ""
    Write-Host "e2e 退出码非零 ($LASTEXITCODE)。准确率报告在 reports/m1-accuracy.md,可继续启动 web 查看部分产物。" -ForegroundColor Yellow
  }
} else {
  Write-Step "跳过 e2e (--SkipE2e),期望 $dataDir/ 已有数据"
  if (-not (Test-Path (Join-Path $repoRoot $dataDir))) {
    throw "$dataDir 不存在 — 先跑一次不带 -SkipE2e 的脚本,或换正确的 -Provider。"
  }
}

# ---------- 5) 启动 web dev server ----------
Write-Step "启动 web dev server (http://localhost:5174)"
Write-Host "数据源:$dataDir" -ForegroundColor DarkGray
Write-Host "Ctrl+C 退出" -ForegroundColor DarkGray
$env:CODETRACE_DATA_DIR = $dataDir

if ($OpenBrowser) {
  # 给 vite 几秒起来再开浏览器
  Start-Job -Name "codeviz-open-browser" -ScriptBlock {
    Start-Sleep -Seconds 3
    Start-Process "http://localhost:5174"
  } | Out-Null
}

# 阻塞:dev server 跑在前台,用户 Ctrl+C 退出
npm run web:dev
