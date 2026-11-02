#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
回测数据获取 · 深圳近两年逐小时气象数据

数据源：Open-Meteo Archive API（https://archive-api.open-meteo.com/v1/archive）
       无需密钥，符合「仓库里不放密钥」的决策（docs/decisions/0001 第 2 条）。

用法：
    python fetch_history.py                # 拉近两年真实数据，已存在的年份跳过
    python fetch_history.py --force        # 覆盖已有文件
    python fetch_history.py --synthetic    # 不联网，生成 730 天合成数据（固定随机种子）
    python fetch_history.py --synthetic --force
    python fetch_history.py --years 2025 2026

产物：
    scripts/backtest/data/shenzhen-<year>.json   按年分片的逐小时记录
    scripts/backtest/data/manifest.json          文件名、来源 URL、获取日期、条数、SHA256

三条纪律：
    1. 只用标准库（urllib / json / hashlib / random / datetime），本机没装 pandas 也能跑；
    2. 写文件先写 .tmp 再 os.replace，网络失败绝不留半个文件；
    3. 合成数据必须在 manifest 里标 synthetic: true，不能冒充真实数据。
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import random
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import date, datetime, timedelta
from pathlib import Path

# ---------------------------------------------------------------- 常量

ENDPOINT = "https://archive-api.open-meteo.com/v1/archive"
CITY = "深圳"
LATITUDE = 22.5431
LONGITUDE = 114.0579
TIMEZONE = "Asia/Shanghai"

# 内部字段名 ← 接口字段名。weather.js 的 adaptResponse() 做同样的事，
# 两边字段名不一致只影响这一张表。
HOURLY_FIELDS = {
    "temperature_2m": "temp",
    "relative_humidity_2m": "humidity",
    "wind_speed_10m": "windSpeed",
    "wind_direction_10m": "windDirection",
    "precipitation": "precipitation",
    "shortwave_radiation": "solar",
}
FIELD_UNITS = {
    "temp": "℃",
    "humidity": "%",
    "windSpeed": "m/s",
    "windDirection": "°",
    "precipitation": "mm",
    "solar": "W/m²",
}

WIND_SPEED_UNIT = "ms"
TIMEOUT_SECONDS = 90
RETRY_TIMES = 3
RETRY_BACKOFF = (2, 5)  # 每次重试前的等待秒数

# 合成数据的固定锚点与种子：日期与随机序列都固定，保证同一天运行两次
# 得到的文件逐字节相同（SHA256 才可核对）。
SYNTHETIC_END = date(2026, 10, 31)
SYNTHETIC_DAYS = 730
SYNTHETIC_SEED = 20261102

# 归档接口有 5 天左右的延迟，用 today-5 作为可请求的右边界
ARCHIVE_DELAY_DAYS = 5
REQUEST_SPAN_DAYS = 730

# 16 方位罗盘，与 weather.js 的 COMPASS 一致（返潮规则按 SE/S/SW 判偏南风）
COMPASS = [
    "N", "NNE", "NE", "ENE",
    "E", "ESE", "SE", "SSE",
    "S", "SSW", "SW", "WSW",
    "W", "WNW", "NW", "NNW",
]

DATA_DIR = Path(__file__).resolve().parent / "data"
MANIFEST_NAME = "manifest.json"


# ---------------------------------------------------------------- 小工具


def log(message: str) -> None:
    """诊断信息一律走 stderr，stdout 留给最终摘要。"""
    print(message, file=sys.stderr)


def data_path(data_dir: Path, year: int) -> Path:
    return data_dir / f"shenzhen-{year}.json"


def atomic_write_json(path: Path, payload: dict) -> None:
    """先写临时文件再原子替换。任何一步失败都删掉临时文件，不留半成品。"""
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + ".tmp")
    try:
        text = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
        with open(tmp, "w", encoding="utf-8", newline="\n") as handle:
            handle.write(text)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(tmp, path)
    except Exception:
        if tmp.exists():
            try:
                tmp.unlink()
            except OSError:
                pass
        raise


def sha256_of(path: Path) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def fnum(value, digits: int = 1, fallback: float = 0.0) -> float:
    if isinstance(value, (int, float)) and math.isfinite(float(value)):
        return round(float(value), digits)
    return fallback


