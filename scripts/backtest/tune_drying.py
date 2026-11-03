"""
晾晒指数配置标定（只用标准库，可离线复现）

问题背景
--------
2026-11-02 用 Open-Meteo 实测归档数据回测 729 天，晾晒指数只有 7 天判到「适宜」，
召回率 2.8%。当时判断是「80 分阈值太高」，但那只是表象。

真实原因
--------
indices.json 的 normalize 区间是把「理想干燥天气」当端点设的，而深圳实际气候够不到：
  - 湿度优端 40%：实测最低 34%，p10 才 56%，等于绝大部分天数这一项只能拿 0.2—0.4 分
  - 日照优端 800 W/m²：实测最高 531，这一项永远拿不到 0.6 以上
两项权重合计 0.35，天花板被硬压掉一截，80 分在物理上几乎不可达。

做法
----
不改权重（权重是经验值，另有拟合实验专门评估），只把五个区间对齐到实测分布，
再在总分上扫等级阈值，用 F1 选点。F1 针对「判适宜」这一类：
  实际为正 = 次日干燥（次日降水合计 0 且平均湿度 ≤ 85%，指导书 11.3 口径）
  预测为正 = 当日 score ≥ 阈值

注意：本脚本用 CSV 里 09 时的气象量做快速扫描，只用于「选方案」。
选定后的正式数字必须回到 Node 跑 backtest_indices.py 复核，
保证结论来自线上同一份规则代码（指导书 2.3）。
"""

import csv
import json
import statistics
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
CSV_PATH = HERE / "output" / "real" / "drying.csv"
CONFIG_PATH = HERE.parent.parent / "public" / "data" / "indices.json"

WEIGHTS = {
    "temp": 0.20,
    "humidity": 0.30,
    "windSpeed": 0.20,
    "precipProb": 0.25,
    "solar": 0.05,
}

CSV_FIELDS = {
    "temp": "temp_09",
    "humidity": "humidity_09",
    "windSpeed": "wind_speed_09",
    "precipProb": "precip_prob_09",
    "solar": "solar_09",
}


def clamp(v, lo, hi):
    return min(hi, max(lo, v))


def normalize(value, poor, good):
    """与 src/core/utils/normalize.js 同一公式：clamp((v - poor) / (good - poor), 0, 1)"""
    return clamp((value - poor) / (good - poor), 0.0, 1.0)


def score_of(row, ranges):
    total = 0.0
    weight_sum = 0.0
    for key, weight in WEIGHTS.items():
        raw = row.get(CSV_FIELDS[key])
        if raw in (None, "", "None"):
            continue
        poor, good = ranges[key]
        total += normalize(float(raw), poor, good) * weight
        weight_sum += weight
    if weight_sum <= 0:
        return None
    return total / weight_sum * 100


def load_rows():
    if not CSV_PATH.exists():
        sys.exit(f"找不到 {CSV_PATH}，先跑 backtest_indices.py --data-dir data/real")
    rows = []
    with open(CSV_PATH, encoding="utf-8-sig", newline="") as f:
        for r in csv.DictReader(f):
            if r.get("scheme") != "empirical":
                continue
            # next_bad == "否" 表示次日干燥，即判定口径里的「实际为正」
            rows.append(
                {
                    "date": r["date"],
                    "dry": r["next_bad"] == "否",
                    "row": r,
                }
            )
    return rows


def evaluate(rows, ranges, threshold):
    tp = fp = fn = tn = 0
    for item in rows:
        s = score_of(item["row"], ranges)
        if s is None:
            continue
        pred = s >= threshold
        dry = item["dry"]
        if pred and dry:
            tp += 1
        elif pred and not dry:
            fp += 1
        elif not pred and dry:
            fn += 1
        else:
            tn += 1
    n = tp + fp + fn + tn
    precision = tp / (tp + fp) if (tp + fp) else 0.0
    recall = tp / (tp + fn) if (tp + fn) else 0.0
    f1 = 2 * precision * recall / (precision + recall) if (precision + recall) else 0.0
    acc = (tp + tn) / n if n else 0.0
    return {
        "threshold": threshold,
        "tp": tp, "fp": fp, "fn": fn, "tn": tn,
        "precision": precision, "recall": recall, "f1": f1,
        "accuracy": acc,
        "predicted_ratio": (tp + fp) / n if n else 0.0,
    }


def sweep(rows, ranges, lo=50, hi=92):
    return [evaluate(rows, ranges, t) for t in range(lo, hi + 1)]


