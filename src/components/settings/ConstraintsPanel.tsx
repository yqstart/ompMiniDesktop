import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { RefObject } from "react";
import ReactMarkdown from "react-markdown";
import type { Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { FileText, Loader, Plus, Refresh, Trash2 } from "reicon-react";
import { api } from "@shared/api";
import type { ConstraintFile, ConstraintsView } from "@shared/types";
import { useApp } from "../../stores/app";
import { fmt, type Text } from "../../lib/locale";
import type { SettingsFocusRequest } from "../../lib/settingsTabs";
import { useText } from "../../lib/useText";
import { useVisibleRefresh } from "../../lib/useVisibleRefresh";
import { isMacKeyboard } from "../../lib/platform";
import {
  constraintKey,
  newRuleName,
  parseRuleDoc,
  ruleDisplayName,
  ruleKindOf,
  splitFrontmatter,
  validateConstraintText,
  type ConstraintIssue,
  type RuleKind,
} from "../../lib/constraints";
import { ConfirmDialog } from "../ConfirmDialog";

/**
 * 设置 ›「omp 约束」：编辑 omp 的**全局**约束文件与规则文件。
 *
 * - `AGENTS.md`：用户级上下文约束（每次会话启动注入；普通 Markdown，不解析 frontmatter）；
 * - `RULES.md`：sticky 硬规则（始终 always-apply、每轮重挂）；
 * - `rules/*.{md,mdc}`：独立规则（文件名即规则名；`enabled: false` 停用）。
 *
 * **三种文件都是直接编辑整份 Markdown**（2026-10-19 用户口径：去掉「表单 / 源码」两档，
 * 表单那套逐字段编辑退场）——文本原样保存，frontmatter 由用户自己写；`lib/constraints.ts`
 * 的解析只用于列表摘要的类型标签与保存前的结构校验（读不懂的 frontmatter 等于坏规则）。
 *
 * 数据面：清单来自 `get_omp_constraints`（固定两份文件 + rules/ 下的文件，一次读全）；
 * 保存 / 新建 / 删除走后端（乐观锁 + 备份 + 原子写）。草稿在**模块级缓存**里跨设置页签 /
 * 设置视图保留（切到模型页看一眼再回来不会丢未保存内容），「重新加载」才丢弃。
 */

type EditorState = {
  /** 整份 Markdown（含 frontmatter）：保存时原样写回。 */
  source: string;
  dirty: boolean;
};

/**
 * 未保存草稿的模块级缓存：面板切设置页签 / 关掉设置视图都会卸载，草稿不能跟着丢。
 * 只在内存里（应用重启即清）；文件被外部改过时保存会撞乐观锁，不会静默覆盖。
 */
const draftCache = new Map<string, EditorState>();

/** 标题行上的类型徽标（总是生效 / 实时注入 / 规则手册）。 */
const KIND_BADGE = "rounded border border-border px-1.5 py-0.5 text-[10px] text-muted";

function stateFromFile(file: ConstraintFile): EditorState {
  return { source: file.content, dirty: false };
}

function kindLabel(kind: RuleKind, t: Text): string {
  if (kind === "always") return t.constraintsKindAlways;
  if (kind === "ttsr") return t.constraintsKindTtsr;
  return t.constraintsKindRulebook;
}

function issueText(issue: ConstraintIssue, t: Text): string {
  if (issue.kind === "tooLarge") return fmt(t.constraintsTooLarge, String(issue.bytes));
  if (issue.kind === "nul") return t.constraintsNul;
  return fmt(t.constraintsParseError, issue.detail);
}

function fileSummary(file: ConstraintFile, t: Text): string {
  if (file.kind === "agents") return t.constraintsAgentsSummary;
  if (file.kind === "rules") return t.constraintsRulesSummary;
  if (file.error) return t.constraintsUnreadable;
  const parsed = parseRuleDoc(file.content);
  if (!parsed.ok) return t.constraintsUnreadable;
  const label = kindLabel(ruleKindOf(parsed.doc.fields), t);
  return parsed.doc.fields.description ? `${label} · ${parsed.doc.fields.description}` : label;
}

/** 编辑框里指的是同一份文件：预览只铺正文（frontmatter 不进正文渲染）。 */
function previewText(source: string): string {
  const split = splitFrontmatter(source);
  return split.frontmatter === null ? source : split.body;
}

/** 预览里的链接不跳转：设置页不是浏览器，跳走会丢掉整个视图。 */
const PREVIEW_COMPONENTS: Components = {
  a: ({ children }) => <span className="text-accent">{children}</span>,
};

function MarkdownPreview({ text, empty }: { text: string; empty: string }) {
  if (!text.trim()) return <p className="text-[13px] text-muted">{empty}</p>;
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={PREVIEW_COMPONENTS}>
      {text}
    </ReactMarkdown>
  );
}

