#!/usr/bin/env bash
# codeviz 一键启动 — POSIX 版本(Linux / macOS / WSL / git-bash)。
# Windows PowerShell 用户请用 scripts/start.ps1(参数语义一致)。
#
# 用法:
#   ./scripts/start.sh                        # mock provider, 装依赖 + e2e + web
#   ./scripts/start.sh --provider claude-code # 真实 LLM(本机 claude CLI)
#   ./scripts/start.sh --skip-e2e             # 跳 e2e,直接看 reports/m1-out*/ 已有数据
#   ./scripts/start.sh --web-only             # 极速:跳 install + e2e
#   ./scripts/start.sh --open                 # 启动后自动开浏览器
set -euo pipefail

PROVIDER="mock"
SKIP_E2E=0
SKIP_INSTALL=0
OPEN_BROWSER=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --provider) PROVIDER="$2"; shift 2 ;;
    --provider=*) PROVIDER="${1#--provider=}"; shift ;;
    --skip-e2e) SKIP_E2E=1; shift ;;
    --skip-install) SKIP_INSTALL=1; shift ;;
    --open) OPEN_BROWSER=1; shift ;;
    --web-only) SKIP_E2E=1; SKIP_INSTALL=1; shift ;;
    -h|--help)
      sed -n '2,11p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *) echo "unknown flag: $1" >&2; exit 2 ;;
  esac
done

case "$PROVIDER" in
  mock|claude|ollama|claude-code) ;;
  *) echo "unsupported --provider: $PROVIDER (use mock|claude|ollama|claude-code)" >&2; exit 2 ;;
esac

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

step() { printf '\n==> %s\n' "$*"; }

if [[ $SKIP_INSTALL -eq 0 ]]; then
  step "依赖检查"
  if [[ ! -d cli/node_modules ]]; then
    echo "cli/node_modules 缺失,跑 npm install --prefix cli"
    npm install --prefix cli
  else
    echo "cli/node_modules OK"
  fi
  if [[ ! -d web/node_modules ]]; then
    echo "web/node_modules 缺失,跑 npm install --prefix web"
    npm install --prefix web
  else
    echo "web/node_modules OK"
  fi
fi

if [[ $SKIP_E2E -eq 0 ]]; then
  if [[ "$PROVIDER" == "claude-code" ]] && ! command -v claude >/dev/null 2>&1; then
    echo "Provider=claude-code 需要 'claude' CLI 在 PATH 上,或换 --provider mock。" >&2
    exit 1
  fi
  if [[ "$PROVIDER" == "claude" && -z "${ANTHROPIC_API_KEY:-}" ]]; then
    echo "Provider=claude 需要环境变量 ANTHROPIC_API_KEY,或换 --provider claude-code。" >&2
    exit 1
  fi
fi

if [[ "$PROVIDER" == "mock" ]]; then
  DATA_DIR="reports/m1-out"
else
  DATA_DIR="reports/m1-out-$PROVIDER"
fi

if [[ $SKIP_E2E -eq 0 ]]; then
  step "运行端到端 pipeline (provider=$PROVIDER, 输出 → $DATA_DIR)"
  if [[ "$PROVIDER" == "mock" ]]; then
    npm run e2e:m1 || echo "e2e 退出码非零,准确率报告在 reports/m1-accuracy.md,继续启动 web"
  else
    npm run e2e:m1 -- --provider "$PROVIDER" || echo "e2e 退出码非零,准确率报告在 reports/m1-accuracy.md,继续启动 web"
  fi
else
  step "跳过 e2e (--skip-e2e),期望 $DATA_DIR/ 已有数据"
  if [[ ! -d "$DATA_DIR" ]]; then
    echo "$DATA_DIR 不存在 — 先跑一次不带 --skip-e2e 的脚本,或换正确的 --provider。" >&2
    exit 1
  fi
fi

step "启动 web dev server (http://localhost:5174)"
echo "数据源:$DATA_DIR"
echo "Ctrl+C 退出"
export CODETRACE_DATA_DIR="$DATA_DIR"

if [[ $OPEN_BROWSER -eq 1 ]]; then
  ( sleep 3 && (command -v xdg-open >/dev/null && xdg-open http://localhost:5174 || \
                command -v open >/dev/null && open http://localhost:5174 || \
                echo "未找到 xdg-open/open,请手动打开 http://localhost:5174") ) &
fi

exec npm run web:dev
