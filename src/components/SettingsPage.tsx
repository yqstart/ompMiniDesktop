import { Archive, ChartBar, Key, Notebook, Plug, Puzzle, Sliders } from "reicon-react";
import { useText } from "../lib/useText";
import { useEffect, useRef, useState } from "react";
import { ArchivedSessions } from "./ArchivedSessions";
import { GeneralSettingsPanel } from "./settings/GeneralSettingsPanel";
import { MemoryPanel } from "./settings/MemoryPanel";
import { PluginsPanel } from "./settings/PluginsPanel";
import { SkillsPanel } from "./settings/SkillsPanel";
import { ModelsPanel } from "./settings/ModelsPanel";
import { UsagePanel } from "./settings/UsagePanel";

/** 设置页分页签；顺序即界面顺序。 */
type SettingsTab = "general" | "models" | "plugins" | "skills" | "memories" | "usage" | "archived";
const TAB_ICONS = {
 general: Sliders,
 models: Key,
 plugins: Plug,
 skills: Puzzle,
 memories: Notebook,
 usage: ChartBar,
 archived: Archive,
};
/**
 * 左栏两组（组标题 + 组间分隔线）：上组读写的是 **omp** 的配置与数据，
 * 下组是本应用自己的信息与设置（会话统计、归档管理）。
 * 页内的快捷定位 chips 已删——区块不多，左栏切页就是唯一导航。
 */
const TAB_GROUPS: { label: "settingsGroupOmp" | "settingsGroupApp"; tabs: SettingsTab[] }[] = [
 { label: "settingsGroupOmp", tabs: ["general", "models", "plugins", "skills", "memories"] },
 { label: "settingsGroupApp", tabs: ["usage", "archived"] },
];

