# -*- coding: utf-8 -*-
"""将 final_draft.md 转成符合 doc-formatter 契约的单个完整 HTML。"""
import re, io, os, html as htmllib

SRC = r"C:/Users/25326/Desktop/创新项目/output/20261102-pm-guide/stage1/final_draft.md"
OUT = r"C:/Users/25326/Desktop/创新项目/output/20261102-pm-guide/stage2/formatted-生活决策助手项目管理指导标准.html"

TITLE = "生活决策助手项目管理指导标准"
SUBTITLE = "从第一次提交到结题归档：上传、合并、回溯的完整操作规程"
CATEGORY = "项目管理标准"
META = "深圳大学学生创新发展基金基础实验项目　|　2026 年 11 月　|　版本 v1.0"

BODY_FONT = "font-family:'SimSun','宋体',serif;"
HEAD_FONT = "font-family:'SimHei','黑体',sans-serif;"

def inline(text):
    """行内标记：先转义，再处理 **bold** 与 `code`。"""
    t = htmllib.escape(text, quote=False)
    t = re.sub(r"\*\*(.+?)\*\*", r"<strong>\1</strong>", t)
    t = re.sub(r"`([^`]+?)`", r'<code style="font-family:Consolas,monospace;font-size:10pt;background:#f2f4f7;padding:0 2px;">\1</code>', t)
    return t

def read_lines():
    with io.open(SRC, encoding="utf-8") as f:
        return f.read().split("\n")

lines = read_lines()

# ---------- 第一遍：切块 ----------
blocks = []   # (kind, payload)
i = 0
while i < len(lines):
    line = lines[i]
    s = line.strip()

    if not s:
        i += 1
        continue

    # 代码块
    if s.startswith("```"):
        i += 1
        buf = []
        while i < len(lines) and not lines[i].strip().startswith("```"):
            buf.append(lines[i])
            i += 1
        i += 1
        blocks.append(("code", "\n".join(buf)))
        continue

    # 标题
    m = re.match(r"^(#{1,4})\s+(.*)$", s)
    if m:
        blocks.append(("h", (len(m.group(1)), m.group(2).strip())))
        i += 1
        continue

    # 表格：当前行含 | 且下一行是分隔行
    if "|" in s and i + 1 < len(lines) and re.match(r"^\s*\|?[\s:\-|]+\|[\s:\-|]*$", lines[i + 1]):
        def split_row(row):
            row = row.strip()
            if row.startswith("|"):
                row = row[1:]
            if row.endswith("|") and not row.endswith("\\|"):
                row = row[:-1]
            row = row.replace("\\|", "\u0001")
            cells = [c.replace("\u0001", "|").strip() for c in row.split("|")]
            return cells
        header = split_row(s)
        i += 2
        rows = []
        while i < len(lines) and "|" in lines[i] and lines[i].strip():
            rows.append(split_row(lines[i]))
            i += 1
        blocks.append(("table", (header, rows)))
        continue

    # 有序列表
    if re.match(r"^\d+\.\s", s):
        items = []
        while i < len(lines) and re.match(r"^\s*\d+\.\s", lines[i]):
            items.append(re.sub(r"^\s*\d+\.\s+", "", lines[i]))
            i += 1
        blocks.append(("ol", items))
        continue

    # 无序列表
    if re.match(r"^[-*]\s", s):
        items = []
        while i < len(lines) and re.match(r"^\s*[-*]\s", lines[i]):
            items.append(re.sub(r"^\s*[-*]\s+", "", lines[i]))
            i += 1
        blocks.append(("ul", items))
        continue

    # 段落（连续非空行合并）
    buf = [s]
    i += 1
    while i < len(lines) and lines[i].strip() and not re.match(r"^(#{1,4}\s|```|[-*]\s|\d+\.\s)", lines[i].strip()) and "|" not in lines[i]:
        buf.append(lines[i].strip())
        i += 1
    blocks.append(("p", "".join(buf)))

# ---------- 第二遍：渲染 ----------
chapters = []   # 目录数据
out = []
sec_no = 0
first_h1_done = False

