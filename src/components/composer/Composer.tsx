import { useEffect, useMemo, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { FileText, FileWarning, ImagePlus, X } from "lucide-react";
import { useApp } from "../../stores/app";
import { api } from "@shared/api";
import { attachmentFromFile, dataUrl } from "../../lib/attachments";
import { extractMentions } from "../../lib/mentions";
import { ModelPicker } from "../pickers/ModelPicker";
import { ThinkingPicker } from "../pickers/ThinkingPicker";
import { PermissionBadge } from "../pickers/PermissionBadge";
import { CompactButton, OmpStatusPill, QueueBadge, RuntimeStats } from "../thread/StatusBar";
import { ContextBar } from "./ContextBar";

/**
 * 会话输入框：随心输入 + 底部工具行（截图布局）。
 * 上：上下文条（项目 / git 分支）+ 附件条 + 多行输入；下左：图片 / 权限；下右：模型 / 思考档 / 发送-停止。
 * 模型·思考档·权限只放这里，顶栏不再重复（UpdateBell 除外）。
 *
 * 图片附件（V2 M6）：粘贴 / 拖拽 / 点回形针三条入口，全部读成 base64 存在内存里，
 * 发送时随 `prompt.images` 一次性交给 omp——应用不落盘、不写覆盖层。
 */
export function Composer() {
  const { activeSessionId, draftOf, setDraft, statusBySession, sessions, attachmentsOf, addAttachments, removeAttachment, clearAttachments, currentModel, models } =
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
  const commands = useApp((s) => (activeSessionId ? (s.commandsBySession[activeSessionId] ?? []) : []));
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
  // 补全状态：slashIdx/mentionIdx 为高亮下标，-1 = 无补全；
  // slashToken 是 `/` 后的过滤词，mentionToken 是 `@` 后的路径前缀。
  const [slashIdx, setSlashIdx] = useState(-1);
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

  // `/` 补全：行首 `/` + 连续非空字符为过滤词；有可用命令面时才参与过滤，
  // 无命令面（未收到 available_commands_update）时不弹框、不误报。
  const slashToken = (() => {
    const before = draft.slice(0, caret);
    const m = /(?:^|\n)\/(\S*)$/.exec(before);
    return m ? m[1] : null;
  })();
  const slashCands =
    slashToken == null || commands.length === 0
      ? []
      : commands
          .filter((c) => `/${c.name}`.startsWith(`/${slashToken}`) || (c.aliases ?? []).some((a) => `/${a}`.startsWith(`/${slashToken}`)))
          .slice(0, 8);
  // `@` 补全：取光标前 `@` 起的路径前缀，300ms 防抖问后端（只读目录列举）。
  const mentionToken = (() => {
    const before = draft.slice(0, caret);
    const m = /@([^\s@]*)$/.exec(before);
    return m ? m[1] : null;
  })();
  const mentionEmpty = mentionToken == null || !cwd || !activeSessionId;
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

  // 模型是否支持图片（模型目录里 `input` 含 image）；目录没加载出来时不做判断，不误报
  const model = models?.models.find((m) => `${m.provider}/${m.id}` === currentModel);
  const imageUnsupported = attachments.length > 0 && !!model?.input && !model.input.includes("image");

  const addFiles = async (files: File[]) => {
    const skipped = files.filter((f) => !f.type.startsWith("image/"));
    const images = files.filter((f) => f.type.startsWith("image/"));
    if (images.length === 0) {
      if (skipped.length > 0) setAttachError("只支持 PNG / JPEG / WebP / GIF 图片，其他文件已忽略");
      return;
    }
    setAttachError(skipped.length > 0 ? "非图片文件已忽略，只添加了图片" : null);
    const added = [];
    for (const f of images) {
      try {
        added.push(await attachmentFromFile(f));
      } catch (e) {
        setAttachError(e instanceof Error ? e.message : "图片读取失败");
      }
    }
    if (added.length > 0) addAttachments(activeSessionId, added);
  };

  const pickImages = async () => {
    try {
      const picked = await open({
        multiple: true,
        filters: [{ name: "图片", extensions: ["png", "jpg", "jpeg", "webp", "gif"] }],
      });
      if (!picked) return;
      const paths = Array.isArray(picked) ? picked : [picked];
      setAttachError(null);
      const added = [];
      for (const p of paths) {
        try {
          added.push(await api.readImageFile(p));
        } catch (e) {
          setAttachError(e instanceof Error ? e.message : "图片读取失败");
        }
      }
      if (added.length > 0) addAttachments(activeSessionId, added);
    } catch (e) {
      setAttachError(e instanceof Error ? e.message : "打开文件选择器失败");
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
        <div className="mx-auto max-w-3xl rounded-2xl border border-border/70 bg-surface px-4 py-3 text-center text-sm text-muted">
          已归档，只读——取消归档后可继续对话
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
        className={`mx-auto max-w-3xl rounded-2xl border bg-surface shadow-[0_8px_28px_-12px_rgba(0,0,0,0.35)] transition-colors duration-150 ${
          dragging ? "border-accent bg-accent/5" : awaiting ? "border-warn/50" : "border-border/80 focus-within:border-accent/60"
        }`}
      >
        {awaiting && <div className="px-4 pt-2.5 text-xs text-warn">先处理上面的审批</div>}
        {attachments.length > 0 && (
          <div className="flex flex-wrap gap-2 px-3 pt-3">
            {attachments.map((a, i) => (
              <div key={`${a.name}-${i}`} className="group relative">
                <img
                  src={dataUrl(a)}
                  alt={a.name}
                  title={`${a.name} · ${Math.round(a.bytes / 1024)}KB`}
                  className="h-16 w-16 rounded-lg border border-border/70 object-cover"
                />
                <button
                  onClick={() => removeAttachment(activeSessionId, i)}
                  aria-label={`移除 ${a.name}`}
                  className="absolute -top-1.5 -right-1.5 cursor-pointer rounded-full border border-border bg-surface p-0.5 text-muted opacity-0 transition-opacity duration-150 group-hover:opacity-100 hover:text-danger focus:opacity-100"
                >
                  <X size={12} aria-hidden />
                </button>
              </div>
            ))}
          </div>
        )}
        {attachError && <div className="px-4 pt-2 text-xs text-danger">{attachError}</div>}
        {mentions.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 px-3 pt-2" aria-label="@提及的文件">
            {mentions.map((p) => {
              const exists = checks.key === mentionKey ? checks.exists[p] : undefined;
              const missing = exists === false;
              return (
                <span
                  key={p}
                  title={missing ? "这个路径在会话目录下不存在，omp 会跳过" : p}
                  className={`inline-flex max-w-full items-center gap-1.5 rounded-lg border px-2 py-0.5 font-mono text-xs ${
                    missing ? "border-warn/50 text-warn" : "border-border/70 text-muted"
                  }`}
                >
                  {missing ? <FileWarning size={12} aria-hidden /> : <FileText size={12} aria-hidden />}
                  <span className="truncate">{p}</span>
                  <span className="sr-only">{missing ? "路径不存在" : "路径存在"}</span>
                </span>
              );
            })}
            <span className="text-xs text-muted">发送时由 omp 读进上下文</span>
          </div>
        )}
        {imageUnsupported && (
          <div className="px-4 pt-2 text-xs text-warn">当前模型可能不支持图片，发送前请确认模型是否带视觉能力</div>
        )}
        <label htmlFor="composer" className="sr-only">
          输入消息
        </label>
        {/* `/` 命令补全：有可用命令面且行首命中时才出现 */}
        {slashToken !== null && slashCands.length > 0 && (
          <div className="mx-3 mb-1 overflow-hidden rounded-lg border border-border/70 bg-background" role="listbox" aria-label="可用命令">
            {slashCands.map((c, i) => (
              <button
                key={c.name}
                role="option"
                aria-selected={i === slashIdx}
                onClick={() => {
                  const before = draft.slice(0, caret);
                  const after = draft.slice(caret);
                  const replaced = before.replace(/(?:^|\n)\/\S*$/, (m) => m.replace(/\/\S*$/, `/${c.name} `));
                  setDraft(activeSessionId, replaced + after);
                  setSlashIdx(-1);
                }}
                onMouseEnter={() => setSlashIdx(i)}
                className={`block w-full cursor-pointer px-2.5 py-1.5 text-left text-[13px] transition-colors duration-100 ${i === slashIdx ? "bg-accent/10 text-foreground" : "text-muted"}`}
              >
                <span className="font-mono font-medium">/{c.name}</span>
                {c.description && <span className="ml-2 text-xs text-muted">{c.description}</span>}
              </button>
            ))}
          </div>
        )}
        {/* `@` 路径补全：前缀匹配的目录列举，Tab/Enter 选中 */}
        {mentionToken !== null && !mentionEmpty && mentionCands.length > 0 && (
          <div className="mx-3 mb-1 overflow-hidden rounded-lg border border-border/70 bg-background" role="listbox" aria-label="路径补全">
            {mentionCands.map((c, i) => (
              <button
                key={c.path}
                role="option"
                aria-selected={i === mentionIdx}
                onClick={() => {
                  const before = draft.slice(0, caret);
                  const after = draft.slice(caret);
                  const replaced = before.replace(/@[^\s@]*$/, `@${c.path}${c.isDir ? "/" : " "}`);
                  setDraft(activeSessionId, replaced + after);
                  setMentionIdx(-1);
                  setMentionCands([]);
                }}
                onMouseEnter={() => setMentionIdx(i)}
                className={`block w-full cursor-pointer px-2.5 py-1.5 text-left font-mono text-[13px] transition-colors duration-100 ${i === mentionIdx ? "bg-accent/10 text-foreground" : "text-muted"}`}
              >
                {c.isDir ? `${c.path}/` : c.path}
              </button>
            ))}
          </div>
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
              if (files.length > 0) setAttachError("只支持 PNG / JPEG / WebP / GIF 图片，其他文件已忽略");
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
            // 补全打开时：上下键导航、Tab/Enter 选中、Esc 关闭（优先于发送）
            const completing = slashCands.length > 0 || mentionCands.length > 0;
            if (completing && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
              e.preventDefault();
              if (slashCands.length > 0) {
                setSlashIdx((i) => (i + (e.key === "ArrowDown" ? 1 : -1) + slashCands.length) % slashCands.length);
              } else {
                setMentionIdx((i) => (i + (e.key === "ArrowDown" ? 1 : -1) + mentionCands.length) % mentionCands.length);
              }
              return;
            }
            if (completing && e.key === "Tab") {
              e.preventDefault();
              if (slashCands.length > 0 && slashCands[Math.max(0, slashIdx)]) {
                const c = slashCands[Math.max(0, slashIdx)];
                const before = draft.slice(0, caret);
                setDraft(activeSessionId, before.replace(/(?:^|\n)\/\S*$/, (m) => m.replace(/\/\S*$/, `/${c.name} `)) + draft.slice(caret));
                setSlashIdx(-1);
              } else if (mentionCands.length > 0 && mentionCands[Math.max(0, mentionIdx)]) {
                const c = mentionCands[Math.max(0, mentionIdx)];
                const before = draft.slice(0, caret);
                setDraft(activeSessionId, before.replace(/@[^\s@]*$/, `@${c.path}${c.isDir ? "/" : " "}`) + draft.slice(caret));
                setMentionIdx(-1);
                setMentionCands([]);
              }
              return;
            }
            if (completing && e.key === "Escape") {
              setSlashIdx(-1);
              setMentionCands([]);
              setMentionIdx(-1);
              return;
            }
            if (completing && e.key === "Enter" && !e.shiftKey && !(e.metaKey || e.ctrlKey)) {
              const hasSel = slashIdx >= 0 || mentionIdx >= 0;
              if (hasSel) {
                e.preventDefault();
                if (slashCands.length > 0 && slashCands[Math.max(0, slashIdx)]) {
                  const c = slashCands[Math.max(0, slashIdx)];
                  const before = draft.slice(0, caret);
                  setDraft(activeSessionId, before.replace(/(?:^|\n)\/\S*$/, (m) => m.replace(/\/\S*$/, `/${c.name} `)) + draft.slice(caret));
                  setSlashIdx(-1);
                } else if (mentionCands.length > 0 && mentionCands[Math.max(0, mentionIdx)]) {
                  const c = mentionCands[Math.max(0, mentionIdx)];
                  const before = draft.slice(0, caret);
                  setDraft(activeSessionId, before.replace(/@[^\s@]*$/, `@${c.path}${c.isDir ? "/" : " "}`) + draft.slice(caret));
                  setMentionIdx(-1);
                  setMentionCands([]);
                }
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
              ? "先处理上面的审批"
              : dragging
                ? "松手即可添加图片"
                : running
                  ? "输入追问，Enter 排队本轮后执行，⌘/Ctrl+Enter 立即转向"
                  : "随心输入（@ 引用文件，/ 查看命令）"
          }
          className="max-h-44 w-full resize-none bg-transparent px-4 pt-3.5 pb-1 text-sm leading-6 outline-none placeholder:text-muted/70 disabled:opacity-60"
        />
        <div className="flex flex-wrap items-center gap-0.5 gap-y-1 px-2.5 pb-2.5">
          <button
            onClick={() => void pickImages()}
            disabled={awaiting}
            className="cursor-pointer rounded-full p-2 text-muted transition-colors duration-150 hover:bg-background hover:text-foreground disabled:cursor-default disabled:opacity-40"
            aria-label="添加图片"
            title="添加图片（也可直接粘贴 / 拖入）"
          >
            <ImagePlus size={16} aria-hidden />
          </button>
          <PermissionBadge compact align="left" />
          <OmpStatusPill />
          <QueueBadge />
          <CompactButton />
          <RuntimeStats />
          <div className="ml-auto flex min-w-0 flex-wrap items-center justify-end gap-1">
            <ModelPicker compact />
            <ThinkingPicker compact />
            {running ? (
              <>
                <button
                  onClick={() => void sendQueued("follow_up")}
                  disabled={!draft.trim() && attachments.length === 0}
                  className="ml-1 cursor-pointer rounded-full border border-border px-3 py-1.5 text-xs text-muted transition-colors duration-150 hover:bg-background hover:text-foreground disabled:cursor-default disabled:opacity-40"
                  aria-label="排队追问（本轮后执行）"
                  title="排队追问（本轮后执行）"
                >
                  排队
                </button>
                <button
                  onClick={() => activeSessionId && api.stop(activeSessionId).catch(() => undefined)}
                  className="ml-1 flex cursor-pointer items-center gap-1.5 rounded-full bg-accent px-3.5 py-1.5 text-sm text-white transition-opacity duration-150 hover:opacity-90"
                  aria-label="停止"
                >
                  <span className="h-2 w-2 rounded-sm bg-white" aria-hidden />
                  停止
                </button>
              </>
            ) : (
              <button
                onClick={() => void send()}
                disabled={(!draft.trim() && attachments.length === 0) || awaiting}
                className="ml-1 flex h-8 w-8 cursor-pointer items-center justify-center rounded-full bg-accent text-white transition-all duration-150 hover:opacity-90 disabled:cursor-default disabled:opacity-30"
                aria-label="发送"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
                  <path d="M12 19V5m0 0-6 6m6-6 6 6" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
