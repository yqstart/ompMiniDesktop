import { api } from "@shared/api";
import type { TerminalView } from "@shared/types";

/**
 * 会话重命名（tab 上的「改标题」）——**走上游原生命令，壳侧不碰任何文件**。
 *
 * omp TUI 有 `/rename <title>`（实测 18.2.10）：改完立刻更新 jsonl 的 `title_change`
 * 事件、并立即用 OSC 标题广播——tab 上的新名字由 omp 自己回来，壳侧不留本地覆盖
 * （真相单一：omp 说是什么就是什么）。壳侧只做两件事：清洗输入、把命令写进 PTY。
 */

/** 标题长度上限（壳侧护栏：注入是一整行 PTY 输入，不做无限长）。 */
export const SESSION_TITLE_MAX = 80;

/**
 * 清洗标题：**去掉全部控制字符**（含换行）——注入的文本必须是一行 PTY 输入，
 * 混进 `\n` / `\r` 会把后半截当第二次输入发出去。清洗后为空 = 非法标题。
 * （`\p{Cc}` = Unicode 控制类：U+0000–U+001F 与 U+007F–U+009F。）
 */
export function sanitizeSessionTitle(raw: string): string | null {
 const cleaned = raw.replace(/\p{Cc}/gu, "").trim();
 return cleaned.length === 0 ? null : cleaned.slice(0, SESSION_TITLE_MAX);
}

/**
 * 现在能不能改名：只有 omp 明确空闲（π = 等待输入）时注入才安全——
 * 工作态注入的文本会被排进会话当用户输入，等待确认（`!`）时注入会答到审批提示上。
 */
export function canRenameSession(term: Pick<TerminalView, "status" | "state">): boolean {
 return term.status === "running" && term.state === "ready";
}

/**
 * 注入 `Ctrl+U`（清掉输入框里可能存在的草稿）+ `/rename <title>` + 回车。
 * 实测：`\x15` 清行、`\r` 提交、omp 立即用 OSC 标题广播新名字。
 * 返回 false = 标题非法（调用方给用户重试的提示）。
 */
export function renameTerminalSession(id: string, title: string): boolean {
 const name = sanitizeSessionTitle(title);
 if (name === null) return false;
 void api.ptyWrite(id, `\u0015/rename ${name}\r`).catch(() => undefined);
 return true;
}
