# l-dsh-plugins

DeepSeek Harness 的本地插件集合，包含四个可独立安装的 bundle：

| 插件 | 用途 |
| --- | --- |
| [`dsh-mcp-panel`](./dsh-mcp-panel) | 查看并启停 profile 补丁中的 MCP 服务器 |
| [`dsh-quota-dashboard`](./dsh-quota-dashboard) | 查看 DeepSeek、MiniMax、GLM 与 Sub2API 的额度和用量 |
| [`dsh-skill-panel`](./dsh-skill-panel) | 查看并启停用户技能 |
| [`dsh-usage-stats`](./dsh-usage-stats) | 从本地会话日志统计 token 用量 |

## 安装

在 DeepSeek Harness 的插件管理器中，选择对应插件目录（例如
`/path/to/l-dsh-plugins/dsh-mcp-panel`）安装。每个插件目录都包含自己的
`package.json` 和 `cordis.patch.yml`，可以单独安装或按需组合安装。

插件源码修改后，由 Harness 的 HMR 机制负责重新加载；浏览器端插件修改后刷新页面即可。
各插件的功能、接口和限制见对应目录的 README。

## 凭据与隐私

仓库只保存插件源码和不含用户数据的示例补丁。仓库中没有真实 token、API key、密码、私钥、
本地会话或用户技能内容。

- `dsh-quota-dashboard` 运行时从 `$DSH_HOME/.credentials.yaml` 的 `refs` 读取凭据，并从
  profile 补丁读取 provider 配置；凭据不会写入返回浏览器的数据。
- `dsh-mcp-panel` 不回传 MCP 配置中的 `env` 或 `headers`；用户的 MCP 地址和命令只存在于本地
  profile 补丁中。
- `.gitignore` 会排除 `node_modules`、运行时凭据、环境文件、会话日志和验证截图。提交前仍应
  检查新增文件，确认没有把本地 profile、`.credentials.yaml` 或其他用户数据复制进仓库。

额度插件中的公开服务端点是功能所需的固定 API 地址，不包含认证信息；依赖锁文件中的 registry
地址和完整性哈希同样是公开依赖元数据。

## 开发检查

在仓库根目录执行：

```bash
npm --prefix dsh-mcp-panel install
npm --prefix dsh-quota-dashboard install
npm --prefix dsh-skill-panel install
node --check dsh-mcp-panel/index.js
node --check dsh-mcp-panel/client.js
node --check dsh-quota-dashboard/index.js
node --check dsh-quota-dashboard/client.js
node --check dsh-skill-panel/index.js
node --check dsh-skill-panel/client.js
node --check dsh-usage-stats/index.js
node --check dsh-usage-stats/client.js
node dsh-skill-panel/tests/smoke.mjs
```

`dsh-usage-stats` 不依赖第三方 npm 包，因此没有单独的 lockfile。
