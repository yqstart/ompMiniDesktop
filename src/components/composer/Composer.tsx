import { useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { ImagePlus, X } from "lucide-react";
import { useApp } from "../../stores/app";
import { api } from "@shared/api";
import { attachmentFromFile, dataUrl } from "../../lib/attachments";
import { ModelPicker } from "../pickers/ModelPicker";
import { ThinkingPicker } from "../pickers/ThinkingPicker";
import { PermissionBadge } from "../pickers/PermissionBadge";
import { OmpStatusPill, RuntimeStats } from "../thread/StatusBar";
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
  const draft = draftOf(activeSessionId);
  const attachments = attachmentsOf(activeSessionId);
  const status = activeSessionId ? statusBySession[activeSessionId]?.state : undefined;
  const running = status === "running" || status === "awaiting-approval";
  const awaiting = status === "awaiting-approval";
  const archived = sessions.find((s) => s.id === activeSessionId)?.archived;
  const [attachError, setAttachError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  // 模型是否支持图片（模型目录里 `input` 含 image）；目录没加载出来时不做判断，不误报
  const model = models?.models.find((m) => `${m.provider}/${m.id}` === currentModel);
  const imageUnsupported = attachments.length > 0 && !!model?.input && !model.input.includes("image");

  const addFiles = async (files: File[]) => {
    const images = files.filter((f) => f.type.startsWith("image/"));
    if (images.length === 0) return;
    setAttachError(null);
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

  const send = async () => {
    if (!activeSessionId || (!draft.trim() && attachments.length === 0) || running || archived) return;
    const text = draft;
    const sentImages = attachments;
    setDraft(activeSessionId, "");
    clearAttachments(activeSessionId);
    try {
      await api.sendMessage(
        activeSessionId,
        text,
        sentImages.map((a) => ({ name: a.name, mimeType: a.mimeType, dataBase64: a.dataBase64, bytes: a.bytes })),
      );
    } catch {
      // 发失败就把草稿与附件还回去，不让用户重打一遍
      setDraft(activeSessionId, text);
      addAttachments(activeSessionId, sentImages);
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
        {imageUnsupported && (
          <div className="px-4 pt-2 text-xs text-warn">当前模型可能不支持图片，发送前请确认模型是否带视觉能力</div>
        )}
        <label htmlFor="composer" className="sr-only">
          输入消息
        </label>
        <textarea
          id="composer"
          rows={3}
          value={draft}
          onChange={(e) => setDraft(activeSessionId, e.target.value)}
          onPaste={(e) => {
            const files = Array.from(e.clipboardData?.files ?? []).filter((f) => f.type.startsWith("image/"));
            if (files.length === 0) return;
            e.preventDefault();
            void addFiles(files);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              if (running) return;
              void send();
            }
            if (e.key === "Escape" && running && activeSessionId) {
              void api.stop(activeSessionId).catch(() => undefined);
            }
          }}
          disabled={awaiting}
          placeholder={awaiting ? "先处理上面的审批" : dragging ? "松手即可添加图片" : "随心输入"}
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
          <RuntimeStats />
          <div className="ml-auto flex min-w-0 flex-wrap items-center justify-end gap-1">
            <ModelPicker compact />
            <ThinkingPicker compact />
            {running ? (
              <button
                onClick={() => activeSessionId && api.stop(activeSessionId).catch(() => undefined)}
                className="ml-1 flex cursor-pointer items-center gap-1.5 rounded-full bg-accent px-3.5 py-1.5 text-sm text-white transition-opacity duration-150 hover:opacity-90"
                aria-label="停止"
              >
                <span className="h-2 w-2 rounded-sm bg-white" aria-hidden />
                停止
              </button>
            ) : (
              <button
                onClick={() => void send()}
                disabled={!draft.trim() && attachments.length === 0}
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
