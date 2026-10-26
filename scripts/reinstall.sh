#!/usr/bin/env bash
# 编译、打包并强制覆盖安装到本机 VS Code
set -euo pipefail

cd "$(dirname "$0")/.."

for cmd in node pnpm code; do
  command -v "$cmd" >/dev/null 2>&1 || { echo "缺少命令: $cmd" >&2; exit 1; }
done

name=$(node -p "require('./package.json').name")
publisher=$(node -p "require('./package.json').publisher")
version=$(node -p "require('./package.json').version")
vsix="${name}-${version}.vsix"

echo "==> 打包 ${vsix}"
# vscode:prepublish 会先执行 compile；未配置 repository 字段时 vsce 会交互询问，这里显式跳过
pnpm exec vsce package --no-dependencies --allow-missing-repository --out "$vsix"

echo "==> 安装 ${publisher}.${name}@${version}"
# 版本号未变时必须加 --force 才会覆盖旧安装
code --install-extension "$vsix" --force

echo "==> 完成。在 VS Code 中执行 Developer: Reload Window（Cmd+Shift+P）使新版本生效"
