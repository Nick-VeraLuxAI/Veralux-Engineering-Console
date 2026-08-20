#!/usr/bin/env python3
"""Direct A/B/C probes: CONTROL 8081 vs EXPERIMENT 8082 faithful Nano."""
from __future__ import annotations

import json
import re
import time
import urllib.request
from pathlib import Path

EVID = Path(__file__).resolve().parents[3] / "evidence" / "nemotron-nano-faithful-runtime"
EVID.mkdir(parents=True, exist_ok=True)

MODEL = "Nemotron-Nano-30B-A3B-NVFP4"
CONTROL = "http://127.0.0.1:8081/v1"
EXPERIMENT = "http://127.0.0.1:8082/v1"

PLAN_SYS = (
    "You generate a worker plan JSON object only: {runId, summary, allowedFiles, "
    "operations:[{type: create_file|update_file|append_file, path, content, reason}]}. "
    "Never write files yourself, never run shell. JSON only. Include complete file contents."
)

INF_USER = (
    "Run ID: ab-inf. Create src/util/isFiniteNumber.js exporting function isFiniteNumber(x) "
    "that returns true only for finite numbers (not NaN, not ±Infinity). "
    "Add src/util/isFiniteNumber.test.js using node:test + assert. "
    "Return worker plan JSON with full file bodies."
)

JOBS_USER = """Run ID: jobs-hard.
Build an idempotent async job runner under src/jobs/ with:
- applyJob(jobId, payload, store) that is async, records pending then success/failure,
- rejects duplicate in-flight and completed applications safely,
- resume support after partial failure,
- tests covering success, failure recording, duplicate apply, and resume.
Use node:test + assert (import test from 'node:test'; import assert from 'node:assert/strict').
Never use require(), never assert.throwsAsync (use await assert.rejects).
Return worker plan JSON with complete file contents for all operations.
"""


def chat(base: str, body: dict, timeout: int = 600) -> dict:
    req = urllib.request.Request(
        f"{base}/chat/completions",
        data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode())


def final_text(msg: dict) -> str:
    content = msg.get("content") or ""
    reasoning = msg.get("reasoning") or msg.get("reasoning_content") or ""
    if "</think>" in content:
        content = content.split("</think>", 1)[-1].strip()
    return content.strip(), reasoning


def extract_json(text: str):
    text = text.strip()
    try:
        return json.loads(text), None
    except Exception as e:
        m = re.search(r"\{[\s\S]*\}", text)
        if not m:
            return None, str(e)
        try:
            return json.loads(m.group(0)), None
        except Exception as e2:
            return None, str(e2)


def score_infinity(plan: dict | None) -> dict:
    if not plan:
        return {"parse": False, "semantic": "FAIL", "notes": ["unparseable"]}
    ops = plan.get("operations") or []
    bodies = "\n".join(str(op.get("content") or "") for op in ops)
    notes = []
    ok = False
    if "Number.isFinite" in bodies:
        ok = True
        notes.append("uses Number.isFinite")
    elif "Number.isNaN" in bodies and "Infinity" in bodies and "!==" in bodies:
        notes.append("manual Infinity/NaN checks — likely wrong polarity")
    elif "Infinity" in bodies and "isFinite" not in bodies.lower():
        notes.append("mentions Infinity without isFinite")
    else:
        notes.append("no clear finite check")
        if "typeof" in bodies and "number" in bodies:
            notes.append("typeof number present")
    # Wrong pattern from audit: x !== Infinity && !Number.isNaN(x)
    wrong = bool(re.search(r"!==\s*Infinity|!=\s*Infinity", bodies)) and "Number.isFinite" not in bodies
    if wrong:
        ok = False
        notes.append("WRONG_PATTERN !== Infinity")
    if "Number.isFinite" in bodies:
        ok = True
    return {"parse": True, "semantic": "PASS" if ok else "FAIL", "notes": notes, "snippet": bodies[:400]}


def score_jobs(plan: dict | None) -> dict:
    if not plan:
        return {"parse": False, "semantic": "FAIL", "notes": ["unparseable"]}
    ops = plan.get("operations") or []
    bodies = "\n".join(str(op.get("content") or "") for op in ops)
    notes = []
    checks = {
        "async_await": bool(re.search(r"\basync\b", bodies) and re.search(r"\bawait\b", bodies)),
        "assert_rejects": "assert.rejects" in bodies or "rejects(" in bodies,
        "no_throwsAsync": "throwsAsync" not in bodies,
        "no_require": "require(" not in bodies,
        "pending_or_status": bool(re.search(r"pending|status|fail", bodies, re.I)),
        "dup_guard": bool(re.search(r"duplicate|already|in[- ]?flight|idempot", bodies, re.I)),
    }
    for k, v in checks.items():
        notes.append(f"{k}={'Y' if v else 'N'}")
    ok = all(checks.values())
    return {"parse": True, "semantic": "PASS" if ok else "FAIL", "notes": notes}


