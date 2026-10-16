import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { openPath } from "@tauri-apps/plugin-opener";
import { ArrowUp, Hourglass, PenLine, Timer, TriangleWarning, X } from "reicon-react";
import type { AvailableCommand, Goal, ImageAttachment, ViewMsg } from "@shared/types";
import { useApp } from "../../stores/app";
import { api } from "@shared/api";
import { attachmentFromFile, attachmentFromOmpImage, dataUrl } from "../../lib/attachments";
import { fmt } from "../../lib/locale";
import { extractMentions, rewriteMentions } from "../../lib/mentions";
import { LOCAL_COMMANDS, localCommandDescription, matchLocalCommand, type LocalCommand } from "../../lib/localCommands";
import { cycleSessionApproval } from "../../lib/sessionApproval";
import { loadHistory, pushHistory } from "../../lib/promptHistory";
import { openBtwPanel, askBtw } from "../../lib/btw";
import { commandInsert, filterCommands, isCompleteCommand, normalizeCommands, type SlashCandidate } from "../../lib/slashCommands";
import { openForkedSession, refreshTitleAfterFirstSend } from "../../lib/sessionOpen";
import { useText } from "../../lib/useText";
import { ProjectPicker } from "../pickers/ProjectPicker";
import { BranchPicker } from "../pickers/BranchPicker";
import { CommitButton } from "./CommitButton";
import { SessionStatsBar } from "../thread/SessionStatsBar";
import { CompactButton, QueueBadge } from "../thread/StatusBar";
import { resolveContext } from "../../lib/context";
import { useGitInfo } from "../../lib/useGitInfo";
import { GoalRow } from "./GoalRow";
import { MentionList, type PathCandidate } from "./MentionList";
import { SlashMenu } from "./SlashMenu";
import { PlusMenu } from "./PlusMenu";
import { ApprovalModeMenu } from "./ApprovalModeMenu";
import { ModelMenu } from "./ModelMenu";
import { ThinkingMenu } from "./ThinkingMenu";

/** 大段粘贴转文件引用的阈值（字符数；V41，zcode 同款——超过就存文件 + `@` 注入）。 */
const PASTE_FILE_MIN = 2000;

/**
 * 会话输入卡（v2 §3 形态，对齐 Codex / ZCode 的输入卡）：
 * **卡顶行** = 项目 + 分支选择器内嵌（原外置的上下文条收缩进来；分支可点切、其后是提交入口）；
 * **输入区** = 附件条 + 提及芯片 + 待发区 + 自动增高输入框；
 * **卡底工具行** = 左「`+` 菜单（图片 / 引用文件）+ 执行模式菜单」，右「压缩行动点 + 模型 · 思考档 ▾ +
 * 圆形发送 / 停止」；**卡底统计条** = `SessionStatsBar`，**工具行之下的独立一行**
 * （卡片直接子元素，不在工具行的 `flex-wrap` 容器里）——会话统计 / Token 用量 / 上下文占用 /
 * 供应商用量（2026-10-16 对齐 DeepSeek Harness 的 composer dock）——「我要不要再开一轮」的读数
 * （跑了多少步、烧了多少 token、上下文还剩多少、配额还剩多少）都在那一行里，点开各自给明细。
 * 上下文容量环与供应商用量 2026-10-14 从顶栏右端搬进输入卡、2026-10-16 从工具行挪进统计条；
 * 提交入口 = 卡顶行的提交键（与右栏「变更」区块同一浮层链路）。
 * 待发区（V40）：omp 的队列真值（`queue_update`）——可撤回 / 编辑 / 提升，Esc 中断还原
 * （「排队」按钮 2026-10-13 按用户口径退场，排队只走 Tab / ⌘Ctrl+Enter）。
 *
 * 图片附件（V2 M6）：粘贴 / 拖拽 / `+` 菜单三条入口，全部读成 base64 存在内存里，
 * 发送时随 `prompt.images` 一次性交给 omp——应用不落盘、不写覆盖层。
 * 三条入口都在光标处留下 `#N` 占位（N = 附件稳定编号，`commitImages` 唯一收尾）：文字与图片
 * 的对应关系写在正文里（「如图#1」），缩略图角标同编号。实测核对（omp 18.10.4 rpc-ui）：
 * 文本原样进 user 消息、图片按数组序追加为 image 块，`#N` 只是普通文本、上游不做特殊解析。
 */
