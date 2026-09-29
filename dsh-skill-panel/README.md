# @local/dsh-skill-panel

技能管理面板：列出用户技能目录（`$DSH_HOME/skills`，即 `~/.dsh/skills`）下的全部技能，
并逐个开启/关闭。

- **开启**（默认）：技能进入模型可见的会话技能目录，模型可通过 `skill` 工具加载。
- **关闭**：在技能文件的 frontmatter 写入 `disable-model-invocation: true`，模型侧的
  技能目录与 `skill` 工具都不再提供该技能；用户以 `/名称` 直接调用不受影响（宿主
  既定语义）。

## 组成

| 文件 | 作用 |
| --- | --- |
| `index.js` | Host 半：`/api/dsh-skill-panel/query`（重读技能目录，列出条目 + 注册表实时状态）与 `/api/dsh-skill-panel/set`（经 YAML 文档 API 改写 SKILL.md frontmatter，保留注释与键序） |
| `client.js` | Client 半：`sidebar.panellist` 侧栏行（order 2，紧邻「MCP」下方）与 `main` keyed 面板 |
| `node_modules/yaml` | frontmatter 解析/写回依赖（只编辑文档树，不评估任何表达式） |
| `locale/{zh,en}.json` + `icon.svg` | 插件管理卡片的显示元数据 |

## 开关语义

开关只改写技能文件 frontmatter 的 `disable-model-invocation` 字段：关闭写入
`true`，开启删除该字段（恢复默认）。宿主 `skill-filesystem` 的文件监视器热捕获
变更并失效技能目录缓存，下一次模型请求即发布替换版目录——**无需重启**。YAML 文档
API 保证无关字段、键序与注释原样保留；已是目标状态时不写文件（字节不变）。

`set` 路由只接受位于 `~/.dsh/skills` 之内、且当前仍能解析为有效技能（frontmatter
含合法 `name`/`description`）的文件路径。

## 条目规则（与宿主 skill-filesystem 一致）

- 目录型技能：`<目录>/SKILL.md`；扁平技能：`*.md` 文件。
- `.system` 子目录跳过；条目按名称字母序列出。
- frontmatter 缺失、YAML 非法、缺 `name`/`description`、`name` 非 kebab-case、
  调用策略字段非法（含驼峰旧字段）的条目显示为「无效」，开关禁用——宿主同样忽略
  它们。

## 开发

本包目录已列入 profile 补丁中 `@deepseek-ai/dsh-hmr` 的 `config.root`（与
dsh-quota-dashboard 等本地插件一致）：`index.js` / `client.js` 的改动由 HMR
热替换，无需重启 DSH；client.js 变更后刷新页面即可看到新代码。

## 边界

- 仅管理用户根 `~/.dsh/skills`；project（`.dsh/skills`、`.agents/skills`）、
  `~/.agents/skills`、bundled 与 custom roots 的技能不在列表中。
- 同名 project 技能（rank 更低）会遮蔽用户技能：开关用户文件不影响被遮蔽同名技能
  的模型可见性。
- 面板的「已生效/等待刷新」badge 对照宿主技能注册表的实时快照（借用默认 agent
  preset 的 standing scope，同宿主会话技能目录的读法），仅用于展示，不影响文件
  写入。切换后立即自动刷新可能短暂显示「等待刷新」，宿主文件监视器完成失效后
  再点「刷新」即收敛。