for kind, payload in blocks:
    if kind == "h":
        level, text = payload
        if level == 1:
            continue  # 文档大标题由封面承载
        sec_no += 1
        sid = "section-%d" % sec_no
        if level == 2:
            chapters.append((1, sid, text))
            brk = ""
            globals()['first_h1_done'] = True
            out.append(
                '<h1 id="%s" style="%s%sfont-size:18pt;font-weight:bold;color:#1a3d6d;'
                'margin:20pt 0 10pt 0;padding-bottom:4pt;border-bottom:1.5pt solid #1a3d6d;'
                'text-indent:0;page-break-after:avoid;">%s</h1>' % (sid, brk, HEAD_FONT, inline(text)))
        elif level == 3:
            chapters.append((2, sid, text))
            out.append(
                '<h2 id="%s" style="%sfont-size:14pt;font-weight:bold;color:#1f2937;'
                'margin:14pt 0 6pt 0;text-indent:0;page-break-after:avoid;">%s</h2>' % (sid, HEAD_FONT, inline(text)))
        else:
            out.append(
                '<h3 style="%sfont-size:12pt;font-weight:bold;color:#333;'
                'margin:10pt 0 4pt 0;text-indent:0;">%s</h3>' % (HEAD_FONT, inline(text)))

    elif kind == "p":
        if payload.startswith(("**项目全称**", "**文档版本**", "**适用对象**")):
            continue
        out.append(
            '<p style="%sfont-size:12pt;line-height:1.65;text-indent:2em;'
            'margin:0 0 8pt 0;text-align:justify;">%s</p>' % (BODY_FONT, inline(payload)))

    elif kind in ("ul", "ol"):
        tag = "ul" if kind == "ul" else "ol"
        style_pad = "padding-left:2em;margin:0 0 8pt 2em;" if tag == "ul" else "padding-left:2em;margin:0 0 8pt 2em;"
        buf = ['<%s style="%sfont-size:12pt;line-height:1.65;%s">' % (tag, BODY_FONT, style_pad)]
        for it in payload:
            buf.append('<li style="%sfont-size:12pt;text-indent:0;margin-bottom:4pt;">%s</li>' % (BODY_FONT, inline(it)))
        buf.append('</%s>' % tag)
        out.append("".join(buf))

    elif kind == "table":
        header, rows = payload
        buf = ['<table style="border-collapse:collapse;width:100%%;%sfont-size:10.5pt;'
               'margin:6pt 0 12pt 0;text-indent:0;">' % BODY_FONT,
               "<thead><tr>"]
        for h in header:
            buf.append('<th style="border:0.75pt solid #9aa4b2;background:#eef2f7;'
                       'padding:5pt 7pt;font-weight:bold;text-align:left;text-indent:0;">%s</th>' % inline(h))
        buf.append("</tr></thead><tbody>")
        for r in rows:
            buf.append("<tr>")
            for c in r:
                buf.append('<td style="border:0.75pt solid #9aa4b2;padding:5pt 7pt;'
                           'vertical-align:top;text-indent:0;text-align:left;">%s</td>' % inline(c))
            buf.append("</tr>")
        buf.append("</tbody></table>")
        out.append("".join(buf))

    elif kind == "code":
        out.append(
            '<pre style="font-family:Consolas,\'Courier New\',monospace;font-size:8.5pt;'
            'line-height:1.4;background:#f6f8fa;border:0.75pt solid #d7dde5;border-radius:3pt;'
            'padding:8pt 10pt;margin:6pt 0 12pt 0;text-indent:0;white-space:pre-wrap;'
            'overflow-wrap:break-word;">%s</pre>' % htmllib.escape(payload, quote=False))

# 内容概览：用段落排版，避免被转换器重新编号
toc = ['<div class="doc-outline">',
       '<p style="%sfont-size:16pt;font-weight:bold;text-indent:0;margin:0 0 14pt 0;'
       'text-align:center;letter-spacing:0.1em;">内 容 概 览</p>' % HEAD_FONT]
for lvl, sid, text in chapters:
    safe = inline(text)
    if lvl == 1:
        toc.append('<p style="%sfont-size:11.5pt;font-weight:bold;color:#1a3d6d;'
                   'text-indent:0;margin:7pt 0 1pt 0;line-height:1.4;">%s</p>' % (BODY_FONT, safe))
    else:
        toc.append('<p style="%sfont-size:10.5pt;color:#374151;'
                   'text-indent:0;margin:0.5pt 0 0.5pt 2.2em;line-height:1.4;">%s</p>' % (BODY_FONT, safe))
toc.append("</div>")
toc_html = "".join(toc)

CSS = """
@page { @bottom-center { content: counter(page); } }
@page cover { @bottom-center { content: none; } }
section[role="cover"] { page: cover; }
body { margin:0; }
.toc-list, .toc-list ol, .toc-list ul { list-style:none; list-style-type:none; }
tr { page-break-inside: avoid; }
thead { display: table-header-group; }
h1, h2, h3 { page-break-after: avoid; }
"""

HTML = """<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="docx-page-size" content="A4">
<title>%s</title>
<style>%s</style>
</head>
<body>

<section role="cover">
  <div style="padding:2.5cm 2.5cm 1.5cm 2.5cm;">
    <p style="%sfont-size:10.5pt;color:#6b7280;letter-spacing:0.15em;text-indent:0;margin:0 0 14pt 0;">%s</p>
    <div style="border-top:2.5pt solid #1a3d6d;width:100%%;margin:0 0 18pt 0;"></div>
    <p style="%sfont-size:28pt;font-weight:bold;color:#1a3d6d;line-height:1.35;text-indent:0;margin:0 0 16pt 0;">%s</p>
    <p style="%sfont-size:14pt;color:#4b5563;line-height:1.5;text-indent:0;margin:0 0 40pt 0;">%s</p>
    <p style="%sfont-size:11pt;color:#374151;text-indent:0;margin:0 0 6pt 0;">%s</p>
    <p style="%sfont-size:10.5pt;color:#4b5563;text-indent:0;margin:0 0 4pt 0;">适用对象：项目负责人（个人项目）、指导教师</p>
    <p style="%sfont-size:10.5pt;color:#9ca3af;text-indent:0;margin:0;">本文件为版本管理的操作规程，与《项目工作指导书》配套使用。</p>
  </div>
</section>

<section role="body" data-page-restart="1" style="padding:0 2.5cm 2cm 2.5cm;">
%s
%s
</section>

</body>
</html>
""" % (TITLE, CSS, BODY_FONT, CATEGORY, HEAD_FONT, TITLE, BODY_FONT, SUBTITLE,
       BODY_FONT, META, BODY_FONT, BODY_FONT, toc_html, "\n".join(out))

os.makedirs(os.path.dirname(OUT), exist_ok=True)
with io.open(OUT, "w", encoding="utf-8", newline="\n") as f:
    f.write(HTML)

print("OK", OUT)
print("chars:", len(HTML), "chapters:", sum(1 for c in chapters if c[0] == 1), "sections:", len(chapters))
