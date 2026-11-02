#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
回测 · 晾晒指数准确率与三套权重方案对比（工作指导书 11.3）

流程：
    1. 读 scripts/backtest/data/shenzhen-*.json（逐小时记录），按本地日期分组；
    2. 每一天取 0—23 时作为 hourly、09:00 的读数作为当前值，构造规则入参；
    3. 用 subprocess 调 run_rule.js 批量跑 drying / damp，拿回 DecisionResult；
    4. 与"次日实际"比对：预测"适宜"（level 4）的次日若降水 > 0 或平均湿度 > 85%，
       记为误判（工作指导书 11.3）；
    5. 输出 drying.csv / damp.csv、混淆矩阵、按月准确率、三套权重对比表、report.md。

三套权重：
    经验权重 = public/data/indices.json#drying.weights（当前线上配置，不在这里硬编码）
    等权     = 五项各 0.2
    拟合权重 = 本脚本用标准库网格搜索得到（不依赖 numpy）

纪律：
    只依赖标准库。数据分析用纯 Python 也能接受（数据量 1.7 万条）。
    报告里的数字若来自合成数据，必须在显眼处标注——这一条由 manifest 决定，不靠人工记得。

用法：
    python backtest_indices.py                     # 全量
    python backtest_indices.py --limit 60          # 只跑前 60 天，快速验证流程
    python backtest_indices.py --data-dir data --out-dir output
    python backtest_indices.py --no-grid           # 跳过网格搜索（省时间）