/**
 * Markdown 编辑框高度跟着内容走：编辑框内部不滚动，整页的滚动只发生在设置页内容区
 * （2026-10-19 用户口径）。值变化（输入 / 切换文件 / 重新加载）与宽度变化（窗口 / 分栏 /
 * 设置页重新显示）都会改变换行数，两种都要重算；`active` 用来覆盖「编辑 ↔ 预览」切换
 * 造成的重新挂载——那时 ref 换了元素但值可能没变。
 */
function useAutoGrowTextarea(
  ref: RefObject<HTMLTextAreaElement | null>,
  value: string,
  active: boolean,
) {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    let width = -1;
    const fit = () => {
      // 设置页隐藏时（display: none）量不到尺寸，跳过，别把高度压成 0
      if (el.clientWidth === 0) return;
      width = el.clientWidth;
      const style = window.getComputedStyle(el);
      // scrollHeight 不含边框：border-box 下不补回来底部会差一行（又出现内部滚动）
      const border =
        (Number.parseFloat(style.borderTopWidth) || 0) +
        (Number.parseFloat(style.borderBottomWidth) || 0);
      el.style.height = "auto";
      el.style.height = `${el.scrollHeight + border}px`;
    };
    fit();
    // 宽度变化要重算高度；jsdom（单测）没有 ResizeObserver，按项目惯例跳过观察
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      if (el.clientWidth !== width) fit();
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref, value, active]);
}

function FileRow({
  title,
  summary,
  selected,
  dirty,
  onSelect,
}: {
  title: string;
  summary: string;
  selected: boolean;
  dirty: boolean;
  onSelect: () => void;
}) {
  const t = useText();
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={`flex w-full flex-col gap-0.5 rounded-md px-2 py-1.5 text-left transition-colors duration-100 ${selected
        ? "bg-active text-foreground"
        : "text-muted hover:bg-hover hover:text-foreground"
        }`}
    >
      <span className="flex min-w-0 items-center gap-1.5">
        <FileText size={13} aria-hidden className="shrink-0" />
        <span className="truncate text-[13px]">{title}</span>
        {dirty && (
          <span
            className="size-1.5 shrink-0 rounded-full bg-warn"
            title={t.constraintsUnsaved}
          />
        )}
      </span>
      <span className="truncate pl-[19px] text-[11px] text-faint">{summary}</span>
    </button>
  );
}

