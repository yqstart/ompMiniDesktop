#!/usr/bin/env node
/**
 * e2e:ipc 自检：校验前后端 IPC 契约（命令名 / 事件名 / ViewMsg 种类）。
 * M0：静态校验（读 src/shared/ipc.ts、src/shared/types.ts、src-tauri/src/main.rs）。
 * M1+：扩展为 fake-omp 驱动的真实 invoke 校验。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fail = (msg) => {
 console.error(`e2e:ipc 失败：${msg}`);
 process.exit(1);
};

const ipc = fs.readFileSync(path.join(root, "src/shared/ipc.ts"), "utf8");
const types = fs.readFileSync(path.join(root, "src/shared/types.ts"), "utf8");
const mainRs = fs.readFileSync(path.join(root, "src-tauri/src/main.rs"), "utf8");
const modRs = fs.readFileSync(path.join(root, "src-tauri/src/commands/mod.rs"), "utf8");
const providersRs = fs.readFileSync(path.join(root, "src-tauri/src/providers.rs"), "utf8");
const memoriesRs = fs.readFileSync(path.join(root, "src-tauri/src/memories.rs"), "utf8");
const usageRs = fs.readFileSync(path.join(root, "src-tauri/src/usage.rs"), "utf8");
const quotaRs = fs.readFileSync(path.join(root, "src-tauri/src/quota.rs"), "utf8");
const contextRs = fs.readFileSync(path.join(root, "src-tauri/src/context.rs"), "utf8");

const COMMANDS = [
 "locate_omp", "get_health", "get_models", "refresh_models", "get_overlay",
 "list_projects", "add_project", "remove_project", "relocate_project",
 "list_sessions", "list_archived_sessions", "search_sessions", "create_session", "open_session", "archive_session",
 "unarchive_session", "delete_session", "archive_sessions", "unarchive_sessions", "delete_sessions",
 "rename_session_note", "get_history",
 "send_message", "steer_message", "follow_up_message", "compact_session", "branch_session", "run_slash",
 "read_image_file", "check_paths", "complete_path", "stop_session", "approve", "respond_ui", "set_model", "set_thinking",
 "get_session_runtime", "get_context_breakdown", "get_git_info",
 "get_global_approval", "set_global_approval", "set_session_approval",
 "set_omp_path",
 "list_providers", "get_provider_login", "start_provider_login", "provider_login_input",
 "cancel_provider_login", "logout_provider", "get_model_roles", "set_model_role",
 "get_fallback_chains", "set_fallback_chain", "set_retry_options",
 "list_memories", "read_memory_file", "delete_memory_file", "delete_memory_project",
 "get_usage_stats",
 "get_provider_usage",
];
for (const c of COMMANDS) {
 if (!mainRs.includes(c)) fail(`main.rs 未注册命令 ${c}`);
 // 命令实现分布在 commands/mod.rs（会话与设置）、providers.rs（供应商）、memories.rs（记忆）、
 // usage.rs（使用统计）、quota.rs（供应商配额）、context.rs（上下文分项）六个模块
 if (
  !modRs.includes(`pub async fn ${c}`) &&
  !providersRs.includes(`pub async fn ${c}`) &&
  !memoriesRs.includes(`pub async fn ${c}`) &&
  !usageRs.includes(`pub async fn ${c}`) &&
  !quotaRs.includes(`pub async fn ${c}`) &&
  !contextRs.includes(`pub async fn ${c}`)
 ) {
  fail(`后端缺少实现 ${c}`);
 }
 if (!ipc.includes(c)) fail(`src/shared/ipc.ts 缺少通道 ${c}`);
}
for (const k of ['"user"', '"text"', '"thinking"', '"tool"', '"approval"', '"divider"', '"command"', '"plan"', '"ui"', '"ui-cancel"', '"files"']) {
 if (!types.includes(k)) fail(`ViewMsg 缺少 kind ${k}`);
}
// 供应商登录进度事件：常量在 ipc.ts，字面量在后端 providers.rs，两边必须一致
const LOGIN_EVENT = "omp-provider://login";
if (!ipc.includes(`providerLogin: "${LOGIN_EVENT}"`)) fail(`ipc.ts 缺少供应商登录事件 ${LOGIN_EVENT}`);
if (!providersRs.includes(`PROVIDER_LOGIN_EVENT: &str = "${LOGIN_EVENT}"`)) {
 fail(`providers.rs 的登录事件通道与 ipc.ts 不一致`);
}
// 登录 / 登出必须走 auth-broker CLI（RPC 模式在"一个都没登录"的环境里起不来）
for (const sub of ['"auth-broker", "login"', '"auth-broker", "logout"', '"auth-broker", "list"']) {
 if (!providersRs.includes(sub)) fail(`providers.rs 未按 auth-broker CLI 调 ${sub}`);
}
console.log(`e2e:ipc 通过：${COMMANDS.length} 命令 × 通道 × ViewMsg 十一型一致`);
