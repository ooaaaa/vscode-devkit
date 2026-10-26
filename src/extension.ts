import * as vscode from 'vscode';
import { exec } from 'child_process';

let statusBarItem: vscode.StatusBarItem;
let currentBranch = '';

export function activate(context: vscode.ExtensionContext) {
  console.log('[vscode-devkit] 插件已激活');

  // 注册复制命令
  const copyCmd = vscode.commands.registerCommand('copyBranchName.copy', async () => {
    if (currentBranch) {
      await vscode.env.clipboard.writeText(currentBranch);
      vscode.window.showInformationMessage(`已复制分支名: ${currentBranch}`);
    } else {
      vscode.window.showWarningMessage('未检测到 Git 分支');
    }
  });

  // 创建状态栏按钮，放在 VS Code 内置 git 分支项的右侧
  // VS Code 内置 git 分支的优先级是 10000，这里用 9999 紧跟其后
  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 9999);
  statusBarItem.command = 'copyBranchName.copy';
  statusBarItem.tooltip = '点击复制当前分支名';
  // 先立即显示，不等 git 结果
  statusBarItem.text = '$(copy)';
  statusBarItem.show();

  context.subscriptions.push(copyCmd, statusBarItem);

  // 初始刷新 + 监听工作区变化
  refreshBranch();

  // 每当活动编辑器切换或文件保存时刷新（覆盖分支切换场景）
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(() => refreshBranch()),
    vscode.workspace.onDidSaveTextDocument(() => refreshBranch())
  );

  // 定时轮询兜底（3 秒），确保切换分支后及时更新
  const interval = setInterval(refreshBranch, 3000);
  context.subscriptions.push({ dispose: () => clearInterval(interval) });
}

function refreshBranch() {
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!workspaceFolder) {
    hideBranchItem();
    return;
  }

  exec('git rev-parse --abbrev-ref HEAD', { cwd: workspaceFolder }, (err, stdout) => {
    if (err) {
      hideBranchItem();
      return;
    }
    const branch = stdout.trim();
    if (branch && branch !== 'HEAD') {
      currentBranch = branch;
      statusBarItem.text = '$(copy)';
      statusBarItem.show();
    } else {
      hideBranchItem();
    }
  });
}

function hideBranchItem() {
  currentBranch = '';
  statusBarItem.hide();
}

export function deactivate() {}
