#!/usr/bin/env python3
"""Regenerate the professional A4 Architecture PDF from Architecture.md.

Pipeline:
    Architecture.md
      -> extract ```mermaid blocks -> render each via mermaid-cli to SVG
      -> SVG print-safety pass (normalize, audit foreignObject)
      -> Markdown -> HTML (tables, fenced_code, toc)
      -> professional A4 cover + contents + figure captions + print CSS
      -> PDF via WeasyPrint, else Chromium fallback (puppeteer)
      -> programmatic verification via PyMuPDF (fitz)
      -> sync submission-docs/Architecture.md + build report

Regenerate later with:
    python scripts/export-architecture-pdf.py        (Windows / POSIX)
    python3 scripts/export-architecture-pdf.py       (POSIX)

Other documents (same professional A4 pipeline):
    python scripts/export-architecture-pdf.py --src AI_USAGE_AND_TOOLS.md
"""

from __future__ import annotations

import argparse
import datetime
import html as htmlmod
import os
import re
import shutil
import subprocess
import sys
import tempfile
import xml.etree.ElementTree as ET

# --------------------------------------------------------------------------
# Paths
# --------------------------------------------------------------------------

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT_SRC_CANDIDATES = [
    os.path.join(ROOT, "Architecture.md"),
    os.path.join(ROOT, "submission-docs", "Architecture.md"),
]
OUT_DIR = os.path.join(ROOT, "submission-docs")
# Ephemeral build cache (mmd/svg/html + fetched puppeteer). Overridable for
# debugging:  ARCH_BUILD_DIR=C:\tmp\arch-build python scripts/...
WORK = os.environ.get(
    "ARCH_BUILD_DIR",
    os.path.join(tempfile.gettempdir(), "careflow-arch-build"),
)
NODE_HELPER = os.path.join(ROOT, "scripts", "render-pdf-chromium.js")
MMDC_PKG = "@mermaid-js/mermaid-cli@11.17.0"  # pinned: verified working

DIAGRAM_RE = re.compile(r"```mermaid(.*?)```", re.S)
HEADING_RE = re.compile(r"^(#{1,4})\s+(.+?)\s*$", re.M)


def _runner(base: list[str]) -> list[str]:
    """Windows resolves .cmd shims (npx/npm) only via the shell."""
    if os.name == "nt":
        return ["cmd", "/c"] + base
    return base


# --------------------------------------------------------------------------
# Step 1: load + inventory
# --------------------------------------------------------------------------

def parse_args() -> argparse.Namespace:
    ap = argparse.ArgumentParser(
        description="Render a Markdown source doc to a professional A4 PDF."
    )
    ap.add_argument("--src", default=None,
                    help="Source Markdown (default: Architecture.md). "
                         "Bare names resolve against the repo root.")
    ap.add_argument("--pdf", default=None,
                    help="Output PDF path (default: submission-docs/<Base>.pdf).")
    ap.add_argument("--md", default=None,
                    help="Synced Markdown copy (default: submission-docs/<Base>.md). "
                         "Use --no-sync-md to skip.")
    ap.add_argument("--no-sync-md", action="store_true",
                    help="Do not write the synced Markdown copy.")
    ap.add_argument("--kicker", default="System Architecture",
                    help="Cover kicker line.")
    ap.add_argument("--sub", default="Architecture & Technical Design",
                    help="Cover subtitle line.")
    return ap.parse_args()


def resolve_src(src_arg: str | None) -> str:
    if src_arg:
        cand = src_arg if os.path.isabs(src_arg) else os.path.join(ROOT, src_arg)
        if os.path.isfile(cand):
            return cand
        raise SystemExit(f"source not found: {src_arg}")
    for cand in DEFAULT_SRC_CANDIDATES:
        if os.path.isfile(cand):
            return cand
    raise SystemExit("Architecture.md not found in repo root or submission-docs/")


def load_source(src_path: str) -> tuple[str, str]:
    with open(src_path, encoding="utf-8") as fh:
        return fh.read(), src_path


def inventory(md: str):
    diagrams = [b.strip("\n") for b in DIAGRAM_RE.findall(md)]
    headings = [(len(m.group(1)), m.group(2).strip()) for m in HEADING_RE.finditer(md)]
    return diagrams, headings