def best_f1(results, min_precision=0.45):
    """在精确率不低于下限的前提下取 F1 最高点。

    下限存在的理由：判「适宜」却招来一场雨，是用户实打实的损失，
    单纯追 F1 容易滑向「宁可错杀」的激进配置。
    """
    pool = [r for r in results if r["precision"] >= min_precision] or results
    return max(pool, key=lambda r: (r["f1"], r["precision"]))


def describe(name, ranges):
    return (
        f"{name}: temp{ranges['temp']} humidity{ranges['humidity']} "
        f"wind{ranges['windSpeed']} precip{ranges['precipProb']} solar{ranges['solar']}"
    )


def main():
    rows = load_rows()
    dry_days = sum(1 for r in rows if r["dry"])
    print(f"样本 {len(rows)} 天，其中次日干燥 {dry_days} 天（{dry_days / len(rows):.1%}）")
    print("判定口径：预测为正 = score ≥ 阈值；实际为正 = 次日干燥\n")

    with open(CONFIG_PATH, encoding="utf-8") as f:
        cfg = json.load(f)["indices"]["drying"]
    current = {k: tuple(v) for k, v in cfg["normalize"].items()}

    candidates = {
        "A 当前配置": current,
        "B 贴合实测分布": {
            "temp": (12, 30), "humidity": (95, 50), "windSpeed": (0, 4.5),
            "precipProb": (95, 5), "solar": (0, 450),
        },
        "C 更宽松（湿度再放宽）": {
            "temp": (12, 30), "humidity": (95, 55), "windSpeed": (0.5, 4),
            "precipProb": (90, 5), "solar": (0, 400),
        },
        "D 只修两个离谱端点": {
            **{k: tuple(v) for k, v in current.items()},
            "humidity": (95, 45), "solar": (0, 500),
        },
    }

    print("=" * 96)
    print("各候选区间在「保持 80 分阈值不变」下的表现（检验是否只需改阈值）")
    print("=" * 96)
    print(f"{'方案':<22}{'判适宜天数':>12}{'精确率':>10}{'召回率':>10}{'F1':>9}{'准确率':>10}")
    for name, ranges in candidates.items():
        r = evaluate(rows, ranges, 80)
        print(
            f"{name:<22}{r['tp'] + r['fp']:>12}{r['precision']:>9.1%}"
            f"{r['recall']:>10.1%}{r['f1']:>9.1%}{r['accuracy']:>10.1%}"
        )

    print()
    print("=" * 96)
    print("各候选区间的阈值扫描结果（取精确率 ≥ 45% 下 F1 最高点）")
    print("=" * 96)
    summary = []
    for name, ranges in candidates.items():
        results = sweep(rows, ranges)
        b = best_f1(results)
        summary.append((name, ranges, b))
        print()
        print(describe(name, ranges))
        print(
            f"  最优阈值 {b['threshold']} 分：判适宜 {b['tp'] + b['fp']} 天"
            f"（占比 {b['predicted_ratio']:.1%}），TP={b['tp']} FP={b['fp']} "
            f"FN={b['fn']} TN={b['tn']}"
        )
        print(
            f"  精确率 {b['precision']:.1%}　召回率 {b['recall']:.1%}　"
            f"F1 {b['f1']:.1%}　准确率 {b['accuracy']:.1%}"
        )

    print()
    print("=" * 96)
    print("选定方案 B 的阈值曲线（每 3 分一档，用来看拐点在哪）")
    print("=" * 96)
    print(f"{'阈值':>6}{'判适宜':>9}{'精确率':>10}{'召回率':>10}{'F1':>9}")
    for r in sweep(rows, candidates["B 贴合实测分布"], 58, 88):
        if r["threshold"] % 3 == 0:
            print(
                f"{r['threshold']:>6}{r['tp'] + r['fp']:>9}{r['precision']:>9.1%}"
                f"{r['recall']:>10.1%}{r['f1']:>9.1%}"
            )

    print()
    print("=" * 96)
    print("分数分布对比（看新区间是否把分数用满 0—100）")
    print("=" * 96)
    for name, ranges in candidates.items():
        vals = sorted(score_of(r["row"], ranges) for r in rows)
        vals = [v for v in vals if v is not None]
        q = statistics.quantiles(vals, n=10)
        print(
            f"{name:<22} min={vals[0]:5.1f} p10={q[0]:5.1f} p50={statistics.median(vals):5.1f} "
            f"p90={q[8]:5.1f} max={vals[-1]:5.1f}"
        )

    print()
    best_name, best_ranges, best = max(summary, key=lambda t: t[2]["f1"])
    print(f"建议：{describe(best_name, best_ranges)}，等级阈值 l4 = {best['threshold']}")


if __name__ == "__main__":
    main()
