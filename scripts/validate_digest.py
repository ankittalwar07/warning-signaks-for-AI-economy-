#!/usr/bin/env python3
"""Validate AI Demand Watch dashboard data. Standard library only, no LLM.

The scheduled Claude run calls this before it commits, so a malformed file
never reaches the GitHub Pages dashboard.

What it checks:
  * docs/data/latest.json and every docs/data/history/YYYY-MM-DD.json against
    docs/data/schema.json (a small built-in JSON Schema subset, no packages)
  * cross-file rules the schema cannot express: file name matches run_date,
    latest.json equals the newest history day, per-agent counts add up,
    signal ids are unique, live data carries no sample or placeholder rows
  * docs/data/history/index.json matches the history files
  * no secret values (GMAIL_APP_PASSWORD, token-like strings) in data files

Usage:
  python3 scripts/validate_digest.py                  # validate only
  python3 scripts/validate_digest.py --rebuild-index  # regenerate index.json, then validate

Exit code 0 means everything passed; 1 means at least one error (printed).
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parent.parent
DATE_FILE = re.compile(r"^\d{4}-\d{2}-\d{2}\.json$")
PLACEHOLDER_HOSTS = ("example.com", "example.org", "example.net")
TOKEN_PATTERNS = [
    re.compile(r"ghp_[A-Za-z0-9]{20,}"),
    re.compile(r"github_pat_[A-Za-z0-9_]{20,}"),
    re.compile(r"sk-ant-[A-Za-z0-9_\-]{10,}"),
    re.compile(r"\bsk-[A-Za-z0-9]{32,}"),
    re.compile(r"AKIA[0-9A-Z]{16}"),
    re.compile(r"xox[abpr]-[A-Za-z0-9\-]{10,}"),
]
LEVELS = ("low", "medium", "high")


# ---------------------------------------------------------------- schema subset
def _type_ok(value, expected) -> bool:
    if isinstance(expected, list):
        return any(_type_ok(value, t) for t in expected)
    return {
        "object": isinstance(value, dict),
        "array": isinstance(value, list),
        "string": isinstance(value, str),
        "boolean": isinstance(value, bool),
        "integer": isinstance(value, int) and not isinstance(value, bool),
        "number": isinstance(value, (int, float)) and not isinstance(value, bool),
        "null": value is None,
    }[expected]


def check_schema(value, schema: dict, root: dict, path: str, errors: list[str]) -> None:
    """Supports the keywords schema.json uses: $ref, type, const, enum, pattern,
    minLength, maxLength, minimum, minItems, maxItems, required, properties,
    additionalProperties (false), items."""
    if "$ref" in schema:
        node = root
        for part in schema["$ref"].lstrip("#/").split("/"):
            node = node[part]
        schema = {**node, **{k: v for k, v in schema.items() if k != "$ref"}}

    if "type" in schema and not _type_ok(value, schema["type"]):
        errors.append(f"{path}: expected type {schema['type']}, got {type(value).__name__}")
        return
    if "const" in schema and value != schema["const"]:
        errors.append(f"{path}: must equal {schema['const']!r}")
    if "enum" in schema and value not in schema["enum"]:
        errors.append(f"{path}: {value!r} not one of {schema['enum']}")
    if isinstance(value, str):
        if "pattern" in schema and not re.search(schema["pattern"], value):
            errors.append(f"{path}: {value!r} does not match {schema['pattern']}")
        if len(value) < schema.get("minLength", 0):
            errors.append(f"{path}: shorter than {schema['minLength']} chars")
        if "maxLength" in schema and len(value) > schema["maxLength"]:
            errors.append(f"{path}: longer than {schema['maxLength']} chars")
    if _type_ok(value, "number") and "minimum" in schema and value < schema["minimum"]:
        errors.append(f"{path}: below minimum {schema['minimum']}")
    if isinstance(value, list):
        if len(value) < schema.get("minItems", 0):
            errors.append(f"{path}: needs at least {schema['minItems']} items")
        if "maxItems" in schema and len(value) > schema["maxItems"]:
            errors.append(f"{path}: more than {schema['maxItems']} items")
        if "items" in schema:
            for i, item in enumerate(value):
                check_schema(item, schema["items"], root, f"{path}[{i}]", errors)
    if isinstance(value, dict):
        for key in schema.get("required", []):
            if key not in value:
                errors.append(f"{path}: missing required field '{key}'")
        props = schema.get("properties", {})
        for key, item in value.items():
            if key in props:
                check_schema(item, props[key], root, f"{path}.{key}", errors)
            elif schema.get("additionalProperties") is False:
                errors.append(f"{path}: unexpected field '{key}'")


# ---------------------------------------------------------------- semantic rules
def check_digest(doc: dict, name: str, errors: list[str]) -> None:
    if not isinstance(doc, dict):
        return
    signals = doc.get("signals") or []
    agents = doc.get("agents") or []

    ids = [s.get("id") for s in signals if isinstance(s, dict)]
    dupes = {i for i in ids if ids.count(i) > 1}
    if dupes:
        errors.append(f"{name}: duplicate signal ids {sorted(dupes)}")

    agent_ids = [a.get("id") for a in agents if isinstance(a, dict)]
    if len(agent_ids) != len(set(agent_ids)):
        errors.append(f"{name}: an agent is listed more than once")
    for a in agents:
        if not isinstance(a, dict):
            continue
        actual = sum(1 for s in signals if isinstance(s, dict) and s.get("agent") == a.get("id"))
        if a.get("signal_count") != actual:
            errors.append(f"{name}: agent {a.get('id')} signal_count {a.get('signal_count')} but {actual} signals listed")
        if a.get("status") == "failed" and actual:
            errors.append(f"{name}: agent {a.get('id')} is marked failed but has signals")
    for s in signals:
        if isinstance(s, dict) and s.get("agent") not in agent_ids:
            errors.append(f"{name}: signal {s.get('id')} uses agent {s.get('agent')!r} not listed in agents")

    if doc.get("sample") is False:
        for s in signals:
            host = (urlparse(str(s.get("source_url", ""))).hostname or "").lower()
            if any(host == h or host.endswith("." + h) for h in PLACEHOLDER_HOSTS):
                errors.append(f"{name}: live data cites placeholder host {host} (signal {s.get('id')})")
            if str(s.get("headline", "")).lower().startswith("example:"):
                errors.append(f"{name}: live data still has a sample headline (signal {s.get('id')})")


def summarize(doc: dict) -> dict:
    signals = doc.get("signals", [])
    by_agent = {a["id"]: 0 for a in doc.get("agents", [])}
    for s in signals:
        by_agent[s["agent"]] = by_agent.get(s["agent"], 0) + 1
    by_sev = {lvl: sum(1 for s in signals if s["severity"] == lvl) for lvl in LEVELS}
    return {
        "date": doc["run_date"],
        "sample": doc["sample"],
        "signal_count": len(signals),
        "high_severity": by_sev["high"],
        "by_agent": by_agent,
        "by_severity": by_sev,
    }


def build_index(days: dict[str, dict]) -> dict:
    ordered = [summarize(days[d]) for d in sorted(days)]
    return {"schema_version": 1, "days": ordered}


def scan_secrets(paths: list[Path], errors: list[str]) -> None:
    secret = os.environ.get("GMAIL_APP_PASSWORD", "").strip()
    variants = {secret, secret.replace(" ", "")} - {""}
    for p in paths:
        if not p.is_file():
            continue
        text = p.read_text(encoding="utf-8", errors="replace")
        name = rel(p)
        if any(v in text or v in text.replace(" ", "") for v in variants if len(v) >= 8):
            errors.append(f"{name}: contains the GMAIL_APP_PASSWORD value; never commit secrets")
        for pat in TOKEN_PATTERNS:
            if pat.search(text):
                errors.append(f"{name}: contains a token-like string matching {pat.pattern}")


# ---------------------------------------------------------------- main
def rel(path: Path) -> str:
    try:
        return str(path.relative_to(ROOT))
    except ValueError:
        return str(path)


def load(path: Path, errors: list[str]):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        errors.append(f"{rel(path)}: file not found")
    except json.JSONDecodeError as exc:
        errors.append(f"{rel(path)}: invalid JSON ({exc})")
    return None


def main() -> int:
    ap = argparse.ArgumentParser(description="Validate AI Demand Watch dashboard data.")
    ap.add_argument("--data-dir", default=str(ROOT / "docs" / "data"))
    ap.add_argument("--rebuild-index", action="store_true",
                    help="regenerate history/index.json from the history files before validating")
    args = ap.parse_args()

    data = Path(args.data_dir).resolve()
    hist = data / "history"
    errors: list[str] = []

    schema = load(data / "schema.json", errors)
    if schema is None:
        print("\n".join(errors), file=sys.stderr)
        return 1

    days: dict[str, dict] = {}
    for f in sorted(hist.glob("*.json")):
        if f.name == "index.json":
            continue
        if not DATE_FILE.match(f.name):
            errors.append(f"history/{f.name}: name must be YYYY-MM-DD.json")
            continue
        doc = load(f, errors)
        if doc is None:
            continue
        before = len(errors)
        check_schema(doc, schema, schema, f"history/{f.name}", errors)
        if len(errors) == before:
            check_digest(doc, f"history/{f.name}", errors)
            if doc.get("run_date") + ".json" != f.name:
                errors.append(f"history/{f.name}: run_date {doc.get('run_date')} does not match file name")
            days[f.name[:-5]] = doc
    if not days:
        errors.append("history/: no day files found")

    latest = load(data / "latest.json", errors)
    if latest is not None:
        before = len(errors)
        check_schema(latest, schema, schema, "latest.json", errors)
        if len(errors) == before:
            check_digest(latest, "latest.json", errors)
            if days:
                newest = max(days)
                if latest.get("run_date") != newest:
                    errors.append(f"latest.json: run_date {latest.get('run_date')} is not the newest history day {newest}")
                elif latest != days[newest]:
                    errors.append(f"latest.json: differs from history/{newest}.json (they must be identical)")
            if latest.get("sample") is False:
                stale = [d for d, doc in days.items() if doc.get("sample")]
                if stale:
                    errors.append(f"history/: live data present but sample days remain {stale}; delete them")

    if days:
        if args.rebuild_index:
            (hist / "index.json").write_text(json.dumps(build_index(days), indent=2) + "\n", encoding="utf-8")
            print(f"rebuilt history/index.json ({len(days)} days)")
        index = load(hist / "index.json", errors)
        if index is not None and index != build_index(days):
            errors.append("history/index.json: out of date; run with --rebuild-index")

    scan_secrets(list(data.rglob("*.json")) + [ROOT / "state" / "seen.json"], errors)

    if errors:
        print(f"FAIL: {len(errors)} problem(s)", file=sys.stderr)
        for e in errors:
            print(f"  - {e}", file=sys.stderr)
        return 1
    total = sum(len(d["signals"]) for d in days.values())
    print(f"OK: latest.json + {len(days)} history day(s), {total} signal(s), index in sync, no secrets found")
    return 0


if __name__ == "__main__":
    sys.exit(main())
