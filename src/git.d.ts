// 内置 vscode.git 扩展 API 的最小类型子集，仅声明本插件用到的成员
// 完整定义见 https://github.com/microsoft/vscode/blob/main/extensions/git/src/api/git.d.ts
import type { Event, Uri } from 'vscode';

export interface Branch {
  readonly name?: string;
}

export interface RepositoryState {
  readonly HEAD: Branch | undefined;
  readonly onDidChange: Event<void>;
}

export interface Repository {
  readonly rootUri: Uri;
  readonly state: RepositoryState;
}

export interface GitAPI {
  readonly repositories: Repository[];
  readonly onDidOpenRepository: Event<Repository>;
  readonly onDidCloseRepository: Event<Repository>;
  getRepository(uri: Uri): Repository | null;
}

export interface GitExtension {
  getAPI(version: 1): GitAPI;
}
