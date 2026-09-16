import { useEffect, useMemo, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { ArrowUp, FileText, ImagePlus, TriangleWarning, X } from "reicon-react";
import { useApp } from "../../stores/app";
import { api } from "@shared/api";
import { attachmentFromFile, dataUrl } from "../../lib/attachments";
import { fmt } from "../../lib/locale";
import { extractMentions } from "../../lib/mentions";
import { commandInsert, filterCommands, isCompleteCommand, normalizeCommands, type SlashCandidate } from "../../lib/slashCommands";
import { useText } from "../../lib/useText";
import { ModelPicker } from "../pickers/ModelPicker";
import { ThinkingPicker } from "../pickers/ThinkingPicker";
import { PermissionBadge } from "../pickers/PermissionBadge";
import { CompactButton, OmpStatusPill, QueueBadge, RuntimeStats } from "../thread/StatusBar";
import { ContextBar } from "./ContextBar";
import { ContextMeter } from "./ContextMeter";
import { MentionList } from "./MentionList";
import { SlashMenu } from "./SlashMenu";

/**
 * 会话输入框：随心输入 + 底部工具行（截图布局）。
 * 上：上下文条（项目 / git 分支）+ 附件条 + 多行输入；下左：图片 / 权限；下右：模型 / 思考档 / 发送-停止。
 * 模型·思考档·权限只放这里，顶栏不再重复（UpdateBell 除外）。
 *
 * 图片附件（V2 M6）：粘贴 / 拖拽 / 点回形针三条入口，全部读成 base64 存在内存里，
 * 发送时随 `prompt.images` 一次性交给 omp——应用不落盘、不写覆盖层。
 */
export function Composer() {
 const t = useText();
 const { activeSessionId, draftOf, setDraft, statusBySession, sessions, attachmentsOf, addAttachments, removeAttachment, clearAttachments, currentModel, currentRuntime, models } =
  useApp();
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
 const attachments = attachmentsOf(activeSessionId);
 const status = activeSessionId ? statusBySession[activeSessionId]?.state : undefined;
 const running = status === "running" || status === "awaiting-approval";
 const awaiting = status === "awaiting-approval";
 const archived = sessions.find((s) => s.id === activeSessionId)?.archived;
 // @文件 提及（V2 M6b）：展开由 omp 做，这里只把草稿里的提及显示成芯片并问一次「路径存在吗」
 const cwd = sessions.find((s) => s.id === activeSessionId)?.cwd ?? "";
 const mentions = useMemo(() => extractMentions(draft), [draft]);
 const mentionKey = `${cwd}\u0000${mentions.join("\u0000")}`;
 const [checks, setChecks] = useState<{ key: string; exists: Record<string, boolean> }>({ key: "", exists: {} });
 const [attachError, setAttachError] = useState<string | null>(null);
 const [dragging, setDragging] = useState(false);
 // `@` 补全状态：mentionIdx 为高亮下标，-1 = 无补全；mentionToken 是 `@` 后的路径前缀。
 const [mentionIdx, setMentionIdx] = useState(-1);
 const [mentionCands, setMentionCands] = useState<{ path: string; isDir: boolean }[]>([]);
 const [caret, setCaret] = useState(0);

 useEffect(() => {
  if (mentions.length === 0 || !cwd) return;
  let alive = true;
  // 打字期间不做请求：停 300ms 再问后端（只 stat，无副作用）
  const timer = setTimeout(() => {
   void api
    .checkPaths(cwd, mentions)
    .then((rs) => {
     if (alive) setChecks({ key: mentionKey, exists: Object.fromEntries(rs.map((r) => [r.path, r.exists])) });
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
 const commands = useMemo(() => normalizeCommands(currentRuntime?.commands), [currentRuntime?.commands]);
 // `/` 补全只在草稿是单条命令、光标还在首个 token 内时开。**流式中不开**：那时 Enter 走 follow_up
 // 排队，`/xxx` 是当文本发出去的，弹出补全等于暗示它能当命令跑。
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

 // `@` 补全：取光标前 `@` 起的路径前缀，300ms 防抖问后端（只读目录列举）。
 const mentionToken = (() => {
  const before = draft.slice(0, caret);
  const m = /@([^\s@]*)$/.exec(before);
  return m ? m[1] : null;
 })();
 const mentionEmpty = mentionToken == null || !cwd || !activeSessionId || slashToken !== null;
 useEffect(() => {
  if (mentionEmpty) return;
  let alive = true;
  const timer = setTimeout(() => {
   void api
    .completePath(cwd, mentionToken)
    .then((rs) => {
     if (alive) {
      setMentionCands(rs);
      setMentionIdx(rs.length > 0 ? 0 : -1);
     }
    })
    .catch(() => undefined);
  }, 300);
  return () => {
   alive = false;
   clearTimeout(timer);
  };
 }, [mentionToken, cwd, activeSessionId, mentionEmpty]);

 // 选中一条候选：把光标前的 `@前缀` 换成完整路径（目录补 `/` 接着往里打，文件补空格收尾）。
 // 点击、Tab、Enter 三个入口共用它，免得三处各写一遍替换规则。
 const pickMention = (c: { path: string; isDir: boolean }) => {
  const before = draft.slice(0, caret);
  setDraft(activeSessionId, before.replace(/@[^\s@]*$/, `@${c.path}${c.isDir ? "/" : " "}`) + draft.slice(caret));
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

 const addFiles = async (files: File[]) => {
  const skipped = files.filter((f) => !f.type.startsWith("image/"));
  const images = files.filter((f) => f.type.startsWith("image/"));
  if (images.length === 0) {
   if (skipped.length > 0) setAttachError(t.attachOnlyImages);
   return;
  }
  setAttachError(skipped.length > 0 ? t.attachSomeIgnored : null);
  const added = [];
  for (const f of images) {
   try {
    added.push(await attachmentFromFile(f, t));
   } catch (e) {
    setAttachError(e instanceof Error ? e.message : t.attachReadFailed);
   }
  }
  if (added.length > 0) addAttachments(activeSessionId, added);
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
   const added = [];
   for (const p of paths) {
    try {
     added.push(await api.readImageFile(p));
    } catch (e) {
     setAttachError(e instanceof Error ? e.message : t.attachReadFailed);
    }
   }
   if (added.length > 0) addAttachments(activeSessionId, added);
  } catch (e) {
   setAttachError(e instanceof Error ? e.message : t.attachPickFailed);
  }
 };

 // 流式中追问：running 时 Enter 走排队（follow_up，本轮后执行），
 // Cmd/Ctrl+Enter 走转向（steer，下一个工具边界生效）；idle 时还是普通发送。
 const sendQueued = async (mode: "steer" | "follow_up") => {
  if (!activeSessionId || (!draft.trim() && attachments.length === 0) || archived) return;
  const text = draft;
  const sentImages = attachments;
  setDraft(activeSessionId, "");
  clearAttachments(activeSessionId);
  try {
   const fn = mode === "steer" ? api.steerMessage : api.followUpMessage;
   await fn(
    activeSessionId,
    text,
    sentImages.map((a) => ({ name: a.name, mimeType: a.mimeType, dataBase64: a.dataBase64, bytes: a.bytes })),
   );
  } catch {
   setDraft(activeSessionId, text);
   addAttachments(activeSessionId, sentImages);
  }
 };

 const send = async () => {
  // `/` 开头是本地命令：经 run_slash 直发（command_output 回来，无 agent turn）
  if (!running && draft.trim().startsWith("/") && attachments.length === 0 && activeSessionId && !archived) {
   const cmd = draft.trim();
   setDraft(activeSessionId, "");
   try {
    await api.runSlash(activeSessionId, cmd);
   } catch {
    setDraft(activeSessionId, cmd);
   }
   return;
  }
  if (running && activeSessionId && (draft.trim() || attachments.length > 0) && !archived) {
   void sendQueued("follow_up");
   return;
  }
  if (!activeSessionId || (!draft.trim() && attachments.length === 0) || running || archived) return;
  const text = draft;
  const sentImages = attachments;
  // 乐观回显：先落一条本地 user 消息，id 带时间戳；
  // 历史回放里同一文本的 `u:<行id>` 到达时按文本合并去重，不翻倍。
  // eslint-disable-next-line react-hooks/purity -- send 是点击事件处理，非 render
  const optimisticId = `u-local-${Date.now()}`;
  useApp.getState().appendEvents(activeSessionId, [
   {
    kind: "user",
    id: optimisticId,
    text,
    mentions: extractMentions(text),
    ...(sentImages.length > 0
     ? { images: sentImages.map((a) => ({ mimeType: a.mimeType, data: a.dataBase64 })) }
     : {}),
   } as never,
  ]);
  setDraft(activeSessionId, "");
  clearAttachments(activeSessionId);
  try {
   await api.sendMessage(
    activeSessionId,
    text,
    sentImages.map((a) => ({ name: a.name, mimeType: a.mimeType, dataBase64: a.dataBase64, bytes: a.bytes })),
   );
  } catch {
   // 发失败就把草稿与附件还回去、不留幽灵消息，不让用户重打一遍
   setDraft(activeSessionId, text);
   addAttachments(activeSessionId, sentImages);
   const st = useApp.getState();
   st.set({
    eventsBySession: {
     ...st.eventsBySession,
     [activeSessionId]: (st.eventsBySession[activeSessionId] ?? []).filter((m) => m.id !== optimisticId),
    },
   });
  }
 };

 if (archived) {
  return (
   <div className="shrink-0 px-4 pb-4">
    <div className="mx-auto max-w-3xl rounded-xl border border-border bg-surface px-4 py-3 text-center text-sm text-muted">
     {t.archivedComposerHint}
    </div>
   </div>
  );
 }

 return (
  <div className="shrink-0 px-4 pb-4">
   {/* 上下文条在卡片外、上方：项目 + git 分支（无项目时自身不渲染） */}
   <ContextBar />
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
     void addFiles(Array.from(e.dataTransfer.files));
    }}
    className={`mx-auto max-w-3xl rounded-xl border bg-surface transition-colors duration-100 ${dragging ? "border-accent bg-accent/5" : awaiting ? "border-warn/60" : "border-border focus-within:border-accent/70"
     }`}
   >
    {awaiting && <div className="px-4 pt-2.5 text-[13px] text-warn">{t.resolveApprovalFirst}</div>}
    {attachments.length > 0 && (
     <div className="flex flex-wrap gap-2 px-3 pt-3">
      {attachments.map((a, i) => (
       <div key={`${a.name}-${i}`} className="group relative">
        <img
         src={dataUrl(a)}
         alt={a.name}
         title={`${a.name} · ${Math.round(a.bytes / 1024)}KB`}
         className="h-16 w-16 rounded-md border border-border object-cover"
        />
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
    {mentions.length > 0 && (
     <div className="flex flex-wrap items-center gap-1.5 px-3 pt-2" aria-label={t.mentionsAria}>
      {mentions.map((p) => {
       const exists = checks.key === mentionKey ? checks.exists[p] : undefined;
       const missing = exists === false;
       return (
        <span
         key={p}
         title={missing ? t.mentionMissingTitle : p}
         className={`inline-flex max-w-full items-center gap-1.5 rounded-md border px-2 py-0.5 font-mono text-xs ${missing ? "border-warn/50 text-warn" : "border-border text-muted"
          }`}
        >
         {missing ? <TriangleWarning size={12} aria-hidden /> : <FileText size={12} aria-hidden />}
         <span className="truncate">{p}</span>
         <span className="sr-only">{missing ? t.pathMissing : t.pathExists}</span>
        </span>
       );
      })}
      <span className="text-[13px] text-muted">{t.mentionSendHint}</span>
     </div>
    )}
    {imageUnsupported && (
     <div className="px-4 pt-2 text-[13px] text-warn">{t.imageUnsupported}</div>
    )}
    <label htmlFor="composer" className="sr-only">
     {t.composerLabel}
    </label>
    {/* `@` 路径补全：前缀匹配的目录列举，Tab/Enter 选中 */}
    {mentionToken !== null && !mentionEmpty && mentionCands.length > 0 && (
     <MentionList cands={mentionCands} active={mentionIdx} onPick={pickMention} onHover={setMentionIdx} />
    )}
    {/* `/` 命令补全：omp 命令面（含技能），限高内部滚动，不挤压输入框 */}
    {slashOpen && (
     <SlashMenu cands={slashCands} active={slashIdx} query={slashToken ?? ""} onPick={pickCommand} onHover={hoverSlash} />
    )}
    <textarea
     id="composer"
     rows={3}
     value={draft}
     onChange={(e) => {
      persistDraft(activeSessionId, e.target.value);
      setCaret(e.target.selectionStart ?? e.target.value.length);
     }}
     onSelect={(e) => setCaret(e.currentTarget.selectionStart ?? 0)}
     onClick={(e) => setCaret(e.currentTarget.selectionStart ?? 0)}
     onPaste={(e) => {
      const files = Array.from(e.clipboardData?.files ?? []);
      if (files.length === 0) return;
      // 只拦截图片：文字照常粘贴，图文混贴时文字不丢；
      // 纯文本粘贴（files 为空）直接放行，不碰剪贴板。
      const images = files.filter((f) => f.type.startsWith("image/"));
      if (images.length === 0) {
       if (files.length > 0) setAttachError(t.attachOnlyImages);
       return;
      }
      e.preventDefault();
      const text = e.clipboardData?.getData("text/plain") ?? "";
      if (text) {
       const el = e.currentTarget;
       const start = el.selectionStart ?? draft.length;
       const end = el.selectionEnd ?? draft.length;
       setDraft(activeSessionId, draft.slice(0, start) + text + draft.slice(end));
      }
      void addFiles(files);
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
      if (completing && e.key === "Escape") {
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
      if (e.key === "Enter" && !e.shiftKey && !(e.metaKey || e.ctrlKey)) {
       e.preventDefault();
       void send();
      }
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && running && activeSessionId) {
       // 流式中 Cmd/Ctrl+Enter = 转向（steer），不砍掉进行中的工作
       e.preventDefault();
       void sendQueued("steer");
      }
      if (e.key === "Escape" && running && activeSessionId) {
       void api.stop(activeSessionId).catch(() => undefined);
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
         : t.placeholderIdle
     }
     className="no-focus-ring max-h-44 w-full resize-none bg-transparent px-3.5 pt-3 pb-1 text-sm leading-6 outline-none placeholder:text-faint disabled:opacity-60"
    />
    <div className="flex flex-wrap items-center gap-0.5 gap-y-1 px-2 py-1.5">
     <button
      onClick={() => void pickImages()}
      disabled={awaiting}
      className="cursor-pointer rounded-md p-1.5 text-muted transition-colors duration-100 hover:bg-hover hover:text-foreground disabled:cursor-default disabled:opacity-40"
      aria-label={t.attachAddAria}
      title={t.attachAddTitle}
     >
      <ImagePlus size={16} aria-hidden />
     </button>
     <PermissionBadge compact align="left" />
     <OmpStatusPill />
     <QueueBadge />
     <CompactButton />
     <RuntimeStats />
     <div className="ml-auto flex min-w-0 flex-wrap items-center justify-end gap-1">
      <ContextMeter />
      <ModelPicker compact />
      <ThinkingPicker compact />
      {running ? (
       <>
        <button
         onClick={() => void sendQueued("follow_up")}
         disabled={!draft.trim() && attachments.length === 0}
         className="ml-1 cursor-pointer rounded-md border border-border px-3 py-1 text-[13px] text-muted transition-colors duration-100 hover:bg-hover hover:text-foreground disabled:cursor-default disabled:opacity-40"
         aria-label={t.queueActionAria}
         title={t.queueActionAria}
        >
         {t.queueAction}
        </button>
        <button
         onClick={() => activeSessionId && api.stop(activeSessionId).catch(() => undefined)}
         className="ml-1 flex cursor-pointer items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-[13px] font-medium text-white transition-opacity duration-150 hover:opacity-90"
         aria-label={t.stop}
        >
         <span className="h-2 w-2 rounded-[2px] bg-white" aria-hidden />
         {t.stop}
        </button>
       </>
      ) : (
       <button
        onClick={() => void send()}
        disabled={(!draft.trim() && attachments.length === 0) || awaiting}
        className="ml-1 flex h-7 w-7 cursor-pointer items-center justify-center rounded-md bg-accent text-white transition-opacity duration-150 hover:opacity-90 disabled:cursor-default disabled:opacity-30"
        aria-label={t.sendAria}
       >
        <ArrowUp size={15} aria-hidden />
       </button>
      )}
     </div>
    </div>
   </div>
  </div>
 );
}
