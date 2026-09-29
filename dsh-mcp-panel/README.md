# @local/dsh-mcp-panel

MCP 服务器管理面板：列出 profile 补丁（`$DSH_PROFILE_DIR/cordis.patch.yml`）中配置的
`@deepseek-ai/dsh-mcp-client` 行，并逐服务器开启/关闭。

- **开启**：该 mcp-client 插件行加载，服务器连接，其 `mcp__<serverName>__*` 工具进入模型可见的全局工具面。
- **关闭**：插件行卸载，服务器断连、工具注销，模型彻底取不到该服务器的任何工具。

## 组成

| 文件 | 作用 |
| --- | --- |
| `index.js` | Host 半：`/api/dsh-mcp-panel/query`（重读补丁，列出 MCP 行 + 运行状态 + 可见工具数）与 `/api/dsh-mcp-panel/set`（经 `pluginManager.setPluginEnabled()` 切换行启停，结果透传） |
| `client.js` | Client 半：`sidebar.panellist` 侧栏行（order 1，紧邻「插件」下方）与 `main` keyed 面板 |
| `node_modules/yaml` | 补丁解析依赖（`!!js` 表达式仅保留原始字符串，不评估、不回显） |

## 开关语义

切换复用宿主自带插件管理服务：写入 `- id: <行id> / disabled: <bool>` 覆盖行到
`cordis.patch.yml`（保留注释），经 HMR 热生效，重启后保留。`ChangeResult` 的
`applied / restart-required / overridden / failed / cancelled` 在面板上有对应文案。

## 边界

- 仅列出用户补丁层的 MCP 行；其他层（shipped bundle 等）插入的 MCP 不在列表中。
- `env` / `headers` 值（可能含密钥）、stdio 参数和 HTTP URL 永不返回给浏览器；面板只显示传输类型和配置状态。
- 路由 `set` 只接受当前补丁中可解析为 MCP 行的 id，无法操作无关插件。
