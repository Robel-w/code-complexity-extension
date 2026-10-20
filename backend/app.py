"""
Code Complexity Analyzer - Flask Backend
Analyzes Python and JavaScript code for complexity metrics.
"""

import re
import math
import textwrap
from flask import Flask, request, jsonify
from flask_cors import CORS

# Try to import radon; it's optional for non-Python analysis
try:
    from radon.complexity import cc_visit, cc_rank
    from radon.metrics import mi_visit, h_visit
    from radon.raw import analyze
    RADON_AVAILABLE = True
except ImportError:
    RADON_AVAILABLE = False

app = Flask(__name__)
CORS(app, resources={r"/*": {"origins": "*"}})


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def severity_from_cc(cc: float) -> str:
    """Map average cyclomatic complexity to a severity label."""
    if cc <= 5:
        return "low"
    elif cc <= 10:
        return "medium"
    elif cc <= 20:
        return "high"
    return "very-high"


def severity_from_mi(mi: float) -> str:
    """Map Maintainability Index to a severity label (higher MI = better)."""
    if mi >= 80:
        return "low"
    elif mi >= 65:
        return "medium"
    elif mi >= 40:
        return "high"
    return "very-high"


def overall_severity(cc: float, mi: float) -> str:
    ranks = ["low", "medium", "high", "very-high"]
    s1 = severity_from_cc(cc)
    s2 = severity_from_mi(mi)
    return ranks[max(ranks.index(s1), ranks.index(s2))]


def suggestions_for(cc: float, mi: float, sloc: int) -> list:
    tips = []
    if cc > 10:
        tips.append("Break large functions into smaller, single-responsibility units to reduce branching.")
    if cc > 5:
        tips.append("Consider replacing complex conditionals with guard clauses or polymorphism.")
    if mi < 65:
        tips.append("Improve Maintainability Index by adding docstrings and reducing function length.")
    if mi < 40:
        tips.append("Significant refactoring recommended — this code will be hard to maintain long-term.")
    if sloc > 300:
        tips.append("File is very long. Consider splitting into multiple modules.")
    if not tips:
        tips.append("Code looks clean! Keep up the good practices.")
    return tips


# ---------------------------------------------------------------------------
# Python analysis (radon-powered)
# ---------------------------------------------------------------------------

def analyze_python(code: str) -> dict:
    if not RADON_AVAILABLE:
        return {"error": "radon is not installed. Run: pip install radon"}

    # Raw metrics
    raw = analyze(code)

    # Cyclomatic complexity
    try:
        blocks = cc_visit(code)
    except SyntaxError as exc:
        return {"error": f"Python syntax error: {exc}"}

    per_function = []
    cc_values = []
    for block in blocks:
        rank = cc_rank(block.complexity)
        per_function.append({
            "name": block.name,
            "type": type(block).__name__.lower(),
            "line": block.lineno,
            "complexity": block.complexity,
            "rank": rank,
        })
        cc_values.append(block.complexity)

    avg_cc = round(sum(cc_values) / len(cc_values), 2) if cc_values else 1.0
    max_cc = max(cc_values) if cc_values else 1

    # Maintainability Index
    try:
        mi_score = round(mi_visit(code, multi=True), 2)
    except Exception:
        mi_score = 0.0

    # Halstead metrics
    try:
        hal = h_visit(code)
        if hal:
            h = hal[0]
            halstead = {
                "h1": h.h1,
                "h2": h.h2,
                "N1": h.N1,
                "N2": h.N2,
                "vocabulary": h.vocabulary,
                "length": h.length,
                "volume": round(h.volume, 2),
                "difficulty": round(h.difficulty, 2),
                "effort": round(h.effort, 2),
                "time": round(h.time, 2),
                "bugs": round(h.bugs, 3),
            }
        else:
            halstead = {}
    except Exception:
        halstead = {}

    sev = overall_severity(avg_cc, mi_score)

    return {
        "language": "python",
        "severity": sev,
        "cyclomatic_complexity": {
            "average": avg_cc,
            "max": max_cc,
            "per_function": per_function,
        },
        "maintainability_index": mi_score,
        "raw_metrics": {
            "loc": raw.loc,
            "sloc": raw.sloc,
            "comments": raw.comments,
            "multi": raw.multi,
            "blank": raw.blank,
            "single_comments": raw.single_comments,
        },
        "halstead": halstead,
        "suggestions": suggestions_for(avg_cc, mi_score, raw.sloc),
    }


