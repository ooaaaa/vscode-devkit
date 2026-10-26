import * as vscode from 'vscode';
import { exec, execFile } from 'child_process';

let statusBarItem: vscode.StatusBarItem;
let renameBarItem: vscode.StatusBarItem;
let currentBranch = '';

// 使用参数数组调用 git，避免用户输入的分支名被 shell 解析
function git(args: string[], cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('git', args, { cwd }, (err, stdout, stderr) => {
      if (err) {
        reject(new Error(stderr.trim() || err.message));
        return;
      }
      resolve(stdout.trim());
    });
  });
}

async function readGitConfig(key: string, cwd: string): Promise<string | undefined> {
  try {
    return await git(['config', '--get', key], cwd);
  } catch {
    return undefined;
  }
}

async function renameBranch() {
  const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!cwd || !currentBranch) {
    vscode.window.showWarningMessage('未检测到 Git 分支');
    return;
  }
  const oldName = currentBranch;

  const newName = await vscode.window.showInputBox({
    title: '重命名当前分支',
    value: oldName,
    prompt: `当前分支: ${oldName}`,
    validateInput: async (value) => {
      const name = value.trim();
      if (!name) return '分支名不能为空';
      if (name === oldName) return '新分支名与当前分支名相同';
      try {
        await git(['check-ref-format', '--branch', name], cwd);
        return undefined;
      } catch {
        return '分支名不合法';
      }
    },
  });
  if (!newName) return;
  const target = newName.trim();

  const hasUpstream = await readGitConfig(`branch.${oldName}.remote`, cwd);

  try {
    await git(['branch', '-m', oldName, target], cwd);
  } catch (e) {
    vscode.window.showErrorMessage(`重命名失败: ${(e as Error).message}`);
    return;
  }
  refreshBranch();

  if (!hasUpstream) return;
  // branch -m 会让新分支继续跟踪远程旧分支，解除后 VS Code 内置 Git 会显示「发布分支」
  try {
    await git(['branch', '--unset-upstream', target], cwd);
  } catch (e) {
    vscode.window.showErrorMessage(`解除远程旧分支跟踪失败: ${(e as Error).message}`);
  }
}

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

  const renameCmd = vscode.commands.registerCommand('renameBranch.rename', renameBranch);

  // 用小数优先级紧贴复制按钮，避免其他插件（如 Git Graph）插到中间
  renameBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 9998.999);
  renameBarItem.command = 'renameBranch.rename';
  renameBarItem.tooltip = '重命名当前分支';
  renameBarItem.text = '$(edit)';
  renameBarItem.show();

  context.subscriptions.push(copyCmd, statusBarItem, renameCmd, renameBarItem);

  // 供 scripts/reinstall.sh 安装后通过 vscode://zhiyuan.vscode-devkit/reload 重载窗口
  context.subscriptions.push(
    vscode.window.registerUriHandler({
      handleUri(uri) {
        if (uri.path === '/reload') {
          vscode.commands.executeCommand('workbench.action.reloadWindow');
        }
      },
    })
  );

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
      renameBarItem.show();
    } else {
      hideBranchItem();
    }
  });
}

function hideBranchItem() {
  currentBranch = '';
  statusBarItem.hide();
  renameBarItem.hide();
}

export function deactivate() {}