# ---------------------------------------------------------------- 真实数据


def build_url(start: date, end: date) -> str:
    params = {
        "latitude": f"{LATITUDE}",
        "longitude": f"{LONGITUDE}",
        "start_date": start.isoformat(),
        "end_date": end.isoformat(),
        "hourly": ",".join(HOURLY_FIELDS.keys()),
        "timezone": TIMEZONE,
        "wind_speed_unit": WIND_SPEED_UNIT,
    }
    return f"{ENDPOINT}?{urllib.parse.urlencode(params)}"


def http_get_json(url: str) -> dict:
    """带重试的 GET。失败抛 RuntimeError，消息里写清是哪一步失败。"""
    last_error = ""
    for attempt in range(RETRY_TIMES):
        if attempt > 0:
            wait = RETRY_BACKOFF[min(attempt - 1, len(RETRY_BACKOFF) - 1)]
            log(f"  第 {attempt + 1} 次尝试，先等 {wait} 秒…")
            time.sleep(wait)
        request = urllib.request.Request(
            url,
            headers={
                "User-Agent": "decision-assistant-backtest/0.1 (student project)",
                "Accept": "application/json",
            },
        )
        try:
            with urllib.request.urlopen(request, timeout=TIMEOUT_SECONDS) as response:
                raw = response.read()
            payload = json.loads(raw.decode("utf-8"))
            if not isinstance(payload, dict):
                last_error = "接口返回的不是 JSON 对象"
                continue
            if payload.get("error"):
                last_error = f"接口报错：{payload.get('reason') or payload.get('error')}"
                continue
            return payload
        except urllib.error.HTTPError as exc:
            last_error = f"HTTP {exc.code} {exc.reason}"
        except urllib.error.URLError as exc:
            last_error = f"网络不可达：{exc.reason}"
        except TimeoutError:
            last_error = f"请求超时（>{TIMEOUT_SECONDS}s）"
        except json.JSONDecodeError as exc:
            last_error = f"响应不是合法 JSON：{exc}"
        except OSError as exc:
            last_error = f"系统错误：{exc}"
    raise RuntimeError(last_error or "未知网络错误")


def to_records(payload: dict) -> list:
    """把接口的列式数组转成逐小时记录，顺便做完整性校验。"""
    hourly = payload.get("hourly")
    if not isinstance(hourly, dict):
        raise RuntimeError("接口返回缺少 hourly 节点")
    times = hourly.get("time")
    if not isinstance(times, list) or not times:
        raise RuntimeError("接口返回缺少 hourly.time")

    columns = {}
    for remote_name, local_name in HOURLY_FIELDS.items():
        values = hourly.get(remote_name)
        if not isinstance(values, list):
            raise RuntimeError(f"接口返回缺少字段 {remote_name}")
        if len(values) != len(times):
            raise RuntimeError(
                f"字段 {remote_name} 长度 {len(values)} 与时间轴长度 {len(times)} 不一致"
            )
        columns[local_name] = values

    records = []
    for index, stamp in enumerate(times):
        # Open-Meteo 返回 "2026-10-31T00:00"，这里统一裁到分钟
        records.append(
            {
                "time": str(stamp)[:16],
                "temp": fnum(columns["temp"][index], 1, None),
                "humidity": fnum(columns["humidity"][index], 0, None),
                "windSpeed": fnum(columns["windSpeed"][index], 1, None),
                "windDirection": fnum(columns["windDirection"][index], 0, None),
                "precipitation": fnum(columns["precipitation"][index], 2, 0.0),
                "solar": fnum(columns["solar"][index], 0, 0.0),
            }
        )
    return records


def plan_windows(today: date, years: list | None) -> list:
    """按年切片，每片一个请求区间，避免单次跨年过长。"""
    end = today - timedelta(days=ARCHIVE_DELAY_DAYS)
    start = end - timedelta(days=REQUEST_SPAN_DAYS - 1)
    windows = []
    for year in range(start.year, end.year + 1):
        if years and year not in years:
            continue
        slice_start = max(start, date(year, 1, 1))
        slice_end = min(end, date(year, 12, 31))
        if slice_start > slice_end:
            continue
        windows.append((year, slice_start, slice_end))
    return windows