# ---------------------------------------------------------------------------
# JavaScript / TypeScript analysis (heuristic)
# ---------------------------------------------------------------------------

def analyze_javascript(code: str) -> dict:
    lines = code.splitlines()
    loc = len(lines)

    # Count blank lines and comment lines
    blank = sum(1 for l in lines if not l.strip())
    comment_lines = sum(
        1 for l in lines
        if l.strip().startswith("//") or l.strip().startswith("*") or l.strip().startswith("/*")
    )
    sloc = loc - blank - comment_lines

    # Cyclomatic complexity: start at 1, add 1 per branch
    branch_patterns = [
        r'\bif\s*\(',
        r'\belse\s+if\s*\(',
        r'\bfor\s*\(',
        r'\bwhile\s*\(',
        r'\bdo\s*\{',
        r'\bcase\s+.+:',
        r'\bcatch\s*\(',
        r'\?\s*[^:]+\s*:',   # ternary
        r'&&',
        r'\|\|',
        r'\?\?',             # nullish coalescing
    ]
    cc = 1
    for pattern in branch_patterns:
        cc += len(re.findall(pattern, code))

    # Detect functions
    func_pattern = re.compile(
        r'(?:function\s+(\w+)|(\w+)\s*=\s*(?:async\s+)?(?:function|\(.*?\)\s*=>))',
        re.MULTILINE,
    )
    funcs = func_pattern.findall(code)
    func_names = [f[0] or f[1] for f in funcs if f[0] or f[1]]

    # Rough maintainability index (simplified formula)
    if sloc > 0:
        volume = sloc * math.log2(max(sloc, 1))
        mi_score = max(0, (171 - 5.2 * math.log(max(volume, 1)) - 0.23 * cc - 16.2 * math.log(max(sloc, 1))) * 100 / 171)
        mi_score = round(min(100, mi_score), 2)
    else:
        mi_score = 100.0

    sev = overall_severity(cc, mi_score)

    return {
        "language": "javascript",
        "severity": sev,
        "cyclomatic_complexity": {
            "average": float(cc),
            "max": cc,
            "per_function": [{"name": name, "type": "function", "line": None, "complexity": "N/A", "rank": "?"} for name in func_names[:20]],
        },
        "maintainability_index": mi_score,
        "raw_metrics": {
            "loc": loc,
            "sloc": sloc,
            "comments": comment_lines,
            "multi": 0,
            "blank": blank,
            "single_comments": comment_lines,
        },
        "halstead": {},
        "suggestions": suggestions_for(float(cc), mi_score, sloc),
    }


# ---------------------------------------------------------------------------
# Language detection
# ---------------------------------------------------------------------------

JS_KEYWORDS = re.compile(r'\b(const|let|var|function|=>|console\.log|require|import\s+.*\s+from|export)\b')
PY_KEYWORDS = re.compile(r'\b(def |import |from |print\(|elif |self\.|__init__|lambda )\b')


def detect_language(code: str, hint: str = "auto") -> str:
    if hint in ("python", "py"):
        return "python"
    if hint in ("javascript", "js", "typescript", "ts"):
        return "javascript"
    py_score = len(PY_KEYWORDS.findall(code))
    js_score = len(JS_KEYWORDS.findall(code))
    return "python" if py_score >= js_score else "javascript"


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "ok", "radon": RADON_AVAILABLE})


@app.route("/analyze", methods=["POST"])
def analyze_code():
    data = request.get_json(silent=True)
    if not data:
        return jsonify({"error": "Invalid JSON body"}), 400

    code = data.get("code", "").strip()
    if not code:
        return jsonify({"error": "No code provided"}), 400

    language_hint = data.get("language", "auto").lower()
    language = detect_language(code, language_hint)

    if language == "python":
        result = analyze_python(code)
    else:
        result = analyze_javascript(code)

    if "error" in result:
        return jsonify(result), 422

    return jsonify(result)


if __name__ == "__main__":
    print("🚀 Code Complexity Analyzer backend running on http://localhost:5000")
    app.run(host="0.0.0.0", port=5000, debug=True)