# --------------------------------------------------------------------------
# Step 2: render mermaid -> SVG
# --------------------------------------------------------------------------

def render_mermaid(diagrams: list[str], work: str) -> tuple[list[dict], list[str]]:
    """Render each diagram independently. Returns (results, failures)."""
    results: list[dict] = []
    failures: list[str] = []
    for i, code in enumerate(diagrams, 1):
        tag = f"d{i:02d}"
        mmd = os.path.join(work, f"{tag}.mmd")
        svg = os.path.join(work, f"{tag}.svg")
        with open(mmd, "w", encoding="utf-8") as fh:
            fh.write(code.strip() + "\n")
        cmd = _runner([
            "npx", "-y", MMDC_PKG,
            "-i", mmd, "-o", svg,
            "-t", "default", "-b", "white",
        ])
        try:
            proc = subprocess.run(
                cmd, cwd=ROOT, capture_output=True, text=True, timeout=240,
            )
            err = (proc.stderr or "") + (proc.stdout or "")
            ok = (
                proc.returncode == 0
                and os.path.isfile(svg)
                and os.path.getsize(svg) > 500
                and "Syntax error in text" not in err
            )
            if not ok:
                failures.append(f"{tag}: exit={proc.returncode} {err.strip()[-500:]}")
                continue
            results.append({"tag": tag, "code": code, "svg": svg})
        except subprocess.TimeoutExpired:
            failures.append(f"{tag}: mmdc timeout")
        except OSError as exc:
            failures.append(f"{tag}: cannot run mmdc ({exc})")
    return results, failures


# --------------------------------------------------------------------------
# Step 3: SVG print-safety pass
# --------------------------------------------------------------------------

def svg_print_safety(svg_path: str) -> dict:
    """Normalize SVG for print embedding; audit foreignObject usage.

    Chromium (our PDF renderer) renders <foreignObject> natively, so labels
    are preserved as-is. This pass normalizes dimensions and reports what
    each SVG contains so the build report stays honest.
    """
    with open(svg_path, encoding="utf-8") as fh:
        raw = fh.read()
    raw = re.sub(r"<\?xml[^>]*\?>", "", raw).strip()
    try:
        root = ET.fromstring(raw)
    except ET.ParseError as exc:
        return {"ok": False, "error": str(exc), "foreign_objects": -1}
    fo = sum(1 for el in root.iter() if el.tag.endswith("foreignObject"))
    # Ensure the SVG scales inside .diagram containers: drop fixed pixel
    # width/height in favour of viewBox-driven scaling (CSS does the rest).
    if root.get("viewBox") is None:
        w = (root.get("width") or "800").replace("px", "")
        h = (root.get("height") or "600").replace("px", "")
        try:
            root.set("viewBox", f"0 0 {float(w)} {float(h)}")
        except ValueError:
            pass
    root.attrib.pop("width", None)
    root.attrib.pop("height", None)
    # Namespace-safe serialization (mermaid SVGs use no prefix by default).
    ET.register_namespace("", "http://www.w3.org/2000/svg")
    ET.register_namespace("xlink", "http://www.w3.org/1999/xlink")
    cleaned = ET.tostring(root, encoding="unicode")
    with open(svg_path, "w", encoding="utf-8") as fh:
        fh.write(cleaned)
    return {"ok": True, "foreign_objects": fo, "bytes": len(cleaned)}


# --------------------------------------------------------------------------
# Step 4: markdown -> HTML + cover + TOC + captions + CSS
# --------------------------------------------------------------------------