def fetch_year(data_dir: Path, year: int, start: date, end: date, force: bool) -> bool:
    target = data_path(data_dir, year)
    if target.exists() and not force:
        log(f"[跳过] {target.name} 已存在（--force 可覆盖）")
        return False

    url = build_url(start, end)
    log(f"[请求] {year} 年 {start} ~ {end}")
    payload = http_get_json(url)
    records = to_records(payload)
    if not records:
        raise RuntimeError(f"{year} 年返回 0 条记录")

    document = {
        "meta": {
            "city": CITY,
            "latitude": LATITUDE,
            "longitude": LONGITUDE,
            "timezone": TIMEZONE,
            "year": year,
            "source": "open-meteo-archive",
            "endpoint": ENDPOINT,
            "url": url,
            "startDate": start.isoformat(),
            "endDate": end.isoformat(),
            "fetchedAt": datetime.now().astimezone().isoformat(timespec="seconds"),
            "synthetic": False,
            "windSpeedUnit": WIND_SPEED_UNIT,
            "fields": FIELD_UNITS,
            "records": len(records),
        },
        "records": records,
    }
    atomic_write_json(target, document)
    log(f"[完成] {target.name}  {len(records)} 条")
    return True


# ---------------------------------------------------------------- 合成数据


def compass_of(degrees: float) -> str:
    index = int(round((degrees % 360) / 22.5)) % 16
    return COMPASS[index]


def synthesize_year(year: int, start: date, end: date) -> list:
    """
    固定种子的合成数据，只为离线跑通流程，不代表深圳真实气候。

    结构上刻意还原三件真实数据里存在的东西，否则回测跑通也说明不了问题：
      1. 雨季（5—9 月）降水更频繁、湿度更高；
      2. 降水日日照下降、气温日较差缩小；
      3. 冬季以偏北风为主，夏季偏南风为主（返潮规则的风向条件才有东西可判）。
    """
    rng = random.Random(SYNTHETIC_SEED + year)
    records = []
    rainy_yesterday = False

    cursor = start
    while cursor <= end:
        doy = cursor.timetuple().tm_yday
        # 季节项：4 月下旬约 23.5℃，7 月下旬约 30.5℃，1 月下旬约 16.5℃
        season = math.sin(2 * math.pi * (doy - 110) / 365.25)
        base_temp = 23.5 + 7.0 * season

        # 湿季概率：5—9 月明显更高
        wet_season = 5 <= cursor.month <= 9
        rain_prob = 0.55 if rainy_yesterday else (0.34 if wet_season else 0.12)
        is_rainy = rng.random() < rain_prob
        rainy_yesterday = is_rainy

        # 干冷空气过程：深圳 11—3 月偶有大陆干冷气团，湿度可跌到 45% 上下。
        # 合成数据必须包含这种日子，否则"适宜"档永远取不到，回测指标会退化成全负例。
        is_dry_spell = (not is_rainy) and cursor.month in (11, 12, 1, 2, 3) and rng.random() < 0.28

        day_temp = base_temp + rng.uniform(-1.8, 1.8) - (1.2 if is_rainy else 0)
        if is_dry_spell:
            day_humidity_base = rng.uniform(46, 58)
            cloud = rng.uniform(0.88, 1.0)
        else:
            # 晴天湿度不要收得太窄：真实深圳秋冬清晨既有 80% 的闷湿天，也有 55% 的干爽天
            day_humidity_base = (91 if is_rainy else 68) + rng.uniform(-9, 9)
            cloud = rng.uniform(0.18, 0.42) if is_rainy else rng.uniform(0.55, 1.0)

        # 降水总量与降水时段：合成数据只求量级合理
        if is_rainy:
            total_precip = rng.uniform(0.4, 46.0)
            start_hour = rng.randint(0, 15)
            span = rng.randint(2, 6)
            rain_hours = {(start_hour + i) % 24 for i in range(span)}
        else:
            total_precip = 0.0
            rain_hours = set()

        # 风向：夏季偏南、冬季偏北，降雨日更偏南
        if is_dry_spell:
            wind_deg = rng.choice([0, 10, 20, 30, 340, 350])
        elif is_rainy or cursor.month in (5, 6, 7, 8, 9):
            wind_deg = rng.choice([150, 160, 170, 180, 190, 200, 210, 220, 135, 250])
        else:
            wind_deg = rng.choice([0, 10, 20, 30, 340, 350, 45, 60, 90, 270])
        wind_base = rng.uniform(2.2, 7.0) if is_rainy else rng.uniform(0.6, 4.6)

        for hour in range(24):
            # 日变化：15 时最高，03 时最低
            diurnal = math.cos(2 * math.pi * (hour - 15) / 24)
            temp = day_temp + 4.2 * diurnal + rng.uniform(-0.5, 0.5)
            humidity = day_humidity_base - 1.6 * 4.2 * diurnal + rng.uniform(-3, 3)
            if hour in rain_hours:
                humidity += 4
            # 晴天正午辐射约 780—980 W/m²，阴雨日大幅衰减
            if 6 <= hour <= 18:
                clear_sky = 950 * math.sin(math.pi * (hour - 6) / 12)
                solar = max(0.0, clear_sky * cloud + rng.uniform(-25, 25))
            else:
                solar = 0.0
            precipitation = 0.0
            if hour in rain_hours and total_precip > 0:
                precipitation = total_precip / len(rain_hours) * rng.uniform(0.5, 1.6)
            elif is_rainy and rng.random() < 0.15:
                precipitation = 0.1

            records.append(
                {
                    "time": f"{cursor.isoformat()}T{hour:02d}:00",
                    "temp": round(min(36.0, max(8.0, temp)), 1),
                    "humidity": int(round(min(100.0, max(40.0, humidity)))),
                    "windSpeed": round(min(12.0, max(0.0, wind_base + rng.uniform(-1.2, 1.2))), 1),
                    "windDirection": float(wind_deg),
                    "precipitation": round(min(80.0, max(0.0, precipitation)), 2),
                    "solar": int(round(min(1100.0, max(0.0, solar)))),
                }
            )
        cursor += timedelta(days=1)
    return records


