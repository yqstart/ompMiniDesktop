import { useState } from "react";
import { openPath, openUrl, revealItemInDir } from "@tauri-apps/plugin-opener";
import { useApp } from "../stores/app";
import { fmt } from "./locale";
import { useText } from "./useText";

/**
 * 路径点击：ToolCard 参数摘要 / @ 芯片里的本地路径可点。
 * - 文件/目录存在 → 系统默认应用打开（目录则在 Finder 中显示）；
 * - 不存在 → 内联提示，不弹错；
 * - 外链（http/https）→ 二次确认后用系统浏览器打开。
 */

export function useOpenPath(cwd: string) {
 const t = useText();
 const [notice, setNotice] = useState<string | null>(null);
 const open = async (raw: string) => {
  const p = raw.trim();
  if (!p) return;
  if (/^https?:\/\//i.test(p)) {
   setNotice(fmt(t.openInBrowserNotice, p));
   return;
  }
  // 相对路径按会话 cwd 解析
  const full = p.startsWith("/") ? p : `${cwd}/${p}`;
  try {
   await openPath(full);
   setNotice(null);
  } catch {
   try {
    await revealItemInDir(full);
    setNotice(null);
   } catch {
    setNotice(fmt(t.pathOpenFailed, p));
   }
  }
 };
 const confirmOpenUrl = async (url: string) => {
  try {
   await openUrl(url);
  } catch {
   // 打开失败不打扰
  } finally {
   setNotice(null);
  }
 };
 return { notice, setNotice, open, confirmOpenUrl };
}


export function useDraftPersistence() {
 // 草稿持久化：localStorage 按会话存，启动时水合、发送后清理。
 const KEY = "omp.drafts.v1";
 const load = (): Record<string, string> => {
  try {
   return JSON.parse(localStorage.getItem(KEY) ?? "{}") as Record<string, string>;
  } catch {
   return {};
  }
 };
 const save = (sid: string, text: string) => {
  try {
   const all = load();
   if (text) all[sid] = text;
   else delete all[sid];
   localStorage.setItem(KEY, JSON.stringify(all));
  } catch {
   // 无痕模式等写失败不阻断输入
  }
 };
 return { load, save };
}

export function hydrateDrafts() {
 try {
  const raw = localStorage.getItem("omp.drafts.v1");
  if (!raw) return;
  const all = JSON.parse(raw) as Record<string, string>;
  const cur = useApp.getState().drafts;
  useApp.setState({ drafts: { ...all, ...cur } });
 } catch {
  // 解析失败就丢弃旧草稿
 }
}