CSS = """
@page { size: A4; margin: 18mm 15mm 20mm 15mm; }
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body {
  font-family: 'Segoe UI', Arial, Helvetica, sans-serif;
  font-size: 10pt; line-height: 1.5; color: #1f2937;
}
.cover { text-align: center; padding: 42mm 0 10mm 0; }
.cover .kicker { font-size: 11pt; letter-spacing: 4px; color: #4b5563;
  text-transform: uppercase; margin-bottom: 8mm; }
.cover h1 { font-size: 30pt; margin: 0 0 4mm 0; color: #0f172a; }
.cover .sub { font-size: 13pt; color: #334155; margin-bottom: 10mm; }
.cover table { margin: 0 auto; width: 82%; }
.cover table.cover-facts { width: 94%; font-size: 7.6pt; }
.cover table.cover-facts th, .cover table.cover-facts td { padding: 1mm 1.6mm; }
.about { text-align: left; margin: 8mm auto 0 auto; width: 82%;
  font-size: 9.5pt; color: #374151; }
.meta { margin-top: 12mm; font-size: 8.5pt; color: #6b7280; }
.toc { margin: 0; }
.toc ul { list-style: none; padding-left: 0; }
.toc li.toc3 { padding-left: 6mm; font-size: 9pt; }
.toc li { margin: 1mm 0; }
.toc a { text-decoration: none; color: #1f2937; }
h1 { font-size: 20pt; color: #0f172a; border-bottom: 2px solid #0ea5e9;
  padding-bottom: 2mm; }
h2 { font-size: 14pt; color: #0f172a; margin-top: 8mm;
  border-bottom: 1px solid #e5e7eb; padding-bottom: 1.2mm;
  page-break-after: avoid; }
h3 { font-size: 11.5pt; color: #1e3a5f; page-break-after: avoid; }
p, li { orphans: 3; widows: 3; }
table { width: 100%; border-collapse: collapse; font-size: 8.4pt;
  margin: 3mm 0; table-layout: fixed; }
th, td { border: 1px solid #cbd5e1; padding: 1.4mm 2mm;
  text-align: left; vertical-align: top;
  overflow-wrap: break-word; word-break: break-word; }
th { background: #eef4fa; color: #0f172a; }
tr { page-break-inside: avoid; }
pre { background: #f1f5f9; border: 1px solid #e2e8f0; border-radius: 2mm;
  padding: 2.5mm 3mm; font-size: 7.8pt; line-height: 1.45;
  white-space: pre-wrap; overflow-wrap: break-word; word-break: break-word; }
code { font-family: Consolas, 'Courier New', monospace; font-size: 8.4pt; }
figure.diagram { margin: 4mm 0; padding: 3mm; border: 1px solid #e2e8f0;
  border-radius: 2mm; background: #ffffff; page-break-inside: avoid; }
figure.diagram svg { display: block; margin: 0 auto; max-width: 100%;
  max-height: 192mm; height: auto; width: auto; }
figure.diagram.tall svg { max-height: 158mm; }
figure.diagram figcaption { margin-top: 2mm; font-size: 8pt; color: #475569;
  text-align: center; }
blockquote { border-left: 3px solid #0ea5e9; margin: 3mm 0;
  padding: 1mm 0 1mm 3mm; color: #475569; }
.convention { background: #f8fafc; border: 1px solid #e2e8f0;
  border-radius: 2mm; padding: 2.5mm 3.5mm; font-size: 8.6pt; color: #334155; }
ul, ol { padding-left: 6mm; }
"""

CONVENTION_HTML = (
    '<div class="convention"><strong>Diagram convention.</strong> '
    "Rectangles = services / components; cylinders = data stores; "
    "solid arrows = calls and data flow; crossed dotted lines = forbidden paths. "
    "All flowcharts use top-to-bottom flow unless labeled.</div>"
)


def nearest_heading(md: str, pos: int) -> str:
    heads = list(HEADING_RE.finditer(md))
    title = "Architecture"
    for m in heads:
        if m.start() < pos:
            title = m.group(2).strip()
        else:
            break
    return re.sub(r"^#+\s*", "", title)