def write_synthetic(data_dir: Path, force: bool) -> list:
    """把 730 天合成数据按年切片写盘，返回写成功的年份列表。"""
    end = SYNTHETIC_END
    start = end - timedelta(days=SYNTHETIC_DAYS - 1)
    written = []
    for year in range(start.year, end.year + 1):
        slice_start = max(start, date(year, 1, 1))
        slice_end = min(end, date(year, 12, 31))
        if slice_start > slice_end:
            continue
        target = data_path(data_dir, year)
        if target.exists() and not force:
            log(f"[跳过] {target.name} 已存在（--force 可覆盖）")
            continue
        records = synthesize_year(year, slice_start, slice_end)
        document = {
            "meta": {
                "city": CITY,
                "latitude": LATITUDE,
                "longitude": LONGITUDE,
                "timezone": TIMEZONE,
                "year": year,
                "source": "synthetic",
                "endpoint": None,
                "url": None,
                "startDate": slice_start.isoformat(),
                "endDate": slice_end.isoformat(),
                "fetchedAt": datetime.now().astimezone().isoformat(timespec="seconds"),
                "synthetic": True,
                "seed": SYNTHETIC_SEED + year,
                "generator": "fetch_history.py --synthetic",
                "windSpeedUnit": WIND_SPEED_UNIT,
                "fields": FIELD_UNITS,
                "records": len(records),
                "note": "合成数据，仅用于离线跑通回测流程，不得作为实验结论",
            },
            "records": records,
        }
        atomic_write_json(target, document)
        log(f"[合成] {target.name}  {len(records)} 条")
        written.append(year)
    return written


# ---------------------------------------------------------------- manifest