export function SettingsPage({ visible = true }: { visible?: boolean }) {
 const t = useText();
 const [tab, setTab] = useState<SettingsTab>("general");
 const pageRef = useRef<HTMLDivElement>(null);
 const panelRef = useRef<HTMLDivElement>(null);
 const lastFocusRef = useRef<HTMLElement | null>(null);

 useEffect(() => {
  panelRef.current?.scrollTo({ top: 0 });
 }, [tab]);

 useEffect(() => {
  const page = pageRef.current;
  if (!page) return;
  const active = document.activeElement;
  if (!visible) {
   if (active instanceof HTMLElement && page.contains(active)) active.blur();
   return;
  }
  if (page.contains(active) || active?.closest('[role="dialog"][aria-modal="true"]')) return;
  const previous = lastFocusRef.current;
  const target = previous?.isConnected && !previous.matches(":disabled")
   ? previous
   : page.querySelector<HTMLElement>('[role="dialog"][aria-modal="true"]')
   ?? page.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]');
  target?.focus({ preventScroll: true });
 }, [visible]);

 // 设置标签面板：切到终端标签只隐藏（页签选择、滚动位置都保留），关闭标签才卸载
 return (
  <div
   ref={pageRef}
   inert={!visible}
   aria-hidden={!visible}
   onFocusCapture={(event) => {
    if (event.target instanceof HTMLElement) lastFocusRef.current = event.target;
   }}
   className={
    visible
     ? "@container/settings mx-auto flex min-h-0 min-w-0 w-full max-w-6xl flex-1 gap-3 overflow-hidden p-3 sm:gap-5 sm:p-5"
     : "hidden"
   }
  >
   {/* 左栏：竖向菜单（无标题行，菜单从顶端开始），分「omp」与「本应用」两组——组标题在窄导航
          （44px）下收进 sr-only，组间分隔线保留。设置是标签栏里的标签——关闭走标签栏的 × / ⌘W
          （`closeSettingsTab`，回到上次的终端标签），页内不放第二个关闭入口。
          omp 组：常用设置（omp 配置在本应用的唯一设置面——`lib/settingsList.ts` 的 117 项
          展示清单，按上游分组；三稿把原「更多设置」页并入）、模型（**omp 模型相关唯一管理面**：
          供应商 / 我的模型 / 模型角色 / 快速切换环 / 失败转移）、插件（V23：`omp plugin` 的
          清单 / 启停 / 特性 / 安装 / 卸载 / 体检）、技能（V23：`omp skill list` 的发现结果 +
          逐项启停 + SKILL.md 预览）、记忆（omp 项目记忆的查看 / 删除）。
          本应用组：使用统计（会话 jsonl 的用量聚合，只读）、已归档对话（归档管理面，归档会话不在左栏出现）。
          本应用的更新在左栏字标行的应用版本 chip；omp 的运行环境诊断（路径 / agentDir /
          重新检测 / 指定路径）在字标行 omp 版本 chip 的弹窗里（V31）；界面语言与皮肤是纯展示层
          偏好，入口在左栏底部「设置」行，这里不重复放。 */}
   <nav aria-label={t.title} className="flex w-11 shrink-0 flex-col border-r border-border-soft pr-2 @min-[640px]/settings:w-40 @min-[640px]/settings:pr-3">
    <div
     role="tablist"
     aria-orientation="vertical"
     aria-label={t.title}
     className="flex flex-col gap-1"
     onKeyDown={(event) => {
      if (event.altKey || event.ctrlKey || event.metaKey || event.nativeEvent.isComposing) return;
      const tabs = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
      const index = tabs.indexOf(event.target as HTMLButtonElement);
      if (index < 0) return;
      const next = event.key === "Home" ? 0
       : event.key === "End" ? tabs.length - 1
        : event.key === "ArrowDown" ? (index + 1) % tabs.length
         : event.key === "ArrowUp" ? (index - 1 + tabs.length) % tabs.length
          : null;
      if (next === null) return;
      event.preventDefault();
      tabs[next].focus();
      tabs[next].click();
     }}
    >
     {TAB_GROUPS.map(({ label: groupKey, tabs }, gi) => (
      <div key={groupKey} className={`flex flex-col gap-1 ${gi > 0 ? "mt-3 border-t border-border-soft pt-3" : ""}`}>
       {/* 组标题：窄导航（44px）放不下文字，收进 sr-only（分组语义仍由 aria 保留） */}
       <p className="sr-only text-[11px] font-medium text-faint @min-[640px]/settings:not-sr-only @min-[640px]/settings:px-3 @min-[640px]/settings:pb-1">
        {t[groupKey]}
       </p>
       {tabs.map((k) => {
        const Icon = TAB_ICONS[k];
        const label =
         k === "general"
          ? t.tabGeneral
          : k === "models"
           ? t.tabModels
           : k === "plugins"
            ? t.tabPlugins
            : k === "skills"
             ? t.tabSkills
             : k === "memories"
              ? t.tabMemories
              : k === "usage"
               ? t.tabUsage
               : t.tabArchived;
        return (
         <button
          key={k}
          id={`settings-tab-${k}`}
          role="tab"
          tabIndex={tab === k ? 0 : -1}
          aria-selected={tab === k}
          aria-controls="settings-panel"
          title={label}
          onClick={() => setTab(k)}
          className={`flex min-h-11 cursor-pointer items-center justify-center gap-2.5 rounded-md text-left text-[13px] transition-colors duration-100 @min-[640px]/settings:justify-start @min-[640px]/settings:px-3 ${tab === k
           ? "bg-active font-semibold text-accent"
           : "text-muted hover:bg-hover hover:text-foreground"
           }`}
         >
          <Icon size={16} className="shrink-0" aria-hidden />
          <span className="sr-only @min-[640px]/settings:not-sr-only">{label}</span>
         </button>
        );
       })}
      </div>
     ))}
    </div>
   </nav>
   {/* tab 内容区是唯一的滚动容器：外层只定高（底边距 24px），滚动条不出设置页外框。 */}
   <div
    ref={panelRef}
    id="settings-panel"
    role="tabpanel"
    tabIndex={0}
    aria-labelledby={`settings-tab-${tab}`}
    className="@container/panel flex min-h-0 min-w-0 flex-1 flex-col gap-4 overflow-x-hidden overflow-y-auto pb-1 [overflow-wrap:anywhere]"
   >
    {tab === "archived" ? (
     <ArchivedSessions />
    ) : tab === "models" ? (
     <ModelsPanel />
    ) : tab === "plugins" ? (
     <PluginsPanel />
    ) : tab === "skills" ? (
     <SkillsPanel />
    ) : tab === "memories" ? (
     <MemoryPanel />
    ) : tab === "usage" ? (
     <UsagePanel />
    ) : (
     <>
      <div className="shrink-0">
       <h2 className="text-[20px] font-semibold tracking-tight">{t.tabGeneral}</h2>
       <p className="mt-1 text-[13px] text-muted">{t.tabGeneralHint}</p>
      </div>
      <GeneralSettingsPanel />
     </>
    )}
   </div>
  </div>
 );
}
