#!/usr/bin/env python3
"""Render submission-docs/prompts.txt to a beautiful, submission-ready A4 PDF.

Pipeline:
    submission-docs/prompts.txt
      -> parse PROMPT sections, sub-headings, bullets, numbered items
      -> reflow hard-wrapped lines into professional paragraphs
      -> A4 cover + auto table of contents + teal brand styling (ReportLab)
      -> programmatic verification via PyMuPDF (fitz)

Regenerate later with:
    python scripts/export-prompts-pdf.py                 (Windows / POSIX)
    python scripts/export-prompts-pdf.py --src <txt> --pdf <out.pdf>

Stdlib + reportlab only (WeasyPrint needs system libs missing on Windows).
"""

from __future__ import annotations

import argparse
import datetime
import os
import re
import sys

# --------------------------------------------------------------------------
# Paths
# --------------------------------------------------------------------------

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT_SRC = os.path.join(ROOT, "submission-docs", "prompts.txt")
DEFAULT_PDF = os.path.join(ROOT, "submission-docs", "prompts.pdf")

# CareFlow brand (from prompt.txt design system).
TEAL = "#0b6e6d"
TEAL_DARK = "#084f4e"
INK = "#102a2b"
SOFT = "#33484a"
MUTED = "#5d7071"
FAINT_BG = "#eef6f5"
LINE = "#d9e4e4"

PROMPT_RE = re.compile(r"^PROMPT\s*(\d+)\s*$")
BULLET_RE = re.compile(r"^-\s+(.*\S)\s*$")
NUMBERED_RE = re.compile(r"^(\d+)[.\)]\s+(.*\S)\s*$")


def sanitize(text: str) -> str:
    """Keep only glyphs in WinAnsi (cp1252); never crash on exotic unicode."""
    return text.encode("cp1252", errors="replace").decode("cp1252")


def esc(text: str) -> str:
    return (
        sanitize(text)
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
    )


def is_heading(line: str) -> bool:
    s = line.strip()
    if len(s) < 3 or len(s) > 72:
        return False
    if s != s.upper() or s == s.lower():  # needs cased chars, all upper
        return False
    if PROMPT_RE.match(s):
        return False
    letters = sum(1 for c in s if c.isalpha())
    return letters >= 4 and letters / max(len(s), 1) > 0.5


# --------------------------------------------------------------------------
# Parse: blocks = ("h1", n) | ("h2", text) | ("para", text)
#            | ("bullets", [items]) | ("numbered", [items])
# --------------------------------------------------------------------------

def parse(text: str):
    lines = text.splitlines()
    preamble: list[str] = []
    sections: list[dict] = []  # {"num": int, "blocks": [...]}
    current = None

    def flush_para(buf: list[str], target: list):
        if buf:
            target.append(("para", " ".join(b.strip() for b in buf)))

    def target_blocks():
        if current is None:
            return preamble_blocks
        return current["blocks"]

    preamble_blocks: list = []
    para_buf: list[str] = []
    list_buf: list[str] | None = None
    list_kind: str | None = None

    def flush_list():
        nonlocal list_buf, list_kind
        if list_buf:
            target_blocks().append((list_kind, list_buf))
            list_buf, list_kind = None, None

    for raw in lines:
        line = raw.rstrip()
        s = line.strip()

        m = PROMPT_RE.match(s)
        if m:
            flush_para(para_buf, target_blocks()); para_buf = []
            flush_list()
            current = {"num": int(m.group(1)), "blocks": []}
            sections.append(current)
            continue

        if not s:
            flush_para(para_buf, target_blocks()); para_buf = []
            flush_list()
            continue

        if current is None:
            preamble.append(line)
            continue

        bm = BULLET_RE.match(s)
        nm = NUMBERED_RE.match(s)
        if bm or nm:
            flush_para(para_buf, target_blocks()); para_buf = []
            kind, item = ("bullets", bm.group(1)) if bm else ("numbered", nm.group(2))
            if list_kind != kind:
                flush_list()
                list_kind, list_buf = kind, []
            list_buf.append(item.strip())
            continue

        # Indented continuation of a list item.
        if list_buf is not None and (line.startswith("    ") or line.startswith("\t")):
            list_buf[-1] += " " + s
            continue

        if is_heading(s):
            flush_para(para_buf, target_blocks()); para_buf = []
            flush_list()
            target_blocks().append(("h2", s))
            continue

        flush_list()
        para_buf.append(line)

    flush_para(para_buf, target_blocks() if current else preamble_blocks)
    flush_list()
    return preamble, sections


