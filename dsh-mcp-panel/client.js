// Browser half of the dsh-mcp-panel bundle: the sidebar row directly below
// the Plugins entry and the MCP server management page it opens.
//
// The page talks to the bundle's Host half over the shared /api channel. The
// Host re-reads the profile patch per query and answers the server list with
// live state; toggling goes through the same channel into the shipped plugin
// manager, which persists a `disabled:` override into the patch file and hot-
// reloads the row. All chrome colors come from --dsw-alias-* theme tokens so
// the page follows light/dark themes beside the host panels.
/* global window */

window.__ModuleLoader__.load({
  id: '@local/dsh-mcp-panel',
  factory(require) {
    const React = require('react')
    const { useState, useEffect, useRef, useCallback } = React
    const h = React.createElement

    // ------------------------------------------------------------------
    // Locale
    // ------------------------------------------------------------------

    const zh = {
      'panel': 'MCP',
      'title': 'MCP 服务器',
      'subtitle': '读取 profile 补丁中配置的 MCP 服务器；关闭后模型无法获取该服务器的工具',
      'refresh': '刷新',
      'retry': '重试',
      'loading': '读取中…',
      'loadError': '加载失败',
      'empty': '补丁中没有 MCP 服务器配置（@deepseek-ai/dsh-mcp-client 行）',
      'enabled': '已启用',
      'disabled': '已关闭',
      'live': '运行中',
      'notLive': '未加载',
      'hiddenWhenDisabled': '已关闭 · 模型不可见',
      'toolsVisible': '模型可见 {n} 个工具',
      'toolsNone': '当前无模型可见工具',
      'configBad': '配置不完整，无法连接',
      'entryId': '行 id',
      'stdioLabel': 'stdio',
      'httpLabel': 'HTTP',
      'timeout': '超时 {n}s',
      'managerMissing': '插件管理服务不可用，无法切换',
      'appliedText': '已生效',
      'restartRequired': '配置已保存，需重启 DSH 后生效',
      'overriddenText': '已保存，但被更高优先级配置覆盖',
      'failedText': '操作失败',
      'cancelledText': '已取消',
      'unknownRow': '补丁中未找到该行，或该行不可通过插件管理服务寻址',
      'note': '开关经插件管理服务写入补丁文件的 disabled 覆盖行，重启后保留；关闭会断开服务器连接并注销其全部工具。',
      'patchSource': '来源',
    }

    const en = {
      'panel': 'MCP',
      'title': 'MCP Servers',
      'subtitle': 'MCP servers configured in the profile patch; a disabled server is invisible to the model',
      'refresh': 'Refresh',
      'retry': 'Retry',
      'loading': 'Loading…',
      'loadError': 'Failed to load',
      'empty': 'No MCP servers in the patch (no @deepseek-ai/dsh-mcp-client rows)',
      'enabled': 'Enabled',
      'disabled': 'Disabled',
      'live': 'Running',
      'notLive': 'Not loaded',
      'hiddenWhenDisabled': 'Disabled · invisible to the model',
      'toolsVisible': '{n} tools visible to the model',
      'toolsNone': 'No model-visible tools right now',
      'configBad': 'Incomplete configuration, cannot connect',
      'entryId': 'Row id',
      'stdioLabel': 'stdio',
      'httpLabel': 'HTTP',
      'timeout': 'timeout {n}s',
      'managerMissing': 'Plugin manager unavailable; cannot toggle',
      'appliedText': 'Applied',
      'restartRequired': 'Saved; restart DSH to apply',
      'overriddenText': 'Saved, but overridden by a higher-priority layer',
      'failedText': 'Operation failed',
      'cancelledText': 'Cancelled',
      'unknownRow': 'Row not found in the patch, or not addressable through the plugin manager',
      'note': 'Toggles persist a `disabled:` override row into the patch file through the plugin manager; disabling disconnects the server and unregisters all of its tools.',
      'patchSource': 'Source',
    }

    // ------------------------------------------------------------------
    // Styles (component-owned; removed with the panel)
    // ------------------------------------------------------------------

    const STYLE = `
.mcpp-page{display:flex;width:100%;height:100%;min-width:0;min-height:0;overflow:hidden;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-base);font-size:14px;line-height:1.6}
.mcpp-scroll{flex:1;min-height:0;overflow:auto;scrollbar-gutter:stable}
.mcpp-content{max-width:900px;margin:0 auto;padding:0 clamp(24px,4vw,48px) 48px}
.mcpp-heading{display:flex;align-items:center;justify-content:space-between;gap:16px;padding-top:28px;margin-bottom:14px}
.mcpp-titles h1{margin:0;font-size:20px;font-weight:600;letter-spacing:-.01em}
.mcpp-subtitle{color:var(--dsw-alias-label-secondary);font-size:13px;margin-top:2px}
.mcpp-refresh{display:flex;align-items:center;gap:6px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font-size:13px;padding:6px 14px;border-radius:8px;cursor:pointer}
.mcpp-refresh:hover{background:var(--dsw-alias-bg-layer-2)}
.mcpp-refresh:disabled{opacity:.6;cursor:default}
.mcpp-list{display:flex;flex-direction:column;gap:12px}
.mcpp-card{border:1px solid var(--dsw-alias-border-l1);border-radius:12px;background:var(--dsw-alias-bg-layer-1);padding:14px 18px}
.mcpp-cardHead{display:flex;align-items:flex-start;gap:12px}
.mcpp-name{font-size:15px;font-weight:600;font-variant-numeric:tabular-nums}
.mcpp-badges{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:3px}
.mcpp-badge{display:inline-flex;align-items:center;gap:5px;border:1px solid var(--dsw-alias-border-l1);border-radius:999px;padding:0 10px;background:var(--dsw-alias-bg-layer-2);font-size:11.5px;color:var(--dsw-alias-label-secondary);line-height:20px;white-space:nowrap}
.mcpp-dot{width:7px;height:7px;border-radius:50%;flex:none}
.mcpp-spacer{flex:1}
.mcpp-switch{position:relative;flex:none;width:38px;height:22px;border-radius:11px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);cursor:pointer;padding:0;transition:background .15s ease,border-color .15s ease}
.mcpp-switchOn{background:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary)}
.mcpp-switch:disabled{opacity:.45;cursor:default}
.mcpp-switch:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}
.mcpp-knob{position:absolute;top:2px;left:2px;width:16px;height:16px;border-radius:50%;background:var(--dsw-alias-bg-base);border:1px solid var(--dsw-alias-border-l2);transition:transform .15s ease}
.mcpp-switchOn .mcpp-knob{transform:translateX(16px);border-color:transparent}
.mcpp-meta{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:10px;font-size:12.5px;color:var(--dsw-alias-label-secondary)}
.mcpp-mono{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12px;word-break:break-all;color:var(--dsw-alias-label-primary)}
.mcpp-state{margin-top:8px;font-size:12.5px;color:var(--dsw-alias-label-secondary)}
.mcpp-stateOk{color:var(--dsw-alias-state-success-primary)}
.mcpp-stateWarn{color:var(--dsw-alias-state-warn-primary)}
.mcpp-stateBad{color:var(--dsw-alias-state-error-primary)}
.mcpp-error{color:var(--dsw-alias-state-error-primary);font-size:13px;word-break:break-all}
.mcpp-errorPanel{border:1px solid var(--dsw-alias-border-l1);border-radius:12px;background:var(--dsw-alias-bg-layer-1);padding:16px 18px;margin-bottom:16px}
.mcpp-retry{margin-top:8px;border:1px solid var(--dsw-alias-border-l2);background:transparent;color:var(--dsw-alias-label-primary);font-size:12.5px;padding:3px 12px;border-radius:7px;cursor:pointer}
.mcpp-retry:hover{background:var(--dsw-alias-bg-layer-2)}
.mcpp-empty{padding:6px 2px;color:var(--dsw-alias-label-secondary);font-size:13px}
.mcpp-note{margin:18px 0 0;font-size:12px;color:var(--dsw-alias-label-secondary);line-height:1.7}
.mcpp-spin{animation:mcpp-rotate .9s linear infinite}
@keyframes mcpp-rotate{to{transform:rotate(360deg)}}
`

    // ------------------------------------------------------------------
    // Small pieces
    // ------------------------------------------------------------------

    function cls(...names) {
      return names.filter(Boolean).join(' ')
    }

    function RefreshGlyph({ spinning }) {
      return h('svg', {
        viewBox: '0 0 24 24', width: 14, height: 14, fill: 'none', stroke: 'currentColor',
        strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true,
        className: spinning ? 'mcpp-spin' : undefined,
      },
      h('path', { d: 'M21 12a9 9 0 1 1-2.64-6.36' }),
      h('polyline', { points: '21 3 21 9 15 9' }),
      )
    }

    /** Plug glyph for the sidebar rail. */
    function PanelIcon({ size }) {
      return h('svg', {
        viewBox: '0 0 24 24', width: size, height: size, fill: 'none', stroke: 'currentColor',
        strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true,
      },
      h('path', { d: 'M12 22v-5' }),
      h('path', { d: 'M9 8V2' }),
      h('path', { d: 'M15 8V2' }),
      h('path', { d: 'M18 8v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8Z' }),
      )
    }

    function Badge({ tone, children }) {
      const color = tone === 'ok'
        ? 'var(--dsw-alias-state-success-primary)'
        : tone === 'warn'
          ? 'var(--dsw-alias-state-warn-primary)'
          : tone === 'bad'
            ? 'var(--dsw-alias-state-error-primary)'
            : 'var(--dsw-alias-label-secondary)'
      return h('span', { className: 'mcpp-badge' },
        h('span', { className: 'mcpp-dot', style: { background: color } }),
        children,
      )
    }

    /** Human text for one ChangeResult application outcome. */
    function applicationText(payload, t) {
      switch (payload?.application) {
        case 'applied': return t('appliedText')
        case 'restart-required': return t('restartRequired')
        case 'overridden': return t('overriddenText')
        case 'cancelled': return t('cancelledText')
        default: {
          if (payload?.error?.code === 'unknown-plugin') return t('unknownRow')
          const code = payload?.error?.code ?? ''
          const diagnostic = payload?.error?.diagnostic ?? ''
          const detail = diagnostic !== '' ? diagnostic : code
          return detail === '' ? t('failedText') : `${t('failedText')}：${detail}`
        }
      }
    }

    // ------------------------------------------------------------------
    // Server card
    // ------------------------------------------------------------------

    function ServerCard({ server, t, busy, result, managerAvailable, onToggle }) {
      const on = server.disabled !== true
      const name = server.serverName !== '' ? server.serverName : server.id
      const badges = []
      badges.push(on ? h(Badge, { key: 'desired', tone: 'ok' }, t('enabled')) : h(Badge, { key: 'desired', tone: 'off' }, t('disabled')))
      if (server.configOk) {
        badges.push(server.live ? h(Badge, { key: 'live', tone: 'ok' }, t('live')) : h(Badge, { key: 'live', tone: 'warn' }, t('notLive')))
        badges.push(h('span', { key: 'transport', className: 'mcpp-badge' },
          server.transport === 'stdio' ? t('stdioLabel') : t('httpLabel')))
        if (typeof server.toolCallTimeoutMs === 'number' && server.toolCallTimeoutMs > 0) {
          badges.push(h('span', { key: 'timeout', className: 'mcpp-badge' },
            t('timeout', { n: Math.round(server.toolCallTimeoutMs / 1000) })))
        }
      }

      let stateLine = null
      if (!server.configOk) stateLine = h('div', { className: 'mcpp-state mcpp-stateWarn' }, t('configBad'))
      else if (!on) stateLine = h('div', { className: 'mcpp-state' }, t('hiddenWhenDisabled'))
      else if (server.tools > 0) stateLine = h('div', { className: 'mcpp-state mcpp-stateOk' }, t('toolsVisible', { n: server.tools }))
      else stateLine = h('div', { className: 'mcpp-state' }, t('toolsNone'))

      const resultLine = result === undefined ? null : h('div', {
        className: cls('mcpp-state', result.ok ? 'mcpp-stateOk' : 'mcpp-stateBad'),
      }, result.text)

      return h('div', { className: 'mcpp-card' },
        h('div', { className: 'mcpp-cardHead' },
          h('div', { style: { minWidth: 0 } },
            h('div', { className: 'mcpp-name' }, name),
            h('div', { className: 'mcpp-badges' }, badges),
          ),
          h('div', { className: 'mcpp-spacer' }),
          h('button', {
            className: cls('mcpp-switch', on && 'mcpp-switchOn'),
            role: 'switch',
            'aria-checked': on,
            'aria-label': name,
            disabled: busy || !managerAvailable || !server.configOk,
            title: !managerAvailable ? t('managerMissing') : undefined,
            onClick: () => onToggle(server, !on),
          }, h('span', { className: 'mcpp-knob' })),
        ),
        h('div', { className: 'mcpp-meta' },
          h('span', null, `${t('entryId')}:`),
          h('span', { className: 'mcpp-mono' }, server.id),
        ),
        server.target !== ''
          ? h('div', { className: 'mcpp-meta' }, h('span', { className: 'mcpp-mono' }, server.target))
          : null,
        stateLine,
        resultLine,
      )
    }

    // ------------------------------------------------------------------
    // Page
    // ------------------------------------------------------------------

    function McpPanelPage(props) {
      const { query, toggle, t } = props
      const [data, setData] = useState(null)
      const [error, setError] = useState(null)
      const [loading, setLoading] = useState(true)
      const [busyId, setBusyId] = useState(null)
      const [results, setResults] = useState({})
      const alive = useRef(true)

      useEffect(() => () => { alive.current = false }, [])

      const run = useCallback(async () => {
        setLoading(true)
        setError(null)
        try {
          const payload = await query()
          if (payload?.servers === undefined) throw new Error(payload?.error || '空响应')
          if (alive.current) setData(payload)
        } catch (cause) {
          if (alive.current) setError(String(cause?.message || cause))
        } finally {
          if (alive.current) setLoading(false)
        }
      }, [query])

      useEffect(() => { void run() }, [run])

      const onToggle = useCallback(async (server, enabled) => {
        setBusyId(server.id)
        try {
          const payload = await toggle(server.id, enabled)
          if (alive.current) {
            setResults(current => ({
              ...current,
              [server.id]: { ok: payload?.ok === true, text: applicationText(payload, t) },
            }))
          }
        } catch (cause) {
          if (alive.current) {
            setResults(current => ({
              ...current,
              [server.id]: { ok: false, text: `${t('failedText')}：${String(cause?.message || cause)}` },
            }))
          }
        } finally {
          if (alive.current) setBusyId(null)
          void run()
        }
      }, [toggle, t, run])

      const servers = data?.servers ?? []

      return h('section', { className: 'mcpp-page', 'aria-label': t('title') },
        h('style', null, STYLE),
        h('div', { className: 'mcpp-scroll' },
          h('div', { className: 'mcpp-content' },
            h('div', { className: 'mcpp-heading' },
              h('div', { className: 'mcpp-titles' },
                h('h1', null, t('title')),
                h('div', { className: 'mcpp-subtitle' }, t('subtitle')),
              ),
              h('button', {
                className: 'mcpp-refresh', onClick: () => { void run() }, disabled: loading,
              }, h(RefreshGlyph, { spinning: loading }), t('refresh')),
            ),
            error !== null
              ? h('div', { className: 'mcpp-errorPanel' },
                h('div', { className: 'mcpp-error' }, `${t('loadError')}：${error}`),
                h('button', { className: 'mcpp-retry', onClick: () => { void run() } }, t('retry')),
              )
              : null,
            error === null && data !== null && servers.length === 0
              ? h('div', { className: 'mcpp-empty' }, t('empty'))
              : null,
            h('div', { className: 'mcpp-list' },
              servers.map(server => h(ServerCard, {
                key: server.id,
                server,
                t,
                busy: busyId === server.id,
                result: results[server.id],
                managerAvailable: data?.managerAvailable === true,
                onToggle,
              })),
            ),
            data !== null && data.patchPath
              ? h('p', { className: 'mcpp-note' },
                `${t('patchSource')}: `,
                h('span', { className: 'mcpp-mono' }, data.patchPath),
                h('br'),
                t('note'),
              )
              : null,
          ),
        ),
      )
    }

    // ------------------------------------------------------------------
    // Plugin registration
    // ------------------------------------------------------------------

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.effect(
          () => ctx.locale.register('mcpPanel', { zh, en }),
          'dsh-mcp-panel: dictionaries',
        )
        const t = ctx.locale.bind('mcpPanel')

        /** Snapshot the Host route: patch-declared MCP rows plus live state. */
        const query = async () => {
          const response = await fetch('/api/dsh-mcp-panel/query', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: '{}',
          })
          if (!response.ok) throw new Error(`HTTP ${response.status}`)
          return response.json()
        }

        /** Toggle one patch row through the Host route into the plugin manager. */
        const toggle = async (id, enabled) => {
          const response = await fetch('/api/dsh-mcp-panel/set', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id, enabled }),
          })
          const payload = await response.json().catch(() => null)
          if (!response.ok) {
            throw new Error(payload?.error?.diagnostic || payload?.error?.code || `HTTP ${response.status}`)
          }
          return payload
        }

        // The sidebar row directly below the Plugins entry (plugins=0, this
        // row=1, quota=5, usage=6, schedules=10).
        ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
          name: 'sidebar.panellist',
          id: 'mcp-panel',
          order: 1,
          locale: 'mcpPanel',
          label: () => t('panel'),
        }, PanelIcon))

        // The main-column panel the row selects.
        ctx.slots.inject('main', () => ctx.slots.register({
          name: 'main',
          key: 'mcp-panel',
          locale: 'mcpPanel',
          inject: () => ({ query, toggle }),
        }, McpPanelPage))
      },
    }
  },
})
