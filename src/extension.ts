import * as vscode from 'vscode';
import * as path from 'path';
import type { GitAPI, GitExtension, Repository } from './git';

let statusBarItem: vscode.StatusBarItem;
// 当前仓库：以源代码管理视图中最后切换到的仓库为准
let activeRepo: Repository | undefined;
let activeRepoStateListener: vscode.Disposable | undefined;
// 每个仓库的选中状态监听，key 为 rootUri
const repoUiListeners = new Map<string, vscode.Disposable>();

export async function activate(context: vscode.ExtensionContext) {
  console.log('[vscode-devkit] 插件已激活');

  // 注册复制命令，成功时只在状态栏短暂提示，不弹通知
  const copyCmd = vscode.commands.registerCommand('copyBranchName.copy', async () => {
    const branch = activeRepo?.state.HEAD?.name;
    if (activeRepo && branch) {
      await vscode.env.clipboard.writeText(branch);
      vscode.window.setStatusBarMessage(`$(check) 已复制 ${repoName(activeRepo)} 分支名: ${branch}`, 2000);
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
    dispose: () => {
      activeRepoStateListener?.dispose();
      repoUiListeners.forEach((d) => d.dispose());
      repoUiListeners.clear();
    },
  });

  const git = await getGitAPI();
  git.repositories.forEach(watchRepository);

  context.subscriptions.push(
    git.onDidOpenRepository((repo) => onRepositoryOpened(git, repo)),
    git.onDidCloseRepository((repo) => onRepositoryClosed(git, repo))
  );

  setActiveRepo(initialRepository(git));
}

async function getGitAPI(): Promise<GitAPI> {
  const ext = vscode.extensions.getExtension<GitExtension>('vscode.git');
  if (!ext) {
    throw new Error('未找到内置 Git 扩展 vscode.git');
  }
  const exports = ext.isActive ? ext.exports : await ext.activate();
  return exports.getAPI(1);
}

// git API 每次返回新的包装对象，需按 rootUri 比较
function isSameRepo(a: Repository, b: Repository): boolean {
  return a.rootUri.toString() === b.rootUri.toString();
}

function repoName(repo: Repository): string {
  return path.basename(repo.rootUri.fsPath);
}

// 尚未在源代码管理视图中切换过仓库时：活动编辑器所在仓库，否则第一个仓库
function initialRepository(git: GitAPI): Repository | undefined {
  const selected = git.repositories.find((r) => r.ui.selected);
  if (selected) {
    return selected;
  }
  const uri = vscode.window.activeTextEditor?.document.uri;
  return (uri && git.getRepository(uri)) ?? git.repositories[0];
}

// 源代码管理视图中切换到某个仓库时，以切换结果为准
function watchRepository(repo: Repository) {
  const key = repo.rootUri.toString();
  repoUiListeners.get(key)?.dispose();
  repoUiListeners.set(
    key,
    repo.ui.onDidChange(() => {
      if (repo.ui.selected) {
        setActiveRepo(repo);
      }
    })
  );
}

// 启动时仓库陆续打开，打开过程中按初始规则重新确定
function onRepositoryOpened(git: GitAPI, repo: Repository) {
  watchRepository(repo);
  if (!activeRepo || !activeRepo.ui.selected) {
    setActiveRepo(initialRepository(git));
  }
}

function onRepositoryClosed(git: GitAPI, repo: Repository) {
  const key = repo.rootUri.toString();
  repoUiListeners.get(key)?.dispose();
  repoUiListeners.delete(key);
  if (activeRepo && isSameRepo(activeRepo, repo)) {
    setActiveRepo(git.repositories.find((r) => !isSameRepo(r, repo)));
  }
}

function setActiveRepo(repo: Repository | undefined) {
  if (repo && activeRepo && isSameRepo(repo, activeRepo)) {
    return;
  }
  activeRepoStateListener?.dispose();
  activeRepo = repo;
  activeRepoStateListener = repo?.state.onDidChange(render);
  render();
}

function render() {
  const branch = activeRepo?.state.HEAD?.name;
  if (!activeRepo || !branch) {
    statusBarItem.hide();
    return;
  }
  statusBarItem.tooltip = `点击复制 ${repoName(activeRepo)} 的分支名: ${branch}`;
  statusBarItem.show();
}

export function deactivate() {}
