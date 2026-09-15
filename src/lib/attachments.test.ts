import { describe, expect, it } from "vitest";
import { ATTACH_MAX_BYTES, bytesToBase64, checkImage, dataUrl, imagesFromContent, mimeFromName } from "./attachments";

/**
 * V2 M6：图片附件的纯逻辑。
 * 关键口径：只认 png/jpeg/webp/gif、单张 ≤ 10MB、历史回放不无上限常驻 base64。
 */
describe("图片附件：类型与体积校验", () => {
  it("由扩展名推 mime，未知扩展名给 null", () => {
    expect(mimeFromName("shot.PNG")).toBe("image/png");
    expect(mimeFromName("a.jpeg")).toBe("image/jpeg");
    expect(mimeFromName("x.webp")).toBe("image/webp");
    expect(mimeFromName("readme.md")).toBeNull();
    expect(mimeFromName("noext")).toBeNull();
  });

  it("非图片类型与超限体积都给出中文提示", () => {
    expect(checkImage("a.png", "image/png", 1024)).toBeNull();
    expect(checkImage("a.svg", "image/svg+xml", 1024)).toContain("只支持 PNG");
    expect(checkImage("big.png", "image/png", ATTACH_MAX_BYTES + 1)).toContain("超过 10MB");
  });
});

describe("图片附件：base64 与 data URL", () => {
  it("bytesToBase64 与已知编码一致（含 padding）", () => {
    expect(bytesToBase64(new Uint8Array([]))).toBe("");
    expect(bytesToBase64(new Uint8Array([104, 105]))).toBe("aGk=");
    expect(bytesToBase64(new Uint8Array([104, 105, 33]))).toBe("aGkh");
    expect(bytesToBase64(new Uint8Array([0xff, 0xd8, 0xff]))).toBe("/9j/");
  });

  it("dataUrl 同时接受 data 与 dataBase64 两种字段名", () => {
    expect(dataUrl({ mimeType: "image/png", data: "AAA" })).toBe("data:image/png;base64,AAA");
    expect(dataUrl({ mimeType: "image/jpeg", dataBase64: "BBB" })).toBe("data:image/jpeg;base64,BBB");
  });
});

describe("图片附件：内容块提取", () => {
  it("只认 image 块，文本/思考块不进图片列表", () => {
    const { images, omitted } = imagesFromContent([
      { type: "text", text: "看图" },
      { type: "image", data: "AAA", mimeType: "image/png" },
      { type: "thinking", thinking: "…" },
    ]);
    expect(images).toEqual([{ mimeType: "image/png", data: "AAA" }]);
    expect(omitted).toBe(0);
  });

  it("兼容 anthropic 风格 source.data / media_type", () => {
    const { images } = imagesFromContent([{ type: "image", source: { data: "ZZZ", media_type: "image/webp" } }]);
    expect(images).toEqual([{ mimeType: "image/webp", data: "ZZZ" }]);
  });

  it("超大块省略并计数（历史回放不许把几十 MB base64 常驻内存）", () => {
    const big = "A".repeat(64);
    const { images, omitted } = imagesFromContent(
      [
        { type: "image", data: big, mimeType: "image/png" },
        { type: "image", data: "small", mimeType: "image/png" },
      ],
      32,
    );
    expect(images).toHaveLength(1);
    expect(images[0].data).toBe("small");
    expect(omitted).toBe(1);
  });

  it("非数组内容（缺失/异常）安全返回空", () => {
    expect(imagesFromContent(undefined)).toEqual({ images: [], omitted: 0 });
    expect(imagesFromContent("nope")).toEqual({ images: [], omitted: 0 });
  });
});
