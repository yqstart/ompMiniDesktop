import { useCallback, useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import type { Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { ChevronDown, FileText, Loader, Plus, Refresh, Trash2, X } from "reicon-react";
import { api } from "@shared/api";
import type { ConstraintFile, ConstraintsView } from "@shared/types";
import { useApp } from "../../stores/app";
import { fmt, type Text } from "../../lib/locale";
import type { SettingsFocusRequest } from "../../lib/settingsTabs";
import { useText } from "../../lib/useText";
import { isMacKeyboard } from "../../lib/platform";
import {
  buildRuleText,
  constraintKey,
  defaultRuleFields,
  newRuleName,
  parseRuleDoc,
  ruleDisplayName,
  ruleKindOf,
  splitFrontmatter,
  validateConstraintText,
  type ConstraintIssue,
  type InterruptMode,
  type RuleFields,
  type RuleKind,
} from "../../lib/constraints";
import { Switch } from "./Switch";
import { ConfirmDialog } from "../ConfirmDialog";

/**
 * 设置 ›「omp 约束」：可视化编辑 omp 的**全局**约束文件与规则文件。
 *
 * - `AGENTS.md`：用户级上下文约束（每次会话启动注入；普通 Markdown，不解析 frontmatter）；
 * - `RULES.md`：sticky 硬规则（始终 always-apply、每轮重挂）；
 * - `rules/*.{md,mdc}`：独立规则（文件名即规则名；`enabled: false` 停用）。
 *
 * 「可视化」= 规则 frontmatter 的表单（描述 / 启用 / 总是生效 / 触发条件 / 作用范围 /
 * 注入方式）+ Markdown 正文编辑 + 预览；另留「源码」模式直接编辑整份 Markdown。
 * 表单保存走 `lib/constraints.ts` 的 `buildRuleText`：在原 frontmatter 文档上只改已知字段，
 * 注释、键序与不认识的字段原样保留（`yaml` 的 Document API）。
 *
 * 数据面：清单来自 `get_omp_constraints`（固定两份文件 + rules/ 下的文件，一次读全）；
 * 保存 / 新建 / 删除走后端（乐观锁 + 备份 + 原子写）。草稿在**模块级缓存**里跨设置页签 /
 * 设置视图保留（切到模型页看一眼再回来不会丢未保存内容），「重新加载」才丢弃。
 */

type EditorMode = "form" | "source";

type EditorState = {
  mode: EditorMode;
  /** 源码模式 / AGENTS.md 的整份文本；表单模式保存时由 fields + body 生成。 */
  source: string;
  fields: RuleFields;
  body: string;
  /** 生成 frontmatter 的底稿（打开 / 切模式时的整份文本，用于保留未知字段）。 */
  baseText: string;
  dirty: boolean;
  parseError: string | null;
  extraFields: string[];
};

/**
 * 未保存草稿的模块级缓存：面板切设置页签 / 关掉设置视图都会卸载，草稿不能跟着丢。
 * 只在内存里（应用重启即清）；文件被外部改过时保存会撞乐观锁，不会静默覆盖。
 */
const draftCache = new Map<string, EditorState>();

function stateFromFile(file: ConstraintFile): EditorState {
  if (file.kind === "agents") {
    return {
      mode: "source",
      source: file.content,
      fields: defaultRuleFields(),
      body: file.content,
      baseText: file.content,
      dirty: false,
      parseError: null,
      extraFields: [],
    };
  }
  const parsed = parseRuleDoc(file.content);
  if (!parsed.ok) {
    return {
      mode: "source",
      source: file.content,
      fields: defaultRuleFields(),
      body: file.content,
      baseText: file.content,
      dirty: false,
      parseError: parsed.error,
      extraFields: [],
    };
  }
  return {
    mode: "form",
    source: file.content,
    fields: parsed.doc.fields,
    body: parsed.doc.body,
    baseText: file.content,
    dirty: false,
    parseError: null,
    extraFields: parsed.doc.extraFields,
  };
}

/** RULES.md 的 alwaysApply 是上游强制的：界面固定为开，保存时按开写。 */
function effectiveFields(kind: string, fields: RuleFields): RuleFields {
  return kind === "rules" ? { ...fields, alwaysApply: true } : fields;
}

function advancedCount(fields: RuleFields): number {
  return (
    fields.globs.length +
    fields.condition.length +
    fields.astCondition.length +
    fields.scope.length +
    fields.agents.length +
    (fields.question.trim() ? 1 : 0) +
    (fields.interruptMode ? 1 : 0)
  );
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

function previewText(state: EditorState, kind: string): string {
  if (kind === "agents") return state.source;
  if (state.mode === "form") return state.body;
  const split = splitFrontmatter(state.source);
  return split.frontmatter === null ? state.source : split.body;
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

/** 一条规则触发条件 / 作用范围列表（表单里的多行文本输入）。 */
function StringListField({
  label,
  hint,
  placeholder,
  values,
  onChange,
  addLabel,
  removeLabel,
}: {
  label: string;
  hint: string;
  placeholder: string;
  values: string[];
  onChange: (values: string[]) => void;
  addLabel: string;
  removeLabel: string;
}) {
  return (
    <div className="py-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[13px]">{label}</span>
        <button
          type="button"
          onClick={() => onChange([...values, ""])}
          className="flex h-6 cursor-pointer items-center gap-1 rounded-md px-1.5 text-[11px] text-muted transition-colors duration-100 hover:bg-hover hover:text-foreground"
        >
          <Plus size={10} aria-hidden />
          {addLabel}
        </button>
      </div>
      <p className="mt-0.5 text-xs text-muted">{hint}</p>
      {values.length > 0 && (
        <div className="mt-1.5 flex flex-col gap-1.5">
          {values.map((value, index) => (
            <div key={index} className="flex items-center gap-1.5">
              <input
                value={value}
                onChange={(event) =>
                  onChange(values.map((item, i) => (i === index ? event.target.value : item)))
                }
                placeholder={placeholder}
                spellCheck={false}
                autoComplete="off"
                className="h-8 min-w-0 flex-1 rounded-md border border-border bg-surface px-2 font-mono text-[12px] outline-none transition-colors duration-100 placeholder:text-faint focus:border-accent"
              />
              <button
                type="button"
                onClick={() => onChange(values.filter((_, i) => i !== index))}
                aria-label={removeLabel}
                title={removeLabel}
                className="flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted transition-colors duration-100 hover:bg-hover hover:text-foreground"
              >
                <X size={12} aria-hidden />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
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
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newStem, setNewStem] = useState("");
  const [createBusy, setCreateBusy] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
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
    setAdvancedOpen(false);
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

  const patchState = useCallback(
    (key: string, file: ConstraintFile, patch: (state: EditorState) => EditorState) => {
      updateStates((prev) => {
        const base = prev[key] ?? stateFromFile(file);
        return { ...prev, [key]: patch(base) };
      });
    },
    [updateStates],
  );

  const updateFields = (patch: Partial<RuleFields>) => {
    if (!currentFile) return;
    patchState(selected, currentFile, (state) => ({
      ...state,
      fields: { ...state.fields, ...patch },
      dirty: true,
    }));
  };

  const updateBody = (body: string) => {
    if (!currentFile) return;
    patchState(selected, currentFile, (state) => ({ ...state, body, dirty: true }));
  };

  const updateSource = (source: string) => {
    if (!currentFile) return;
    patchState(selected, currentFile, (state) => ({ ...state, source, dirty: true }));
  };

  const switchMode = (mode: EditorMode) => {
    if (!currentFile || !currentState || currentFile.kind === "agents" || currentState.mode === mode) {
      return;
    }
    if (mode === "source") {
      patchState(selected, currentFile, (state) => ({
        ...state,
        mode: "source",
        source: buildRuleText(state.baseText, effectiveFields(currentFile.kind, state.fields), state.body),
        parseError: null,
      }));
      return;
    }
    const parsed = parseRuleDoc(currentState.source);
    if (!parsed.ok) {
      patchState(selected, currentFile, (state) => ({ ...state, parseError: parsed.error }));
      return;
    }
    patchState(selected, currentFile, (state) => ({
      ...state,
      mode: "form",
      fields: parsed.doc.fields,
      body: parsed.doc.body,
      baseText: state.source,
      extraFields: parsed.doc.extraFields,
      parseError: null,
      dirty: state.source !== currentFile.content,
    }));
  };

  const save = useCallback(
    async (force = false) => {
      if (!currentFile || !currentState || saving || currentFile.error) return;
      const fields = effectiveFields(currentFile.kind, currentState.fields);
      const text =
        currentFile.kind === "agents"
          ? currentState.source
          : currentState.mode === "form"
            ? buildRuleText(currentState.baseText, fields, currentState.body)
            : currentState.source;
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
        // 保存后停在用户当前所在的模式：源码模式不要一跳回表单（表单只是同一个文件的另一视图）。
        const base = stateFromFile(written);
        const nextState =
          currentFile.kind !== "agents" && currentState.mode === "source"
            ? { ...base, mode: "source" as const, source: written.content, baseText: written.content }
            : base;
        updateStates((prev) => ({ ...prev, [selected]: nextState }));
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

  return (
    <div ref={panelRef} className="mt-1">
      <div className="flex flex-wrap items-start gap-2">
        <p className="min-w-0 flex-1 text-xs leading-5 text-muted">{t.constraintsIntro}</p>
        <button
          type="button"
          onClick={() => void load()}
          className="flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted transition-colors duration-100 hover:bg-hover hover:text-foreground"
          aria-label={t.constraintsRefresh}
          title={t.constraintsRefresh}
        >
          <Refresh size={12} aria-hidden />
        </button>
      </div>
      {view && (
        <p className="mt-1 font-mono text-[11px] break-all text-faint" title={view.agentDir}>
          {view.agentDir}
        </p>
      )}
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
                      {currentFile.kind !== "agents" && (
                        <span className="rounded border border-border px-1.5 py-0.5 text-[10px] text-muted">
                          {currentFile.kind === "rules"
                            ? t.constraintsKindAlways
                            : kindLabel(ruleKindOf(currentState.fields), t)}
                        </span>
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
                    {currentFile.kind === "rule" && currentState.extraFields.length > 0 && (
                      <p className="mt-1 text-[11px] text-muted">
                        {fmt(t.constraintsExtraFields, String(currentState.extraFields.length))}
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

                {currentFile.kind !== "agents" && (
                  <div className="mt-3 flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => switchMode("form")}
                      aria-pressed={currentState.mode === "form"}
                      className={`h-6 cursor-pointer rounded-md border px-2 text-[11px] transition-colors duration-100 ${currentState.mode === "form"
                        ? "border-accent/50 bg-active text-foreground"
                        : "border-border text-muted hover:bg-hover hover:text-foreground"
                        }`}
                    >
                      {t.constraintsFormMode}
                    </button>
                    <button
                      type="button"
                      onClick={() => switchMode("source")}
                      aria-pressed={currentState.mode === "source"}
                      className={`h-6 cursor-pointer rounded-md border px-2 text-[11px] transition-colors duration-100 ${currentState.mode === "source"
                        ? "border-accent/50 bg-active text-foreground"
                        : "border-border text-muted hover:bg-hover hover:text-foreground"
                        }`}
                    >
                      {t.constraintsSourceMode}
                    </button>
                  </div>
                )}

                {currentState.parseError && (
                  <p role="alert" className="mt-2 rounded border border-warn/40 bg-warn/5 px-2 py-1.5 text-[13px] text-warn">
                    {fmt(t.constraintsParseError, currentState.parseError)}
                  </p>
                )}

                {currentFile.kind === "agents" || currentState.mode === "source" ? (
                  <div className="mt-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-xs text-muted">
                        {currentFile.kind === "agents" ? t.constraintsAgentsDocHint : t.constraintsSourceHint}
                      </p>
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
                        <MarkdownPreview
                          text={previewText(currentState, currentFile.kind)}
                          empty={t.constraintsPreviewEmpty}
                        />
                      </div>
                    ) : (
                      <textarea
                        value={currentState.source}
                        onChange={(event) => updateSource(event.target.value)}
                        spellCheck={false}
                        autoComplete="off"
                        aria-label={currentTitle}
                        className="mt-2 min-h-[380px] w-full resize-y rounded-md border border-border bg-surface p-2.5 font-mono text-[12.5px] leading-5 outline-none transition-colors duration-100 focus:border-accent"
                      />
                    )}
                  </div>
                ) : (
                  <>
                    <div className="mt-3 flex flex-col divide-y divide-border-soft border-y border-border-soft">
                      {currentFile.kind !== "rules" && (
                        <div className="flex flex-wrap items-center gap-2 py-2">
                          <span className="w-24 shrink-0 text-[13px]">{t.constraintsEnabled}</span>
                          <Switch
                            on={currentState.fields.enabled}
                            disabled={saving}
                            label={t.constraintsEnabled}
                            onToggle={() => updateFields({ enabled: !currentState.fields.enabled })}
                          />
                          <span className="min-w-0 flex-1 text-xs text-muted">{t.constraintsEnabledHint}</span>
                        </div>
                      )}
                      <div className="flex flex-wrap items-center gap-2 py-2">
                        <span className="w-24 shrink-0 text-[13px]">{t.constraintsAlwaysApply}</span>
                        <Switch
                          on={currentState.fields.alwaysApply || currentFile.kind === "rules"}
                          disabled={saving || currentFile.kind === "rules"}
                          label={t.constraintsAlwaysApply}
                          onToggle={() => updateFields({ alwaysApply: !currentState.fields.alwaysApply })}
                        />
                        <span className="min-w-0 flex-1 text-xs text-muted">
                          {currentFile.kind === "rules" ? t.constraintsStickyForced : t.constraintsAlwaysApplyHint}
                        </span>
                      </div>
                      <div className="py-2">
                        <label className="text-[13px]" htmlFor={`constraint-description-${selected}`}>
                          {t.constraintsEditorDescription}
                        </label>
                        <input
                          id={`constraint-description-${selected}`}
                          value={currentState.fields.description}
                          onChange={(event) => updateFields({ description: event.target.value })}
                          placeholder={t.constraintsDescriptionPlaceholder}
                          spellCheck={false}
                          autoComplete="off"
                          className="mt-1 h-9 w-full min-w-0 rounded-md border border-border bg-surface px-2.5 text-[13px] outline-none transition-colors duration-100 placeholder:text-faint focus:border-accent"
                        />
                      </div>
                      <div className="py-2">
                        <button
                          type="button"
                          onClick={() => setAdvancedOpen((open) => !open)}
                          aria-expanded={advancedOpen}
                          className="flex w-full cursor-pointer items-center gap-1.5 text-left"
                        >
                          <ChevronDown
                            size={12}
                            aria-hidden
                            className={`shrink-0 text-muted transition-transform duration-100 ${advancedOpen ? "rotate-180" : ""}`}
                          />
                          <span className="text-[13px]">{t.constraintsAdvanced}</span>
                          <span className="text-xs text-muted">
                            {advancedCount(currentState.fields) > 0
                              ? fmt(t.constraintsAdvancedSummary, String(advancedCount(currentState.fields)))
                              : t.constraintsAdvancedNone}
                          </span>
                        </button>
                        {advancedOpen && (
                          <div className="mt-1">
                            <StringListField
                              label={t.constraintsGlobs}
                              hint={t.constraintsGlobsHint}
                              placeholder="src/**/*.ts"
                              values={currentState.fields.globs}
                              onChange={(values) => updateFields({ globs: values })}
                              addLabel={t.constraintsAdd}
                              removeLabel={t.constraintsRemove}
                            />
                            <StringListField
                              label={t.constraintsCondition}
                              hint={t.constraintsConditionHint}
                              placeholder=": any"
                              values={currentState.fields.condition}
                              onChange={(values) => updateFields({ condition: values })}
                              addLabel={t.constraintsAdd}
                              removeLabel={t.constraintsRemove}
                            />
                            <StringListField
                              label={t.constraintsAstCondition}
                              hint={t.constraintsAstConditionHint}
                              placeholder="func $F() {}"
                              values={currentState.fields.astCondition}
                              onChange={(values) => updateFields({ astCondition: values })}
                              addLabel={t.constraintsAdd}
                              removeLabel={t.constraintsRemove}
                            />
                            <div className="py-2">
                              <label className="text-[13px]" htmlFor={`constraint-question-${selected}`}>
                                {t.constraintsQuestion}
                              </label>
                              <p className="mt-0.5 text-xs text-muted">{t.constraintsQuestionHint}</p>
                              <textarea
                                id={`constraint-question-${selected}`}
                                value={currentState.fields.question}
                                onChange={(event) => updateFields({ question: event.target.value })}
                                rows={2}
                                spellCheck={false}
                                className="mt-1.5 w-full resize-y rounded-md border border-border bg-surface px-2 py-1.5 text-[12px] outline-none transition-colors duration-100 focus:border-accent"
                              />
                            </div>
                            <StringListField
                              label={t.constraintsScope}
                              hint={t.constraintsScopeHint}
                              placeholder="tool:edit(*.ts)"
                              values={currentState.fields.scope}
                              onChange={(values) => updateFields({ scope: values })}
                              addLabel={t.constraintsAdd}
                              removeLabel={t.constraintsRemove}
                            />
                            <StringListField
                              label={t.constraintsAgentsField}
                              hint={t.constraintsAgentsHint}
                              placeholder="reviewer"
                              values={currentState.fields.agents}
                              onChange={(values) => updateFields({ agents: values })}
                              addLabel={t.constraintsAdd}
                              removeLabel={t.constraintsRemove}
                            />
                            <div className="flex flex-wrap items-center gap-2 py-2">
                              <label className="w-24 shrink-0 text-[13px]" htmlFor={`constraint-mode-${selected}`}>
                                {t.constraintsInterruptMode}
                              </label>
                              <select
                                id={`constraint-mode-${selected}`}
                                value={currentState.fields.interruptMode}
                                onChange={(event) =>
                                  updateFields({ interruptMode: event.target.value as InterruptMode | "" })
                                }
                                className="h-8 rounded-md border border-border bg-surface px-2 text-[12px] outline-none transition-colors duration-100 focus:border-accent"
                              >
                                <option value="">{t.constraintsInterruptDefault}</option>
                                <option value="never">{t.constraintsInterruptNever}</option>
                                <option value="prose-only">{t.constraintsInterruptProse}</option>
                                <option value="tool-only">{t.constraintsInterruptTool}</option>
                                <option value="always">{t.constraintsInterruptAlways}</option>
                              </select>
                              <span className="min-w-0 flex-1 text-xs text-muted">{t.constraintsInterruptModeHint}</span>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="mt-4">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <h3 className="text-xs font-medium text-muted">{t.constraintsBody}</h3>
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
                      <p className="mt-0.5 text-xs text-muted">{t.constraintsBodyHint}</p>
                      {preview ? (
                        <div className="md-body mt-2 min-h-[240px] rounded-md border border-border-soft bg-surface p-3 text-[13px] leading-6">
                          <MarkdownPreview text={currentState.body} empty={t.constraintsPreviewEmpty} />
                        </div>
                      ) : (
                        <textarea
                          value={currentState.body}
                          onChange={(event) => updateBody(event.target.value)}
                          spellCheck={false}
                          autoComplete="off"
                          aria-label={t.constraintsBody}
                          className="mt-2 min-h-[260px] w-full resize-y rounded-md border border-border bg-surface p-2.5 font-mono text-[12.5px] leading-5 outline-none transition-colors duration-100 focus:border-accent"
                        />
                      )}
                    </div>
                  </>
                )}

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