def run_case(name: str, base: str, body: dict) -> dict:
    t0 = time.time()
    try:
        resp = chat(base, body)
    except Exception as e:
        out = {"name": name, "error": str(e), "elapsed_s": round(time.time() - t0, 2)}
        (EVID / f"{name}.json").write_text(json.dumps(out, indent=2))
        return out
    choice = (resp.get("choices") or [{}])[0]
    msg = choice.get("message") or {}
    content, reasoning = final_text(msg)
    plan, perr = extract_json(content)
    out = {
        "name": name,
        "base": base,
        "elapsed_s": round(time.time() - t0, 2),
        "finish_reason": choice.get("finish_reason"),
        "usage": resp.get("usage"),
        "has_reasoning_field": bool(msg.get("reasoning") or msg.get("reasoning_content")),
        "reasoning_preview": (reasoning or "")[:400],
        "content_preview": (content or "")[:600],
        "think_tags_in_content": "<think>" in (msg.get("content") or "") or "</think>" in (msg.get("content") or ""),
        "parse_error": perr,
        "plan_summary": (plan or {}).get("summary") if isinstance(plan, dict) else None,
        "request": {
            "temperature": body.get("temperature"),
            "top_p": body.get("top_p"),
            "max_tokens": body.get("max_tokens"),
            "chat_template_kwargs": body.get("chat_template_kwargs"),
        },
    }
    if "inf" in name:
        out["score"] = score_infinity(plan if isinstance(plan, dict) else None)
    else:
        out["score"] = score_jobs(plan if isinstance(plan, dict) else None)
    (EVID / f"{name}.json").write_text(json.dumps(out, indent=2))
    # Keep raw separately (can be large)
    (EVID / f"{name}.raw.json").write_text(json.dumps(resp, indent=2)[:500_000])
    return out


