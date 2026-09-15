import type { ImageAttachment, ImageBlock } from "@shared/types";

/**
 * 图片附件的纯逻辑（不碰 DOM/tauri，便于单测）：
 * 类型白名单、单张体积上限、bytes → base64、`data:` URL 组装。
 *
 * 口径：附件只在内存里存在到发送那一刻，随 `prompt.images` 交给 omp；
 * 应用不落盘、不写覆盖层，历史回放读的是 omp 自己写进 jsonl 的 image 块。
 */

/** 单张上限：超过就在本地拒绝（提示用户先压缩），不把几十 MB base64 塞进 RPC 帧。 */
export const ATTACH_MAX_BYTES = 10 * 1024 * 1024;

/** 允许的图片类型（omp 侧支持 png/jpeg/webp/gif）。 */
export const ATTACH_MIME = ["image/png", "image/jpeg", "image/webp", "image/gif"] as const;

const EXT_MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
};

/** 由文件名推 mime；不认识的扩展名返回 null（调用方给中文提示）。 */
export function mimeFromName(name: string): string | null {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  return EXT_MIME[ext] ?? null;
}

export function isAllowedMime(mime: string): boolean {
  return (ATTACH_MIME as readonly string[]).includes(mime);
}

/** 体积/类型校验：返回中文错误文案，null = 通过。 */
export function checkImage(name: string, mime: string, bytes: number): string | null {
  if (!isAllowedMime(mime)) return `${name}：只支持 PNG / JPEG / WebP / GIF`;
  if (bytes > ATTACH_MAX_BYTES) return `${name}：超过 10MB，请先压缩再发`;
  return null;
}

/** Uint8Array → base64（分块，避免 String.fromCharCode 参数过多爆栈）。 */
export function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

/** data: URL（缩略图渲染用；只在本地 WebView 内显示，不外发）。 */
export function dataUrl(img: { mimeType: string; data?: string; dataBase64?: string }): string {
  return `data:${img.mimeType};base64,${img.data ?? img.dataBase64 ?? ""}`;
}

/**
 * File → 附件。用 `arrayBuffer()` 而不是 FileReader：Node/vitest 与 WebView 都能跑。
 * 校验不过时抛中文 Error（调用方直接展示 message）。
 */
export async function attachmentFromFile(file: File): Promise<ImageAttachment> {
  const mime = file.type || mimeFromName(file.name) || "";
  const err = checkImage(file.name, mime, file.size);
  if (err) throw new Error(err);
  const buf = new Uint8Array(await file.arrayBuffer());
  return { name: file.name, mimeType: mime, dataBase64: bytesToBase64(buf), bytes: buf.byteLength };
}

/**
 * 从消息内容块里取图片（实时帧与 jsonl 同构）。
 * 只认 `type:"image"`；`data` 缺失或超过 `maxChars` 的块跳过并计数——
 * 历史回放不做无上限 base64 常驻，宁可少渲染也不把内存吃光。
 */
export function imagesFromContent(
  content: unknown,
  maxChars = 512 * 1024,
): { images: ImageBlock[]; omitted: number } {
  if (!Array.isArray(content)) return { images: [], omitted: 0 };
  const images: ImageBlock[] = [];
  let omitted = 0;
  for (const raw of content) {
    if (!raw || typeof raw !== "object") continue;
    const b = raw as { type?: string; data?: unknown; mimeType?: unknown; source?: { data?: unknown; media_type?: unknown } };
    if (b.type !== "image") continue;
    const data = typeof b.data === "string" ? b.data : typeof b.source?.data === "string" ? b.source.data : "";
    const mimeType =
      typeof b.mimeType === "string"
        ? b.mimeType
        : typeof b.source?.media_type === "string"
          ? b.source.media_type
          : "image/png";
    if (!data || data.length > maxChars) {
      omitted += 1;
      continue;
    }
    images.push({ mimeType, data });
  }
  return { images, omitted };
}
