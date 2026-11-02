# 回测数据来源

> 工作指导书 5.4 的要求：**仓库只记录数据从哪来**，数据文件本身不进版本库。
> `scripts/backtest/data/` 与 `scripts/backtest/output/` 已在 `.gitignore` 里排除。
>
> 本文档记录：文件名、来源、获取日期、记录条数、SHA256。换数据后请同步更新本页，
> 否则报告里的数字就无法追溯（结题答辩被问"这批数据哪来的"时需要当场答上来）。

---

## 一、数据源

| 项 | 内容 |
|---|---|
| 服务 | Open-Meteo Archive API（历史归档，非预报） |
| 端点 | `https://archive-api.open-meteo.com/v1/archive` |
| 是否需要密钥 | 不需要（决策 2：从根上消除"密钥进仓库"的风险） |
| 城市 | 深圳 |
| 坐标 | 纬度 22.5431，经度 114.0579 |
| 时区 | `Asia/Shanghai` |
| 风速单位 | `ms`（米/秒），与 `weather.js` 的 `wind_speed_unit=ms` 一致 |
| 请求字段 | `temperature_2m, relative_humidity_2m, wind_speed_10m, wind_direction_10m, precipitation, shortwave_radiation` |
| 落盘粒度 | 逐小时，按自然年分片（`shenzhen-<year>.json`） |
| 归档延迟 | 约 5 天（脚本用 `today − 5` 作为右边界） |

## 二、真实数据（报告引用这一份）

目录：`scripts/backtest/data/real/`
获取日期：**2026-11-02**
覆盖区间：2024-10-29 ~ 2026-10-28（730 天，17520 条记录）

| 文件名 | 年份 | 覆盖区间 | 记录数 | 字节数 | SHA256 |
|---|---:|---|---:|---:|---|
| `shenzhen-2024.json` | 2024 | 2024-10-29 ~ 2024-12-31 | 1536 | 194078 | `b3599bb1770456150a24053456ab75801473a2808657ca5576c40876249911af` |
| `shenzhen-2025.json` | 2025 | 2025-01-01 ~ 2025-12-31 | 8760 | 1107722 | `87f147b89ff600533c3a5c59a6873a047727aaf3ecf99c5aab9c50261d3e2854` |
| `shenzhen-2026.json` | 2026 | 2026-01-01 ~ 2026-10-28 | 7224 | 915117 | `89f0bcd90ba0563f1fe3432db0605a819e0c51db0133819596547a4f85efaff5` |

实际请求区间（脚本按年切片，右边界为 `2026-11-02 − 5 天`）：

- 2024 年：`2024-10-29` ~ `2024-12-31`
- 2025 年：`2025-01-01` ~ `2025-12-31`
- 2026 年：`2026-01-01` ~ `2026-10-28`

数据合理性抽查（说明"看起来像深圳"）：

- 气温 7.1 ~ 35.7 ℃；
- 相对湿度 17 ~ 100 %；
- 2026 年首条记录 `2026-01-01T00:00`：16.3 ℃ / 92% / 2.6 m/s / 风向 94° / 降水 0 / 辐射 0（夜间辐射为 0，符合物理）。

## 三、合成数据（仅用于离线跑通流程）

目录：`scripts/backtest/data/`（与真实数据分开，避免混用）
生成方式：`fetch_history.py --synthetic`，固定随机种子 `20261102 + year`，锚点结束日 `2026-10-31`
覆盖区间：2024-11-01 ~ 2026-10-31（730 天，17520 条记录）

| 文件名 | 年份 | 覆盖区间 | 记录数 |
|---|---:|---|---:|
| `shenzhen-2024.json` | 2024 | 2024-11-01 ~ 2024-12-31 | 1464 |
| `shenzhen-2025.json` | 2025 | 2025-01-01 ~ 2025-12-31 | 8760 |
| `shenzhen-2026.json` | 2026 | 2026-01-01 ~ 2026-10-31 | 7296 |

**这里故意不列 SHA256**：种子固定只能保证**数值**可复现，文件里还记着 `meta.fetchedAt`（生成时刻），
每次运行字节都不同，哈希因此没有核对意义。真实数据的哈希值得记（可以判断有没有被改过），
合成数据的哈希不值得记——与其列一堆查不了的值，不如说清楚为什么查不了。
需要确认"这批合成数据是不是同一份"，看 `manifest.json` 里的 `seed` 与 `updatedAt` 即可。

合成数据的三条纪律：