def build_html(md: str, rendered: list[dict],
               headings: list[tuple[int, str]], src_file: str,
               kicker: str, sub: str) -> str:
    import markdown as mdlib

    # Swap mermaid fences for placeholders (nearest heading -> caption).
    captions: dict[str, str] = {}
    out = md
    # Iterate matches in reverse so positions stay valid.
    matches = list(DIAGRAM_RE.finditer(md))
    if len(matches) != len(rendered):
        raise SystemExit(
            f"diagram count mismatch: {len(matches)} fences vs {len(rendered)} renders"
        )
    for idx in range(len(matches) - 1, -1, -1):
        m = matches[idx]
        tag = f"d{idx + 1:02d}"
        captions[tag] = nearest_heading(md, m.start())
        out = out[: m.start()] + f"\n\n{{{{DIAGRAM_{tag}}}}}\n\n" + out[m.end():]

    title = headings[0][1] if headings else "System Architecture"
    status_line = status_summary(md)

    body = mdlib.markdown(
        out, extensions=["tables", "fenced_code", "toc"],
        extension_configs={"toc": {"title": "Contents"}},
    )

    # Inline each rendered SVG as a captioned figure. Very tall SVGs get
    # a "tall" class (smaller cap) so their section heading can share
    # the page instead of stranding an orphan heading.
    for i, res in enumerate(rendered, 1):
        tag = res["tag"]
        with open(res["svg"], encoding="utf-8") as fh:
            svg = fh.read()
        tall = ""
        vb = re.search(r'viewBox="[\d.\-]+\s+[\d.\-]+\s+([\d.]+)\s+([\d.]+)"', svg)
        if vb:
            try:
                w, h = float(vb.group(1)), float(vb.group(2))
                if w > 0 and h / w > 1.4:
                    tall = " tall"
            except ValueError:
                pass
        cap = htmlmod.escape(captions.get(tag, "Architecture"), quote=False)
        fig = (
            f'<figure class="diagram{tall}" id="fig-{tag}">'
            f"{svg}<figcaption>Figure {i} &mdash; {cap}</figcaption></figure>"
        )
        body = body.replace(f"<p>{{{{DIAGRAM_{tag}}}}}</p>", fig)
        body = body.replace(f"{{{{DIAGRAM_{tag}}}}}", fig)

    # Cover: title + subtitle + the doc's most cover-suitable table
    # (first table with <=3 columns and a real header row) + about + meta.
    # Wide evidence tables are skipped: they crush on a cover. No invented values.
    cover_table = ""
    for tm in re.finditer(r"<table>.*?</table>", body, re.S):
        ncols = len(re.findall(r"<th[ >]", tm.group(0)))
        if ncols and ncols <= 3:
            cover_table = tm.group(0).replace(
                "<table>", '<table class="cover-facts">', 1)
            break
    about = re.search(r"<blockquote>(.*?)</blockquote>", body, re.S)
    if not about:
        # Fall back to the first body paragraph (e.g. a Purpose section).
        about = re.search(r"<p>(?!</p>).{40,}?</p>", body, re.S)
    about_html = (
        f'<div class="about">{about.group(0)}</div>' if about else ""
    )
    date = datetime.date.today().isoformat()
    meta_status = f" &nbsp;·&nbsp; {status_line}" if status_line else ""
    cover = (
        '<section class="cover">'
        f'<div class="kicker">{htmlmod.escape(kicker)}</div>'
        f"<h1>{htmlmod.escape(title)}</h1>"
        f'<div class="sub">{htmlmod.escape(sub)}</div>'
        f"{cover_table}{about_html}"
        '<div class="meta">'
        f"Source: {htmlmod.escape(os.path.basename(src_file))}"
        f" &nbsp;·&nbsp; Generated: {date}{meta_status}"
        "</div></section>"
    )

    # Contents: built from actual Markdown headings (single contents system).
    # python-markdown's toc extension only emits a TOC div when a [TOC]
    # marker is present, so we render our own numbered list instead.
    toc_items = []
    n2 = n3 = 0
    for level, h in headings:
        if level == 1:
            continue
        plain = re.sub(r"<[^>]+>", "", h).strip()
        anchor = re.sub(r"[^a-z0-9]+", "-", plain.lower()).strip("-")
        if level == 2:
            n2 += 1
            n3 = 0
            toc_items.append(
                f'<li><a href="#{anchor}"><strong>{n2}.</strong> '
                f"{htmlmod.escape(plain)}</a></li>"
            )
        elif level == 3:
            n3 += 1
            toc_items.append(
                f'<li class="toc3"><a href="#{anchor}">{n2}.{n3} '
                f"{htmlmod.escape(plain)}</a></li>"
            )
    toc_html = (
        "<h2>Contents</h2>"
        '<div class="toc"><ul>' + "".join(toc_items) + "</ul></div>"
        if toc_items else ""
    )

    full = (
        "<!DOCTYPE html><html><head><meta charset='utf-8'>"
        f"<title>{htmlmod.escape(title)}</title>"
        f"<style>{CSS}</style></head><body>"
        f"{cover}"
        f"{toc_html}"
        f"{CONVENTION_HTML if rendered else ''}"
        f"{body}</body></html>"
    )
    return full, title


