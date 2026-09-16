import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { fmt } from "../../lib/locale";
import { useText } from "../../lib/useText";

/**
 * Assistant 正文渲染（MASTER §8 组件名 `AssistantText`）。
 *
 * - Markdown 走 `react-markdown`：默认不渲染原始 HTML（无 `dangerouslySetInnerHTML`），
 *   内容来自本地 omp 会话文件，仍然按不可信输入处理。
 * - 代码高亮走 `rehype-highlight`（highlight.js 的 lowlight），配色在 `src/index.css`
 *   用项目 token 定义，深浅色各一套，不额外引第三方主题 CSS。
 * - 流式中代码块未闭合（``` 计数为奇数）时给一条 skeleton，避免"半个代码块"跳版（MASTER §5）。
 * - 代码块右上角复制按钮：长命令/长 diff 是高频复用内容。
 */
export function AssistantText({ text, complete }: { text: string; complete: boolean }) {
  const t = useText();
  const [pendingUrl, setPendingUrl] = useState<string | null>(null);
  // 未闭合的围栏代码块：流式中会出现，长度用奇偶判断（Markdown 里 ``` 必须成对）
  const openFence = (text.match(/```/g)?.length ?? 0) % 2 === 1;
  return (
    <div className="md-body max-w-full overflow-x-auto">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[[rehypeHighlight, { detect: true, ignoreMissing: true }]]}
        components={{
          // 代码块：横滚不撑破布局（MASTER §7），并挂复制按钮
          pre: ({ children, ...props }) => (
            <CodeBlock {...props}>{children}</CodeBlock>
          ),
          a: ({ children, ...props }) => (
            <a
              {...props}
              target="_blank"
              rel="noreferrer noopener"
              onClick={(e) => {
                const href = String(props.href ?? "");
                if (/^https?:\/\//i.test(href)) {
                  e.preventDefault();
                  setPendingUrl(href);
                }
              }}
            >
              {children}
            </a>
          ),
        }}
      >
        {text}
      </ReactMarkdown>
      {pendingUrl && (
        <span className="mx-1 inline-flex items-center gap-1 rounded border border-border bg-surface px-1.5 py-0.5 text-xs">
          {fmt(t.openLinkConfirm, pendingUrl.length > 40 ? `${pendingUrl.slice(0, 40)}…` : pendingUrl)}
          <button
            className="cursor-pointer text-accent hover:opacity-80"
            onClick={() => {
              const url = pendingUrl;
              setPendingUrl(null);
              void import("@tauri-apps/plugin-opener").then((m) => m.openUrl(url).catch(() => undefined));
            }}
          >
            {t.openLink}
          </button>
          <button className="cursor-pointer text-muted hover:text-foreground" onClick={() => setPendingUrl(null)}>
            {t.cancel}
          </button>
        </span>
      )}
      {openFence && (
        <div className="mt-1.5 space-y-1.5 rounded-lg bg-code p-3" aria-label={t.codeBlockGenerating} role="status">
          <div className="h-3 w-2/3 animate-pulse rounded bg-border/70" />
          <div className="h-3 w-1/2 animate-pulse rounded bg-border/70" />
        </div>
      )}
      {!complete && !openFence && (
        <span className="ml-0.5 inline-block h-4 w-1.5 animate-pulse rounded-sm bg-accent/70 align-text-bottom" aria-hidden />
      )}
    </div>
  );
}

/** 代码块容器：自带复制（纯前端剪贴板，不落盘、不联网）。 */
function CodeBlock({ children, ...props }: React.ComponentProps<"pre">) {
  const t = useText();
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    const el = document.activeElement as HTMLElement | null;
    void el;
    const text = extractText(children);
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // 复制失败不阻断阅读
    }
  };
  return (
    <div className="group/code relative">
      <pre {...props} className="overflow-x-auto rounded-lg bg-code p-3 font-mono text-xs leading-5">
        {children}
      </pre>
      <button
        onClick={() => void copy()}
        className="absolute top-1.5 right-1.5 flex cursor-pointer items-center gap-1 rounded border border-border/70 bg-surface/90 px-1.5 py-0.5 text-[11px] text-muted opacity-0 transition-opacity duration-150 group-hover/code:opacity-100 focus-visible:opacity-100"
        aria-label={t.copy}
        title={t.copy}
      >
        {copied ? <Check size={11} aria-hidden /> : <Copy size={11} aria-hidden />}
        {copied ? t.copied : t.copy}
      </button>
    </div>
  );
}

/** 从 React 子树里抽纯文本（复制用；highlight.js 产出的是嵌套 span）。 */
function extractText(node: React.ReactNode): string {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(extractText).join("");
  if (typeof node === "object" && "props" in (node as { props?: unknown })) {
    const props = (node as { props?: { children?: React.ReactNode } }).props;
    return extractText(props?.children);
  }
  return "";
}
