"""
晾晒指数的两种验证口径对照（只用标准库）

为什么要做这件事
----------------
指导书 11.3 定的口径是「判适宜的**次日**若降水 > 0 或平均湿度 > 85%，记误判」。
这个口径便于批量计算，但它和功能目标之间隔着一层：

    用户是「今天晾、18:00 前收衣」，衣服当天下午就进柜了。
    次日是否下雨，对这一次晾晒几乎没影响。

于是「今天大晴天、明天暴雨」会被记成一次误判，而用户当天其实晾得很成功。
口径越保守，模型越吃亏——这不是模型差，是量错了东西。

本脚本把两种口径并排算一遍，让报告能说清差异出在哪：
    主口径（指导书 11.3）  ：实际为正 = 次日干燥（次日降水 = 0 且平均湿度 ≤ 85%）
    补充口径（贴近功能）    ：实际为正 = 当日晾晒窗口干燥（09:00—20:00 降水 = 0 且平均湿度 ≤ 85%）

补充口径不改主口径的结论，只用来解释主口径为什么偏低。
"""

import csv
import json
import sys
from collections import defaultdict
from pathlib import Path

HERE = Path(__file__).resolve().parent
DATA_DIR = HERE / "data" / "real"
CSV_PATH = HERE / "output" / "real" / "drying.csv"

# 晾晒窗口：用户早上看结论、白天晾、傍晚收
WINDOW_START = 9
WINDOW_END = 20
HUMIDITY_LIMIT = 85.0
PRECIP_LIMIT = 0.0


def load_hours(data_dir: Path) -> dict:
    """date -> {hour: record}"""
    table = defaultdict(dict)
    for path in sorted(data_dir.glob("shenzhen-*.json")):
        with open(path, encoding="utf-8") as f:
            payload = json.load(f)
        for record in payload.get("records", []):
            stamp = str(record.get("time") or "")
            if len(stamp) < 13:
                continue
            day = stamp[:10]
            hour = int(stamp[11:13])
            table[day][hour] = record
    return table


def window_is_dry(day_hours: dict) -> bool | None:
    """当日 09:00—20:00 是否干燥（降水合计 0 且平均湿度 ≤ 85%）"""
    window = [day_hours[h] for h in range(WINDOW_START, WINDOW_END + 1) if h in day_hours]
    if len(window) < 8:
        return None
    precip = sum(float(r.get("precipitation") or 0.0) for r in window)
    humidities = [float(r["humidity"]) for r in window if r.get("humidity") is not None]
    if not humidities:
        return None
    return precip <= PRECIP_LIMIT and (sum(humidities) / len(humidities)) <= HUMIDITY_LIMIT


def load_samples() -> list:
    if not CSV_PATH.exists():
        sys.exit(f"找不到 {CSV_PATH}，先跑 backtest_indices.py --data-dir data/real --out-dir output/real")
    samples = []
    with open(CSV_PATH, encoding="utf-8-sig", newline="") as f:
        for row in csv.DictReader(f):
            if row.get("scheme") != "empirical":
                continue
            samples.append(
                {
                    "date": row["date"],
                    "score": float(row["score"]),
                    "next_bad": row["next_bad"] == "是",
                }
            )
    return samples


def report(name: str, pairs: list, threshold: float) -> dict:
    tp = fp = fn = tn = 0
    for score, actual_dry in pairs:
        pred = score >= threshold
        if pred and actual_dry:
            tp += 1
        elif pred and not actual_dry:
            fp += 1
        elif not pred and actual_dry:
            fn += 1
        else:
            tn += 1
    n = tp + fp + fn + tn
    precision = tp / (tp + fp) if (tp + fp) else 0.0
    recall = tp / (tp + fn) if (tp + fn) else 0.0
    f1 = 2 * precision * recall / (precision + recall) if (precision + recall) else 0.0
    print(f"\n【{name}】阈值 {threshold:.0f} 分，样本 {n} 天")
    print(f"  判适宜 {tp + fp} 天，其中真的能干 {tp} 天、白晾了 {fp} 天")
    print(f"  该晾却没说 {fn} 天，其余 {tn} 天双方都认为不宜")
    print(
        f"  精确率 {precision:.1%}　召回率 {recall:.1%}　"
        f"F1 {f1:.1%}　准确率 {(tp + tn) / n:.1%}"
    )
    return {"n": n, "tp": tp, "fp": fp, "fn": fn, "tn": tn,
            "precision": precision, "recall": recall, "f1": f1}


def main():
    hours = load_hours(DATA_DIR)
    samples = load_samples()
    threshold = float(sys.argv[1]) if len(sys.argv) > 1 else 70.0

    primary = []
    secondary = []
    skipped = 0
    for item in samples:
        day_hours = hours.get(item["date"])
        dry_today = window_is_dry(day_hours) if day_hours else None
        if dry_today is None:
            skipped += 1
            continue
        primary.append((item["score"], not item["next_bad"]))
        secondary.append((item["score"], dry_today))

    print(f"可用样本 {len(primary)} 天（缺当日窗口数据跳过 {skipped} 天）")
    print(f"当日晾晒窗口口径下，本当能干的天数：{sum(1 for _, d in secondary if d)} 天"
          f"（{sum(1 for _, d in secondary if d) / len(secondary):.1%}）")
    print(f"次日口径下，本当能干的天数：{sum(1 for _, d in primary if d)} 天"
          f"（{sum(1 for _, d in primary if d) / len(primary):.1%}）")

    a = report("主口径：次日是否干燥（指导书 11.3）", primary, threshold)
    b = report("补充口径：当日晾晒窗口是否干燥（贴近功能目标）", secondary, threshold)

    print("\n差异解读")
    print(f"  同一批「适宜」结论，主口径判对 {a['precision']:.1%}，"
          f"补充口径判对 {b['precision']:.1%}，相差 {(b['precision'] - a['precision']) * 100:.1f} 个百分点。")
    print("  差额来自「当天晾成了、次天下雨」这类样本：主口径把它们算作误判，")
    print("  但它们恰恰是用户满意的结果。报告里应同时给出两个数字并说明口径，")
    print("  不能只挑好看的那个写。")


if __name__ == "__main__":
    main()