1. `manifest.json` 里 `synthetic: true`，文件 `meta.source = "synthetic"`，`meta.seed` 记录种子；
2. `manifest.json` 的 `meta.containsSynthetic` 为 true 时，`backtest_indices.py` 会在 `report.md`
   顶部自动插入"不得作为实验结论"的声明——**这条横幅由 manifest 驱动，不靠人记得**；
3. 合成数据与真实数据分目录存放，不会互相覆盖。

## 四、SHA256 怎么复核

任何一台装了标准库的机器都能复核，不需要额外工具：

```bash
# 单个文件
python -c "import hashlib,sys; print(hashlib.sha256(open(sys.argv[1],'rb').read()).hexdigest())" scripts/backtest/data/real/shenzhen-2025.json

# Git Bash / Linux / macOS
sha256sum scripts/backtest/data/real/shenzhen-2025.json

# Windows PowerShell
Get-FileHash scripts/backtest/data/real/shenzhen-2025.json -Algorithm SHA256
```

`fetch_history.py` 每次运行都会重算全部文件的 SHA256 并写入 `manifest.json`，
所以 `manifest.json` 与文件不一致就说明文件被改过（或拷坏了）。

注意：**真实数据的 SHA256 不是永久不变的**。它取决于拉取当天的请求区间，
Open-Meteo 也可能对历史数据做再分析订正，因此隔一段时间重拉，哈希会变——这是正常的，
以 `manifest.json` 里的 `fetchedAt` 为准。本文第二节的哈希用于核对"2026-11-02 那一次拉到的数据"。
合成数据不列哈希，原因见上一节。

## 五、manifest.json 字段说明

```json
{
  "meta": {
    "city": "深圳", "latitude": 22.5431, "longitude": 114.0579,
    "timezone": "Asia/Shanghai",
    "endpoint": "https://archive-api.open-meteo.com/v1/archive",
    "requestFields": ["temperature_2m", "..."],
    "localFields": { "temp": "℃", "humidity": "%" },
    "windSpeedUnit": "ms",
    "updatedAt": "2026-11-02T16:39:26+08:00",
    "fileCount": 3, "totalRecords": 17520,
    "containsSynthetic": false,
    "warning": "全部为真实数据"
  },
  "files": [
    {
      "file": "shenzhen-2025.json", "year": 2025,
      "source": "open-meteo-archive", "url": "https://archive-api.open-meteo.com/v1/archive?...",
      "startDate": "2025-01-01", "endDate": "2025-12-31",
      "fetchedAt": "2026-11-02T16:39:12+08:00",
      "records": 8760, "synthetic": false, "seed": null,
      "bytes": 1107722, "sha256": "87f147b8..."
    }
  ]
}
```

## 六、字段映射

接口字段 → 本地字段（`fetch_history.py` 的 `HOURLY_FIELDS`，与 `weather.js` 的 `adaptResponse()` 一一对应）：

| 接口字段 | 本地字段 | 单位 | 用途 |
|---|---|---|---|
| `temperature_2m` | `temp` | ℃ | 晾晒、返潮、体感 |
| `relative_humidity_2m` | `humidity` | % | 晾晒、返潮、露点 |
| `wind_speed_10m` | `windSpeed` | m/s | 晾晒、返潮 |
| `wind_direction_10m` | `windDirection` | ° | 返潮判偏南风（转 16 方位） |
| `precipitation` | `precipitation` | mm | 判定"实际降水"，并构造降水概率代理值 |
| `shortwave_radiation` | `solar` | W/m² | 晾晒 |

**缺失字段说明**：归档接口没有 `precipitation_probability`（该字段只在预报接口上提供，
且历史长度有限）。回测用小时降水量与当日累计降水构造代理值，详见
`docs/设计说明书.md` 6.3 与 `output/real/report.md` 第七节。
这条不是可以含糊过去的细节：降水概率在晾晒权重里占 0.25。

## 七、输出文件

| 文件 | 内容 | 是否进仓库 |
|---|---|---|
| `scripts/backtest/output/drying.csv` | 逐日 × 三方案的 DecisionResult 与判定标签（合成数据） | 否（.gitignore） |
| `scripts/backtest/output/damp.csv` | 逐日返潮结论（合成数据） | 否 |
| `scripts/backtest/output/report.md` | 合成数据回测报表（跑通流程用） | 否 |
| `scripts/backtest/output/real/drying.csv` | 同上，真实归档数据 | 否 |
| `scripts/backtest/output/real/report.md` | **真实数据回测报表，结题报告引用这一份** | 否 |
| `scripts/backtest/output/irr.csv` | 分期三算法逐组结果 | 否 |
| `scripts/backtest/output/irr-report.md` | 分期三算法对比报告 | 否 |

CSV 使用 `utf-8-sig` 编码，Excel 双击打开不乱码。
