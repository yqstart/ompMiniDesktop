import { useState } from "react";
import type { ModelInfo } from "@shared/types";
import { fmt } from "../../lib/locale";
import { fmtContextWindow, shortModelName } from "../../lib/modelNames";
import { useText } from "../../lib/useText";

/**
 * 模型选择列表（搜索框 + 按供应商分组平铺 + 点选）。
 *
 * 设置 ›「模型」里两处共用：给角色挑模型、给失败转移链挑目标——两处各写一遍会漂
 * （一处能搜一处不能、角标不一致）。设置页是可滚动容器，选择器一律**行内展开**，
 * 不做浮层（浮层会被裁掉）。
 */
export function ModelPickList({
  models,
  onPick,
}: {
  models: ModelInfo[];
  onPick: (m: ModelInfo) => void;
}) {
  const t = useText();
  const [q, setQ] = useState("");
  const query = q.trim().toLowerCase();
  const list = query
    ? models.filter((m) => `${m.provider}/${m.id} ${m.name}`.toLowerCase().includes(query))
    : models;
  const groups = new Map<string, ModelInfo[]>();
  for (const m of list) {
    const g = groups.get(m.provider) ?? [];
    g.push(m);
    groups.set(m.provider, g);
  }

  return (
    <>
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={t.roleSearchPlaceholder}
        aria-label={t.roleSearchPlaceholder}
        className="w-full rounded-md border border-border bg-surface px-3 py-2 text-[13px]"
      />
      <div className="mt-2 max-h-56 overflow-y-auto">
        {[...groups].map(([provider, ms]) => (
          <div key={provider}>
            <div className="px-2 pt-3 pb-1 font-mono text-[11px] break-all text-faint">{provider}</div>
            {ms.map((m) => (
              <button
                key={m.selector}
                onClick={() => onPick(m)}
                className="flex min-h-9 w-full cursor-pointer items-center gap-2 rounded-md px-2 py-2 text-left text-[13px] transition-colors duration-100 hover:bg-hover"
                aria-label={fmt(t.useModelAria, m.name)}
              >
                <span className="truncate">{shortModelName(m)}</span>
                <span className="ml-auto flex shrink-0 gap-1 font-mono text-xs text-muted">
                  {m.contextWindow ? <span>{fmtContextWindow(m.contextWindow)}</span> : null}
                  {m.thinking?.length ? <span>{m.thinking.length}</span> : null}
                </span>
              </button>
            ))}
          </div>
        ))}
        {list.length === 0 && <div className="p-2 text-[13px] text-muted">{t.noModelMatch}</div>}
      </div>
    </>
  );
}
