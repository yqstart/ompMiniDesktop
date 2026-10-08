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
 setOmpPath: "set_omp_path",
 // 工作区（V21）：多项目容器（左栏顶层单元）
 listWorkspaces: "list_workspaces",
 createWorkspace: "create_workspace",
 updateWorkspace: "update_workspace",
 deleteWorkspace: "delete_workspace",
 // 左栏拖拽（V26）：项目排序 + 拖进 / 拖出工作区（归属与全局顺序一次写完）
 moveProject: "move_project",
 // 目录行（V21 前叫「工作区行」）：项目 → 主目录 + git worktree（只读展示）
 listCheckouts: "list_checkouts",
 // 引用工作区文件（V22）：工作区成员项目的文件列表（git ls-files；只读）
 listProjectFiles: "list_project_files",
 // 工作区提交 / 推送（V19）：默认壳侧快路径（一次 omp -p 生成 + git commit/push），
 // 另有一条可选的完整轨（omp commit，含 CHANGELOG 维护）
 getChangeSet: "get_change_set",
 generateCommitMessage: "generate_commit_message",
 commitSelected: "commit_selected",
 startFullCommit: "start_full_commit",
 pushWorkspace: "push_workspace",
 cancelCommitTask: "cancel_commit_task",
 getWorkspaceGitState: "get_workspace_git_state",
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
 // omp 设置目录（设置 ›「常用设置」）：上游完整目录（文本 + JSON 两路 config list 的合并，只读）
 getOmpSettingsCatalog: "get_omp_settings_catalog",
 // 写一个设置项 / 恢复默认（cwd 钉 agentDir，写 omp 全局配置）
 setOmpSetting: "set_omp_setting",
 resetOmpSetting: "reset_omp_setting",
 // omp 主题列表（「常用设置」深色 / 浅色主题下拉用）：内置注册表 ∪ <agentDir>/themes/*.json（只读）
 listOmpThemes: "list_omp_themes",
 // 自定义模型（设置 › 供应商）：omp `models.yml` 的读写——上游没有 CLI 写入口，写文件是唯一路径
 readModelsConfig: "read_models_config",
 writeModelsConfig: "write_models_config",
 // 插件（设置 ›「插件」）：omp 插件清单 / 启停 / 特性 / 安装 / 卸载 / 体检（全部经 `omp plugin`）
 listPlugins: "list_plugins",
 setPluginEnabled: "set_plugin_enabled",
 setPluginFeatures: "set_plugin_features",
 installPlugin: "install_plugin",
 uninstallPlugin: "uninstall_plugin",
 pluginDoctor: "plugin_doctor",
 // 技能（设置 ›「技能」）：`omp skill list` 的发现结果 + `disabledExtensions` 的逐项启停
 listSkills: "list_skills",
 setSkillEnabled: "set_skill_enabled",
 readSkillFile: "read_skill_file",
 // 会话标题语言（V18）：把界面语言同步成 omp 的 `<agentDir>/TITLE_SYSTEM.md`（标题生成 prompt）
 syncTitlePrompt: "sync_title_prompt",
 // omp 运行时更新（`omp update --check` 只检查；`omp update` 才是真安装）
 checkOmpUpdate: "check_omp_update",
 startOmpUpdate: "start_omp_update",
 cancelOmpUpdate: "cancel_omp_update",
 // 聊天形态（V32 恢复自 V1–V10）：RPC 会话命令面（per-会话长驻 `omp --mode rpc-ui`）
 createSession: "create_session",
 openSession: "open_session",
 renameSessionNote: "rename_session_note",
 getHistory: "get_history",
 sendMessage: "send_message",
 steerMessage: "steer_message",
 followUpMessage: "follow_up_message",
 runSlash: "run_slash",
 compactSession: "compact_session",
 branchSession: "branch_session",
 readImageFile: "read_image_file",
 checkPaths: "check_paths",
 completePath: "complete_path",
 stopSession: "stop_session",
 approve: "approve",
 respondUi: "respond_ui",
 setModel: "set_model",
 setThinking: "set_thinking",
 getSessionRuntime: "get_session_runtime",
 getGlobalApproval: "get_global_approval",
 setGlobalApproval: "set_global_approval",
 setSessionApproval: "set_session_approval",
 getGitInfo: "get_git_info",
 getContextBreakdown: "get_context_breakdown",
 // events
 /** 供应商登录进度（payload = 全量 ProviderLoginStatus 快照）。 */
 providerLogin: "omp-provider://login",
 /**
  * 模型目录快照刷新完成（payload = 全量 ModelCatalog）。
  * `omp models --json` 实测 2–10s：后端把目录拉取收敛成单飞 + 缓存（过期只后台刷新），
  * 新快照完成后广播——已挂载的设置页（模型 / 供应商）据此原地更新，不必自己重拉。
  */
 modelsRefreshed: "omp-models://catalog",
 /** 聊天会话事件流（payload = 单帧 omp RPC 事件；`useSessionEvents` 归一成 ViewMsg）。 */
 chatEvent: (id: string) => `omp-event://${id}`,
 /** 聊天会话状态（payload = `{state}`；running / idle / awaiting-approval / error / exited）。 */
 chatStatus: (id: string) => `omp-status://${id}`,
 /** 聊天会话运行时真值（payload = 全量 SessionRuntime 快照）。 */
 chatRuntime: (id: string) => `omp-state://${id}`,
} as const;