def status_summary(md: str) -> str:
    """Count Implemented / Partially / Not Implemented rows in the status table.

    Returns "" when the document has no such table (e.g. non-architecture
    docs); the cover then omits the status fragment.
    """
    sec = re.search(r"## Current Implementation Status(.*?)(?:\n## |\Z)", md, re.S)
    if not sec:
        return ""
    rows = re.findall(r"^\|.*\|$", sec.group(1), re.M)
    impl = sum(1 for r in rows if "Partially Implemented" in r)
    full = sum(1 for r in rows if "Implemented" in r) - impl - sum(
        1 for r in rows if "Not Implemented" in r
    )
    notimpl = sum(1 for r in rows if "Not Implemented" in r)
    parts = []
    if full:
        parts.append(f"{full} Implemented")
    if impl:
        parts.append(f"{impl} Partially Implemented")
    if notimpl:
        parts.append(f"{notimpl} Not Implemented")
    return "Status: " + " · ".join(parts) if parts else "Status: see table"


# --------------------------------------------------------------------------
# Step 5: HTML -> PDF (WeasyPrint, else Chromium fallback)
# --------------------------------------------------------------------------

def ensure_puppeteer(work: str) -> str:
    """Return the node `require('puppeteer')` path, installing if needed."""
    install_dir = os.path.join(work, "pdftool")
    mod = os.path.join(install_dir, "node_modules", "puppeteer")
    if os.path.isdir(mod):
        return mod
    os.makedirs(install_dir, exist_ok=True)
    subprocess.run(
        _runner(["npm", "install", "--prefix", install_dir, "puppeteer"]),
        cwd=ROOT, capture_output=True, text=True, timeout=600,
    )
    if not os.path.isdir(mod):
        raise SystemExit("could not install puppeteer for Chromium PDF fallback")
    return mod


def html_to_pdf(html_path: str, pdf_path: str, title: str) -> str:
    """Try WeasyPrint; fall back to Chromium. Returns engine name."""
    try:
        from weasyprint import HTML as WHTML  # noqa: WPS433 (optional dep)

        WHTML(filename=html_path).write_pdf(pdf_path)
        return "weasyprint"
    except Exception as exc:  # noqa: BLE001 - env lacks system libs (Windows)
        print(f"[info] WeasyPrint unavailable ({exc}); using Chromium fallback.")

    puppeteer_dir = ensure_puppeteer(os.path.dirname(html_path))
    env = dict(os.environ, NODE_PATH=os.path.join(puppeteer_dir, ".."))
    # Helper resolves puppeteer via NODE_PATH or local install.
    shim = (
        "const Module=require('module');"
        "try{require.resolve('puppeteer');}catch(e){"
        f"process.env.NODE_PATH={os.path.join(puppeteer_dir, '..')!r};"
        "Module._initPaths();}"
    )
    _ = shim
    proc = subprocess.run(
        ["node", NODE_HELPER, html_path, pdf_path, title],
        cwd=ROOT, capture_output=True, text=True, timeout=600, env=env,
    )
    if proc.returncode != 0 or not os.path.isfile(pdf_path):
        raise SystemExit(f"Chromium PDF failed: {(proc.stderr or proc.stdout)[-2000:]}")
    return "chromium+puppeteer"


# --------------------------------------------------------------------------
# Step 6: verification (PyMuPDF)
# --------------------------------------------------------------------------

STOPWORDS = {
    "with", "from", "that", "this", "your", "into", "status", "lookup",
    "request", "context", "service", "server", "execution", "operation",
    "appointment", "hospital", "doctor", "patient", "workflow",
}


def diagram_keywords(diagrams: list[str]) -> list[str]:
    words: set[str] = set()
    for code in diagrams:
        for label in re.findall(r'\["([^"\]]+)"\]', code):
            for w in re.findall(r"[A-Za-z][A-Za-z0-9_.\-]{4,}", label):
                wl = w.lower()
                if wl not in STOPWORDS:
                    words.add(wl)
        for alias in re.findall(r"participant\s+\w+\s+as\s+(.+)$", code, re.M):
            for w in re.findall(r"[A-Za-z][A-Za-z0-9_.\-/]{4,}", alias):
                wl = w.lower().strip("/-*")
                if wl not in STOPWORDS and len(wl) >= 5:
                    words.add(wl)
    return sorted(words)


