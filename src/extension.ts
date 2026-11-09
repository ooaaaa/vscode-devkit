import * as vscode from 'vscode';
import * as path from 'path';
import type { GitAPI, GitExtension, Repository } from './git';

let statusBarItem: vscode.StatusBarItem;
// 当前选中的仓库：跟随活动编辑器所在仓库
let activeRepo: Repository | undefined;
let repoStateListener: vscode.Disposable | undefined;

export async function activate(context: vscode.ExtensionContext) {
  console.log('[vscode-devkit] 插件已激活');

  // 注册复制命令
  const copyCmd = vscode.commands.registerCommand('copyBranchName.copy', async () => {
    const branch = activeRepo?.state.HEAD?.name;
    if (branch) {
      await vscode.env.clipboard.writeText(branch);
      vscode.window.showInformationMessage(`已复制分支名: ${branch}`);
    } else {
      vscode.window.showWarningMessage('未检测到 Git 分支');
    }
  });

  // 创建状态栏按钮，放在 VS Code 内置 git 分支项的右侧
  // VS Code 内置 git 分支的优先级是 10000，这里用 9999 紧跟其后
  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 9999);
  statusBarItem.command = 'copyBranchName.copy';
  statusBarItem.text = '$(copy)';

  context.subscriptions.push(copyCmd, statusBarItem, {
    dispose: () => repoStateListener?.dispose(),
  });

  const git = await getGitAPI();

  // 仓库增减、活动编辑器切换时重新确定当前仓库
  context.subscriptions.push(
    git.onDidOpenRepository(() => selectRepository(git)),
    git.onDidCloseRepository(() => selectRepository(git)),
    vscode.window.onDidChangeActiveTextEditor(() => selectRepository(git))
  );

  selectRepository(git);
}

async function getGitAPI(): Promise<GitAPI> {
  const ext = vscode.extensions.getExtension<GitExtension>('vscode.git');
  if (!ext) {
    throw new Error('未找到内置 Git 扩展 vscode.git');
  }
  const exports = ext.isActive ? ext.exports : await ext.activate();
  return exports.getAPI(1);
}

function isSameRepo(a: Repository, b: Repository): boolean {
  return a.rootUri.toString() === b.rootUri.toString();
}

function selectRepository(git: GitAPI) {
  const uri = vscode.window.activeTextEditor?.document.uri;
  const editorRepo = uri ? git.getRepository(uri) : null;
  // git API 每次返回新的包装对象，需按 rootUri 比较
  const current = activeRepo && git.repositories.find((r) => isSameRepo(r, activeRepo!));
  // 活动编辑器不属于任何仓库时保持当前仓库，尚未选中过则取第一个
  const next = editorRepo ?? current ?? git.repositories[0];

  if (!(next && activeRepo && isSameRepo(next, activeRepo))) {
    repoStateListener?.dispose();
    repoStateListener = next?.state.onDidChange(render);
  }
  activeRepo = next;
  render();
}

function render() {
  const branch = activeRepo?.state.HEAD?.name;
  if (!activeRepo || !branch) {
    statusBarItem.hide();
    return;
  }
  statusBarItem.tooltip = `点击复制 ${path.basename(activeRepo.rootUri.fsPath)} 的分支名: ${branch}`;
  statusBarItem.show();
}

export function deactivate() {}
