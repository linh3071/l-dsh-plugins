# dsh-quota-dashboard

DeepSeek Harness 的额度查询插件:在一个 cc-switch 风格的面板中查看各 provider 的套餐配额与账户余额。以 bundle 形式安装进 profile,不修改 Harness 源码。

## 平台覆盖(provider 驱动)

面板卡片完全由 profile patch 中的 providers 驱动:**每个 provider 一张卡片**,按 patch 声明顺序排列,按 id 归类到查询协议:

| provider id 匹配 | 查询协议 | 接口 | 站点地址 |
|---|---|---|---|
| 含 `deepseek` | DeepSeek | `GET /user/balance` | api.deepseek.com(固定) |
| 含 `minimax` | MiniMax | `GET /v1/token_plan/remains` | www.minimaxi.com(固定) |
| 含 `zai`/`bigmodel`/`glm` | GLM | `GET /api/monitor/usage/quota/limit`、`/api/biz/subscription/list` | open.bigmodel.cn(固定) |
| `sub2api` 前缀 | Sub2API | `GET /v1/usage?days=30` | provider 的 `baseURL` |

多个 `sub2api-*` provider 各占一张卡片;不属于以上协议的 provider 不显示。

## Key 读取(provider 驱动)

Host 半部在每次查询时:

1. 解析 profile patch `$DSH_PROFILE_DIR/cordis.patch.yml`(回退 `$DSH_HOME/profiles/web/cordis.patch.yml`)中所有 patch 行的 `config.providers`,得到 provider 表(id、`apiKeyEnv`、`baseURL`);
2. 按 id 把每个 provider 归类到查询协议(DeepSeek 是内置 provider,不在 patch 中时兜底一个实例,回退约定 env `DEEPSEEK_API_KEY`);
3. 用 provider 的 `apiKeyEnv` 到 `$DSH_HOME/.credentials.yaml` 的 `refs` 取 key;
4. Sub2API 站点地址取 provider 的 `baseURL` origin,其余平台用固定额度站点地址。

卡片名称直接显示 provider id(如 `zai-coding-cn`、`minimax-cn`、`sub2api-pro5x`、`deepseek`)。两个文件每次查询重读,增删 provider 或改 key 立即生效(刷新面板即可);provider 缺失或 refs 无值时,对应卡片显示「未找到可用的 Provider 配置」。Key 不进入任何返回给浏览器的数据。

## 结构

- `index.js` — Host 半部:注册 `/api/dsh-quota-dashboard/query` Fetch 路由(POST `{key?}`,key 为 provider id;省略时并发查全部),代理各平台 API 并输出规范化结果(摘要行、明细表、结论)。
- `client.js` — Client 半部:侧栏 `sidebar.panellist` 入口行(order 5,位于「插件」之下)与 `main` keyed 面板;卡片列表由查询结果驱动;React + 主题 token,随宿主明暗主题。
- `cordis.patch.yml` — 插入 Loader 行 `quota-dashboard`。
- `icon.svg` / `locale/*.json` — 插件管理页展示的图标与标题。

## 字段语义(与源查询协议一致)

- MiniMax:使用率只取 `current_*_remaining_percent`(已用 = 100 − 剩余);计数口径不可信,仅作百分比缺失时的回退;重置时间取 `end_time` / `weekly_end_time`(过期不显示)。
- GLM:`Authorization` 发送原始 key(无 Bearer);`TIME_LIMIT` 为联网搜索/MCP 次数,`TOKENS_LIMIT`/`CREDIT_LIMIT` 的 unit 3 → 5 小时窗口、6 → 每周窗口。
- Sub2API:`rate_limits[].window` 原样作为摘要标签(5h/1d/7d);历史累计用量是跨周期日志统计,可高于当前 Key 额度。

## 安装

通过 Harness 的插件管理安装本目录(绝对路径)即可;浏览器端刷新一次页面后,侧栏「插件」下方出现「额度面板」。
