# dsh-usage-stats

DeepSeek Harness 的用量统计插件:基于本地会话日志(`~/.dsh/sessions`)统计 token 用量,提供 GitHub 风格的日历热力图(Calendar Heatmap)、provider/模型分组统计与时间范围筛选。以 bundle 形式安装进 profile,不修改 Harness 源码。姊妹项目 [dsh-quota-dashboard](../dsh-quota-dashboard) 负责服务商侧的套餐配额与余额查询,本项目负责本机侧的真实消耗统计。

## 数据源与口径

- 会话日志:`$DSH_HOME/sessions/<项目目录>/<session-id>/session.v4.jsonl.zstd`(zstd 拼接帧容器,Host 半部自带帧扫描与逐帧解压,容忍写入中的 torn 尾帧);
- **真实用量(优先)**:`assistant/message` 事件的 `data.usage`(`inputTokens` 为未命中缓存的 prompt、`cacheReadTokens`/`cacheWriteTokens` 为缓存读写、`outputTokens` 含 reasoning),归因 `data.message.source.{provider,model}`,时间取事件 `time`;
- **估算回退**:适配器未上报时按 DSH token-meter 启发式(`packages/llm/token-meter`:4 字符 ≈ 1 token,text/reasoning `ceil(len/4)+4`,tool-call 按名称+参数)仅估输出,input 记 0,记录标 `estimated`,面板显示「估算」徽标;
- 每条助手结算计 1 次请求;`llm/retry` 重试的额外消耗未计入;标题/搜索等辅助 LLM 请求在日志中无用量,仅统计条数(脚注展示);
- 按天分桶固定 UTC+8(与姊妹插件一致);热力图窗口为最近 52 周(约一年,右端对齐当前周,当前月始终在最右),空格与数据格全部绘制,与统计栏的时间范围相互独立;
- 「今天 / 7 天 / 30 天」的起止由浏览器本地时间计算后显式传给 Host。

## 界面

- 侧栏入口:首页左侧栏「额度面板」行下方新增「用量统计」(`sidebar.panellist`,order 6);
- 统计栏:分组下拉(Provider｜Provider / 模型,默认 Provider)、时间范围(今天(默认)｜7 天｜30 天｜自定义起止日期,from>to 自动交换);
- 概要卡:固定 4×2 均匀分布,顺序为 请求数、会话数、缓存命中率、合计 / 输入(未缓存)、输出、缓存读、缓存写 + 真实上报/估算徽标;
- 分组明细:按所选维度聚合的请求数、输入、缓存读、缓存写、输出、合计与占比条;provider 已不在当前 LLM 可用列表(`llm.listProviders()`)时标「已移除」,代表纯历史消耗;
- 脚注:数据覆盖范围、扫描文件数、辅助请求条数与口径说明。

## 结构

- `index.js` — Host 半部:zstd 帧扫描/解压 → 事件折叠(mtime 缓存增量) → POST `/api/dsh-usage-stats/query`(body `{ from?, to?, groupBy? }`,to 为排他边界)返回 `{ totals, groups, days, sessions, meta }`;
- `client.js` — Client 半部:侧栏入口行与 `main` keyed 面板;React + `--dsw-alias-*` 主题 token,热力图色阶由 `--dsw-alias-state-success-primary` 经 `color-mix` 分四档,随宿主明暗主题;
- `cordis.patch.yml` — 插入 Loader 行 `usage-stats`;
- `icon.svg` / `locale/*.json` — 插件管理页展示的图标与标题。

## 安装

通过 Harness 的插件管理安装本目录(绝对路径)即可;刷新页面后,侧栏「额度面板」下方出现「用量统计」。

## 已知局限

- 重试与辅助 LLM 请求(标题生成、搜索改写)的 token 消耗不在统计内(日志未落盘其用量);
- 估算记录缺输入侧(不重放请求面),其 provider 行的输入为 0;
- 会话删除后统计随之消失(日志是唯一数据源);插件不做配置 schema,可调值(热力图 26 周、Top 50、UTC+8)为 `index.js` 命名常量。
