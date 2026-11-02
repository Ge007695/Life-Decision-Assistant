#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
回测 · 分期真实年化：三种算法一致性（工作指导书 6.3 / 6.4 / 11.3）

验证目标（对应工作指导书 6.4 第二条）：
    同一笔分期下，二分法 / 牛顿法 / 扫描插值三种算法给出的年化差值应小于 0.01 个百分点，
    但迭代次数应明显不同——"算得一样、代价不同"正是实验要的对比数据。

做法：
    1. 用 run_rule.js 批量跑 installment（与页面同一条规则代码，不另写一套公式）；
    2. 从 meta.comparison 取三种算法各自的月利率、年化、迭代次数、残差；
    3. 再用 Python 标准库独立二分求解一遍，作为第四方复算，用来发现"规则与配置同时写错"；
    4. 另跑一组非法输入（0 期、负本金、费率 0），确认有中文提示且不出现 NaN。

用法：
    python irr_backtest.py
    python irr_backtest.py --out-dir output
"""

from __future__ import annotations

import argparse
import csv
import json
import os
import subprocess
import sys
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = SCRIPT_DIR.parent.parent
RUN_RULE = SCRIPT_DIR / "run_rule.js"
DEFAULT_OUT_DIR = SCRIPT_DIR / "output"

# 主场景：本金 6000 元、每期费率 0.6%，只改期数（工作指导书 6.4 的标准用例）
#
# 费率单位：按规则当前口径收**百分数**（0.6 表示每期 0.6%），与页面表单一致。
# 规则也接受 input.feeRateUnit = 'decimal'（0.006），但默认是 percent，
# 这里跟随默认口径，避免"看着像小数就自动除以 100"这类猜测。
MAIN_PRINCIPAL = 6000.0
MAIN_FEE_RATE = 0.6
MAIN_PERIODS = [3, 6, 12, 24, 36]

# 补充场景：换本金、换费率，看三种算法在别的量级上是否仍然一致
EXTRA_CASES = [
    {"principal": 3000.0, "periods": 6, "feeRate": 0.5},
    {"principal": 12000.0, "periods": 12, "feeRate": 0.75},
    {"principal": 20000.0, "periods": 24, "feeRate": 1.0},
    {"principal": 999.9, "periods": 36, "feeRate": 0.4},
]

# 边界：非法或极端输入，只检查"有没有友好提示"，不参与一致性统计
EDGE_CASES = [
    {"principal": 6000.0, "periods": 0, "feeRate": 0.6, "note": "0 期"},
    {"principal": -6000.0, "periods": 12, "feeRate": 0.6, "note": "负本金"},
    {"principal": 6000.0, "periods": 12, "feeRate": 0.0, "note": "费率 0（应为 0 成本）"},
    {"principal": 6000.0, "periods": 360, "feeRate": 0.6, "note": "360 期（浮点误差）"},
    {"principal": 6000.0, "periods": 12.5, "feeRate": 0.6, "note": "非整数期数"},
]

# 一致性门槛：0.01 个百分点 = 0.0001（年化以小数计）
CONSISTENCY_LIMIT_PP = 0.01


def log(message: str) -> None:
    print(message, file=sys.stderr)


def call_rules(node_bin: str, inputs: list) -> list:
    """批量调用 installment。入参走 stdin，stdout 必须是纯 JSON。"""
    command = [node_bin, str(RUN_RULE), "installment", "-"]
    try:
        completed = subprocess.run(
            command,
            input=json.dumps(inputs, ensure_ascii=False),
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            cwd=str(PROJECT_ROOT),
        )
    except FileNotFoundError:
        raise SystemExit("找不到 node 可执行文件，可用 --node 指定绝对路径")
    if completed.returncode != 0:
        raise SystemExit(
            f"run_rule.js 退出码 {completed.returncode}\nstderr：\n{completed.stderr.strip()}"
        )
    if (completed.stderr or "").strip():
        for line in completed.stderr.strip().splitlines():
            log(f"  [node] {line}")
    try:
        results = json.loads(completed.stdout)
    except json.JSONDecodeError as exc:
        raise SystemExit(f"run_rule.js 的 stdout 不是纯 JSON：{exc}")
    if not isinstance(results, list) or len(results) != len(inputs):
        raise SystemExit("run_rule.js 返回条数与入参不一致")
    return results


# ------------------------------------------------------------------ 独立复算


def npv(monthly_rate: float, principal: float, payment: float, periods: int) -> float:
    """
    期初收本金 +P，此后每期支出 payment，折现到 0 期的净现值。

    折现因子用累乘而不是 (1+r)**t：r 接近 -1 且期数很大时，幂运算会下溢成 0
    并触发 ZeroDivisionError；这里显式处理下溢，返回 ±1e300 表示"无穷"，
    二分只需符号，不需要精确值。
    """
    if monthly_rate <= -1:
        return 1e300
    total = principal
    discount = 1.0
    for _ in range(periods):
        discount *= 1 + monthly_rate
        if discount < 1e-300:
            return -1e300
        total -= payment / discount
        if total < -1e300:
            return -1e300
    return total


def independent_annual_rate(principal: float, periods: int, fee_percent: float) -> float | None:
    """
    纯 Python 二分复算，只依赖标准库。

    这一列存在的意义：如果规则里的公式和这里同时写错，回测发现不了；
    但只要有一边写错，两列数字就会分叉。用它当第四方校验比"相信测试通过"更实在。
    """
    if not isinstance(periods, int) or periods <= 0 or principal <= 0 or fee_percent < 0:
        return None
    fee_rate = fee_percent / 100  # 规则收百分数，复算按小数
    payment = principal / periods + principal * fee_rate
    low, high = -0.99, 10.0
    low_value = npv(low, principal, payment, periods)
    high_value = npv(high, principal, payment, periods)
    if low_value * high_value > 0:
        return None
    for _ in range(300):
        mid = (low + high) / 2
        value = npv(mid, principal, payment, periods)
        if abs(value) < 1e-10:
            return mid
        if value * low_value > 0:
            low, low_value = mid, value
        else:
            high = mid
    return (low + high) / 2


def annualize(monthly_rate: float) -> float:
    return (1 + monthly_rate) ** 12 - 1


# ------------------------------------------------------------------ 主流程


def extract(result: dict, case: dict) -> dict:
    """把一条 DecisionResult 摊平成一行实验记录"""
    meta = result.get("meta") or {}
    # 规则同时给出 meta.methods（新）与 meta.comparison（旧），两者结构相同，取到哪个用哪个
    series = meta.get("methods") or meta.get("comparison") or []
    comparison = {item.get("method"): item for item in series}
    row = {
        "principal": case["principal"],
        "periods": case["periods"],
        "fee_rate": case["feeRate"],
        "note": case.get("note", ""),
        "level": result.get("level"),
        "level_label": result.get("levelLabel"),
        "headline": result.get("headline"),
        "degraded": bool(result.get("degraded")),
        "ok": bool(meta.get("ok")),
        "payment": meta.get("payment"),
        "nominal_annual": meta.get("nominalAnnualRate"),
        "monthly_rate": meta.get("monthlyRate"),
        "annual_rate": meta.get("annualRate"),
        "ratio": meta.get("ratio"),
    }
    annuals = []
    for method in ("bisection", "newton", "scan"):
        item = comparison.get(method) or {}
        row[f"{method}_ok"] = bool(item.get("ok"))
        row[f"{method}_annual"] = item.get("annualRate")
        row[f"{method}_iterations"] = item.get("iterations")
        row[f"{method}_error"] = item.get("error")
        row[f"{method}_reason"] = item.get("reason") or ""
        if item.get("ok") and isinstance(item.get("annualRate"), (int, float)):
            annuals.append(float(item["annualRate"]))
    row["method_spread_pp"] = (max(annuals) - min(annuals)) * 100 if len(annuals) >= 2 else None

    python_monthly = independent_annual_rate(case["principal"], case["periods"], case["feeRate"])
    row["python_monthly"] = python_monthly
    row["python_annual"] = annualize(python_monthly) if python_monthly is not None else None
    if row["python_annual"] is not None and isinstance(row["annual_rate"], (int, float)):
        row["python_diff_pp"] = abs(row["python_annual"] - float(row["annual_rate"])) * 100
    else:
        row["python_diff_pp"] = None

    text = json.dumps(result, ensure_ascii=False)
    row["has_nan"] = "NaN" in text or "Infinity" in text
    return row


def percent(value, digits: int = 2) -> str:
    if value is None:
        return "—"
    return f"{float(value) * 100:.{digits}f}%"


def pp(value, digits: int = 4) -> str:
    if value is None:
        return "—"
    return f"{float(value):.{digits}f}"


def build_markdown(rows: list, edge_rows: list, rule_version: str) -> str:
    lines = []
    add = lines.append
    add("# IRR 三算法对比实验")
    add("")
    add(
        f"规则：`installment` v{rule_version}　｜　脚本：`scripts/backtest/irr_backtest.py`　｜　"
        "调用链：Python → `run_rule.js` → `engine.run('installment')`"
    )
    add("")
    add("> 本表中的年化由线上同一份规则代码算出，不是 Python 复写的公式。")
    add("> `独立复算` 一列是纯标准库二次求解，仅用于交叉校验，两边偏差应接近 0。")
    add("")

    add("## 一、主场景：本金 6000 元、每期费率 0.6%，改期数")
    add("")
    add("| 期数 | 每期还款 | 名义年化 | 真实年化 | 倍数 | 三算法最大差（百分点） | 独立复算差（百分点） |")
    add("|---:|---:|---:|---:|---:|---:|---:|")
    for row in rows:
        add(
            f"| {row['periods']} | {row['payment']:.2f} | {percent(row['nominal_annual'])} | "
            f"{percent(row['annual_rate'])} | {row['ratio']:.2f} | "
            f"{pp(row['method_spread_pp'])} | {pp(row['python_diff_pp'])} |"
        )
    add("")

    add("## 二、三种算法的代价对比")
    add("")
    add("| 期数 | 二分法迭代 | 二分残差 | 牛顿法迭代 | 牛顿残差 | 扫描迭代 | 扫描残差 | 结论 |")
    add("|---:|---:|---:|---:|---:|---:|---:|---|")
    for row in rows:
        consistent = row["method_spread_pp"] is not None and row["method_spread_pp"] < CONSISTENCY_LIMIT_PP
        verdict = "一致" if consistent else "不一致，需查"
        add(
            f"| {row['periods']} | {row['bisection_iterations']} | "
            f"{'%.2e' % row['bisection_error'] if row['bisection_error'] is not None else '—'} | "
            f"{row['newton_iterations']} | "
            f"{'%.2e' % row['newton_error'] if row['newton_error'] is not None else '—'} | "
            f"{row['scan_iterations']} | "
            f"{'%.2e' % row['scan_error'] if row['scan_error'] is not None else '—'} | "
            f"{verdict} |"
        )
    add("")
    add(
        f"一致性门槛：三种算法的年化最大差 < {CONSISTENCY_LIMIT_PP} 个百分点"
        "（工作指导书 6.4 第二条）。"
    )
    add("")

    add("## 三、补充场景（换本金与费率）")
    add("")
    add("| 本金 | 期数 | 每期费率 | 真实年化 | 倍数 | 三算法最大差（百分点） | 独立复算差（百分点） |")
    add("|---:|---:|---:|---:|---:|---:|---:|")
    for row in rows:
        if not row["note"]:
            continue
        add(
            f"| {row['principal']:.0f} | {row['periods']} | {row['fee_rate']:.3g}% | "
            f"{percent(row['annual_rate'])} | {row['ratio']:.2f} | "
            f"{pp(row['method_spread_pp'])} | {pp(row['python_diff_pp'])} |"
        )
    add("")

    add("## 四、边界输入")
    add("")
    add("| 场景 | 是否降级 | 结论 | 出现 NaN |")
    add("|---|---|---|---|")
    for row in edge_rows:
        add(
            f"| {row['note']} | {'是' if row['degraded'] else '否'} | "
            f"{row['headline']} | {'有，必须修' if row['has_nan'] else '无'} |"
        )
    add("")
    add(
        "边界用例的判据是「有没有中文原因」与「有没有把 NaN 递给页面」，不参与一致性统计——"
        "算不出结果时，给出原因比给出数字更重要。"
    )
    add("")
    return "\n".join(lines)


def main(argv: list | None = None) -> int:
    parser = argparse.ArgumentParser(description="分期真实年化：三算法一致性与边界检查")
    parser.add_argument("--out-dir", default=str(DEFAULT_OUT_DIR), help="产出目录")
    parser.add_argument("--node", default=os.environ.get("NODE_BIN", "node"), help="node 可执行文件")
    args = parser.parse_args(argv)

    out_dir = Path(args.out_dir).resolve()
    out_dir.mkdir(parents=True, exist_ok=True)

    cases = [{"principal": MAIN_PRINCIPAL, "periods": p, "feeRate": MAIN_FEE_RATE} for p in MAIN_PERIODS]
    cases.extend(EXTRA_CASES)

    log(f"调用 run_rule.js 跑 installment，共 {len(cases)} 组参数…")
    results = call_rules(args.node, cases)
    rows = [extract(result, case) for result, case in zip(results, cases)]
    rule_version = str(results[0].get("version") or "unknown")

    log(f"跑边界用例 {len(EDGE_CASES)} 组…")
    edge_results = call_rules(args.node, EDGE_CASES)
    edge_rows = [extract(result, case) for result, case in zip(edge_results, EDGE_CASES)]

    # ---------------- CSV
    csv_path = out_dir / "irr.csv"
    header = [
        "principal", "periods", "fee_rate", "payment", "nominal_annual", "monthly_rate", "annual_rate",
        "ratio", "bisection_annual", "bisection_iterations", "bisection_error",
        "newton_annual", "newton_iterations", "newton_error",
        "scan_annual", "scan_iterations", "scan_error",
        "method_spread_pp", "python_annual", "python_diff_pp", "degraded", "has_nan",
    ]
    with open(csv_path, "w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.writer(handle)
        writer.writerow(header)
        for row in rows + edge_rows:
            writer.writerow([row.get(key) for key in header])

    # ---------------- Markdown
    markdown_path = out_dir / "irr-report.md"
    markdown_path.write_text(build_markdown(rows, edge_rows, rule_version), encoding="utf-8")

    # ---------------- 摘要
    print("")
    print(f"规则 installment v{rule_version}　·　{len(rows)} 组参数 + {len(edge_rows)} 组边界")
    print("")
    print(f"{'期数':>4}{'每期还款':>10}{'名义年化':>10}{'真实年化':>10}{'倍数':>7}{'三算法差(pp)':>14}")
    for row in rows:
        if row["note"]:
            continue
        print(
            f"{row['periods']:>4}{row['payment']:>10.2f}{percent(row['nominal_annual']):>10}"
            f"{percent(row['annual_rate']):>10}{row['ratio']:>7.2f}{pp(row['method_spread_pp']):>14}"
        )
    print("")

    consistent = [row for row in rows if row["method_spread_pp"] is not None
                  and row["method_spread_pp"] < CONSISTENCY_LIMIT_PP]
    print(f"一致性：{len(consistent)}/{len(rows)} 组通过（门槛 {CONSISTENCY_LIMIT_PP} 个百分点）")
    max_python_diff = max((row["python_diff_pp"] or 0) for row in rows)
    print(f"独立复算最大偏差：{max_python_diff:.6f} 个百分点")
    nan_rows = [row for row in edge_rows if row["has_nan"]]
    print(f"边界用例：{len(edge_rows)} 组，出现 NaN 的 {len(nan_rows)} 组")
    print("")
    print(f"数据：{csv_path}")
    print(f"报告：{markdown_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