def write_manifest(data_dir: Path) -> dict:
    """
    扫描 data 目录重建 manifest。以磁盘上的文件为准，
    避免「manifest 说有条数据、文件已经被删」这种自相矛盾。
    """
    files = []
    for path in sorted(data_dir.glob("shenzhen-*.json")):
        try:
            document = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            log(f"[警告] {path.name} 无法解析，跳过：{exc}")
            continue
        meta = document.get("meta") or {}
        records = document.get("records") or []
        files.append(
            {
                "file": path.name,
                "year": meta.get("year"),
                "source": meta.get("source"),
                "url": meta.get("url"),
                "startDate": meta.get("startDate"),
                "endDate": meta.get("endDate"),
                "fetchedAt": meta.get("fetchedAt"),
                "records": len(records),
                "synthetic": bool(meta.get("synthetic")),
                "seed": meta.get("seed"),
                "bytes": path.stat().st_size,
                "sha256": sha256_of(path),
            }
        )

    files.sort(key=lambda item: (item["year"] or 0, item["file"]))
    any_synthetic = any(item["synthetic"] for item in files)
    manifest = {
        "meta": {
            "city": CITY,
            "latitude": LATITUDE,
            "longitude": LONGITUDE,
            "timezone": TIMEZONE,
            "endpoint": ENDPOINT,
            "requestFields": list(HOURLY_FIELDS.keys()),
            "localFields": FIELD_UNITS,
            "windSpeedUnit": WIND_SPEED_UNIT,
            "updatedAt": datetime.now().astimezone().isoformat(timespec="seconds"),
            "fileCount": len(files),
            "totalRecords": sum(item["records"] for item in files),
            "containsSynthetic": any_synthetic,
            "warning": (
                "本目录含 synthetic: true 的合成数据，只能用于跑通流程，"
                "任何基于它的准确率都不得写进结题报告的实验结论"
            )
            if any_synthetic
            else "全部为真实数据",
        },
        "files": files,
    }
    atomic_write_json(data_dir / MANIFEST_NAME, manifest)
    return manifest


# ---------------------------------------------------------------- 入口


def main(argv: list | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="拉取 / 生成深圳逐小时气象数据，供 scripts/backtest 使用",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=(
            "示例：\n"
            "  python fetch_history.py --synthetic --force\n"
            "  python fetch_history.py --years 2025 2026\n"
        ),
    )
    parser.add_argument("--force", action="store_true", help="覆盖已存在的年份文件")
    parser.add_argument(
        "--synthetic",
        action="store_true",
        help="不联网，用固定随机种子生成 730 天合成数据（manifest 会标 synthetic: true）",
    )
    parser.add_argument("--years", nargs="*", type=int, help="只处理指定年份（默认全部）")
    parser.add_argument(
        "--data-dir",
        default=str(DATA_DIR),
        help=f"输出目录，默认 {DATA_DIR}",
    )
    args = parser.parse_args(argv)

    data_dir = Path(args.data_dir).resolve()
    data_dir.mkdir(parents=True, exist_ok=True)

    try:
        if args.synthetic:
            written = write_synthetic(data_dir, args.force)
            mode = "合成"
        else:
            written = []
            windows = plan_windows(date.today(), args.years)
            if not windows:
                log("[失败] 没有可请求的年份区间，请检查 --years")
                return 2
            for year, start, end in windows:
                if fetch_year(data_dir, year, start, end, args.force):
                    written.append(year)
            mode = "真实"
    except RuntimeError as exc:
        log("")
        log(f"[失败] {exc}")
        log("[提示] 网络不可用时请改用：python fetch_history.py --synthetic --force")
        log("[提示] 本次失败未写入任何文件（写入前已校验完整性）")
        return 1

    manifest = write_manifest(data_dir)
    meta = manifest["meta"]

    print("")
    print(f"模式：{mode}　目录：{data_dir}")
    print(f"本次写入：{('、'.join(str(y) for y in written)) if written else '无（全部跳过）'}")
    print(f"清单：{len(manifest['files'])} 个文件，共 {meta['totalRecords']} 条记录")
    for item in manifest["files"]:
        flag = "合成" if item["synthetic"] else "真实"
        print(f"  · {item['file']:<22} {item['records']:>6} 条  {flag}  sha256={item['sha256'][:16]}…")
    if meta["containsSynthetic"]:
        print("")
        print("注意：目录中含合成数据，基于它的回测数字只能用于验证脚本流程，不能当作实验结论。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
