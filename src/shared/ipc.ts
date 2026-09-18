/** Tauri command / event 通道常量，前后端共用命名。 */
export const IPC = {
  // commands
  locateOmp: "locate_omp",
  getHealth: "get_health",
  getModels: "get_models",
  refreshModels: "refresh_models",
  getOverlay: "get_overlay",
  listProjects: "list_projects",
  addProject: "add_project",
  removeProject: "remove_project",
  relocateProject: "relocate_project",
  listSessions: "list_sessions",
  listArchivedSessions: "list_archived_sessions",
  archiveSessions: "archive_sessions",
  unarchiveSessions: "unarchive_sessions",
  deleteSessions: "delete_sessions",
  getGitInfo: "get_git_info",
  setOmpPath: "set_omp_path",
  // 工作区（V11 左栏树）：项目 → 主目录 + git worktree
  listWorkspaces: "list_workspaces",
  createWorktree: "create_worktree",
  // 工作区「提交并推送」（V14）：omp commit 的壳侧封装（两段式：提交 → 推送）
  getWorkspaceGitState: "get_workspace_git_state",
  startCommitPush: "start_commit_push",
  pushCommits: "push_commits",
  cancelCommitPush: "cancel_commit_push",
  // 终端 PTY（V11）：per-终端 omp TUI 进程
  ptySpawn: "pty_spawn",
  ptyWrite: "pty_write",
  ptyResize: "pty_resize",
  ptyKill: "pty_kill",
  // 供应商（设置 › 供应商）：login / logout / modelRoles
  listProviders: "list_providers",
  getProviderLogin: "get_provider_login",
  startProviderLogin: "start_provider_login",
  providerLoginInput: "provider_login_input",
  cancelProviderLogin: "cancel_provider_login",
  logoutProvider: "logout_provider",
  getModelRoles: "get_model_roles",
  setModelRole: "set_model_role",
  // 快速切换环（设置 › 模型）：Ctrl+P 轮换序 cycleOrder（array 键，整组覆盖写）
  getCycleOrder: "get_cycle_order",
  setCycleOrder: "set_cycle_order",
  // 失败转移链（设置 › 模型）：retry.fallbackChains 的读写与两个配套开关
  getFallbackChains: "get_fallback_chains",
  setFallbackChain: "set_fallback_chain",
  setRetryOptions: "set_retry_options",
  // 记忆（设置 › 记忆）：omp 项目记忆的列表 / 查看 / 删除
  listMemories: "list_memories",
  readMemoryFile: "read_memory_file",
  deleteMemoryFile: "delete_memory_file",
  deleteMemoryProject: "delete_memory_project",
  // 使用统计（设置 › 使用统计）：会话 jsonl 里 usage 的聚合（只读）
  getUsageStats: "get_usage_stats",
  // 供应商用量（设置 › 供应商用量）：`omp usage --json` 的各供应商滚动窗口（只读）
  getProviderUsage: "get_provider_usage",
  // omp 常用设置（设置 › 通用）：白名单键的批量读 / 单键写 / 恢复默认（写 omp 全局配置）
  getOmpSettings: "get_omp_settings",
  setOmpSetting: "set_omp_setting",
  resetOmpSetting: "reset_omp_setting",
  // 自定义模型（设置 › 供应商）：omp `models.yml` 的读写——上游没有 CLI 写入口，写文件是唯一路径
  readModelsConfig: "read_models_config",
  writeModelsConfig: "write_models_config",
  // events
  /** 供应商登录进度（payload = 全量 ProviderLoginStatus 快照）。 */
  providerLogin: "omp-provider://login",
} as const;