# --------------------------------------------------------------------------
# Build PDF
# --------------------------------------------------------------------------

def build_pdf(preamble, sections, pdf_path, kicker, subtitle):
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import ParagraphStyle
    from reportlab.lib.units import mm
    from reportlab.lib import colors
    from reportlab.platypus import (
        BaseDocTemplate, PageTemplate, Frame, Paragraph, Spacer,
        PageBreak, Table, TableStyle, ListFlowable, ListItem,
    )
    from reportlab.platypus.tableofcontents import TableOfContents

    teal = colors.HexColor(TEAL)
    teal_dark = colors.HexColor(TEAL_DARK)
    ink = colors.HexColor(INK)
    soft = colors.HexColor(SOFT)
    muted = colors.HexColor(MUTED)
    faint = colors.HexColor(FAINT_BG)
    line_c = colors.HexColor(LINE)

    s_title = ParagraphStyle("Title", fontName="Helvetica-Bold",
                             fontSize=30, leading=34, textColor=teal_dark)
    s_kicker = ParagraphStyle("Kicker", fontName="Helvetica-Bold",
                              fontSize=10, leading=14, textColor=teal,
                              spaceAfter=6)
    s_sub = ParagraphStyle("Sub", fontName="Helvetica",
                           fontSize=12.5, leading=17, textColor=soft,
                           spaceAfter=4)
    s_h1 = ParagraphStyle("PromptTitle", fontName="Helvetica-Bold",
                          fontSize=18, leading=22, textColor=teal_dark,
                          spaceBefore=0, spaceAfter=2,
                          keepWithNext=True)
    s_h1_num = ParagraphStyle("PromptNum", fontName="Helvetica-Bold",
                              fontSize=10, leading=13, textColor=teal,
                              spaceAfter=1, keepWithNext=True)
    s_h2 = ParagraphStyle("H2", fontName="Helvetica-Bold",
                          fontSize=12, leading=15, textColor=teal_dark,
                          spaceBefore=10, spaceAfter=4, keepWithNext=True)
    s_body = ParagraphStyle("Body", fontName="Helvetica",
                            fontSize=9.5, leading=14.5, textColor=ink,
                            spaceAfter=5, alignment=4)  # justified
    s_bullet = ParagraphStyle("Bullet", parent=s_body, alignment=0,
                              leftIndent=14, firstLineIndent=0,
                              spaceAfter=3)
    s_meta = ParagraphStyle("Meta", fontName="Helvetica",
                            fontSize=8.5, leading=12, textColor=muted)
    s_cover_fact = ParagraphStyle("CoverFact", fontName="Helvetica",
                                  fontSize=9, leading=13, textColor=ink)
    s_cover_fact_b = ParagraphStyle("CoverFactB", parent=s_cover_fact,
                                    fontName="Helvetica-Bold",
                                    textColor=teal_dark)
    s_toc0 = ParagraphStyle("TOC0", fontName="Helvetica",
                            fontSize=9.5, leading=12, textColor=ink)
    s_toc_head = ParagraphStyle("TOCHead", fontName="Helvetica-Bold",
                                fontSize=16, leading=20, textColor=teal_dark,
                                spaceAfter=6)

    W, H = A4

    def footer(canvas, doc):
        if doc.page <= 1:
            return
        canvas.saveState()
        canvas.setStrokeColor(line_c)
        canvas.setLineWidth(0.6)
        canvas.line(18 * mm, 14 * mm, W - 15 * mm, 14 * mm)
        canvas.setFont("Helvetica", 7.5)
        canvas.setFillColor(muted)
        canvas.drawString(18 * mm, 10.5 * mm,
                          "CareFlow AI  ·  Implementation Prompts")
        canvas.drawRightString(W - 15 * mm, 10.5 * mm, f"Page {doc.page}")
        canvas.restoreState()

    doc = BaseDocTemplate(pdf_path, pagesize=A4,
                          leftMargin=18 * mm, rightMargin=15 * mm,
                          topMargin=16 * mm, bottomMargin=18 * mm,
                          title="CareFlow AI — Implementation Prompts",
                          author="CareFlow AI")
    frame = Frame(doc.leftMargin, doc.bottomMargin,
                  doc.width, doc.height, id="main")
    doc.addPageTemplates([PageTemplate(id="main", frames=[frame],
                                       onPage=footer)])

    story = []
    nums = [s["num"] for s in sections]
    span = f"PROMPT{nums[0]}–PROMPT{nums[-1]}" if nums else "PROMPTS"

    # ---- Cover ----
    band = Table([[Paragraph(
        "<font color='#ffffff'><b>CAREFLOW AI &nbsp;·&nbsp; SUBMISSION DOCUMENT</b>"
        "</font>", ParagraphStyle("band", fontName="Helvetica-Bold",
                                  fontSize=9, leading=12,
                                  textColor=colors.white))]],
        colWidths=[doc.width])
    band.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), teal),
        ("ROUNDEDCORNERS", [3, 3, 3, 3]),
        ("LEFTPADDING", (0, 0), (-1, -1), 10),
        ("TOPPADDING", (0, 0), (-1, -1), 7),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
    ]))
    story += [Spacer(1, 26 * mm), band, Spacer(1, 10 * mm),
              Paragraph(esc(kicker), s_kicker),
              Paragraph("Implementation<br/>Prompts", s_title),
              Spacer(1, 4 * mm),
              Paragraph(esc(subtitle), s_sub),
              Paragraph(f"Coding-agent prompt pack · {esc(span)} · "
                        f"{len(sections)} prompts", s_meta),
              Spacer(1, 8 * mm)]

    facts = [
        (Paragraph("<b>Source</b>", s_cover_fact_b),
         Paragraph(esc(os.path.basename(DEFAULT_SRC)), s_cover_fact)),
        (Paragraph("<b>Prompts</b>", s_cover_fact_b),
         Paragraph(f"{len(sections)} sections ({esc(span)})", s_cover_fact)),
        (Paragraph("<b>Generated</b>", s_cover_fact_b),
         Paragraph(datetime.date.today().isoformat(), s_cover_fact)),
        (Paragraph("<b>Format</b>", s_cover_fact_b),
         Paragraph("A4 · justified body · numbered sections", s_cover_fact)),
    ]
    facts_tbl = Table(facts, colWidths=[32 * mm, doc.width - 32 * mm])
    facts_tbl.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), faint),
        ("ROUNDEDCORNERS", [3, 3, 3, 3]),
        ("BOX", (0, 0), (-1, -1), 0.6, line_c),
        ("INNERGRID", (0, 0), (-1, -1), 0.4, line_c),
        ("LEFTPADDING", (0, 0), (-1, -1), 8),
        ("RIGHTPADDING", (0, 0), (-1, -1), 8),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
    ]))
    story += [facts_tbl]

    # Intro from the file preamble (reflowed, skip raw title lines).
    intro_lines = [l for l in preamble
                   if l.strip() and l.strip() != (preamble[0].strip()
                                                  if preamble else "")]
    if intro_lines:
        story += [Spacer(1, 8 * mm),
                  Paragraph("About this document", s_h2),
                  Paragraph(esc(" ".join(l.strip() for l in intro_lines)),
                            s_body)]
    story += [PageBreak()]

    # ---- Contents ----
    story += [Paragraph("Contents", s_toc_head)]
    toc = TableOfContents()
    toc.levelStyles = [ParagraphStyle(
        "TOCLevel0", parent=s_toc0, fontName="Helvetica",
        leftIndent=0, firstLineIndent=0, spaceBefore=2,
        textColor=ink)]
    story += [toc, PageBreak()]

    # ---- Prompt sections ----
    for idx, sec in enumerate(sections):
        if idx > 0:
            story.append(PageBreak())
        story += [
            Paragraph(f"PROMPT {sec['num']:02d} &nbsp;/&nbsp; {len(sections):02d}",
                      s_h1_num),
            Paragraph(f"Prompt {sec['num']}", s_h1),
            Spacer(1, 1 * mm),
            Table([[""]], colWidths=[doc.width],
                  style=TableStyle([("LINEBELOW", (0, 0), (-1, -1),
                                     1.2, teal)])),
            Spacer(1, 4 * mm),
        ]
        for kind, payload in sec["blocks"]:
            if kind == "para":
                story.append(Paragraph(esc(payload), s_body))
            elif kind == "h2":
                label = payload.title() if len(payload) > 26 else payload
                story.append(Paragraph(esc(label), s_h2))
            elif kind in ("bullets", "numbered"):
                items = [ListItem(Paragraph(esc(it), s_bullet),
                                  leftIndent=14, bulletColor=teal)
                         for it in payload]
                story.append(ListFlowable(
                    items,
                    bulletType="bullet" if kind == "bullets" else "1",
                    start="1" if kind == "numbered" else "•",
                    leftIndent=14, bulletFontName="Helvetica",
                    bulletFontSize=9.5, bulletColor=teal))
                story.append(Spacer(1, 2))

    def after_flowable(flow):
        if isinstance(flow, Paragraph) and flow.style.name == "PromptTitle":
            doc.notify("TOCEntry", (0, flow.getPlainText(), doc.page))

    doc.afterFlowable = after_flowable
    doc.multiBuild(story)
    return nums


