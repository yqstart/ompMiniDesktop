import { api } from "@shared/api";
import type { TerminalView } from "@shared/types";
import { referenceInsertText } from "./workspaceFiles";

/**
 * 引用工作区文件（V22）的注入通道：与 `termRename` 同一口径、同一条 PTY 通道
 * （`api.ptyWrite`），只是注入的是 `@<路径> ` 而不是 omp 原生命令。
 */

/** bracketed paste 序列（omp 自己的 `pasteToEditor` 用同一对；整段一次性插入输入框）。 */
export const PASTE_START = "\u001b[200~";
export const PASTE_END = "\u001b[201~";

/** 与 termRename 同口径：只有 omp 明确空闲（π = 等待输入）时注入才安全。 */
export function canInjectReference(term: Pick<TerminalView, "status" | "state">): boolean {
 return term.status === "running" && term.state === "ready";
}

/**
 * 把 `@<路径> ` 注入终端输入框（**不回车**——用户接着写需求，发送时才预读该文件）。
 * 走 bracketed paste：不触发 omp 的 `@` 补全浮层，也不被单词补全/拼写干扰。
 * 失败静默（键盘输入与 termRename 的既有口径：PTY 写失败无处可报，等用户自己发现）。
 */
export function insertFileReference(id: string, absPath: string): void {
 const text = `${PASTE_START}${referenceInsertText(absPath)}${PASTE_END}`;
 void api.ptyWrite(id, text).catch(() => undefined);
}