def main() -> None:
    results = []

    # A CONTROL Infinity
    results.append(
        run_case(
            "ab_inf_A_control_8081",
            CONTROL,
            {
                "model": MODEL,
                "messages": [
                    {"role": "system", "content": PLAN_SYS},
                    {"role": "user", "content": INF_USER},
                ],
                "temperature": 0.1,
                "max_tokens": 2048,
                "chat_template_kwargs": {"enable_thinking": False},
            },
        )
    )

    # B EXPERIMENT Infinity
    results.append(
        run_case(
            "ab_inf_B_faithful_8082",
            EXPERIMENT,
            {
                "model": MODEL,
                "messages": [
                    {"role": "system", "content": PLAN_SYS},
                    {"role": "user", "content": INF_USER},
                ],
                "temperature": 1.0,
                "top_p": 1.0,
                "max_tokens": 10000,
                "chat_template_kwargs": {"enable_thinking": True},
            },
        )
    )

    # A CONTROL jobs
    results.append(
        run_case(
            "abc_jobs_A_control_8081",
            CONTROL,
            {
                "model": MODEL,
                "messages": [
                    {"role": "system", "content": PLAN_SYS},
                    {"role": "user", "content": JOBS_USER},
                ],
                "temperature": 0.1,
                "max_tokens": 2048,
                "chat_template_kwargs": {"enable_thinking": False},
            },
        )
    )

    # B EXPERIMENT jobs single-turn faithful
    results.append(
        run_case(
            "abc_jobs_B_faithful_8082",
            EXPERIMENT,
            {
                "model": MODEL,
                "messages": [
                    {"role": "system", "content": PLAN_SYS},
                    {"role": "user", "content": JOBS_USER},
                ],
                "temperature": 1.0,
                "top_p": 1.0,
                "max_tokens": 10000,
                "chat_template_kwargs": {"enable_thinking": True},
            },
        )
    )

    # C continuous tools-shaped (simulated tool turns, no shell)
    tools = [
        {
            "type": "function",
            "function": {
                "name": "inspect_repo_fact",
                "description": "Read-only repo fact",
                "parameters": {
                    "type": "object",
                    "properties": {"fact": {"type": "string"}},
                    "required": ["fact"],
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": "propose_worker_plan",
                "description": "Propose final worker plan JSON",
                "parameters": {
                    "type": "object",
                    "properties": {"plan": {"type": "object"}},
                    "required": ["plan"],
                },
            },
        },
    ]
    # First turn may tool-call; we force a second turn with tool results + ask for plan JSON
    t0 = time.time()
    first = chat(
        EXPERIMENT,
        {
            "model": MODEL,
            "messages": [
                {
                    "role": "system",
                    "content": PLAN_SYS
                    + " You may call inspect_repo_fact then propose_worker_plan. Read-only tools only.",
                },
                {"role": "user", "content": JOBS_USER},
            ],
            "temperature": 0.6,
            "top_p": 0.95,
            "max_tokens": 10000,
            "chat_template_kwargs": {"enable_thinking": True, "truncate_history_thinking": True},
            "tools": tools,
            "tool_choice": "auto",
        },
    )
    msg1 = (first.get("choices") or [{}])[0].get("message") or {}
    tool_calls = msg1.get("tool_calls") or []
    messages = [
        {
            "role": "system",
            "content": PLAN_SYS
            + " After tools, emit the worker plan as JSON content (or via propose_worker_plan).",
        },
        {"role": "user", "content": JOBS_USER},
        {
            "role": "assistant",
            "content": msg1.get("content"),
            "tool_calls": tool_calls,
            "reasoning": msg1.get("reasoning"),
        },
    ]
    for tc in tool_calls:
        fn = (tc.get("function") or {}).get("name")
        messages.append(
            {
                "role": "tool",
                "tool_call_id": tc.get("id"),
                "content": json.dumps(
                    {
                        "ok": True,
                        "fact": "package.json has type:module and test script node --test",
                        "tool": fn,
                    }
                ),
            }
        )
    if not tool_calls:
        messages.append(
            {
                "role": "user",
                "content": "Repo fact: type:module, node --test. Now emit the complete worker plan JSON only.",
            }
        )
    else:
        messages.append(
            {
                "role": "user",
                "content": "Using the tool results, emit the complete worker plan JSON only in content.",
            }
        )
    second = chat(
        EXPERIMENT,
        {
            "model": MODEL,
            "messages": messages,
            "temperature": 0.6,
            "top_p": 0.95,
            "max_tokens": 10000,
            "chat_template_kwargs": {"enable_thinking": True, "truncate_history_thinking": True},
        },
    )
    choice = (second.get("choices") or [{}])[0]
    msg = choice.get("message") or {}
    content, reasoning = final_text(msg)
    # Also accept propose_worker_plan args if present
    plan = None
    perr = None
    if msg.get("tool_calls"):
        for tc in msg["tool_calls"]:
            if (tc.get("function") or {}).get("name") == "propose_worker_plan":
                try:
                    args = json.loads(tc["function"]["arguments"])
                    plan = args.get("plan") or args
                except Exception as e:
                    perr = str(e)
    if plan is None:
        plan, perr = extract_json(content)
    out = {
        "name": "abc_jobs_C_continuous_tools_8082",
        "elapsed_s": round(time.time() - t0, 2),
        "first_finish": (first.get("choices") or [{}])[0].get("finish_reason"),
        "first_tool_calls": [
            (tc.get("function") or {}).get("name") for tc in tool_calls
        ],
        "finish_reason": choice.get("finish_reason"),
        "usage_first": first.get("usage"),
        "usage_second": second.get("usage"),
        "has_reasoning_field": bool(msg.get("reasoning") or msg.get("reasoning_content")),
        "think_tags_in_content": "<think>" in (msg.get("content") or ""),
        "parse_error": perr,
        "score": score_jobs(plan if isinstance(plan, dict) else None),
        "content_preview": (content or "")[:600],
    }
    (EVID / "abc_jobs_C_continuous_tools_8082.json").write_text(json.dumps(out, indent=2))
    results.append(out)

    summary = {
        "at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "control": CONTROL,
        "experiment": EXPERIMENT,
        "results": [
            {
                "name": r.get("name"),
                "finish_reason": r.get("finish_reason"),
                "score": r.get("score"),
                "has_reasoning_field": r.get("has_reasoning_field"),
                "think_tags_in_content": r.get("think_tags_in_content"),
                "elapsed_s": r.get("elapsed_s"),
                "error": r.get("error"),
            }
            for r in results
        ],
    }
    (EVID / "direct_abc_summary.json").write_text(json.dumps(summary, indent=2))
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