"""

from __future__ import annotations

import argparse
import csv
import json
import math
import os
import subprocess
import sys
from datetime import datetime
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = SCRIPT_DIR.parent.parent
RUN_RULE = SCRIPT_DIR / "run_rule.js"
DEFAULT_DATA_DIR = SCRIPT_DIR / "data"
DEFAULT_OUT_DIR = SCRIPT_DIR / "output"
CONFIG_PATH = PROJECT_ROOT / "public" / "data" / "indices.json"

# 判定口径（工作指导书 11.3）：预测"适宜"的次日，降水 > 0 或平均湿度 > 85% 记误判
NEXT_DAY_HUMIDITY_LIMIT = 85.0
NEXT_DAY_PRECIP_LIMIT = 0.0
DRYING_LEVEL_GOOD = 4

# 烘托指标顺序固定，网格搜索与报告表格都按这个顺序展开
WEIGHT_KEYS = ["temp", "humidity", "windSpeed", "precipProb", "solar"]

COMPASS = [
    "N", "NNE", "NE", "ENE",
    "E", "ESE", "SE", "SSE",
    "S", "SSW", "SW", "WSW",
    "W", "WNW", "NW", "NNW",
]


# ------------------------------------------------------------------ 小工具


def log(message: str) -> None:
    print(message, file=sys.stderr)


def compass_of(degrees) -> str:
    """角度 → 16 方位。与 weather.js 的 degreesToCompass 同表，返潮规则按 SE/S/SW 判偏南风。"""
    if not isinstance(degrees, (int, float)) or math.isnan(float(degrees)):
        return ""
    index = int(round((float(degrees) % 360) / 22.5)) % 16
    return COMPASS[index]


def number(value, fallback=None):
    if isinstance(value, bool):
        return fallback
    if isinstance(value, (int, float)) and math.isfinite(float(value)):
        return float(value)
    return fallback


def mean(values):
    nums = [v for v in values if isinstance(v, (int, float))]
    if not nums:
        return None
    return sum(nums) / len(nums)


def pct(numerator, denominator) -> str:
    if not denominator:
        return "—"
    return f"{numerator / denominator * 100:.1f}%"


# ------------------------------------------------------------------ 读数据


def load_days(data_dir: Path):
    """
    读全部 shenzhen-*.json，返回 ({date: [24 条记录]}, [文件元信息])。
    日期以记录里的 time 前缀为准（已按 Asia/Shanghai 落盘），不做时区换算。
    """
    files = sorted(data_dir.glob("shenzhen-*.json"))
    if not files:
        raise SystemExit(
            f"没有找到数据文件：{data_dir}\n"
            "先运行：python scripts/backtest/fetch_history.py --synthetic --force"
        )

    days: dict[str, list] = {}
    sources = []
    synthetic_flags = []

    for path in files:
        try:
            document = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            raise SystemExit(f"数据文件无法解析：{path}（{exc}）")
        records = document.get("records") or []
        meta = document.get("meta") or {}
        for record in records:
            stamp = str(record.get("time") or "")
            if len(stamp) < 13:
                continue
            days.setdefault(stamp[:10], []).append(record)
        sources.append(
            {
                "file": path.name,
                "records": len(records),
                "source": meta.get("source"),
                "synthetic": bool(meta.get("synthetic")),
                "startDate": meta.get("startDate"),
                "endDate": meta.get("endDate"),
                "fetchedAt": meta.get("fetchedAt"),
            }
        )
        synthetic_flags.append(bool(meta.get("synthetic")))

    for key in days:
        days[key].sort(key=lambda item: str(item.get("time")))

    any_synthetic = any(synthetic_flags)
    all_synthetic = all(synthetic_flags) if synthetic_flags else False
    return days, sources, any_synthetic, all_synthetic


def load_drying_config() -> dict:
    """经验权重与归一化区间直接读配置，避免脚本与线上配置各写一份、慢慢分叉。"""
    try:
        raw = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise SystemExit(f"无法读取 {CONFIG_PATH}：{exc}")
    node = (raw.get("indices") or {}).get("drying")
    if not node:
        raise SystemExit("indices.json 里没有 drying 节点")
    return node


# ------------------------------------------------------------------ 构造入参


def precip_prob_proxy(hour_precip: float, day_total: float) -> int:
    """
    降水概率代理值。

    归档接口（Archive API）只有 precipitation（毫米），没有 precipitation_probability，
    而 drying 规则里降水概率占 0.25 权重，缺了这项结论会显著偏移。
    这里用"小时降水量 + 当日累计降水"构造一个单调、可解释的代理值。
    它是代理值，不是观测到的概率，报告里必须这么写。
    """
    if hour_precip >= 1.0:
        return 100
    if hour_precip >= 0.3:
        return 85
    if hour_precip > 0:
        return 65
    if day_total >= 10:
        return 45
    if day_total >= 1:
        return 25
    if day_total > 0:
        return 15
    return 5


def hourly_entry(record: dict, day_total: float) -> dict:
    """单小时记录 → weather.js hourly 元素的结构（time 用 HH:00）"""
    stamp = str(record.get("time") or "")
    hour = stamp[11:13] if len(stamp) >= 13 else "00"
    precip = number(record.get("precipitation"), 0.0) or 0.0
    return {
        "time": f"{hour}:00",
        "temp": number(record.get("temp")),
        "humidity": number(record.get("humidity")),
        "windSpeed": number(record.get("windSpeed")),
        "windDir": compass_of(record.get("windDirection")),
        "precipProb": precip_prob_proxy(precip, day_total),
        "solar": number(record.get("solar"), 0.0),
    }


def pick_current(hours: list) -> dict:
    """当日 09:00 的读数；缺这一小时就退到最近的一个上午整点。"""
    if not hours:
        return {}
    for record in hours:
        if str(record.get("time"))[11:13] == "09":
            return record
    for record in hours:
        hour = int(str(record.get("time"))[11:13] or 0)
        if hour >= 9:
            return record
    return hours[0]


def build_inputs(days: dict, sorted_dates: list) -> list:
    """
    逐日构造样本。每个样本包含三块：
        drying   —— 规则入参
        damp     —— 规则入参
        truth    —— 次日实况（用于判定误判，不喂给模型）
    """
    samples = []
    for index, day in enumerate(sorted_dates):
        hours = days[day]
        if len(hours) < 24:
            # 缺小时的日期（真实数据的首尾）不参与回测，避免拿半天的数据下结论
            continue
        next_date = sorted_dates[index + 1] if index + 1 < len(sorted_dates) else None
        if not next_date:
            continue

        day_total = sum((number(r.get("precipitation"), 0.0) or 0.0) for r in hours)
        hourly = [hourly_entry(record, day_total) for record in hours]
        current = pick_current(hours)
        current_entry = hourly_entry(current, day_total)

        # 过去 72 小时最低气温：返潮规则用它近似室内表面温度（工作指导书 4.3）
        past_pool = []
        cursor = index - 1
        while cursor >= 0 and len(past_pool) < 72:
            for record in reversed(days[sorted_dates[cursor]]):
                past_pool.append(number(record.get("temp")))
                if len(past_pool) >= 72:
                    break
            cursor -= 1
        past_temps = [v for v in past_pool if v is not None]
        past_min = min(past_temps) if past_temps else None

        next_hours = days[next_date]
        next_precip = sum((number(r.get("precipitation"), 0.0) or 0.0) for r in next_hours)
        next_humidity = mean([number(r.get("humidity")) for r in next_hours])
        next_bad = next_precip > NEXT_DAY_PRECIP_LIMIT or (
            next_humidity is not None and next_humidity > NEXT_DAY_HUMIDITY_LIMIT
        )

        samples.append(
            {
                "date": day,
                "drying": {
                    "temp": current_entry["temp"],
                    "humidity": current_entry["humidity"],
                    "windSpeed": current_entry["windSpeed"],
                    "windDir": current_entry["windDir"],
                    "precipProb": current_entry["precipProb"],
                    "solar": current_entry["solar"],
                    "hourly": hourly,
                },
                "damp": {
                    "temp": current_entry["temp"],
                    "humidity": current_entry["humidity"],
                    "windDir": current_entry["windDir"],
                    "windSpeed": current_entry["windSpeed"],
                    "hourly": hourly,
                    "pastMinTemp72h": past_min,
                    "indoorTemp": None,
                },
                "truth": {
                    "day_precip_total": round(day_total, 2),
                    "next_date": next_date,
                    "next_precip_total": round(next_precip, 2),
                    "next_humidity_mean": None if next_humidity is None else round(next_humidity, 1),
                    "next_bad": bool(next_bad),
                },
            }
        )
    return samples


# ------------------------------------------------------------------ 调 Node


def call_rule(node_bin: str, rule_id: str, inputs: list, weights: dict | None = None) -> list:
    """
    通过 run_rule.js 批量跑规则。入参走 stdin，避免为几百天数据来回写临时文件。

    这里是 Python 与内核之间唯一的缝：如果哪天回测结果和页面不一致，
    先看这个函数的 stdout 是不是被日志污染了。
    """
    command = [node_bin, str(RUN_RULE), rule_id, "-"]
    if weights:
        command.extend(["--weights", json.dumps(weights, ensure_ascii=False)])

    payload = json.dumps(inputs, ensure_ascii=False)
    try:
        completed = subprocess.run(
            command,
            input=payload,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            cwd=str(PROJECT_ROOT),
        )
    except FileNotFoundError:
        raise SystemExit(
            f"找不到 Node 可执行文件：{node_bin}\n"
            "回测需要一个能跑 ES Module 的 Node（>=20），或用 --node 指定绝对路径。"
        )
    except OSError as exc:
        raise SystemExit(f"调用 Node 失败：{exc}")

    if completed.returncode != 0:
        raise SystemExit(
            f"run_rule.js 退出码 {completed.returncode}（规则 {rule_id}）\n"
            f"stderr：\n{completed.stderr.strip()}"
        )

    stderr_text = (completed.stderr or "").strip()
    if stderr_text:
        # 配置异常之类的告警照原样转出来，不吞掉
        for line in stderr_text.splitlines():
            log(f"  [node] {line}")

    try:
        results = json.loads(completed.stdout)
    except json.JSONDecodeError as exc:
        raise SystemExit(
            "run_rule.js 的 stdout 不是纯 JSON，无法解析。\n"
            f"原因：{exc}\n前 200 字符：{completed.stdout[:200]!r}"
        )
    if not isinstance(results, list):
        raise SystemExit("run_rule.js 批量模式应返回数组")
    if len(results) != len(inputs):
        raise SystemExit(f"返回条数 {len(results)} 与入参条数 {len(inputs)} 不一致")
    return results


# ------------------------------------------------------------------ 统计


def classify(results: list, samples: list) -> dict:
    """
    二分类口径（报告里要写清楚，否则数字没法复核）：

        预测为正 = 结论"适宜"（level 4）
        实际为正 = 次日干燥（次日降水 = 0 且次日平均湿度 <= 85%）

        TP 判适宜且次日确实干    FP 判适宜但次日下雨/高湿 —— 就是误判
        FN 判不适宜但次日其实能干 TN 判不适宜且次日确实湿
    """
    tp = fp = fn = tn = 0
    degraded = 0
    rows = []
    for result, sample in zip(results, samples):
        level = result.get("level")
        predicted_ok = level == DRYING_LEVEL_GOOD
        actual_ok = not sample["truth"]["next_bad"]
        if result.get("degraded"):
            degraded += 1
        if predicted_ok and actual_ok:
            tp += 1
        elif predicted_ok and not actual_ok:
            fp += 1
        elif not predicted_ok and actual_ok:
            fn += 1
        else:
            tn += 1
        rows.append(
            {
                "predicted_ok": predicted_ok,
                "actual_ok": actual_ok,
                "misjudge": predicted_ok and not actual_ok,
            }
        )

    total = tp + fp + fn + tn
    return {
        "tp": tp,
        "fp": fp,
        "fn": fn,
        "tn": tn,
        "total": total,
        "degraded": degraded,
        "accuracy": (tp + tn) / total if total else None,
        "precision": tp / (tp + fp) if (tp + fp) else None,
        "recall": tp / (tp + fn) if (tp + fn) else None,
        "f1": (2 * tp / (2 * tp + fp + fn)) if (2 * tp + fp + fn) else None,
        "misjudge": fp,
        "conservative": fn,
        "rows": rows,
    }


def baseline_metrics(samples: list) -> dict:
    """
    朴素基线：今天干燥就预测明天也干燥。

    作用是对照。深圳天气有很强的连续性，"今天不下雨"本身就是极强的预测因子；
    如果拟合权重只比这条基线高一点点，那它学到的其实只是天气的持续性，
    而不是"什么条件适合晾衣服"。没有这条基线，70% 的准确率会被误读成模型有效。
    """
    tp = fp = fn = tn = 0
    for sample in samples:
        today_dry = sample["truth"]["day_precip_total"] <= NEXT_DAY_PRECIP_LIMIT
        today_humidity = mean([entry.get("humidity") for entry in sample["drying"]["hourly"]])
        predicted_ok = today_dry and (today_humidity is not None and today_humidity <= NEXT_DAY_HUMIDITY_LIMIT)
        actual_ok = not sample["truth"]["next_bad"]
        if predicted_ok and actual_ok:
            tp += 1
        elif predicted_ok and not actual_ok:
            fp += 1
        elif not predicted_ok and actual_ok:
            fn += 1
        else:
            tn += 1
    total = tp + fp + fn + tn
    return {
        "tp": tp,
        "fp": fp,
        "fn": fn,
        "tn": tn,
        "total": total,
        "degraded": 0,
        "accuracy": (tp + tn) / total if total else None,
        "precision": tp / (tp + fp) if (tp + fp) else None,
        "recall": tp / (tp + fn) if (tp + fn) else None,
        "f1": (2 * tp / (2 * tp + fp + fn)) if (2 * tp + fp + fn) else None,
        "misjudge": fp,
        "conservative": fn,
    }


def score_distribution(results: list) -> dict:
    """分数与等级的分布。用来回答"这个指数到底会不会给出适宜"这种问题。"""
    scores = sorted(float(item.get("score") or 0.0) for item in results)
    levels: dict[int, int] = {}
    for item in results:
        level = int(item.get("level") or 0)
        levels[level] = levels.get(level, 0) + 1
    total = len(scores)
    return {
        "min": scores[0] if scores else None,
        "median": scores[total // 2] if scores else None,
        "mean": (sum(scores) / total) if total else None,
        "max": scores[-1] if scores else None,
        "over80": sum(1 for value in scores if value >= 80),
        "levels": levels,
        "total": total,
    }


def monthly_accuracy(rows: list, samples: list) -> list:
    """按自然月聚合准确率（跨年份合并，2 年数据同一月份放在一行）"""
    buckets: dict[int, dict] = {}
    for row, sample in zip(rows, samples):
        month = int(sample["date"][5:7])
        bucket = buckets.setdefault(month, {"total": 0, "correct": 0, "misjudge": 0, "good": 0})
        bucket["total"] += 1
        bucket["correct"] += 1 if row["predicted_ok"] == row["actual_ok"] else 0
        bucket["misjudge"] += 1 if row["misjudge"] else 0
        bucket["good"] += 1 if row["predicted_ok"] else 0
    table = []
    for month in sorted(buckets):
        bucket = buckets[month]
        table.append(
            {
                "month": month,
                "total": bucket["total"],
                "correct": bucket["correct"],
                "accuracy": bucket["correct"] / bucket["total"],
                "misjudge": bucket["misjudge"],
                "good": bucket["good"],
            }
        )
    return table


# ------------------------------------------------------------------ 网格搜索


def normalize_ratio(value, poor: float, good: float) -> float:
    """与 utils/normalize.js 完全一致的 [劣端, 优端] 归一化，含 0—1 截断。"""
    if value is None:
        return None
    if good == poor:
        return 0.5
    raw = (value - poor) / (good - poor)
    if math.isnan(raw):
        return 0.5
    return min(1.0, max(0.0, raw))


def grid_search(samples: list, config_node: dict, step: float) -> dict:
    """
    在单纯形上做网格搜索，最小化误判数（等价于最大化准确率），用标准库实现。

    目标函数用"准确率"而不是"最小二乘"：本项目关心的是"该不该晾"这个二元判断，
    不是分数本身的回归精度；工作指导书 11.3 也只要求准确率对比。

    平局处理：准确率相同取误判更少者，再相同取与经验权重更接近者，
    保证同一份数据反复跑得到同一套权重（否则报告里的数字不可复现）。
    """
    keys = WEIGHT_KEYS
    normalize_map = config_node.get("normalize") or {}
    empirical = {key: float(config_node.get("weights", {}).get(key, 0.0)) for key in keys}

    # 预先把每天的 5 个比值算好，网格里只剩加权求和，729 天 × 上万组合也跑得动
    ratio_rows = []
    actual_rows = []
    for sample in samples:
        entry = sample["drying"]
        ratios = []
        usable = True
        for key in keys:
            span = normalize_map.get(key) or []
            if len(span) != 2:
                usable = False
                break
            ratio = normalize_ratio(entry.get(key), float(span[0]), float(span[1]))
            if ratio is None:
                usable = False
                break
            ratios.append(ratio)
        if not usable:
            continue
        ratio_rows.append(tuple(ratios))
        actual_rows.append(not sample["truth"]["next_bad"])

    units = int(round(1.0 / step))
    if units <= 0:
        raise SystemExit("--grid-step 必须小于 1 且大于 0")

    def combos(remaining, slots):
        """枚举和为 remaining（以 step 为单位）的非负整数分配"""
        if slots == 1:
            yield (remaining,)
            return
        for head in range(remaining + 1):
            for tail in combos(remaining - head, slots - 1):
                yield (head,) + tail

    # 每项至少 1 个步长。不加这条约束，搜索会给出 precipProb=0.80、temp=0、solar=0
    # 这种解：它确实准确率高，但 createConfig() 会因为"权重必须为正数"判它违规，
    # 即拟合结果无法落回 indices.json，也就无法在页面上复现。约束之后结果始终合法。
    minimum_units = 1 if units > len(keys) else 0
    budget = units - minimum_units * len(keys)
    if budget < 0:
        raise SystemExit("--grid-step 太粗：五项各留一个步长后已无剩余权重可分配")

    best = None
    tried = 0
    for raw_combo in combos(budget, len(keys)):
        combo = tuple(value + minimum_units for value in raw_combo)
        weights = tuple(value / units for value in combo)
        tp = fp = fn = tn = 0
        for ratios, actual_ok in zip(ratio_rows, actual_rows):
            score = 0.0
            for weight, ratio in zip(weights, ratios):
                score += weight * ratio
            score = round(score * 100, 1)
            predicted_ok = score >= 80.0
            if predicted_ok and actual_ok:
                tp += 1
            elif predicted_ok and not actual_ok:
                fp += 1
            elif not predicted_ok and actual_ok:
                fn += 1
            else:
                tn += 1
        tried += 1
        total = tp + fp + fn + tn
        accuracy = (tp + tn) / total if total else 0.0
        f1 = (2 * tp / (2 * tp + fp + fn)) if (2 * tp + fp + fn) else 0.0
        distance = sum(abs(weights[i] - empirical[keys[i]]) for i in range(len(keys)))
        candidate = (accuracy, -fp, -distance, f1, weights, (tp, fp, fn, tn))
        if best is None or candidate[:4] > best[:4]:
            best = candidate

    weights = dict(zip(keys, best[4]))
    return {
        "weights": weights,
        "accuracy": best[0],
        "misjudge": -best[1],
        "f1": best[3],
        "tried": tried,
        "step": step,
        "min_weight": minimum_units * step,
        "evaluated_days": len(ratio_rows),
    }


# ------------------------------------------------------------------ 输出


def write_csv(path: Path, header: list, rows: list) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.writer(handle)
        writer.writerow(header)
        writer.writerows(rows)


def percent(value) -> str:
    return "—" if value is None else f"{value * 100:.1f}%"


def build_report(context: dict) -> str:
    """生成人可读的 report.md，供结题报告直接引用。"""
    lines = []
    add = lines.append

    add("# 晾晒指数回测报告")
    add("")
    add(f"生成时间：{context['generated_at']}　｜　脚本：`scripts/backtest/backtest_indices.py`")
    add("")

    if context["any_synthetic"]:
        add("> **数据来源声明（务必保留）**")
        add(">")
        add("> 本次回测使用的数据含 **合成数据（synthetic: true）**，由 `fetch_history.py --synthetic`")
        add("> 用固定随机种子生成，结构与量级模仿深圳，但**不是实测气象记录**。")
        add("> 因此下表所有准确率、精确率、召回率**只能证明脚本与内核能跑通、口径能落地**，")
        add("> **不得**作为「晾晒指数准确率」的实验结论写进结题报告。")
        add("> 换成真实数据后需重跑本脚本，并在 `docs/data-source.md` 记录数据文件的 SHA256。")
        add("")
    elif not context["all_synthetic"]:
        add("> 数据来源：Open-Meteo Archive API 实测归档（详见 `docs/data-source.md`）。")
        add("")

    add("## 一、数据概况")
    add("")
    add("| 文件 | 记录数 | 来源 | 合成 | 覆盖区间 |")
    add("|---|---:|---|---|---|")
    for item in context["sources"]:
        add(
            f"| `{item['file']}` | {item['records']} | {item['source'] or '—'} | "
            f"{'是' if item['synthetic'] else '否'} | {item['startDate'] or '—'} ~ {item['endDate'] or '—'} |"
        )
    add("")
    add(
        f"参与回测的样本：**{context['sample_count']} 天**"
        f"（日期 {context['date_from']} ~ {context['date_to']}，"
        f"要求当日 24 小时齐全且有次日数据，因此比总天数少）"
    )
    if context.get("limit"):
        add("")
        add(f"本次为快速验证：`--limit {context['limit']}`，只跑了前 {context['sample_count']} 天。")
    add("")

    add("## 二、判定口径")
    add("")
    add("- 预测为正：`drying` 结论 `level == 4`（适宜）")
    add("- 实际为正：**次日干燥**，即次日降水合计 = 0 且次日平均相对湿度 ≤ 85%")
    add("- 误判（FP）：判「适宜」但次日降水 > 0 或次日平均湿度 > 85%（工作指导书 11.3 的原话）")
    add("- 漏判（FN）：判「不适宜」但次日其实干燥——代价是保守，不算错得离谱，但会降低可用性")
    add("")
    add("准确率 = (TP+TN)/N；精确率 = TP/(TP+FP)；召回率 = TP/(TP+FN)。")
    add("")

    add("## 三、三套权重方案对比")
    add("")
    add("| 方案 | 温度 | 湿度 | 风速 | 降水概率 | 日照 | 准确率 | 精确率 | 召回率 | F1 | 误判 | 漏判 |")
    add("|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|")
    for scheme in context["schemes"]:
        weight_cells = " | ".join(f"{scheme['weights'][key]:.2f}" for key in WEIGHT_KEYS)
        metrics = scheme["metrics"]
        add(
            f"| {scheme['label']} | {weight_cells} | {percent(metrics['accuracy'])} | "
            f"{percent(metrics['precision'])} | {percent(metrics['recall'])} | "
            f"{percent(metrics['f1'])} | {metrics['fp']} | {metrics['fn']} |"
        )
    baseline = context["baseline"]
    add(
        f"| 朴素基线（今天干即判明天干，仅作参照） | — | — | — | — | — | "
        f"{percent(baseline['accuracy'])} | {percent(baseline['precision'])} | "
        f"{percent(baseline['recall'])} | {percent(baseline['f1'])} | "
        f"{baseline['fp']} | {baseline['fn']} |"
    )
    add("")
    add(
        "最后一行不是权重方案，是参照线：它不做任何气象判断，只说「今天不下雨，明天大概也不下雨」。"
        "任何一个方案的准确率若与它持平，就说明该方案没有提供额外信息。"
    )
    add("")

    add("### 混淆矩阵")
    add("")
    for scheme in context["schemes"]:
        metrics = scheme["metrics"]
        add(f"**{scheme['label']}**（N = {metrics['total']}）")
        add("")
        add("| | 次日实际干燥 | 次日雨/高湿 |")
        add("|---|---:|---:|")
        add(f"| 判「适宜」 | TP = {metrics['tp']} | FP = {metrics['fp']}（误判） |")
        add(f"| 判「不适宜」 | FN = {metrics['fn']} | TN = {metrics['tn']} |")
        add("")
    add("")

    add("## 四、分数与等级分布")
    add("")
    add("这一节回答一个比准确率更基础的问题：**这个指数在两年里到底给过几次「适宜」？**")
    add("如果「适宜」几乎不出现，那么准确率再高也没有意义——用户永远看到「不建议」。")
    add("")
    add("| 方案 | 最低 | 中位 | 平均 | 最高 | ≥80 分天数 | L4 | L3 | L2 | L1 |")
    add("|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|")
    for scheme in context["schemes"]:
        dist = scheme["distribution"]
        add(
            f"| {scheme['label']} | {dist['min']:.1f} | {dist['median']:.1f} | {dist['mean']:.1f} | "
            f"{dist['max']:.1f} | {dist['over80']}（{percent(dist['over80'] / dist['total'])}） | "
            f"{dist['levels'].get(4, 0)} | {dist['levels'].get(3, 0)} | "
            f"{dist['levels'].get(2, 0)} | {dist['levels'].get(1, 0)} |"
        )
    add("")

    add("### 返潮（damp）输出分布")
    add("")
    add("返潮没有可用的实测标注（「今天墙面是否真的结露」没有公开数据可查），"
        "所以这一节只统计规则给出过什么结论，不评准确率。")
    add("")
    damp = context["damp"]
    add("| 等级 | 含义 | 天数 | 占比 |")
    add("|---:|---|---:|---:|")
    for level in (1, 2, 3, 4):
        add(f"| {level} | {damp['labels'].get(level, '—')} | {damp['counts'].get(level, 0)} | "
            f"{percent(damp['counts'].get(level, 0) / damp['total'])} |")
    add("")
    add(
        f"规则版本 v{damp['version']}，降级 {damp['degraded']}/{damp['total']} 天。"
        f"level ≤ 2（需要防潮动作）共 {damp['risky']} 天，占 {percent(damp['risky'] / damp['total'])}。"
    )
    add("")

    add("## 五、按月准确率")
    add("")
    header = "| 月份 | 样本数 | " + " | ".join(s["label"] for s in context["schemes"]) + " |"
    add(header)
    add("|---:|---:|" + "---:|" * len(context["schemes"]))
    for index in range(len(context["months"][0]["rows"]) if context["months"] else 0):
        month = context["months"][0]["rows"][index]
        cells = []
        for scheme_months in context["months"]:
            row = scheme_months["rows"][index]
            cells.append(f"{percent(row['accuracy'])}（{row['correct']}/{row['total']}）")
        add(f"| {month['month']} 月 | {month['total']} | " + " | ".join(cells) + " |")
    add("")
    if context["months"]:
        add("各月误判数（FP）：")
        add("")
        add("| 月份 | " + " | ".join(s["label"] for s in context["schemes"]) + " |")
        add("|---:|" + "---:|" * len(context["schemes"]))
        for index in range(len(context["months"][0]["rows"])):
            month = context["months"][0]["rows"][index]
            cells = [str(scheme_months["rows"][index]["misjudge"]) for scheme_months in context["months"]]
            add(f"| {month['month']} 月 | " + " | ".join(cells) + " |")
        add("")

    add("## 六、拟合权重是怎么来的")
    add("")
    if context["grid"]:
        grid = context["grid"]
        add(
            f"- 方法：在权重单纯形上做网格搜索，步长 {grid['step']}，共评估 **{grid['tried']}** 组合，"
            f"覆盖 {grid['evaluated_days']} 天样本；"
        )
        add(
            f"- 约束：每项权重 ≥ {grid['min_weight']:.2f}。无此约束时搜索会落到「降水概率 0.80、"
            "温度 0、日照 0」这类解，但 `createConfig()` 规定权重必须为正数，"
            "那样的解无法写回 `indices.json`，也就无法在页面上复现；"
        )
        add("- 目标：准确率最高；平局依次比误判数更少、与经验权重更接近，保证结果可复现；")
        add("- 实现：纯标准库枚举，未使用 numpy / pandas（本机 Python 环境未装科学计算包）。")
        add("")
        add(
            "> 注意：在同一批数据上选权重、再用同一批数据评准确率，属于**样本内评估**，"
            "拟合方案的准确率天然偏高，不能直接说「比经验权重好」。"
            "严谨做法是切成训练段/验证段或做时间序列交叉验证，这一项列在待办里。"
        )
    else:
        add("本次以 `--no-grid` 运行，未做拟合权重方案。")
    add("")

    add("## 七、口径与已知问题")
    add("")
    for note in context["notes"]:
        add(f"- {note}")
    add("")

    add("## 八、结论（当前仅限脚本层面）")
    add("")
    add("1. Python → `run_rule.js` → `engine.run()` 的链路可跑通，回测与线上共用同一份规则代码；")
    add("2. 逐日构造入参、批量调用、CSV 落盘、混淆矩阵与按月统计均已实现；")
    add("3. 表中数字为**示例数据结果**，真实准确率待接入实测数据后重跑；")
    add(
        "4. `damp`（返潮）只做描述性统计：缺少「是否真的返潮」的实测标注，"
        "没有标注就没有准确率可言，宁可空着也不编一个数字。"
    )
    add("")

    return "\n".join(lines)


# ------------------------------------------------------------------ 主流程


def main(argv: list | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="晾晒指数回测：准确率、混淆矩阵、按月分组、三套权重对比",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("--data-dir", default=str(DEFAULT_DATA_DIR), help="历史数据目录")
    parser.add_argument("--out-dir", default=str(DEFAULT_OUT_DIR), help="产出目录")
    parser.add_argument("--limit", type=int, default=0, help="只跑前 N 天，便于快速验证")
    parser.add_argument("--grid-step", type=float, default=0.05, help="网格搜索步长，默认 0.05")
    parser.add_argument("--no-grid", action="store_true", help="跳过拟合权重的网格搜索")
    parser.add_argument("--node", default=os.environ.get("NODE_BIN", "node"), help="node 可执行文件")
    args = parser.parse_args(argv)

    data_dir = Path(args.data_dir).resolve()
    out_dir = Path(args.out_dir).resolve()
    out_dir.mkdir(parents=True, exist_ok=True)

    days, sources, any_synthetic, all_synthetic = load_days(data_dir)
    sorted_dates = sorted(days.keys())
    samples = build_inputs(days, sorted_dates)
    if args.limit and args.limit > 0:
        samples = samples[: args.limit]
    if not samples:
        raise SystemExit("没有可回测的样本：数据里可能只有不到 2 天，或缺小时")

    config_node = load_drying_config()
    empirical = {key: float(config_node.get("weights", {}).get(key, 0.0)) for key in WEIGHT_KEYS}
    config_sum = sum(empirical.values())
    if abs(config_sum - 1) > 0.011:
        log(f"[警告] 配置里的 drying 权重之和为 {config_sum:.4f}，不是 1")

    log(f"样本 {len(samples)} 天：{samples[0]['date']} ~ {samples[-1]['date']}")

    schemes = [
        {"key": "empirical", "label": "经验权重（当前配置）", "weights": empirical, "override": None},
        {
            "key": "equal",
            "label": "等权（五项各 0.2）",
            "weights": {key: 0.2 for key in WEIGHT_KEYS},
            "override": {key: 0.2 for key in WEIGHT_KEYS},
        },
    ]

    grid_info = None
    if not args.no_grid:
        log(f"网格搜索拟合权重（步长 {args.grid_step}）…")
        grid_info = grid_search(samples, config_node, args.grid_step)
        # 网格结果按步长取整后可能带浮点尾巴，统一到 4 位小数，
        # 既满足配置校验的 ±0.01，报告里也好读
        fitted = {key: round(grid_info["weights"][key], 4) for key in WEIGHT_KEYS}
        schemes.append(
            {"key": "fitted", "label": "拟合权重（网格搜索）", "weights": fitted, "override": fitted}
        )

    drying_inputs = [sample["drying"] for sample in samples]
    damp_inputs = [sample["damp"] for sample in samples]

    log("调用 run_rule.js 跑 drying（逐方案）…")
    for scheme in schemes:
        results = call_rule(args.node, "drying", drying_inputs, scheme["override"])
        scheme["results"] = results
        scheme["metrics"] = classify(results, samples)
        scheme["months"] = monthly_accuracy(scheme["metrics"]["rows"], samples)
        scheme["distribution"] = score_distribution(results)

    baseline = baseline_metrics(samples)

    log("调用 run_rule.js 跑 damp…")
    damp_results = call_rule(args.node, "damp", damp_inputs)
    damp_degraded = sum(1 for item in damp_results if item.get("degraded"))
    damp_counts: dict[int, int] = {}
    damp_labels: dict[int, str] = {}
    for item in damp_results:
        level = int(item.get("level") or 0)
        damp_counts[level] = damp_counts.get(level, 0) + 1
        damp_labels.setdefault(level, str(item.get("levelLabel") or ""))
    damp_stats = {
        "counts": damp_counts,
        "labels": damp_labels,
        "degraded": damp_degraded,
        "total": len(damp_results),
        "risky": sum(count for level, count in damp_counts.items() if level <= 2),
        "version": str(damp_results[0].get("version") or "unknown") if damp_results else "unknown",
    }

    # ---------------- CSV
    header = [
        "date", "scheme", "level", "level_label", "score", "headline",
        "best_window", "best_window_score", "degraded",
        "temp_09", "humidity_09", "wind_speed_09", "precip_prob_09", "solar_09",
        "next_date", "next_precip_total", "next_humidity_mean", "next_bad",
        "predicted_ok", "actual_ok", "misjudge",
    ]
    rows = []
    for scheme in schemes:
        for result, sample in zip(scheme["results"], samples):
            window = (result.get("meta") or {}).get("bestWindow") or {}
            entry = sample["drying"]
            truth = sample["truth"]
            predicted_ok = result.get("level") == DRYING_LEVEL_GOOD
            actual_ok = not truth["next_bad"]
            rows.append(
                [
                    sample["date"],
                    scheme["key"],
                    result.get("level"),
                    result.get("levelLabel"),
                    result.get("score"),
                    result.get("headline"),
                    f"{window.get('start')}-{window.get('end')}" if window else "无",
                    window.get("score"),
                    "是" if result.get("degraded") else "否",
                    entry["temp"],
                    entry["humidity"],
                    entry["windSpeed"],
                    entry["precipProb"],
                    entry["solar"],
                    truth["next_date"],
                    truth["next_precip_total"],
                    truth["next_humidity_mean"],
                    "是" if truth["next_bad"] else "否",
                    "是" if predicted_ok else "否",
                    "是" if actual_ok else "否",
                    "是" if (predicted_ok and not actual_ok) else "否",
                ]
            )
    drying_csv = out_dir / "drying.csv"
    write_csv(drying_csv, header, rows)

    damp_rows = []
    for result, sample in zip(damp_results, samples):
        damp_rows.append(
            [
                sample["date"],
                result.get("level"),
                result.get("levelLabel"),
                result.get("score"),
                result.get("headline"),
                "是" if result.get("degraded") else "否",
                result.get("version"),
                len(result.get("evidence") or []),
            ]
        )
    damp_csv = out_dir / "damp.csv"
    write_csv(
        damp_csv,
        ["date", "level", "level_label", "score", "headline", "degraded", "rule_version", "evidence_count"],
        damp_rows,
    )

    # ---------------- 报告
    notes = [
        "hourly 用的是**当日 0—23 时**，而线上 `weather.js` 给的是**从当前小时起的未来 48 小时**；"
        "因此回测里的「最佳时段」只在当天范围内找，与线上口径不完全一致，改进方式是把 hourly 换成"
        "「当日 09:00 起连续 24 小时」。",
        "归档接口没有 `precipitation_probability`，本回测用小时降水量与当日累计降水构造代理值"
        "（≥1mm→100，≥0.3mm→85，>0→65，其余按当日累计 45/25/15/5）。"
        "降水概率在权重里占 0.25，代理值会系统性影响分数，真实数据接入后应重新评估。",
        f"`damp`（返潮）规则 v{damp_stats['version']} 已接入，"
        f"本次 {damp_degraded}/{len(damp_results)} 条返回降级结论；"
        "返潮没有可用的实测标注，故只做描述性统计，不评准确率。",
        "`engine.js` 的 `nowIso()` 在 `config.checkedAt` 存在时忽略注入时钟，"
        "所以 CSV 里没有收录 `updatedAt`——它记录的是跑脚本的墙上时间，不是历史日期。",
        "判定「实际为干燥」用的是次日 24 小时合计降水与平均湿度，"
        "「今天晾、次日收」这个时间差在工作指导书里没有更细的口径，本脚本按字面实现。",
    ]

    if all(scheme["metrics"]["tp"] + scheme["metrics"]["fp"] == 0 for scheme in schemes):
        notes.insert(
            0,
            "本次样本里没有任何一天被判为「适宜」（level 4），因此精确率无定义、召回率为 0。"
            "这本身是一个可用的结论：`levels` 里 80 分这道线在该时段达不到，"
            "要么阈值定得过高，要么归一化区间与实际气候不匹配，需要拿真实数据复核。",
        )

    context = {
        "generated_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "sources": sources,
        "any_synthetic": any_synthetic,
        "all_synthetic": all_synthetic,
        "sample_count": len(samples),
        "date_from": samples[0]["date"],
        "date_to": samples[-1]["date"],
        "limit": args.limit,
        "schemes": schemes,
        "baseline": baseline,
        "damp": damp_stats,
        "months": [{"label": scheme["label"], "rows": scheme["months"]} for scheme in schemes],
        "grid": grid_info,
        "notes": notes,
    }
    report_path = out_dir / "report.md"
    report_path.write_text(build_report(context), encoding="utf-8")

    # ---------------- stdout 摘要
    print("")
    print(f"数据：{len(sources)} 个文件，{len(samples)} 天样本（{samples[0]['date']} ~ {samples[-1]['date']}）")
    print(f"数据性质：{'合成数据（示例）' if any_synthetic else '实测数据'}")
    print("")
    print(f"{'方案':<20}{'准确率':>8}{'精确率':>8}{'召回率':>8}{'误判':>6}{'漏判':>6}")
    for scheme in schemes:
        metrics = scheme["metrics"]
        print(
            f"{scheme['label']:<20}{percent(metrics['accuracy']):>8}"
            f"{percent(metrics['precision']):>8}{percent(metrics['recall']):>8}"
            f"{metrics['fp']:>6}{metrics['fn']:>6}"
        )
    print(
        f"{'朴素基线（参照）':<20}{percent(baseline['accuracy']):>8}"
        f"{percent(baseline['precision']):>8}{percent(baseline['recall']):>8}"
        f"{baseline['fp']:>6}{baseline['fn']:>6}"
    )
    print("")
    if grid_info:
        weights = " ".join(f"{key}={grid_info['weights'][key]:.2f}" for key in WEIGHT_KEYS)
        print(f"拟合权重：{weights}（评估 {grid_info['tried']} 组合）")
    print(f"报表：{drying_csv}")
    print(f"      {damp_csv}")
    print(f"      {report_path}")
    if any_synthetic:
        print("")
        print("提醒：以上均为合成数据结果，只能验证流程，不能作为实验结论。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
