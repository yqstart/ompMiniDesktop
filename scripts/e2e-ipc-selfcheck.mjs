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

const COMMANDS = [
  "locate_omp", "get_health", "get_models", "refresh_models", "get_overlay",
  "list_projects", "add_project", "remove_project", "relocate_project",
  "list_sessions", "search_sessions", "create_session", "open_session", "archive_session",
  "unarchive_session", "delete_session", "archive_sessions", "delete_sessions",
  "rename_session_note", "get_history",
  "send_message", "read_image_file", "check_paths", "stop_session", "approve", "respond_ui", "set_model", "set_thinking",
  "get_session_runtime", "get_git_info",
  "get_global_approval", "set_global_approval", "set_session_approval",
  "set_omp_path",
];
for (const c of COMMANDS) {
  if (!mainRs.includes(c)) fail(`main.rs 未注册命令 ${c}`);
  if (!modRs.includes(`pub async fn ${c}`)) fail(`commands/mod.rs 缺少实现 ${c}`);
  if (!ipc.includes(c)) fail(`src/shared/ipc.ts 缺少通道 ${c}`);
}
for (const k of ['"user"', '"text"', '"thinking"', '"tool"', '"approval"', '"divider"', '"ui"', '"ui-cancel"', '"files"']) {
  if (!types.includes(k)) fail(`ViewMsg 缺少 kind ${k}`);
}
console.log(`e2e:ipc 通过：${COMMANDS.length} 命令 × 通道 × ViewMsg 九型一致`);