export function Composer() {
 const t = useText();
 const { activeSessionId, draftOf, setDraft, statusBySession, sessions, attachmentsOf, addAttachments, removeAttachment, clearAttachments, queuedOf, currentModel, currentRuntime, models, composerFocusSeq } =
  useApp();
 const taRef = useRef<HTMLTextAreaElement | null>(null);
 /** 引用浮层注入草稿后回到输入框接着写（序号信号：同一会话反复注入也能重新聚焦）。 */
 useEffect(() => {
  if (composerFocusSeq > 0) taRef.current?.focus();
 }, [composerFocusSeq]);
 const persistDraft = (sid: string | null, text: string) => {
  setDraft(sid, text);
  if (sid) {
   try {
    const raw = localStorage.getItem("omp.drafts.v1");
    const all = (raw ? JSON.parse(raw) : {}) as Record<string, string>;
    if (text) all[sid] = text;
    else delete all[sid];
    localStorage.setItem("omp.drafts.v1", JSON.stringify(all));
   } catch {
    // 持久化失败不阻断输入
   }
  }
 };
 const draft = draftOf(activeSessionId);
 /**
  * 输入区自动增高（MASTER §4.3）：**1 行起步**，随内容长高，到 `max-h-44` 封顶后内部滚动。
  * 受控值从任何路径变化（打字 / 引用注入 / 队列退回 / 历史浏览）都要重算，所以挂 effect 而不是 onChange。
  */
 const autosize = useCallback(() => {
  const ta = taRef.current;
  if (!ta) return;
  ta.style.height = "auto";
  const h = ta.scrollHeight;
  // jsdom 里 scrollHeight = 0（没有布局）：不动内联高度，避免把输入框量成 0
  ta.style.height = h > 0 ? `${h}px` : "";
 }, []);
 useLayoutEffect(() => {
  autosize();
 }, [autosize, draft]);
 // 宽度变化（窗口缩放 / 左栏拖拽）会改变折行数，要重算。观察自身：RO 会因我们写进去的高度触发，
 // 所以只在宽度真的变了时才跑（否则自我喂食成死循环）。
 useLayoutEffect(() => {
  const ta = taRef.current;
  if (!ta || typeof ResizeObserver === "undefined") return;
  let last = ta.clientWidth;
  const ro = new ResizeObserver(() => {
   if (ta.clientWidth === last) return;
   last = ta.clientWidth;
   autosize();
  });
  ro.observe(ta);
  return () => ro.disconnect();
 }, [autosize]);
 const attachments = attachmentsOf(activeSessionId);
 /** 待发队列真值（V40）：omp 的 steering / followUp 芯片文本（`queue_update` 驱动）。 */
 const queued = queuedOf(activeSessionId);
 const status = activeSessionId ? statusBySession[activeSessionId]?.state : undefined;
 const running = status === "running" || status === "awaiting-approval";
 const awaiting = status === "awaiting-approval";
 const archived = sessions.find((s) => s.id === activeSessionId)?.archived;
 // @文件 提及（V2 M6b）：展开由 omp 做，这里只把草稿里的提及显示成芯片并问一次「路径存在吗」
 const cwd = sessions.find((s) => s.id === activeSessionId)?.cwd ?? "";
 // 卡顶行（v2 §3）：项目 + 分支选择器内嵌（原 `ContextBar` 收缩进来）；git 查询与右栏共用 `useGitInfo`
 const projects = useApp((s) => s.projects);
 const { project } = resolveContext(projects, sessions, activeSessionId);
 const { info: git, loading: gitLoading, reload: reloadGit } = useGitInfo(cwd);
 // 空态（v2 §4）：本会话还没有任何消息 → 输入卡上移，与问候语一起构成居中的「问候 + 输入卡」
 const empty = useApp((s) => (s.activeSessionId ? (s.eventsBySession[s.activeSessionId]?.length ?? 0) === 0 : false));
 const mentions = useMemo(() => extractMentions(draft), [draft]);
 const mentionKey = `${cwd}\u0000${mentions.join("\u0000")}`;
 /** 提及的存在性回执（`check_paths`）：芯片据此标「缺失 / 目录 / 文件」。 */
 const [checks, setChecks] = useState<{
  key: string;
  info: Record<string, { exists: boolean; isDir: boolean; resolved: string | null }>;
 }>({
  key: "",
  info: {},
 });
 /** 解析不到的引用：只给这些留一行提示（正常的引用已经融入正文，不再单独排芯片）。 */
 const missingMentions = useMemo(
  () => (checks.key === mentionKey ? mentions.filter((p) => checks.info[p]?.exists === false) : []),
  [checks, mentionKey, mentions],
 );
 /** 输入框的悬停提示：`@标签 → 真实相对路径`（正常态不占版面，要查全路径就悬浮一下）。 */
 const mentionTitles = useMemo(() => {
  if (checks.key !== mentionKey) return "";
  return mentions
   .map((p) => {
    const full = checks.info[p]?.resolved;
    return full ? `@${p} → ${full}` : null;
   })
   .filter((line): line is string => line !== null)
   .join("\n");
 }, [checks, mentionKey, mentions]);
 const [attachError, setAttachError] = useState<string | null>(null);
 const [dragging, setDragging] = useState(false);
 // `@` 补全状态：mentionIdx 为高亮下标，-1 = 无补全；mentionToken 是 `@` 后的路径前缀。
 const [mentionIdx, setMentionIdx] = useState(-1);
 const [mentionCands, setMentionCands] = useState<PathCandidate[]>([]);
 const [caret, setCaret] = useState(0);

 useEffect(() => {
  if (mentions.length === 0 || !cwd) return;
  let alive = true;
  // 打字期间不做请求：停 300ms 再问后端（只 stat，无副作用）
  const timer = setTimeout(() => {
   void api
    .checkPaths(cwd, mentions)
    .then((rs) => {
     if (alive) {
      setChecks({
       key: mentionKey,
       info: Object.fromEntries(
        rs.map((r) => [r.path, { exists: r.exists, isDir: r.isDir, resolved: r.resolved }]),
       ),
      });
     }
    })
    .catch(() => undefined);
  }, 300);
  return () => {
   alive = false;
   clearTimeout(timer);
  };
 }, [mentionKey, cwd, mentions]);

 // 补全浮层有两套：`/` 命令面（数据是 omp 自己的 `available_commands_update`）与 `@` 路径。
 // 两者互斥——草稿以 `/` 开头时整条就是一条命令，不该再冒出路径候选。
 const commands = useMemo(() => {
  // 壳本地命令（V40）以固定组置顶（`source:"local"`）：它们是壳拦截处理的，
  // 与 omp 命令面分开可见（描述文案走字典、随语言切换重算）。
  const local: AvailableCommand[] = LOCAL_COMMANDS.map((c) => ({
   name: c.name,
   description: localCommandDescription(c, t),
   hint: c.hint,
   source: "local",
  }));
  return [...local, ...normalizeCommands(currentRuntime?.commands)];
 }, [currentRuntime?.commands, t]);
 // `/` 补全只在草稿是单条命令、光标还在首个 token 内时开。**流式中不开**：那时 Enter 走 steer
 // 插话，`/xxx` 是当文本发出去的，弹出补全等于暗示它能当命令跑。
 const slashToken = (() => {
  if (running || !activeSessionId) return null;
  const m = /^\/(\S*)$/.exec(draft.slice(0, caret));
  return m ? m[1] : null;
 })();
 // Esc 关掉后记住当时的 token：token 一变（继续打字）就重新打开，不用手动清标记
 const [slashDismissed, setSlashDismissed] = useState<string | null>(null);
 const slashOpen = slashToken !== null && slashToken !== slashDismissed && commands.length > 0;
 const slashCands = useMemo(
  () => (slashOpen ? filterCommands(commands, slashToken ?? "") : []),
  [slashOpen, commands, slashToken],
 );
 // 高亮跟着输入走：slashKey 一变（继续打字 / 命令面刷新）就当回到第一条。
 // 不用 effect 重置——effect 里同步 setState 会多打一轮渲染，react-hooks 规则也不让。
 const slashKey = `${slashToken ?? ""}\u0000${commands.length}`;
 const [slashNav, setSlashNav] = useState<{ key: string; idx: number }>({ key: "", idx: 0 });
 const slashIdx = slashNav.key === slashKey ? slashNav.idx : 0;
 const hoverSlash = (idx: number) => setSlashNav({ key: slashKey, idx });
 const moveSlash = (step: number) =>
  setSlashNav({ key: slashKey, idx: (slashIdx + step + slashCands.length) % (slashCands.length || 1) });

 // `@` 补全：取光标前 `@` 起的路径前缀，300ms 防抖问后端（一层列举 / 递归搜名字，见 `complete_path`）。
 const mentionToken = (() => {
  const before = draft.slice(0, caret);
  const m = /@([^\s@]*)$/.exec(before);
  return m ? m[1] : null;
 })();
 const mentionEmpty = mentionToken == null || !cwd || !activeSessionId || slashToken !== null;
 /** 当前补全的取词 key（`cwd\0token`）：与 `mentionLoadedKey` 对不上 = 还在搜。 */
 const mentionQueryKey = `${cwd}\u0000${mentionToken ?? ""}`;
 /** ESC 关掉后记住当时的 key：继续打字（key 变）就重新打开，与 `/` 命令面同一口径。 */
 const [mentionDismissed, setMentionDismissed] = useState<string | null>(null);
 /** 已取完词的 key：对不上就渲染「搜索中」，**不许让浮层无声消失**（用户实测的坑）。 */
 const [mentionLoadedKey, setMentionLoadedKey] = useState<string | null>(null);
 const mentionOpen = !mentionEmpty && mentionDismissed !== mentionQueryKey;
 useEffect(() => {
  if (mentionEmpty) return;
  let alive = true;
  const key = mentionQueryKey;
  const timer = setTimeout(() => {
   void api
    .completePath(cwd, mentionToken)
    .then((rs) => {
     if (!alive) return;
     setMentionCands(rs);
     setMentionIdx(rs.length > 0 ? 0 : -1);
     setMentionLoadedKey(key);
    })
    .catch(() => undefined);
  }, 300);
  return () => {
   alive = false;
   clearTimeout(timer);
  };
 }, [mentionQueryKey, mentionToken, cwd, activeSessionId, mentionEmpty]);

 // 选中一条候选：把光标前的 `@前缀` 换成完整路径（目录补 `/` 接着往里打，文件补空格收尾）。
 // 点击、Tab、Enter 三个入口共用它，免得三处各写一遍替换规则。
 const pickMention = (c: PathCandidate) => {
  const before = draft.slice(0, caret);
  // 写进草稿的是**短标签**（`components/FileTree.tsx` 这种尽可能短的唯一后缀），
  // 发送前由 `expandMentions` 还原成完整相对路径——输入框里不再出现一长串路径
  setDraft(activeSessionId, before.replace(/@[^\s@]*$/, `@${c.label}${c.isDir ? "/" : " "}`) + draft.slice(caret));
  setMentionIdx(-1);
  setMentionCands([]);
 };

 // 选中一条命令：整条草稿就是这条命令（`/` 开头的语法如此），所以直接换成完整名 + 一个空格；
 // 若首个 token 之后还有内容（在 token 中间补全），接到命令后面而不是丢掉。
 const pickCommand = (c: SlashCandidate) => {
  const sp = draft.search(/\s/);
  const tail = sp >= 0 ? draft.slice(sp).trimStart() : "";
  setDraft(activeSessionId, commandInsert(c) + tail);
  setSlashDismissed(slashToken);
 };

 // 模型是否支持图片（模型目录里 `input` 含 image）；目录没加载出来时不做判断，不误报
 const model = models?.models.find((m) => `${m.provider}/${m.id}` === currentModel);
 const imageUnsupported = attachments.length > 0 && !!model?.input && !model.input.includes("image");

 /** 在光标处插入文本、落草稿（含 localStorage）、把光标移到插入段之后——受控 textarea 的值更新
  *  会丢光标，用 rAF 在提交后再定位；`@` 大段粘贴与图片 `#N` 占位共用。 */
 const insertAtCaret = (sid: string, insert: string) => {
  if (!insert) return;
  const cur = useApp.getState().draftOf(sid) ?? "";
  const ta = taRef.current;
  const at = ta?.selectionStart ?? cur.length;
  const end = ta?.selectionEnd ?? cur.length;
  persistDraft(sid, cur.slice(0, at) + insert + cur.slice(end));
  requestAnimationFrame(() => {
   taRef.current?.setSelectionRange(at + insert.length, at + insert.length);
  });
 };

 /** File[] → 附件对象（只收图片，非图片给提示）。不落库、不插占位——由 `commitImages` 收尾。 */
 const readImages = async (files: File[]): Promise<ImageAttachment[]> => {
  const skipped = files.filter((f) => !f.type.startsWith("image/"));
  const images = files.filter((f) => f.type.startsWith("image/"));
  if (images.length === 0) {
   if (skipped.length > 0) setAttachError(t.attachOnlyImages);
   return [];
  }
  setAttachError(skipped.length > 0 ? t.attachSomeIgnored : null);
  const added: ImageAttachment[] = [];
  for (const f of images) {
   try {
    added.push(await attachmentFromFile(f, t));
   } catch (e) {
    setAttachError(e instanceof Error ? e.message : t.attachReadFailed);
   }
  }
  return added;
 };

 /** 图片入口的统一收尾（粘贴 / 拖拽 / `+` 菜单）：附件入库（store 分配稳定编号）并在光标处
  *  插入 `#N` 占位（多张空格分隔）。`prefix` = 图文混贴时剪贴板附带的文字——文字在前、占位紧随
  *  其后，拼成**一次**插入（顺序不依赖两段异步插入的先后，光标也只定位一次）。 */
 const commitImages = (items: ImageAttachment[], prefix = "") => {
  const sid = activeSessionId;
  if (!sid) return;
  const assigned = addAttachments(sid, items);
  insertAtCaret(sid, prefix + assigned.map((a) => `#${a.slot}`).join(" "));
 };

 /** 大段粘贴转文件引用（V41，zcode 同款）：存临时文件 + 在光标处插入 `@<绝对路径> `。
  *  之后走 omp 原生的 `@file` 提及（发送时展开成 fileMention 读进上下文），壳侧零自定义协议。 */
 const pasteAsFile = async (text: string) => {
  const sid = activeSessionId;
  if (!sid) return;
  try {
   const { path } = await api.savePaste(text);
   insertAtCaret(sid, `@${path} `);
   setAttachError(fmt(t.pasteAsFile, path.split("/").pop() ?? path));
  } catch (e) {
   setAttachError(e instanceof Error ? e.message : String(e));
  }
 };

 const pickImages = async () => {
  try {
   const picked = await open({
    multiple: true,
    filters: [{ name: t.attachImages, extensions: ["png", "jpg", "jpeg", "webp", "gif"] }],
   });
   if (!picked) return;
   const paths = Array.isArray(picked) ? picked : [picked];
   setAttachError(null);
   const added: ImageAttachment[] = [];
   for (const p of paths) {
    try {
     added.push(await api.readImageFile(p));
    } catch (e) {
     setAttachError(e instanceof Error ? e.message : t.attachReadFailed);
    }
   }
   if (added.length > 0) commitImages(added);
  } catch (e) {
   setAttachError(e instanceof Error ? e.message : t.attachPickFailed);
  }
 };

 // 流式中追问的发送语义**对齐 omp 终端与 codex**（codex TUI 实测：轮次运行中 Enter 走 steer、
 // Tab 排队、Esc 打断；omp 终端：Enter = steering 插话、Ctrl+Q / Ctrl+Enter = follow-up 排队）——
 // Enter 走插话（steer，进当前轮、下一个边界生效），Tab 与 Cmd/Ctrl+Enter 走排队（follow_up，
 // 本轮后执行）；送达处理交给 omp 自己的设置（steeringMode / followUpMode / interruptMode）。
 // 运行中的「排队」按钮 2026-10-13 按用户口径退场（原先 = 同一通路的鼠标等价物）——排队只剩 Tab /
 // ⌘Ctrl+Enter 两个键盘入口。
 // 「待发区」（V40）= **omp 的队列真值**（`queue_update` 帧驱动，ack 后立即到达）：
 // 撤回 / 编辑 / 提升 / 中断还原全部按真值操作，壳侧不做本地对账（V39 的乐观条目已退场）。
 /**
  * 发送前把输入框里的**短标签**还原成完整相对路径（`@components/` → `@src/views/…/components/`）。
  *
  * 输入框显示短标签、omp 只认真路径，所以这一步必须有；解析规则与芯片的「存在性」同一个后端
  * 入口（`check_paths` 的 `resolved`），两边不会各说各话。解析不出来（歧义 / 不存在）就按原文发
  * ——芯片此时已经用警告色告诉过用户了。**失败不阻塞发送**。
  */
 const expandMentions = async (text: string): Promise<string> => {
  const tokens = extractMentions(text);
  if (tokens.length === 0 || !cwd) return text;
  try {
   const rs = await api.checkPaths(cwd, tokens);
   const map = new Map(rs.filter((r) => r.resolved).map((r) => [r.path, r.resolved as string]));
   return map.size > 0
    ? rewriteMentions(text, (token) => {
       const hit = map.get(token);
       if (hit === undefined) return null;
       // 目录写法（`@components/`）保留尾斜杠，还原后仍是「这是一个目录」的写法
       return token.endsWith("/") && !hit.endsWith("/") ? `${hit}/` : hit;
      })
    : text;
  } catch {
   return text;
  }
 };

 const sendQueued = async (mode: "steer" | "follow_up") => {
  if (!activeSessionId || (!draft.trim() && attachments.length === 0) || archived) return;
  const raw = draft;
  const text = await expandMentions(raw);
  const sentImages = attachments;
  // 清空 / 回滚都走 persistDraft（带 localStorage 同步）：只清内存的话，
  // 已发送的内容下次启动会被 hydrateDrafts 从 `omp.drafts.v1` 恢复回输入框（幽灵草稿）。
  persistDraft(activeSessionId, "");
  clearAttachments(activeSessionId);
  try {
   const fn = mode === "steer" ? api.steerMessage : api.followUpMessage;
   await fn(
    activeSessionId,
    text,
    sentImages.map((a) => ({ name: a.name, mimeType: a.mimeType, dataBase64: a.dataBase64, bytes: a.bytes })),
   );
   pushHistory(activeSessionId, text);
   resetHistory();
  } catch {
   persistDraft(activeSessionId, raw);
   addAttachments(activeSessionId, sentImages);
  }
 };

 /**
  * 发送前展开的**逆操作**：把文本里的真路径缩成短标签（退回输入框的队列消息用）。
  * 规则由 `mention_label` 一端决定（最短唯一后缀），拿不到标签的 mention 原样保留。
  */
 const shortenMentions = async (text: string): Promise<string> => {
  const tokens = extractMentions(text);
  if (tokens.length === 0 || !cwd) return text;
  try {
   const pairs = await Promise.all(
    tokens.map(async (token) => [token, await api.mentionLabel(cwd, token).catch(() => null)] as const),
   );
   const map = new Map(pairs.filter(([, label]) => label !== null) as [string, string][]);
   return map.size > 0
    ? rewriteMentions(text, (token) => {
       const hit = map.get(token);
       if (hit === undefined || hit === token) return null;
       return token.endsWith("/") && !hit.endsWith("/") ? `${hit}/` : hit;
      })
    : text;
  } catch {
   return text;
  }
 };

 /** 「编辑」一条排队消息（zcode 口径：整条连同附件退回输入框、从队列移除）。 */
 const editQueued = async (text: string, queue: "steering" | "followUp") => {
  const sid = activeSessionId;
  if (!sid) return;
  try {
   const r = await api.removeQueuedMessage(sid, text, queue);
   if (!r.removed) return;
   // 队列里存的是发给 omp 的真路径：退回草稿时缩回短标签，与输入框口径一致
   const back = await shortenMentions(text);
   const cur = useApp.getState().draftOf(sid);
   persistDraft(sid, cur.trim() ? `${cur}\n\n${back}` : back);
   if (r.images && r.images.length > 0) {
    addAttachments(sid, (r.images as { data?: string; mimeType?: string }[]).map(attachmentFromOmpImage));
   }
   taRef.current?.focus();
  } catch {
   // 失败（已被投递 / 已消费）：队列快照随后自行收敛，不弹错
  }
 };

 /** 撤回一条排队消息（不退回草稿）。 */
 const removeQueued = async (text: string, queue: "steering" | "followUp") => {
  const sid = activeSessionId;
  if (!sid) return;
  try {
   await api.removeQueuedMessage(sid, text, queue);
  } catch {
   // 同上：快照收敛
  }
 };

 /** 把一条 followUp 提升为 steering（排队 → 立刻插话）。 */
 const promoteQueued = async (text: string) => {
  const sid = activeSessionId;
  if (!sid) return;
  try {
   await api.promoteQueuedMessage(sid, text);
  } catch {
   // 同上
  }
 };

 /**
  * Esc = 中断并交还队列（V40；omp TUI 的 Esc 等价物 / codex 的「打断时把 pending 还给输入框」）：
  * 返回的插话 / 排队消息连图片一起放回输入框（草稿已有内容时空行追加）。
  */
 const abortAndRestore = async (sid: string) => {
  try {
   const r = await api.abortAndRestoreQueue(sid);
   const items = [...r.steering, ...r.followUp];
   if (items.length > 0) {
    const text = items.map((i) => i.text).filter((x) => x.trim()).join("\n\n");
    if (text) {
     const cur = useApp.getState().draftOf(sid);
     persistDraft(sid, cur.trim() ? `${cur}\n\n${text}` : text);
    }
    const imgs = items.flatMap((i) => i.images ?? []);
    if (imgs.length > 0) {
     addAttachments(sid, imgs.map((x) => attachmentFromOmpImage(x as { data?: string; mimeType?: string })));
    }
    taRef.current?.focus();
   }
  } catch {
   // 接口失败兜底：直发 abort（保证「停止」这个动作本身不丢）
   void api.stop(sid).catch(() => undefined);
  }
 };

 /**
  * 执行模式循环（V40/V41）：实现提取到 `lib/sessionApproval.ts`（命令中心共用）——
  * always-ask → write → yolo；idle 时自动重启 runtime 生效、running 挂起到本轮结束。
  */
 const cycleApproval = async () => {
  const sid = activeSessionId;
  if (!sid || archived) return;
  await cycleSessionApproval(sid);
 };

 /** 本地 shell（V41，codex 的 `!` 前缀）：`$ cmd` 先行落一行，完成后输出落第二行。 */
 const runShell = async (sid: string, cmd: string) => {
  localNote(sid, `$ ${cmd}`);
  try {
   const r = await api.runBash(sid, cmd);
   const out = (r.output ?? "").trimEnd();
   const exitNote = r.exitCode === 0 ? "" : fmt(t.bashExitNote, r.exitCode);
   localNote(sid, [out || t.bashNoOutput, exitNote].filter(Boolean).join("\n"));
  } catch (e) {
   localNote(sid, e instanceof Error ? e.message : String(e));
  }
 };

 /** 会话内反馈：往消息流尾追加一条本地 command 行（灰字代码区，与 omp 命令输出同款）。 */
 const localNote = (sid: string, text: string) => {
  useApp.getState().appendEvents(sid, [
   // eslint-disable-next-line react-hooks/purity -- localNote 只在事件处理器里调用，非 render
   { kind: "command", id: `lc-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, output: text } as ViewMsg,
  ]);
 };

 /** 已发送 prompt 历史（V41，codex 的 ↑↓ 调回）：浏览态 {sid, idx, backup}——idx 指向历史下标、
  *  backup = 开始浏览前的草稿（↓ 到底还原）。带 sid 标记 → 切会话后自动不活跃，无需 effect 重置。 */
 const [hist, setHist] = useState<{ sid: string; idx: number; backup: string } | null>(null);
 const historyRef = useRef<string[] | null>(null);
 const browsing = hist && hist.sid === activeSessionId ? hist : null;
 const resetHistory = () => {
  setHist(null);
  historyRef.current = null;
 };

 /** ↑↓ 浏览历史（codex 的「Press Up or Down to restore draft history」）。 */
 const browseHistory = (dir: 1 | -1) => {
  const sid = activeSessionId;
  if (!sid) return;
  if (historyRef.current === null) historyRef.current = loadHistory(sid);
  const list = historyRef.current;
  if (list.length === 0) return;
  if (!browsing) {
   if (dir === 1) return; // 不在浏览态时 ↓ 不做事
   setHist({ sid, idx: list.length - 1, backup: draft });
   persistDraft(sid, list[list.length - 1]);
   requestAnimationFrame(() => {
    const ta = taRef.current;
    if (ta) ta.setSelectionRange(ta.value.length, ta.value.length);
   });
   return;
  }
  const next = browsing.idx + dir;
  if (next < 0) return; // 到顶不动
  if (next >= list.length) {
   // 到底：还原浏览前草稿并退出浏览
   setHist(null);
   persistDraft(sid, browsing.backup);
   return;
  }
  setHist({ ...browsing, idx: next });
  persistDraft(sid, list[next]);
 };

 /** 壳本地命令的执行（V40）：命中 `LOCAL_COMMANDS` 后由这里分发（不发去 omp）。 */
 const runLocalCommand = async (cmd: LocalCommand, arg: string) => {
  const sid = activeSessionId;
  if (!sid) return;
  const st = useApp.getState();
  try {
   switch (cmd.name) {
    case "goal": {
     const op = arg === "" ? "get" : /^(pause|resume|drop|clear)$/i.test(arg) ? (arg === "clear" ? "drop" : arg) : "create";
     const data = await api.goalCommand(sid, op as "get" | "create" | "resume" | "pause" | "drop", op === "create" ? arg : undefined);
     const goal = (data.goal ?? null) as Goal | null;
     useApp.getState().setGoal(sid, goal);
     localNote(sid, goal ? fmt(t.goalNoteSet, goal.objective) : t.goalNoteCleared);
     break;
    }
    case "status":
     st.setStatsOpen(true);
     break;
    case "btw":
    case "side": {
     await openBtwPanel(sid);
     if (arg) await askBtw(sid, arg);
     break;
    }
    case "fork": {
     const view = await api.forkSession(sid);
     await openForkedSession(view);
     break;
    }
    case "find":
     st.setFindOpen(true);
     break;
    case "fast": {
     const cur = st.currentRuntime?.fastModeEnabled ?? false;
     const on = arg === "on" ? true : arg === "off" ? false : !cur;
     try {
      await api.setFastMode(sid, on);
      localNote(sid, on ? t.fastOn : t.fastOff);
     } catch (e) {
      // 模型不支持时 omp 的原文错误（"Fast mode is unavailable for the current model."）原样上屏
      localNote(sid, e instanceof Error ? e.message : String(e));
     }
     break;
    }
    case "slow": {
     const cur = st.currentRuntime?.slowModeEnabled ?? false;
     const on = arg === "on" ? true : arg === "off" ? false : !cur;
     try {
      await api.setSlowMode(sid, on);
      localNote(sid, on ? t.slowOn : t.slowOff);
     } catch (e) {
      localNote(sid, e instanceof Error ? e.message : String(e));
     }
     break;
    }
    case "export": {
     const { path } = await api.exportSessionHtml(sid);
     if (path) {
      localNote(sid, fmt(t.exportDone, path));
      // 导出即打开（系统默认应用 / 浏览器）；失败静默（路径已在流尾）
      void openPath(path).catch(() => undefined);
     } else {
      localNote(sid, t.exportDone.replace("{0}", "?"));
     }
     break;
    }
   }
  } catch (e) {
   localNote(sid, e instanceof Error ? e.message : String(e));
  }
 };


 const send = async () => {
  // `!` 前缀 = 本地 shell（V41，codex 的 `!` 用法）：在会话进程的工作目录跑一条命令，
  // 命令行与输出各落一条流尾 command 行；运行中也可用（omp 的 bash 是 concurrent 分发）。
  if (draft.trim().startsWith("!") && draft.trim().length > 1 && activeSessionId && !archived && attachments.length === 0) {
   const cmd = draft.trim().slice(1).trim();
   persistDraft(activeSessionId, "");
   void runShell(activeSessionId, cmd);
   return;
  }
  // `/` 开头先查壳本地命令（V40：/goal /status /btw /fork /find——发给 omp 只会变成普通提示词）；
  // 未命中才走 omp 命令面（run_slash 直发，command_output 回来，无 agent turn）
  if (!running && draft.trim().startsWith("/") && attachments.length === 0 && activeSessionId && !archived) {
   const cmdText = draft.trim();
   persistDraft(activeSessionId, "");
   const local = matchLocalCommand(cmdText);
   if (local) {
    void runLocalCommand(local.cmd, local.arg);
    return;
   }
   try {
    await api.runSlash(activeSessionId, cmdText);
    pushHistory(activeSessionId, cmdText);
    resetHistory();
   } catch {
    persistDraft(activeSessionId, cmdText);
   }
   return;
  }
  if (running && activeSessionId && (draft.trim() || attachments.length > 0) && !archived) {
   // 流式中 Enter = 插话（steer），与 omp 终端的 Enter 一致
   void sendQueued("steer");
   return;
  }
  if (!activeSessionId || (!draft.trim() && attachments.length === 0) || running || archived) return;
  // 输入框里是短标签，omp 只认真路径：发送前展开（回显 / 历史 / 回滚都用原文，用户看到的还是自己写的）
  const raw = draft;
  const text = await expandMentions(raw);
  const sentImages = attachments;
  const sid = activeSessionId;
  // 首条判定：流里还没有 user 消息 = 这是本会话第一条（标题回退只做这一次）
  const isFirst = !(useApp.getState().eventsBySession[sid] ?? []).some((m) => m.kind === "user");
  // 乐观回显：先落一条本地 user 消息，id 带时间戳；
  // 历史回放里同一文本的 `u:<行id>` 到达时按文本合并去重，不翻倍。
  // eslint-disable-next-line react-hooks/purity -- send 是点击事件处理，非 render
  const optimisticId = `u-local-${Date.now()}`;
  useApp.getState().appendEvents(sid, [
   {
    kind: "user",
    id: optimisticId,
    text: raw,
    mentions: extractMentions(raw),
    ...(sentImages.length > 0
     ? { images: sentImages.map((a) => ({ mimeType: a.mimeType, data: a.dataBase64 })) }
     : {}),
   } as never,
  ]);
  persistDraft(sid, "");
  clearAttachments(sid);
  try {
   await api.sendMessage(
    sid,
    text,
    sentImages.map((a) => ({ name: a.name, mimeType: a.mimeType, dataBase64: a.dataBase64, bytes: a.bytes })),
   );
   pushHistory(sid, raw);
   resetHistory();
   // 首条发送成功：本地回退先顶上 + 回读 omp 真值（rpc-ui 实测不产标题，回退即终态；
   // TUI 侧改过名时真值覆盖回退）。失败不阻塞发送链路。
   if (isFirst && raw.trim() && sentImages.length === 0) {
    void refreshTitleAfterFirstSend(sid, raw).catch(() => undefined);
   }
  } catch {
   // 发失败就把草稿与附件还回去、不留幽灵消息，不让用户重打一遍
   persistDraft(sid, raw);
   addAttachments(sid, sentImages);
   const st = useApp.getState();
   st.set({
    eventsBySession: {
     ...st.eventsBySession,
     [sid]: (st.eventsBySession[sid] ?? []).filter((m) => m.id !== optimisticId),
    },
   });
  }
 };

 if (archived) {
  return (
   <div className="shrink-0 pb-4">
    <div className="mx-auto max-w-(--measure-content) rounded-xl border border-border bg-surface px-4 py-3 text-center text-sm text-muted">
     {t.archivedComposerHint}
    </div>
   </div>
  );
 }

 // 宽度口径：输入卡 = 中列 85%（`--measure-content`，与正文列 / 查找条同档、三者左缘对齐）。
 // 外层**不挂水平内边距**——挂上 px-4 就把 85% 的基准缩成「中列 − 32」，卡比正文窄一截、看着错位。
 return (
  <div className={`shrink-0 pb-4 ${empty ? "pb-[14vh]" : ""}`}>
   {/* 目标行（V40）：有 goal 时显示（目标 / 状态 / 暂停·继续·清除） */}
   <GoalRow />
   <div
    onDragOver={(e) => {
     if (!e.dataTransfer.types.includes("Files")) return;
     e.preventDefault();
     setDragging(true);
    }}
    onDragLeave={() => setDragging(false)}
    onDrop={(e) => {
     if (!e.dataTransfer.files?.length) return;
     e.preventDefault();
     setDragging(false);
     void readImages(Array.from(e.dataTransfer.files)).then((added) => commitImages(added));
    }}
    className={`mx-auto max-w-(--measure-content) rounded-xl border bg-surface transition-colors duration-100 ${dragging ? "border-accent bg-accent/5" : awaiting ? "border-warn/60" : "border-border focus-within:border-accent/70"
     }`}
   >
    {/* 卡顶行（v2 §3，对齐 ZCode）：项目 + 分支选择器内嵌；与「+」菜单等共用 composerMenu 互斥槽 */}
    <div className="flex items-center gap-0.5 px-2 pt-2">
     <ProjectPicker project={project} />
     {git?.isRepo ? (
      <>
       <BranchPicker git={git} cwd={cwd} loading={gitLoading} onReload={reloadGit} />
       <CommitButton cwd={cwd} />
      </>
     ) : null}
    </div>
    {awaiting && <div className="px-4 pt-2.5 text-[13px] text-warn">{t.resolveApprovalFirst}</div>}
    {attachments.length > 0 && (
     <div className="flex flex-wrap gap-2 px-3 pt-3">
      {attachments.map((a, i) => (
       <div key={a.slot ?? `${a.name}-${i}`} className="group relative">
        <img
         src={dataUrl(a)}
         alt={a.name}
         title={`${a.name} · ${Math.round(a.bytes / 1024)}KB`}
         className="h-16 w-16 rounded-md border border-border object-cover"
        />
        {/* 编号角标与文字里的 `#N` 占位同源（store 稳定分配）：删图不重编号，正文引用不错位 */}
        {a.slot !== undefined && (
         <span className="pointer-events-none absolute -top-1.5 -left-1.5 select-none rounded-md border border-border bg-surface px-1 font-mono text-[10px] leading-4 text-muted">
          #{a.slot}
         </span>
        )}
        <button
         onClick={() => removeAttachment(activeSessionId, i)}
         aria-label={fmt(t.attachRemoveAria, a.name)}
         className="absolute -top-1.5 -right-1.5 cursor-pointer rounded-full border border-border bg-surface p-0.5 text-muted opacity-0 transition-opacity duration-150 group-hover:opacity-100 hover:text-danger focus:opacity-100"
        >
         <X size={12} aria-hidden />
        </button>
       </div>
      ))}
     </div>
    )}
    {attachError && <div className="px-4 pt-2 text-[13px] text-danger">{attachError}</div>}
    {/* 引用**不再单独排一行芯片**（2026-10-17 用户口径：标签已经融入正文，别又展示 tag 又展示路径）。
        只有解析不到的引用才提示——那时用户需要知道「它不会被读进上下文」。 */}
    {missingMentions.length > 0 && (
     <div className="flex flex-wrap items-center gap-1.5 px-3 pt-2" role="status">
      <span className="inline-flex items-center gap-1 text-[12px] text-warn">
       <TriangleWarning size={12} aria-hidden />
       {fmt(t.mentionsMissingHint, String(missingMentions.length))}
      </span>
      {missingMentions.map((p) => (
       <span
        key={p}
        title={t.mentionMissingTitle}
        className="inline-flex max-w-full items-center gap-1.5 rounded-md border border-warn/50 px-2 py-0.5 font-mono text-xs text-warn"
       >
        <span className="truncate">@{p}</span>
        <span className="sr-only">{t.pathMissing}</span>
       </span>
      ))}
     </div>
    )}
    {imageUnsupported && (
     <div className="px-4 pt-2 text-[13px] text-warn">{t.imageUnsupported}</div>
    )}
    {/* 待发区（V40，omp 队列真值 / codex pending input preview 同口径）：steering = 插话、
        followUp = 排队；hover 出操作——撤回 / 编辑（退回输入框）/ 提升为插话（仅排队行）。
        只读的旧口径（V39「omp 没有 dequeue RPC」）已过时：18.10.1 有 remove / promote。 */}
    {queued.steering.length + queued.followUp.length > 0 && (
     <ul className="flex flex-col gap-1 px-3 pt-2" role="status">
      {queued.steering.map((text, i) => (
       <QueueRow
        key={`s-${i}-${text}`}
        mode="steer"
        text={text}
        onEdit={() => void editQueued(text, "steering")}
        onRemove={() => void removeQueued(text, "steering")}
       />
      ))}
      {queued.followUp.map((text, i) => (
       <QueueRow
        key={`f-${i}-${text}`}
        mode="queue"
        text={text}
        onEdit={() => void editQueued(text, "followUp")}
        onRemove={() => void removeQueued(text, "followUp")}
        onPromote={() => void promoteQueued(text)}
       />
      ))}
     </ul>
    )}
    <label htmlFor="composer" className="sr-only">
     {t.composerLabel}
    </label>
    {/* `@` 路径补全：一层列举 / 递归搜名字（`complete_path`），Tab/Enter 选中。
        取词中与「没有匹配」都留在浮层里如实说——无声消失会被当成坏了（用户实测）。 */}
    {mentionOpen && (
     <MentionList
      cands={mentionCands}
      active={mentionIdx}
      onPick={pickMention}
      onHover={setMentionIdx}
      status={mentionLoadedKey !== mentionQueryKey ? "loading" : mentionCands.length > 0 ? "ready" : "empty"}
     />
    )}
    {/* `/` 命令补全：omp 命令面（含技能），限高内部滚动，不挤压输入框 */}
    {slashOpen && (
     <SlashMenu cands={slashCands} active={slashIdx} query={slashToken ?? ""} onPick={pickCommand} onHover={hoverSlash} />
    )}
    {/* 输入区：1 行起步（`rows` 只是首帧兜底，高度由 autosize 按内容写），封顶 `max-h-44`。
        悬停给出 `@标签 → 真实相对路径`（引用不单独排芯片，完整路径要查就在这里）。 */}
    <textarea
     ref={taRef}
     id="composer"
     rows={1}
     title={mentionTitles || undefined}
     value={draft}
     onChange={(e) => {
      persistDraft(activeSessionId, e.target.value);
      setCaret(e.target.selectionStart ?? e.target.value.length);
      // 用户编辑即退出历史浏览（文本保留；下次 ↑ 从最近一条重新开始）
      if (browsing) setHist(null);
     }}
     onSelect={(e) => setCaret(e.currentTarget.selectionStart ?? 0)}
     onClick={(e) => setCaret(e.currentTarget.selectionStart ?? 0)}
     onPaste={(e) => {
      const files = Array.from(e.clipboardData?.files ?? []);
      if (files.length === 0) {
       // 纯文本粘贴：大段文本转文件引用（V41，zcode 同款）——输入框不被几万字撑爆，
       // omp 侧按 `@file` 提及把内容读进上下文；短文本照常走浏览器默认粘贴。
       const text = e.clipboardData?.getData("text/plain") ?? "";
       if (text.length > PASTE_FILE_MIN) {
        e.preventDefault();
        void pasteAsFile(text);
       }
       return;
      }
      // 只拦截图片：文字照常粘贴，图文混贴时文字不丢
      const images = files.filter((f) => f.type.startsWith("image/"));
      if (images.length === 0) {
       if (files.length > 0) setAttachError(t.attachOnlyImages);
       return;
      }
      e.preventDefault();
      // 图文混贴（截图工具常同时给 text+image）：剪贴板文字在前、`#N` 占位紧随其后，
      // 拼成**一次**插入——顺序与光标定位都不依赖两段异步插入的先后。
      const text = e.clipboardData?.getData("text/plain") ?? "";
      void readImages(files).then((added) => commitImages(added, text));
     }}
     onKeyDown={(e) => {
      // `/` 命令补全打开时先接管键盘（它和 `@` 补全互斥，开着就说明草稿是条命令）。
      // Esc 用 slashOpen 判定：零命中时面板也在，也该关得掉。
      if (slashOpen && e.key === "Escape") {
       setSlashDismissed(slashToken);
       return;
      }
      const slashActive = slashOpen && slashCands.length > 0;
      if (slashActive && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
       e.preventDefault();
       moveSlash(e.key === "ArrowDown" ? 1 : -1);
       return;
      }
      if (slashActive && e.key === "Tab") {
       e.preventDefault();
       // 没有高亮（slashIdx = -1）时补第一项：Tab 在补全里不该"什么都不做"
       const c = slashCands[Math.max(0, slashIdx)];
       if (c) pickCommand(c);
       return;
      }
      if (slashActive && e.key === "Enter" && !e.shiftKey && !(e.metaKey || e.ctrlKey)) {
       // **打全即发**：首 token 已是完整命令名（含别名）时不拦，交给下面的发送逻辑；
       // 否则补全——不然打 `/comp` 回车会被当成把半截命令发出去。
       if (!isCompleteCommand(commands, slashToken ?? "")) {
        const c = slashIdx >= 0 ? slashCands[slashIdx] : undefined;
        if (c) {
         e.preventDefault();
         pickCommand(c);
         return;
        }
       }
      }
      // `@` 补全打开时：上下键导航、Tab/Enter 选中、Esc 关闭（优先于发送）
      const completing = mentionCands.length > 0;
      if (completing && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
       e.preventDefault();
       setMentionIdx((i) => (i + (e.key === "ArrowDown" ? 1 : -1) + mentionCands.length) % mentionCands.length);
       return;
      }
      if (completing && e.key === "Tab") {
       e.preventDefault();
       // 没有高亮（mentionIdx = -1）时补第一项：Tab 在补全里不该"什么都不做"
       const c = mentionCands[Math.max(0, mentionIdx)];
       if (c) pickMention(c);
       return;
      }
      // Esc 关浮层也认「正在取词」这一态（此时还没有候选，completing 为假）
      if (e.key === "Escape" && mentionOpen) {
       setMentionDismissed(mentionQueryKey);
       setMentionCands([]);
       setMentionIdx(-1);
       return;
      }
      if (completing && e.key === "Enter" && !e.shiftKey && !(e.metaKey || e.ctrlKey)) {
       const c = mentionIdx >= 0 ? mentionCands[mentionIdx] : undefined;
       if (c) {
        e.preventDefault();
        pickMention(c);
        return;
       }
      }
      // ↑↓ 调回已发送的 prompt 历史（V41，codex 的「Press Up or Down to restore draft history」）：
      // ↑ 只在光标位于开头（或正在浏览）时接管——多行编辑中照常移动光标；↓ 只在浏览态接管。
      if (e.key === "ArrowUp" && !e.shiftKey && !slashOpen && !completing && activeSessionId) {
       const ta = e.currentTarget;
       if (browsing || (ta.selectionStart === 0 && ta.selectionEnd === 0)) {
        e.preventDefault();
        browseHistory(-1);
        return;
       }
      }
      if (e.key === "ArrowDown" && !e.shiftKey && !slashOpen && !completing && browsing) {
       e.preventDefault();
       browseHistory(1);
       return;
      }
      // Shift+Tab = 执行模式循环（V40，对齐 codex / zcode 的 Shift+Tab；补全浮层开着时放行——
      // 与参照物同口径：补全上下文优先级更高）
      if (e.key === "Tab" && e.shiftKey && !slashOpen && mentionEmpty && activeSessionId && !archived) {
       e.preventDefault();
       void cycleApproval();
       return;
      }
      // Tab = 排队（V39/V40，对齐 codex 的「Tab to queue message」）：流式中且有内容时把草稿排进
      // 本轮之后。补全浮层（`/` 与 `@`）开着时上面的分支已经吃掉 Tab。
      if (
       e.key === "Tab" &&
       !e.shiftKey &&
       running &&
       activeSessionId &&
       !archived &&
       !slashOpen &&
       mentionEmpty &&
       (draft.trim() || attachments.length > 0)
      ) {
       e.preventDefault();
       void sendQueued("follow_up");
       return;
      }
      if (e.key === "Enter" && !e.shiftKey && !(e.metaKey || e.ctrlKey)) {
       e.preventDefault();
       void send();
      }
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && running && activeSessionId) {
       // 流式中 Cmd/Ctrl+Enter = 排队（follow_up，本轮后执行）——与 omp 终端的 ctrl+enter / ctrl+q 对齐
       e.preventDefault();
       void sendQueued("follow_up");
      }
      if (e.key === "Escape" && running && activeSessionId) {
       // Esc = 中断并交还队列（V40；omp TUI 的 Esc 等价物）
       void abortAndRestore(activeSessionId);
      }
     }}
     disabled={awaiting}
     placeholder={
      awaiting
       ? t.resolveApprovalFirst
       : dragging
        ? t.placeholderDragging
        : running
         ? t.placeholderRunning
         : empty
          ? t.placeholderNew
          : t.placeholderIdle
     }
     className="no-focus-ring max-h-44 w-full resize-none bg-transparent px-3.5 pt-3 pb-1 text-sm leading-6 outline-none placeholder:text-faint disabled:opacity-60"
    />
    <div className="flex flex-wrap items-center gap-0.5 gap-y-1 px-2 py-1.5">
     {/* 卡底工具行（v2 §3）：左 = `+`（附件 / 引用文件 / 图片）+ 执行模式菜单 + 排队徽标；
         右 = 压缩行动点 / 上下文容量环 / 供应商用量（2026-10-14 从顶栏右端搬进输入卡）+
         模型 / 思考档（两个独立选择器）+ 发送 / 停止 */}
     <PlusMenu
      onPickImages={() => void pickImages()}
      onPickRef={() => {
       if (activeSessionId) useApp.getState().set({ refPickerTarget: { sessionId: activeSessionId } });
      }}
      disabled={!activeSessionId || awaiting}
     />
     <ApprovalModeMenu />
     <QueueBadge />
     <div className="ml-auto flex min-w-0 flex-wrap items-center justify-end gap-1">
      <CompactButton />
      {/* 模型与思考档是两个独立选择器（2026-10-14 拆分）：模型名 ▾ 与 档位 ▾ 各开各的浮层 */}
      <ModelMenu />
      <ThinkingMenu />
      {/* 运行中 = 同一个圆形键变「停止」（v2：idle 圆形 ↑；running 停止 ■） */}
      {running ? (
       <button
        onClick={() => activeSessionId && void abortAndRestore(activeSessionId)}
        className="ml-1 flex h-7 w-7 cursor-pointer items-center justify-center rounded-full bg-primary text-primary-foreground transition-opacity duration-150 hover:opacity-90"
        aria-label={t.stop}
        title={t.stop}
       >
        <span className="h-2 w-2 rounded-[2px] bg-primary-foreground" aria-hidden />
       </button>
      ) : (
       <button
        onClick={() => void send()}
        disabled={(!draft.trim() && attachments.length === 0) || awaiting}
        className="ml-1 flex h-7 w-7 cursor-pointer items-center justify-center rounded-full bg-primary text-primary-foreground transition-opacity duration-150 hover:opacity-90 disabled:cursor-default disabled:opacity-30"
        aria-label={t.sendAria}
       >
        <ArrowUp size={15} aria-hidden />
       </button>
      )}
     </div>
    </div>
    {/* 卡底统计条（2026-10-16，对齐 DeepSeek Harness 的 composer dock）：
        **独占一行**——它是**卡片的直接子元素**，不许塞进上面工具行的 `flex-wrap` 容器里：
        那样它只会变成行尾的又一个 flex item，跟模型 / 思考档 / 发送键挤在同一行、
        `border-t` 分隔线也只剩自己那半截宽（用户实测的错位）。
        四项：会话统计 / Token 用量 / 上下文占用 / 供应商用量，各自点开明细 */}
    <SessionStatsBar />
   </div>
  </div >
 );
}

