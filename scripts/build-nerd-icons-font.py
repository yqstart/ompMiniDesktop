#!/usr/bin/env python3
"""从 Nerd Fonts 的 Symbols-only 字体派生壳内嵌的**单宽图标回退字体**。

用法：
    # 1) 取上游字体（Nerd Fonts 官方 release 的 Symbols Only 包）
    curl -L -o /tmp/NerdFontsSymbolsOnly.zip \\
      https://github.com/ryanoasis/nerd-fonts/releases/latest/download/NerdFontsSymbolsOnly.zip
    unzip -o /tmp/NerdFontsSymbolsOnly.zip -d /tmp/nf
    # 2) 生成（依赖：pip install fonttools brotli；只在重新生成时需要，构建期不需要 Python）
    python3 scripts/build-nerd-icons-font.py /tmp/nf/SymbolsNerdFontMono-Regular.ttf

产物：public/fonts/omp-nerd-icons.woff2（进仓库；它是 `index.css` 里 "OMP Nerd Icons"
唯一的源）。第三方来源与许可见 THIRD-PARTY-NOTICES.md「字体资源」节。

为什么要横向压缩到 0.6 em：
  Symbols-only 字体里每个字形 advance = 1 em（10624 个字形全 2048/2048 upem），而终端
  等宽字体（Menlo / JetBrains Mono / SF Mono…）的字符 advance ≈ 0.6 em——终端里一个图标
  必须恰好占 1 个 cell：xterm 的 DOM renderer 按 cell 网格排布（每字符 advance 归一到
  cell 宽），字形若比 cell 宽就会与相邻字符重叠。Nerd Fonts 官方发布的 `Nerd Font Mono`
  变体就是「图标压成单宽」的形态（官方口径：非 Mono 版图标约 1.5 个字母宽，Mono 版即
  单宽）——本脚本对 Symbols-only 做同样的横向压缩，纵向保持 1 em（与官方 Mono 一致）。

改了什么（相对上游 ttf）：
  - 所有字形的轮廓横向 ×0.6、advance 同比例（composite 先分解再缩放，避免组件被二次缩放）；
  - head.xMin/xMax 与 hhea.advanceWidthMax 按新轮廓重算；
  - name 表改名为 "OMP Nerd Icons"（MIT 允许修改与再分发；改名避免与上游字体混淆，
    copyright / license 等声明字段原样保留）。
"""

import sys
from pathlib import Path

from fontTools.pens.recordingPen import DecomposingRecordingPen
from fontTools.pens.transformPen import TransformPen
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.ttLib import TTFont
from fontTools.ttLib.woff2 import compress

# 横向比例：等于被替换的终端等宽字体（Menlo / JetBrains Mono / SF Mono）的 advance/em。
# 实测（浏览器，13px）：Menlo 'W' = 7.828125px，1 em = 13px → 0.602；三家的常见值都是 0.6。
X_SCALE = 0.6

FAMILY = "OMP Nerd Icons"
SUBFAMILY = "Regular"
PS_NAME = "OMPNerdIcons-Regular"

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "public" / "fonts" / "omp-nerd-icons.woff2"


def bake_glyphs(font: TTFont) -> None:
    """把每个字形（含 composite）分解后按 X_SCALE 横向缩放，并同比例收窄 advance。"""
    glyph_set = font.getGlyphSet()
    glyf = font["glyf"]
    hmtx = font["hmtx"]
    baked = {}
    for name in font.getGlyphOrder():
        # 先完整分解（composite 的组件变换一并展开），避免组件引用被各自缩一次
        rec = DecomposingRecordingPen(glyph_set)
        glyph_set[name].draw(rec)
        pen = TTGlyphPen(None)
        rec.replay(TransformPen(pen, (X_SCALE, 0, 0, 1, 0, 0)))
        baked[name] = pen.glyph()
    for name in font.getGlyphOrder():
        glyf[name] = baked[name]
        advance, lsb = hmtx[name]
        hmtx[name] = (round(advance * X_SCALE), round(lsb * X_SCALE))
    # 三处横向极值：取全部字形的联合 bbox 与最大 advance，别让 head / hhea 停在旧值上
    head = font["head"]
    xs_min, xs_max = None, None
    for name in font.getGlyphOrder():
        glyph = glyf[name]
        if glyph.numberOfContours == 0:
            continue
        glyph.recalcBounds(glyf)
        xs_min = glyph.xMin if xs_min is None else min(xs_min, glyph.xMin)
        xs_max = glyph.xMax if xs_max is None else max(xs_max, glyph.xMax)
    if xs_min is not None:
        head.xMin, head.xMax = xs_min, xs_max
    font["hhea"].advanceWidthMax = max(w for w, _ in hmtx.metrics.values())
    font["OS/2"].xAvgCharWidth = round(font["OS/2"].xAvgCharWidth * X_SCALE)


def rename(font: TTFont) -> None:
    """改 name 表：家族名换成派生名，copyright / license 等声明字段保持上游原文。"""
    replacements = {
        1: FAMILY,  # family
        2: SUBFAMILY,  # subfamily
        3: f"{FAMILY} {SUBFAMILY}; derived from Nerd Fonts Symbols Only",  # unique id
        4: f"{FAMILY} {SUBFAMILY}",  # full name
        6: PS_NAME,  # postscript name
        16: FAMILY,  # typographic family
        17: SUBFAMILY,  # typographic subfamily
    }
    name = font["name"]
    for rec in list(name.names):
        if rec.nameID in replacements:
            name.setName(
                replacements[rec.nameID], rec.nameID, rec.platformID, rec.platEncID, rec.langID
            )


def main() -> int:
    if len(sys.argv) != 2:
        print(__doc__)
        return 2
    src = Path(sys.argv[1])
    if not src.is_file():
        print(f"找不到上游字体：{src}", file=sys.stderr)
        return 1

    font = TTFont(src)
    upem = font["head"].unitsPerEm
    baked_before = len(font.getGlyphOrder())
    bake_glyphs(font)
    rename(font)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    tmp_ttf = OUT.with_suffix(".tmp.ttf")
    font.save(tmp_ttf)
    compress(str(tmp_ttf), str(OUT))
    tmp_ttf.unlink()

    check = TTFont(OUT)
    hmtx = check["hmtx"]
    widths = sorted({w for w, _ in hmtx.metrics.values()})
    advance_em = round(widths[-1] / upem, 4) if widths else None
    print(f"字形 {baked_before} 个；advance 取值 {widths}（upem {upem}，即 {advance_em} em）")
    print(f"family：{check['name'].getDebugName(1)}；postscript：{check['name'].getDebugName(6)}")
    print(f"产出：{OUT.relative_to(ROOT)}（{OUT.stat().st_size / 1024:.0f} KB）")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