# --------------------------------------------------------------------------
# Verify
# --------------------------------------------------------------------------

def verify_pdf(pdf_path, nums):
    import fitz

    doc = fitz.open(pdf_path)
    pages = doc.page_count
    text = "\n".join(p.get_text() for p in doc)
    norm = re.sub(r"\s+", " ", text)
    norm_l = norm.lower()
    missing = [n for n in nums if f"prompt {n}" not in norm_l]
    blank = []
    for i, page in enumerate(doc):
        pix = page.get_pixmap(dpi=40, colorspace=fitz.csGRAY)
        data = pix.samples
        if sum(1 for b in data if b < 200) / max(len(data), 1) < 0.002:
            blank.append(i + 1)
    has_contents = "contents" in norm_l
    doc.close()
    return {"pages": pages, "missing": missing, "blank": blank,
            "has_contents": has_contents}


# --------------------------------------------------------------------------
# Main
# --------------------------------------------------------------------------

def parse_args():
    ap = argparse.ArgumentParser(
        description="Render prompts.txt to a beautiful A4 PDF.")
    ap.add_argument("--src", default=DEFAULT_SRC, help="Source .txt file.")
    ap.add_argument("--pdf", default=DEFAULT_PDF, help="Output PDF path.")
    ap.add_argument("--kicker", default="CareFlow AI",
                    help="Cover kicker line.")
    ap.add_argument("--sub",
                    default="Step-by-step build prompts for the CareFlow AI "
                            "healthcare scheduling platform.",
                    help="Cover subtitle line.")
    return ap.parse_args()