export function ConstraintsPanel({
  focusRequest,
  onFocusDone,
}: {
  focusRequest?: SettingsFocusRequest | null;
  onFocusDone?: () => void;
}) {
  const t = useText();
  const settingsTabActive = useApp((s) => s.settingsTabActive);
  const [view, setView] = useState<ConstraintsView | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [staleError, setStaleError] = useState<string | null>(null);
  const [states, setStates] = useState<Record<string, EditorState>>(() => {
    const init: Record<string, EditorState> = {};
    for (const [key, value] of draftCache) init[key] = value;
    return init;
  });
  const [selected, setSelected] = useState("agents:AGENTS.md");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  const [preview, setPreview] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newStem, setNewStem] = useState("");
  const [createBusy, setCreateBusy] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const sourceRef = useRef<HTMLTextAreaElement>(null);
  const loadSeq = useRef(0);
  const loadedOnce = useRef(false);
  const flashTimer = useRef<number | null>(null);

  const updateStates = useCallback(
    (updater: (prev: Record<string, EditorState>) => Record<string, EditorState>) => {
      setStates((prev) => {
        const next = updater(prev);
        // 草稿跨挂载保留（切设置页签 / 关设置视图）；写缓存与 setState 同步发生。
        draftCache.clear();
        for (const [key, value] of Object.entries(next)) draftCache.set(key, value);
        return next;
      });
    },
    [],
  );

  const load = useCallback(async (): Promise<boolean> => {
    const seq = ++loadSeq.current;
    try {
      const next = await api.getOmpConstraints();
      if (seq !== loadSeq.current) return false;
      loadedOnce.current = true;
      setView(next);
      setLoadError(null);
      setStaleError(null);
      setSelected((prev) => {
        if (next.files.some((file) => constraintKey(file.kind, file.name) === prev)) return prev;
        const first = next.files[0];
        return first ? constraintKey(first.kind, first.name) : "agents:AGENTS.md";
      });
      return true;
    } catch (error) {
      if (seq !== loadSeq.current) return false;
      const message = error instanceof Error ? error.message : String(error);
      if (loadedOnce.current) setStaleError(message);
      else setLoadError(message);
      return false;
    }
  }, []);

  // 设置视图重新激活时刷新清单（在 omp TUI / 文件管理器里改过，回来就该看到）；
  // 草稿不清——「重新加载」才是显式丢弃。
  useEffect(() => {
    if (!settingsTabActive) return;
    // 放进任务队列再发请求：effect 体内不直接 setState（与 ModelsPanel 同一口径）。
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [settingsTabActive, load]);

  // 页头刷新钮退场后（2026-10-19），外部改动（在别的编辑器里改了这些文件）靠焦点回读补上：
  // 本页编辑的正是 `~/.omp/agent` 下的文件，被外部改动的概率不低。`load()` 不动草稿。
  useVisibleRefresh(() => void load());

  useEffect(
    () => () => {
      if (flashTimer.current !== null) window.clearTimeout(flashTimer.current);
    },
    [],
  );

  const selectFile = useCallback((key: string) => {
    setSelected(key);
    setConflict(false);
    setSaveError(null);
    setSavedFlash(false);
    setPreview(false);
    setDeleting(false);
    setDeleteError(null);
  }, []);

  // 设置搜索跳转：命中文件 → 选中它（列表还没回来时等加载完成再执行）。
  useEffect(() => {
    if (!focusRequest || !view) return;
    const timer = window.setTimeout(() => {
      if (view.files.some((file) => constraintKey(file.kind, file.name) === focusRequest.key)) {
        selectFile(focusRequest.key);
      }
      onFocusDone?.();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [focusRequest, view, selectFile, onFocusDone]);

  const files = view?.files ?? [];
  const rules = files.filter((file) => file.kind === "rule");
  const agentsFile = files.find((file) => file.kind === "agents") ?? null;
  const rulesFile = files.find((file) => file.kind === "rules") ?? null;
  const currentFile = files.find((file) => constraintKey(file.kind, file.name) === selected) ?? null;
  const currentState = currentFile ? states[selected] ?? stateFromFile(currentFile) : null;
  const currentKind = currentFile?.kind ?? "";
  const currentSource = currentState?.source ?? "";

  // 类型标签从**当前文本**派生（frontmatter 读不懂就不下结论）；解析很轻，击键即更新。
  const ruleFields = useMemo(() => {
    if (currentKind !== "rule") return null;
    const parsed = parseRuleDoc(currentSource);
    return parsed.ok ? parsed.doc : null;
  }, [currentKind, currentSource]);

  // 编辑框高度随内容展开，滚动交给设置页内容区（预览态没有编辑框）。
  useAutoGrowTextarea(sourceRef, currentSource, currentFile !== null && !preview);

  const patchState = useCallback(
    (key: string, file: ConstraintFile, patch: (state: EditorState) => EditorState) => {
      updateStates((prev) => {
        const base = prev[key] ?? stateFromFile(file);
        return { ...prev, [key]: patch(base) };
      });
    },
    [updateStates],
  );

  const updateSource = (source: string) => {
    if (!currentFile) return;
    patchState(selected, currentFile, (state) => ({ ...state, source, dirty: true }));
  };

  const save = useCallback(
    async (force = false) => {
      if (!currentFile || !currentState || saving || currentFile.error) return;
      const text = currentState.source;
      const issue = validateConstraintText(currentFile.kind, text);
      if (issue) {
        setSaveError(issueText(issue, t));
        return;
      }
      setSaving(true);
      setSaveError(null);
      setConflict(false);
      try {
        const written = await api.writeOmpConstraint(
          currentFile.kind,
          currentFile.name,
          text,
          force ? null : currentFile.exists ? currentFile.hash : "",
        );
        setView((prev) =>
          prev
            ? {
              ...prev,
              files: prev.files.map((file) =>
                file.kind === written.kind && file.name === written.name ? written : file,
              ),
            }
            : prev,
        );
        updateStates((prev) => ({ ...prev, [selected]: stateFromFile(written) }));
        setStaleError(null);
        setSavedFlash(true);
        if (flashTimer.current !== null) window.clearTimeout(flashTimer.current);
        flashTimer.current = window.setTimeout(() => setSavedFlash(false), 2000);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const code = (error as { cause?: { code?: string } } | null)?.cause?.code;
        if (code === "CONSTRAINT_CONFLICT") setConflict(true);
        setSaveError(message);
      } finally {
        setSaving(false);
      }
    },
    [currentFile, currentState, saving, selected, t, updateStates],
  );

  // ⌘S / Ctrl+S 只在焦点位于本面板内时接管（不抢聊天输入框与搜索框）。
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!settingsTabActive || event.isComposing) return;
      const mod = isMacKeyboard() ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
      if (!mod || event.key.toLowerCase() !== "s") return;
      if (!panelRef.current?.contains(document.activeElement)) return;
      event.preventDefault();
      void save();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [settingsTabActive, save]);

  const reloadFile = async () => {
    if (!currentFile) return;
    const key = selected;
    const ok = await load();
    if (!ok) return;
    updateStates((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
    setConflict(false);
    setSaveError(null);
    setDeleting(false);
  };

  const create = async () => {
    const check = newRuleName(newStem);
    if (check.error || !check.name) {
      setCreateError(check.error === "empty" ? t.constraintsNameEmpty : t.constraintsNameInvalid);
      return;
    }
    if (files.some((file) => file.kind === "rule" && file.name === check.name)) {
      setCreateError(t.constraintsRuleExists);
      return;
    }
    setCreateBusy(true);
    setCreateError(null);
    try {
      const created = await api.createOmpRule(check.name);
      setView((prev) => (prev ? { ...prev, files: [...prev.files, created] } : prev));
      updateStates((prev) => ({ ...prev, [constraintKey("rule", created.name)]: stateFromFile(created) }));
      selectFile(constraintKey("rule", created.name));
      setNewStem("");
      setCreating(false);
    } catch (error) {
      setCreateError(error instanceof Error ? error.message : String(error));
    } finally {
      setCreateBusy(false);
    }
  };

  const remove = async () => {
    if (!currentFile || currentFile.kind !== "rule" || deleteBusy) return;
    setDeleteBusy(true);
    setDeleteError(null);
    try {
      await api.deleteOmpRule(currentFile.name);
      const key = selected;
      setView((prev) =>
        prev
          ? {
            ...prev,
            files: prev.files.filter((file) => !(file.kind === "rule" && file.name === currentFile.name)),
          }
          : prev,
      );
      updateStates((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
      selectFile("agents:AGENTS.md");
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : String(error));
      setDeleting(false);
    } finally {
      setDeleteBusy(false);
    }
  };

  const currentTitle = currentFile
    ? currentFile.kind === "rule"
      ? ruleDisplayName(currentFile.name)
      : currentFile.name
    : "";

  // 编辑区上方一行说明：三种文件各自提示它的加载口径。
  const docHint =
    currentKind === "agents"
      ? t.constraintsAgentsDocHint
      : currentKind === "rules"
        ? t.constraintsStickyForced
        : t.constraintsSourceHint;

  return (
    <div ref={panelRef} className="mt-1">
     {/* 页头整行已按用户口径退场（2026-10-19）：说明 / 刷新钮 / agentDir 读数都不再上界面
         （当前文件的全路径在编辑器标题行里本来就有）；重读时机 = 切走页签再回来（重挂）、
         窗口重新获得焦点（`useVisibleRefresh`）与编辑器工具行的「重新加载」 */}
     {staleError && (
        <p role="alert" className="mt-3 rounded border border-warn/40 bg-warn/5 px-2 py-1.5 text-[13px] text-warn">
          {t.listRefreshFailed}：{staleError}
        </p>
      )}
      {view?.rulesError && (
        <p role="alert" className="mt-3 rounded border border-warn/40 bg-warn/5 px-2 py-1.5 text-[13px] text-warn">
          {view.rulesError}
        </p>
      )}

      {loadError && !view ? (
        <div className="mt-4 flex flex-col items-start gap-2">
          <p role="alert" className="text-[13px] text-danger">
            {t.constraintsLoadFailed}：{loadError}
          </p>
          <button
            type="button"
            onClick={() => void load()}
            className="cursor-pointer rounded-md border border-border px-3 py-1.5 text-[13px] transition-colors duration-100 hover:bg-hover"
          >
            {t.retry}
          </button>
        </div>
      ) : !view ? (
        <p className="mt-4 text-[13px] text-muted">{t.constraintsLoading}</p>
      ) : (
        <div className="mt-4 flex flex-col gap-5 @min-[760px]/panel:flex-row">
          <nav aria-label={t.tabConstraints} className="w-full shrink-0 @min-[760px]/panel:w-60">
            <h3 className="px-1 text-xs font-medium text-muted">{t.constraintsGroupAgents}</h3>
            <div className="mt-1 flex flex-col gap-0.5">
              {agentsFile && (
                <FileRow
                  title="AGENTS.md"
                  summary={fileSummary(agentsFile, t)}
                  selected={selected === constraintKey("agents", agentsFile.name)}
                  dirty={states[constraintKey("agents", agentsFile.name)]?.dirty === true}
                  onSelect={() => selectFile(constraintKey("agents", agentsFile.name))}
                />
              )}
            </div>
            <h3 className="mt-4 px-1 text-xs font-medium text-muted">{t.constraintsGroupRules}</h3>
            <div className="mt-1 flex flex-col gap-0.5">
              {rulesFile && (
                <FileRow
                  title="RULES.md"
                  summary={fileSummary(rulesFile, t)}
                  selected={selected === constraintKey("rules", rulesFile.name)}
                  dirty={states[constraintKey("rules", rulesFile.name)]?.dirty === true}
                  onSelect={() => selectFile(constraintKey("rules", rulesFile.name))}
                />
              )}
            </div>
            <div className="mt-4 flex items-center justify-between gap-2 px-1">
              <h3 className="text-xs font-medium text-muted">{t.constraintsGroupIndep}</h3>
              <button
                type="button"
                onClick={() => {
                  setCreating(true);
                  setNewStem("");
                  setCreateError(null);
                }}
                className="flex h-6 cursor-pointer items-center gap-1 rounded-md px-1.5 text-[11px] text-muted transition-colors duration-100 hover:bg-hover hover:text-foreground"
              >
                <Plus size={10} aria-hidden />
                {t.constraintsNewRule}
              </button>
            </div>
            {creating && (
              <form
                className="mt-1.5 rounded-md border border-border bg-surface p-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  void create();
                }}
              >
                <input
                  autoFocus
                  value={newStem}
                  onChange={(event) => {
                    setNewStem(event.target.value);
                    setCreateError(null);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Escape" && !event.nativeEvent.isComposing) {
                      event.preventDefault();
                      setCreating(false);
                      setNewStem("");
                      setCreateError(null);
                    }
                  }}
                  placeholder={t.constraintsNewRulePlaceholder}
                  spellCheck={false}
                  autoComplete="off"
                  className="h-8 w-full min-w-0 rounded-md border border-border bg-surface px-2 text-[12px] outline-none transition-colors duration-100 placeholder:text-faint focus:border-accent"
                />
                {createError && <p className="mt-1 text-[11px] text-danger">{createError}</p>}
                <div className="mt-1.5 flex items-center gap-1.5">
                  <button
                    type="submit"
                    disabled={createBusy}
                    className="h-7 cursor-pointer rounded-md border border-border px-2.5 text-[12px] transition-colors duration-100 hover:bg-hover disabled:opacity-40"
                  >
                    {t.constraintsCreate}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setCreating(false);
                      setNewStem("");
                      setCreateError(null);
                    }}
                    className="h-7 cursor-pointer rounded-md px-2 text-[12px] text-muted transition-colors duration-100 hover:bg-hover hover:text-foreground"
                  >
                    {t.cancel}
                  </button>
                  {createBusy && <Loader size={11} className="animate-spin text-muted" aria-hidden />}
                </div>
              </form>
            )}
            <div className="mt-1 flex flex-col gap-0.5">
              {rules.length === 0 ? (
                <p className="px-1 py-1 text-[11px] leading-4 text-faint">{t.constraintsNoRules}</p>
              ) : (
                rules.map((file) => {
                  const key = constraintKey("rule", file.name);
                  return (
                    <FileRow
                      key={key}
                      title={ruleDisplayName(file.name)}
                      summary={fileSummary(file, t)}
                      selected={selected === key}
                      dirty={states[key]?.dirty === true}
                      onSelect={() => selectFile(key)}
                    />
                  );
                })
              )}
            </div>
          </nav>

          <div className="min-w-0 flex-1">
            {!currentFile || !currentState ? (
              <p className="text-[13px] text-muted">{t.constraintsLoading}</p>
            ) : (
              <section aria-label={currentTitle}>
                <div className="flex flex-wrap items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="truncate text-sm font-medium">{currentTitle}</h2>
                      {currentKind === "rules" && (
                        <span className={KIND_BADGE}>{t.constraintsKindAlways}</span>
                      )}
                      {currentKind === "rule" && ruleFields && (
                        <span className={KIND_BADGE}>{kindLabel(ruleKindOf(ruleFields.fields), t)}</span>
                      )}
                      {currentState.dirty && (
                        <span className="rounded border border-warn/40 bg-warn/5 px-1.5 py-0.5 text-[10px] text-warn">
                          {t.constraintsUnsaved}
                        </span>
                      )}
                      {savedFlash && <span className="text-[11px] text-accent">{t.constraintsSaved}</span>}
                    </div>
                    <p className="mt-0.5 font-mono text-[11px] break-all text-faint" title={currentFile.path}>
                      {currentFile.path}
                    </p>
                    {currentKind === "rule" && ruleFields && ruleFields.extraFields.length > 0 && (
                      <p className="mt-1 text-[11px] text-muted">
                        {fmt(t.constraintsExtraFields, String(ruleFields.extraFields.length))}
                      </p>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => void reloadFile()}
                      className="flex h-7 cursor-pointer items-center gap-1 rounded-md px-2 text-[12px] text-muted transition-colors duration-100 hover:bg-hover hover:text-foreground"
                    >
                      <Refresh size={11} aria-hidden />
                      {t.constraintsReload}
                    </button>
                    <button
                      type="button"
                      onClick={() => void save()}
                      disabled={!currentState.dirty || saving || currentFile.error !== null}
                      title={t.constraintsSaveHint}
                      className="flex h-7 cursor-pointer items-center gap-1.5 rounded-md border border-border px-2.5 text-[12px] transition-colors duration-100 hover:bg-hover disabled:opacity-40"
                    >
                      {saving && <Loader size={11} className="animate-spin" aria-hidden />}
                      {saving ? t.constraintsSaving : t.constraintsSave}
                    </button>
                  </div>
                </div>

                {!currentFile.exists && (
                  <p className="mt-2 text-[11px] text-muted">{t.constraintsMissing}</p>
                )}
                {currentFile.error && (
                  <p role="alert" className="mt-2 rounded border border-danger/40 bg-danger/5 px-2 py-1.5 text-[13px] text-danger">
                    {t.constraintsUnreadable}：{currentFile.error}
                  </p>
                )}
                {conflict && (
                  <div
                    role="alert"
                    className="mt-2 rounded border border-warn/40 bg-warn/5 px-2.5 py-2 text-[13px] text-warn"
                  >
                    <p>{t.constraintsConflict}</p>
                    <p className="mt-0.5 text-xs">{t.constraintsConflictHint}</p>
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => void reloadFile()}
                        className="h-7 cursor-pointer rounded-md border border-border px-2.5 text-[12px] text-foreground transition-colors duration-100 hover:bg-hover"
                      >
                        {t.constraintsReload}
                      </button>
                      <button
                        type="button"
                        onClick={() => void save(true)}
                        disabled={saving}
                        className="h-7 cursor-pointer rounded-md border border-warn/50 px-2.5 text-[12px] transition-colors duration-100 hover:bg-warn/10 disabled:opacity-40"
                      >
                        {t.constraintsOverwrite}
                      </button>
                    </div>
                  </div>
                )}
                {saveError && !conflict && (
                  <p role="alert" className="mt-2 rounded border border-danger/40 bg-danger/5 px-2 py-1.5 text-[13px] text-danger">
                    {saveError}
                  </p>
                )}

                <div className="mt-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-xs text-muted">{docHint}</p>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => setPreview(false)}
                        aria-pressed={!preview}
                        className={`h-6 cursor-pointer rounded-md border px-2 text-[11px] transition-colors duration-100 ${!preview
                          ? "border-accent/50 bg-active text-foreground"
                          : "border-border text-muted hover:bg-hover hover:text-foreground"
                          }`}
                      >
                        {t.constraintsEditMode}
                      </button>
                      <button
                        type="button"
                        onClick={() => setPreview(true)}
                        aria-pressed={preview}
                        className={`h-6 cursor-pointer rounded-md border px-2 text-[11px] transition-colors duration-100 ${preview
                          ? "border-accent/50 bg-active text-foreground"
                          : "border-border text-muted hover:bg-hover hover:text-foreground"
                          }`}
                      >
                        {t.constraintsPreview}
                      </button>
                    </div>
                  </div>
                  {preview ? (
                    <div className="md-body mt-2 min-h-[240px] rounded-md border border-border-soft bg-surface p-3 text-[13px] leading-6">
                      <MarkdownPreview text={previewText(currentSource)} empty={t.constraintsPreviewEmpty} />
                    </div>
                  ) : (
                    <textarea
                      ref={sourceRef}
                      value={currentSource}
                      onChange={(event) => updateSource(event.target.value)}
                      spellCheck={false}
                      autoComplete="off"
                      aria-label={currentTitle}
                      className="mt-2 min-h-[380px] w-full resize-none overflow-hidden rounded-md border border-border bg-surface p-2.5 font-mono text-[12.5px] leading-5 outline-none transition-colors duration-100 focus:border-accent"
                    />
                  )}
                </div>

                {currentFile.kind === "rule" && (
                  <div className="mt-6 border-t border-border-soft pt-3">
                    <button
                      type="button"
                      onClick={() => {
                        setDeleteError(null);
                        setDeleting(true);
                      }}
                      className="flex h-7 cursor-pointer items-center gap-1.5 rounded-md px-1.5 text-[12px] text-muted transition-colors duration-100 hover:bg-hover hover:text-danger"
                    >
                      <Trash2 size={11} aria-hidden />
                      {t.constraintsDelete}
                    </button>
                    {deleteError && (
                      <p role="alert" className="mt-1 text-xs text-danger">
                        {deleteError}
                      </p>
                    )}
                  </div>
                )}
              </section>
            )}
          </div>
        </div>
      )}

      <ConfirmDialog
        open={deleting}
        danger
        title={currentFile ? fmt(t.constraintsDeleteConfirm, ruleDisplayName(currentFile.name)) : t.constraintsDelete}
        detail={t.constraintsDeleteDetail}
        confirmLabel={t.delete}
        onConfirm={() => {
          if (!deleteBusy) void remove();
        }}
        onCancel={() => {
          setDeleting(false);
          setDeleteError(null);
        }}
      />
    </div>
  );
}