/**
 * 待发队列的一行（V40）：插话 / 排队标签 + 文本 + hover 操作（撤回 / 编辑 / 提升）。
 * 编辑 = 整条退回输入框并从队列移除（zcode 待发送队列同口径）；提升只给排队行
 * （followUp → steering：下一个工具边界插话）。
 */
function QueueRow({
 mode,
 text,
 onEdit,
 onRemove,
 onPromote,
}: {
 mode: "steer" | "queue";
 text: string;
 onEdit: () => void;
 onRemove: () => void;
 onPromote?: () => void;
}) {
 const t = useText();
 return (
  <li title={text} className="group flex items-center gap-1.5 text-[13px] text-muted">
   {mode === "steer" ? (
    <Timer size={13} className="shrink-0 text-accent" aria-hidden />
   ) : (
    <Hourglass size={13} className="shrink-0 text-accent" aria-hidden />
   )}
   <span className="shrink-0 text-accent">{mode === "steer" ? t.pendingSteer : t.pendingQueue}</span>
   <span className="min-w-0 truncate">{text}</span>
   <span className="ml-auto flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity duration-100 group-hover:opacity-100 focus-within:opacity-100">
    {onPromote && (
     <button
      onClick={onPromote}
      className="cursor-pointer rounded p-0.5 text-faint transition-colors duration-100 hover:bg-hover hover:text-foreground"
      aria-label={t.pendingPromoteAria}
      title={t.pendingPromoteAria}
     >
      <ArrowUp size={12} aria-hidden />
     </button>
    )}
    <button
     onClick={onEdit}
     className="cursor-pointer rounded p-0.5 text-faint transition-colors duration-100 hover:bg-hover hover:text-foreground"
     aria-label={t.pendingEditAria}
     title={t.pendingEditAria}
    >
     <PenLine size={12} aria-hidden />
    </button>
    <button
     onClick={onRemove}
     className="cursor-pointer rounded p-0.5 text-faint transition-colors duration-100 hover:bg-hover hover:text-danger"
     aria-label={t.pendingRemoveAria}
     title={t.pendingRemoveAria}
    >
     <X size={12} aria-hidden />
    </button>
   </span>
  </li>
 );
}
