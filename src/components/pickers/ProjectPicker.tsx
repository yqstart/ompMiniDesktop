import { useCallback } from "react";
import { Check, ChevronDown } from "lucide-react";
import { useApp } from "../../stores/app";
import { useDropdown } from "../../lib/useDropdown";
import { switchProject } from "../../lib/projects";
import type { ProjectView } from "@shared/types";

/**
 * 输入框上方的项目选择器（截图左侧那个）：显示这条消息落到哪个项目。
 * 点开列全部项目，选中即切上下文并打开该项目最近的会话（`switchProject` 的
 * `openRecent`）——切换后输入框上方显示的项目，一定就是消息发去的项目。
 *
 * 当前会话不属于任何项目时显示「未归属」（目录被解绑过），此时仍可切到某个项目。
 */
export function ProjectPicker({ project }: { project: ProjectView | null }) {
  const { projects, activeSessionId, composerMenu } = useApp();
  const open = composerMenu === "project";
  const setOpen = useCallback(
    (v: boolean) => useApp.setState({ composerMenu: v ? "project" : null }),
    [],
  );
  const ref = useDropdown(open, () => setOpen(false));
  const label = project?.name ?? (activeSessionId ? "未归属" : "选择项目");

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className="flex shrink-0 cursor-pointer items-center gap-1 rounded-full px-2 py-1 whitespace-nowrap text-muted transition-colors duration-150 hover:bg-surface hover:text-foreground"
        aria-label={`当前项目：${label}，点击切换`}
        aria-expanded={open}
        title={project?.path ?? "当前会话不属于任何项目"}
      >
        <span className="whitespace-nowrap">{label}</span>
        <ChevronDown size={14} aria-hidden className="shrink-0 opacity-60" />
      </button>
      {open && (
        <div className="absolute bottom-full left-0 z-10 mb-1 max-h-72 w-72 max-w-[calc(100vw-2rem)] overflow-y-auto rounded-xl border border-border bg-surface p-1 shadow-xl">
          {projects.map((p) => {
            const current = p.id === project?.id;
            return (
              <button
                key={p.id}
                onClick={() => {
                  setOpen(false);
                  void switchProject(p.id, { openRecent: true });
                }}
                disabled={p.missing}
                className={`flex w-full cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-left text-sm transition-colors duration-150 hover:bg-background disabled:cursor-not-allowed disabled:opacity-40 ${
                  current ? "text-foreground" : "text-muted"
                }`}
                aria-label={`切换到项目 ${p.name}`}
              >
                <Check size={13} aria-hidden className={`shrink-0 ${current ? "opacity-100" : "opacity-0"}`} />
                <span className="min-w-0 flex-1 truncate">{p.name}</span>
                {p.missing ? (
                  <span className="shrink-0 rounded bg-warn/15 px-1 py-px text-[11px] text-warn">目录缺失</span>
                ) : (
                  <span className="max-w-28 shrink-0 truncate font-mono text-[11px] text-muted/70">{p.path}</span>
                )}
              </button>
            );
          })}
          {projects.length === 0 && (
            <div className="px-2 py-1.5 text-sm text-muted">暂无项目，先在左侧添加</div>
          )}
        </div>
      )}
    </div>
  );
}
