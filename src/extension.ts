import * as vscode from 'vscode';
import * as path from 'path';
import type { GitAPI, GitExtension, Repository } from './git';

let statusBarItem: vscode.StatusBarItem;
// 当前仓库：与内置状态栏一致，取「活动编辑器所在仓库」与「SCM 面板聚焦仓库」中最后变化的那个
let activeRepo: Repository | undefined;
let activeRepoStateListener: vscode.Disposable | undefined;
// 每个仓库的 SCM 面板聚焦监听，key 为 rootUri
const repoUiListeners = new Map<string, vscode.Disposable>();
// 上一次活动编辑器的资源，用于过滤与切换编辑器无关的 tab 事件
let lastEditorUri: string | undefined;

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
    git.onDidCloseRepository((repo) => onRepositoryClosed(git, repo)),
    vscode.window.tabGroups.onDidChangeTabs(() => onActiveEditorChanged(git)),
    vscode.window.tabGroups.onDidChangeTabGroups(() => onActiveEditorChanged(git))
  );

  const editorUri = activeEditorUri();
  lastEditorUri = editorUri?.toString();
  setActiveRepo(
    (editorUri && git.getRepository(editorUri)) ??
      git.repositories.find((r) => r.ui.selected) ??
      git.repositories[0]
  );
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

// 取活动 tab 的资源，覆盖文本、diff、自定义编辑器和 notebook
function activeEditorUri(): vscode.Uri | undefined {
  const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
  if (
    input instanceof vscode.TabInputText ||
    input instanceof vscode.TabInputCustom ||
    input instanceof vscode.TabInputNotebook
  ) {
    return input.uri;
  }
  if (input instanceof vscode.TabInputTextDiff || input instanceof vscode.TabInputNotebookDiff) {
    return input.modified;
  }
  return undefined;
}

// SCM 面板聚焦某个仓库时切换过去
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

function onRepositoryOpened(git: GitAPI, repo: Repository) {
  watchRepository(repo);
  // 启动时仓库是陆续打开的，活动编辑器所在仓库打开后需要切换过去
  const uri = activeEditorUri();
  const editorRepo = uri ? git.getRepository(uri) : null;
  if (!activeRepo || (editorRepo && isSameRepo(editorRepo, repo))) {
    setActiveRepo(repo);
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

// 活动编辑器切换时，若其资源属于某个仓库则切换过去；不属于任何仓库时保持不变
function onActiveEditorChanged(git: GitAPI) {
  const uri = activeEditorUri();
  const key = uri?.toString();
  if (key === lastEditorUri) {
    return;
  }
  lastEditorUri = key;
  const repo = uri ? git.getRepository(uri) : null;
  if (repo) {
    setActiveRepo(repo);
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
  statusBarItem.tooltip = `点击复制 ${path.basename(activeRepo.rootUri.fsPath)} 的分支名: ${branch}`;
  statusBarItem.show();
}

export function deactivate() {}