def verify_pdf(pdf_path: str, headings: list[tuple[int, str]],
               keywords: list[str]) -> dict:
    import fitz

    doc = fitz.open(pdf_path)
    pages = doc.page_count
    text = "\n".join(p.get_text() for p in doc)
    norm = re.sub(r"\s+", " ", text)
    norm_l = norm.lower()

    syntax_errors = norm.count("Syntax error in text")

    missing_sections = []
    for _level, h in headings:
        key = re.sub(r"\s+", " ", h).strip()
        probe = key[:60]
        if probe.lower() not in norm_l:
            missing_sections.append(key)

    missing_keywords = [k for k in keywords if k.lower() not in norm_l]

    blank_pages: list[int] = []
    for i, page in enumerate(doc):
        pix = page.get_pixmap(dpi=40, colorspace=fitz.csGRAY)
        import math

        data = pix.samples
        dark = sum(1 for b in data if b < 200)
        if dark / max(len(data), 1) < 0.002:
            blank_pages.append(i + 1)
    doc.close()
    return {
        "pages": pages,
        "syntax_errors": syntax_errors,
        "missing_sections": missing_sections,
        "missing_keywords": missing_keywords,
        "blank_pages": blank_pages,
    }


# --------------------------------------------------------------------------
# Main
# --------------------------------------------------------------------------

def main() -> int:
    args = parse_args()
    src = resolve_src(args.src)
    base = os.path.splitext(os.path.basename(src))[0]
    out_pdf = args.pdf or os.path.join(OUT_DIR, f"{base}.pdf")
    out_md = args.md or os.path.join(OUT_DIR, f"{base}.md")

    os.makedirs(OUT_DIR, exist_ok=True)
    os.makedirs(WORK, exist_ok=True)

    md, src = load_source(src)
    diagrams, headings = inventory(md)
    print(f"Source Markdown:       {os.path.relpath(src, ROOT)}")
    print(f"Mermaid diagrams:      {len(diagrams)}")

    rendered, failures = render_mermaid(diagrams, WORK)
    print(f"Mermaid failures:      {len(failures)}")
    for f in failures:
        print(f"  FAIL {f}")
    if failures:
        print("STATUS: FAIL (fix mermaid syntax, then re-run)")
        return 1

    fo_total = 0
    for res in rendered:
        info = svg_print_safety(res["svg"])
        if not info.get("ok"):
            print(f"  FAIL {res['tag']}: SVG parse error {info.get('error')}")
            return 1
        fo_total += info["foreign_objects"]
    print(f"SVG conversions:       {len(rendered)} (foreignObject labels: {fo_total})")

    html_doc, title = build_html(md, rendered, headings, src,
                                 args.kicker, args.sub)
    html_path = os.path.join(WORK, f"{base}.html")
    with open(html_path, "w", encoding="utf-8") as fh:
        fh.write(html_doc)

    engine = html_to_pdf(html_path, out_pdf, title)
    print(f"PDF engine:            {engine}")

    keywords = diagram_keywords(diagrams)
    rep = verify_pdf(out_pdf, headings, keywords)
    print(f"PDF pages:             {rep['pages']}")
    print(f"Blank pages:           {len(rep['blank_pages'])} {rep['blank_pages']}")
    print(f"Syntax errors:         {rep['syntax_errors']}")
    print(f"Missing sections:      {len(rep['missing_sections'])}")
    for s in rep["missing_sections"]:
        print(f"  MISSING SECTION: {s}")
    if keywords:
        print(f"Diagram keywords:      {len(keywords)} checked, "
              f"{len(rep['missing_keywords'])} missing")
        for k in rep["missing_keywords"][:20]:
            print(f"  MISSING KW: {k}")
    else:
        print("Diagram keywords:      none (no mermaid blocks)")

    if not args.no_sync_md:
        shutil.copyfile(src, out_md)
    print("Output:")
    print(f"  {os.path.relpath(out_pdf, ROOT)}")
    if not args.no_sync_md:
        print(f"  {os.path.relpath(out_md, ROOT)}")
    print()
    ok = (
        not rep["missing_sections"]
        and rep["syntax_errors"] == 0
        and not rep["blank_pages"]
        and len(rep["missing_keywords"]) <= max(2, len(keywords) // 10)
    )
    print(f"STATUS: {'PASS' if ok else 'FAIL'}")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