def main() -> int:
    args = parse_args()
    if not os.path.isfile(args.src):
        raise SystemExit(f"source not found: {args.src}")
    with open(args.src, encoding="utf-8-sig", errors="replace") as fh:
        text = fh.read()

    preamble, sections = parse(text)
    print(f"Source text:           {os.path.relpath(args.src, ROOT)}")
    print(f"Prompt sections:       {len(sections)}")
    if not sections:
        raise SystemExit("no PROMPT sections found — aborting")

    os.makedirs(os.path.dirname(os.path.abspath(args.pdf)), exist_ok=True)
    nums = build_pdf(preamble, sections, args.pdf, args.kicker, args.sub)

    rep = verify_pdf(args.pdf, nums)
    size_kb = os.path.getsize(args.pdf) // 1024
    print(f"Output:                {os.path.relpath(args.pdf, ROOT)} "
          f"({rep['pages']} pages, {size_kb} KB)")
    print(f"Contents page present: {rep['has_contents']}")
    print(f"Missing prompts:       {len(rep['missing'])} {rep['missing'][:10]}")
    print(f"Blank pages:           {len(rep['blank'])} {rep['blank']}")
    ok = (not rep["missing"] and not rep["blank"] and rep["has_contents"]
          and rep["pages"] > 5)
    print(f"STATUS: {'PASS' if ok else 'FAIL'}")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
