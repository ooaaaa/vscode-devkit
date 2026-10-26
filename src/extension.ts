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

  // 重命名前读取上游信息，branch -m 会把配置迁移到新分支名下
  const remote = await readGitConfig(`branch.${oldName}.remote`, cwd);
  const mergeRef = await readGitConfig(`branch.${oldName}.merge`, cwd);

  try {
    await git(['branch', '-m', oldName, target], cwd);
  } catch (e) {
    vscode.window.showErrorMessage(`重命名失败: ${(e as Error).message}`);
    return;
  }
  refreshBranch();

  if (!remote || !mergeRef) {
    vscode.window.showInformationMessage(`已将本地分支 ${oldName} 重命名为 ${target}（无远程上游）`);
    return;
  }

  const remoteOld = mergeRef.replace(/^refs\/heads\//, '');
  const action = await vscode.window.showWarningMessage(
    `本地分支已重命名为 ${target}。是否推送到 ${remote} 并删除远程旧分支 ${remoteOld}？`,
    { modal: true, detail: '删除远程旧分支后，基于该分支的 PR/MR 可能会被关闭。' },
    '同步远程'
  );
  if (action !== '同步远程') {
    vscode.window.showInformationMessage(`已重命名本地分支，远程分支 ${remote}/${remoteOld} 未改动`);
    return;
  }

  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: '同步远程分支' },
    async (progress) => {
      try {
        progress.report({ message: `推送 ${target}` });
        await git(['push', '-u', remote, target], cwd);
      } catch (e) {
        vscode.window.showErrorMessage(`推送新分支失败: ${(e as Error).message}`);
        return;
      }
      try {
        progress.report({ message: `删除远程 ${remoteOld}` });
        await git(['push', remote, '--delete', remoteOld], cwd);
      } catch (e) {
        vscode.window.showErrorMessage(`新分支已推送，删除远程旧分支失败: ${(e as Error).message}`);
        return;
      }
      vscode.window.showInformationMessage(`远程分支已从 ${remoteOld} 重命名为 ${target}`);
    }
  );
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
  statusBarItem.text = '$(copy) 复制分支名';
  statusBarItem.show();

  const renameCmd = vscode.commands.registerCommand('renameBranch.rename', renameBranch);

  renameBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 9998);
  renameBarItem.command = 'renameBranch.rename';
  renameBarItem.tooltip = '重命名当前分支';
  renameBarItem.text = '$(edit)';
  renameBarItem.show();

  context.subscriptions.push(copyCmd, statusBarItem, renameCmd, renameBarItem);

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
      statusBarItem.text = '$(copy) 复制分支名';
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
