/**
 * 界面语言（设置页）：只作用于本应用的展示层，不改 omp 配置、不写覆盖层。
 * 持久化走 localStorage（与 sidebarWidth 同模式）；未知值回退简体中文。
 */

export const LOCALES = ["zh-CN", "en"] as const;
export type Locale = (typeof LOCALES)[number];

const KEY = "omp.locale.v1";

export function loadLocale(): Locale {
 try {
  if (typeof localStorage === "undefined") return "zh-CN";
  const raw = localStorage.getItem(KEY);
  if (raw === "en" || raw === "zh-CN") return raw;
  return "zh-CN";
 } catch {
  return "zh-CN";
 }
}

export function saveLocale(locale: Locale): void {
 if (locale !== "zh-CN" && locale !== "en") return;
 try {
  localStorage.setItem(KEY, locale);
 } catch {
  // 无痕模式等写失败不阻断切换
 }
}

/** 设置页字典键：增删文案时中英必须同键（有单测守着）。 */
export type SettingsKey =
 | "title"
 | "subtitle"
 | "languageSection"
 | "languageHint"
 | "diagSection"
 | "diagOk"
 | "diagBad"
 | "recheck"
 | "pickPath"
 | "pickPathTitle"
 | "ompPath"
 | "version"
 | "notFound"
 | "unknown"
 | "copyAgentDir"
 | "copyPath"
 | "copyFailed"
 | "opFailed"
 | "diagFoot"
 | "updateSection"
 | "current"
 | "checkUpdate"
 | "viewDetail"
 | "updateFoot"
 | "updateLatest"
 | "updateAvailable"
 | "updateDownloading"
 | "updateReady"
 | "updateError"
 | "tabGeneral"
 | "tabArchived"
 | "archivedHint"
 | "archivedRefresh"
 | "archivedLoading"
 | "archivedEmpty"
 | "archivedLoadFailed"
 | "archivedOpenHint"
 | "archivedRestore"
 | "archivedRestoreAll"
 | "archivedDelete"
 | "archivedDeleteAll"
 | "archivedDeleteConfirm"
 | "archivedDeleteDetail"
 | "archivedPartialRestore"
 | "archivedPartialDelete"
 | "archivedOrphan"
 | "back";

export const SETTINGS_TEXT: Record<Locale, Record<SettingsKey, string>> = {
 "zh-CN": {
  title: "设置",
  subtitle: "V1 暂不在此提供设置。Provider Key、模型目录等请用 omp CLI 管理。",
  languageSection: "界面语言",
  languageHint: "只切换本应用的界面展示，不改 omp 配置。",
  diagSection: "omp 诊断",
  diagOk: "正常",
  diagBad: "不可用",
  recheck: "重新检测",
  pickPath: "指定路径",
  pickPathTitle: "指定 omp 可执行文件（GUI 启动的 PATH 常不含 homebrew 目录）",
  ompPath: "omp 路径",
  version: "版本",
  notFound: "未找到",
  unknown: "未知",
  copyAgentDir: "复制 agentDir",
  copyPath: "复制路径",
  copyFailed: "复制失败，请手动选中文本复制",
  opFailed: "操作失败",
  diagFoot: "指定路径只写入本应用的覆盖层，不改 omp 自己的配置文件。",
  updateSection: "应用更新",
  current: "当前",
  checkUpdate: "检查更新",
  viewDetail: "查看详情",
  updateFoot: "更新包来自 GitHub Release；下载完成后可选择立即重启或稍后重启（下次启动生效）。",
  updateLatest: "已是最新（{v}）",
  updateAvailable: "发现新版本 {v}",
  updateDownloading: "正在下载更新…",
  updateReady: "新版本 {v} 已就绪，重启生效",
  updateError: "检查失败：{v}",
  tabGeneral: "通用",
  tabArchived: "已归档对话",
  archivedHint:
   "归档的对话不在左侧项目列表里显示（那边只列进行中的）；恢复后立刻回到原项目分组，删除会把 jsonl 会话文件一起删掉、不可恢复。这里不受左栏 500 个扫描窗口限制，多老的归档都找得到。",
  archivedRefresh: "刷新",
  archivedLoading: "读取中…",
  archivedEmpty: "还没有已归档的对话。在左栏会话行点「归档」，或对项目用「归档全部对话」。",
  archivedLoadFailed: "读取已归档对话失败",
  archivedOpenHint: "打开只读回放（归档会话不能继续对话，恢复后可继续）",
  archivedRestore: "恢复",
  archivedRestoreAll: "恢复全部",
  archivedDelete: "删除",
  archivedDeleteAll: "删除全部",
  archivedDeleteConfirm: "删除这 {v} 个已归档对话？",
  archivedDeleteDetail: "会连同 jsonl 会话文件一起删除，不可恢复。",
  archivedPartialRestore: "部分恢复失败：{v}",
  archivedPartialDelete: "部分删除失败：{v}",
  archivedOrphan: "未归属会话",
  back: "返回",
 },
 en: {
  title: "Settings",
  subtitle: "No app settings in V1. Manage Provider keys and model catalogs via the omp CLI.",
  languageSection: "Language",
  languageHint: "Only changes this app's UI text. Does not touch omp config.",
  diagSection: "omp Diagnostics",
  diagOk: "OK",
  diagBad: "Unavailable",
  recheck: "Re-check",
  pickPath: "Set path",
  pickPathTitle: "Point to the omp executable (GUI PATH often misses the homebrew dir)",
  ompPath: "omp path",
  version: "Version",
  notFound: "Not found",
  unknown: "Unknown",
  copyAgentDir: "Copy agentDir",
  copyPath: "Copy path",
  copyFailed: "Copy failed, please select the text manually",
  opFailed: "Operation failed",
  diagFoot: "A custom path is stored in this app's overlay only, never in omp's own config.",
  updateSection: "App updates",
  current: "Current",
  checkUpdate: "Check for updates",
  viewDetail: "Details",
  updateFoot: "Updates come from GitHub Releases; after download, restart now or later (takes effect on next launch).",
  updateLatest: "Already latest ({v})",
  updateAvailable: "New version {v} available",
  updateDownloading: "Downloading update…",
  updateReady: "New version {v} ready, restart to apply",
  updateError: "Check failed: {v}",
  tabGeneral: "General",
  tabArchived: "Archived chats",
  archivedHint:
   "Archived chats are hidden from the sidebar (it lists active ones only). Restore puts a chat back into its project group; delete removes the jsonl file for good. This list ignores the sidebar's 500-file scan window, so even very old archives show up.",
  archivedRefresh: "Refresh",
  archivedLoading: "Loading…",
  archivedEmpty: "Nothing archived yet. Use Archive on a sidebar row, or Archive all on a project.",
  archivedLoadFailed: "Failed to load archived chats",
  archivedOpenHint: "Open a read-only replay (archived chats cannot continue until restored)",
  archivedRestore: "Restore",
  archivedRestoreAll: "Restore all",
  archivedDelete: "Delete",
  archivedDeleteAll: "Delete all",
  archivedDeleteConfirm: "Delete these {v} archived chats?",
  archivedDeleteDetail: "The jsonl session files are deleted with them; this cannot be undone.",
  archivedPartialRestore: "Some restores failed: {v}",
  archivedPartialDelete: "Some deletes failed: {v}",
  archivedOrphan: "Unassigned",
  back: "Back",
 },
};
