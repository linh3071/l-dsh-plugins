// Browser half of the dsh-quota-dashboard bundle: the sidebar entry below the
// Plugins row and the cc-switch style quota panel it opens in the main column.
//
// The panel queries the bundle's Host half over the shared /api channel; the
// Host owns the API keys and returns only normalized quota data. All colors
// come from --dsw-alias-* theme tokens so the panel follows light/dark themes.
/* global window, document */

window.__ModuleLoader__.load({
  id: '@local/dsh-quota-dashboard',
  factory(require) {
    const React = require('react')
    const { useState, useEffect, useRef, useCallback } = React
    const h = React.createElement

    /**
     * Card chrome per protocol: brand block color and the name shown when no
     * provider is resolved yet. The card title itself is the provider id the
     * Host resolved from the profile patch; no badge tags are rendered.
     */
    const PLATFORM_META = {
      minimax: { name: 'minimax', color: '#F5533D' },
      deepseek: { name: 'deepseek', color: '#4D6BFE' },
      glm: { name: 'glm', color: '#3859FF' },
      sub2api: { name: 'sub2api', color: '#8B5CF6' },
    }

    // ------------------------------------------------------------------
    // Locale
    // ------------------------------------------------------------------

    const zh = {
      'panel': '额度面板',
      'title': '额度面板',
      'subtitle': '各 provider 套餐配额与账户余额',
      'refreshAll': '全部刷新',
      'refresh': '刷新',
      'retry': '重试',
      'loading': '查询中…',
      'expand': '展开明细',
      'collapse': '收起明细',
      'notConfigured': '未找到可用的 Provider 配置',
      'notConfiguredHint': '请确认 profile patch(cordis.patch.yml)中存在对应 provider,且其 apiKeyEnv 在 ~/.dsh/.credentials.yaml 的 refs 中有值,然后点击重试。',
      'justNow': '刚刚',
      'minutesAgo': '{count} 分钟前',
      'hoursAgo': '{count} 小时前',
    }

    const en = {
      'panel': 'Usage Dashboard',
      'title': 'Usage Dashboard',
      'subtitle': 'Plan quotas and account balance across providers',
      'refreshAll': 'Refresh all',
      'refresh': 'Refresh',
      'retry': 'Retry',
      'loading': 'Querying…',
      'expand': 'Show details',
      'collapse': 'Hide details',
      'notConfigured': 'No usable provider configuration',
      'notConfiguredHint': 'Ensure the profile patch (cordis.patch.yml) declares a matching provider and its apiKeyEnv has a value under refs in ~/.dsh/.credentials.yaml, then retry.',
      'justNow': 'just now',
      'minutesAgo': '{count} min ago',
      'hoursAgo': '{count} h ago',
    }

    // ------------------------------------------------------------------
    // Styles (component-owned; removed with the panel)
    // ------------------------------------------------------------------

    const STYLE = `
.udash-page{display:flex;width:100%;height:100%;min-width:0;min-height:0;overflow:hidden;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-base);font-size:14px;line-height:1.6}
.udash-scroll{flex:1;min-height:0;overflow:auto;scrollbar-gutter:stable}
.udash-content{max-width:960px;margin:0 auto;padding:0 clamp(24px,4vw,48px) 48px}
.udash-heading{display:flex;align-items:center;justify-content:space-between;gap:16px;padding-top:28px;margin-bottom:18px}
.udash-titles h1{margin:0;font-size:20px;font-weight:600;letter-spacing:-.01em}
.udash-subtitle{color:var(--dsw-alias-label-secondary);font-size:13px;margin-top:2px}
.udash-refreshAll{display:flex;align-items:center;gap:6px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font-size:13px;padding:6px 14px;border-radius:8px;cursor:pointer}
.udash-refreshAll:hover{background:var(--dsw-alias-bg-layer-2)}
.udash-refreshAll:disabled{opacity:.6;cursor:default}
.udash-list{display:flex;flex-direction:column;gap:12px}
.udash-card{border:1px solid var(--dsw-alias-border-l1);border-radius:12px;background:var(--dsw-alias-bg-layer-1);transition:border-color .15s ease}
.udash-card:hover{border-color:var(--dsw-alias-border-l2)}
.udash-cardExpanded{border-color:var(--dsw-alias-brand-primary)}
.udash-row{display:flex;align-items:center;gap:14px;padding:14px 18px;cursor:pointer;user-select:none}
.udash-row:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px;border-radius:12px}
.udash-icon{width:40px;height:40px;border-radius:10px;display:flex;align-items:center;justify-content:center;flex:none;color:#fff}
.udash-letter{font-size:17px;font-weight:700;line-height:1}
.udash-main{flex:1;min-width:0}
.udash-nameRow{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.udash-name{font-size:15px;font-weight:600}
.udash-domain{font-size:12.5px;color:var(--dsw-alias-brand-primary);margin-top:1px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.udash-right{display:flex;flex-direction:column;align-items:flex-end;gap:3px;flex:none}
.udash-summary{display:flex;gap:14px;font-size:13px;flex-wrap:wrap;justify-content:flex-end}
.udash-line{display:flex;align-items:baseline;gap:4px;white-space:nowrap}
.udash-lineLabel{color:var(--dsw-alias-label-secondary)}
.udash-reset{color:var(--dsw-alias-label-secondary);font-size:11.5px}
.udash-meta{display:flex;align-items:center;gap:6px;font-size:12px;color:var(--dsw-alias-label-secondary)}
.udash-iconBtn{display:flex;align-items:center;justify-content:center;border:none;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;padding:3px;border-radius:6px}
.udash-iconBtn:hover{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-2)}
.udash-iconBtn:disabled{cursor:default;opacity:.7}
.udash-spin{animation:udash-rotate .9s linear infinite}
@keyframes udash-rotate{to{transform:rotate(360deg)}}
.udash-detail{border-top:1px solid var(--dsw-alias-border-l1);padding:12px 18px 14px}
.udash-section+.udash-section{margin-top:14px}
.udash-caption{caption-side:top;text-align:left;font-size:12.5px;color:var(--dsw-alias-label-secondary);padding-bottom:6px}
.udash-table{width:100%;border-collapse:collapse;font-size:13px}
.udash-table th{text-align:left;color:var(--dsw-alias-label-secondary);font-weight:500;padding:4px 12px 4px 0;border-bottom:1px solid var(--dsw-alias-border-l1);white-space:nowrap}
.udash-table td{padding:5px 12px 5px 0;border-bottom:1px solid var(--dsw-alias-border-l1)}
.udash-table tr:last-child td{border-bottom:none}
.udash-note{margin:10px 0 0;font-size:12.5px;color:var(--dsw-alias-label-secondary)}
.udash-error{color:var(--dsw-alias-state-error-primary);font-size:13px;word-break:break-all}
.udash-retry{margin-top:8px;border:1px solid var(--dsw-alias-border-l2);background:transparent;color:var(--dsw-alias-label-primary);font-size:12.5px;padding:3px 12px;border-radius:7px;cursor:pointer}
.udash-retry:hover{background:var(--dsw-alias-bg-layer-2)}
.udash-tone-ok{color:var(--dsw-alias-state-success-primary)}
.udash-tone-warn{color:var(--dsw-alias-state-warn-primary)}
.udash-tone-bad{color:var(--dsw-alias-state-error-primary)}
.udash-tone-neutral{color:var(--dsw-alias-label-primary)}
.udash-empty{padding:8px 2px 2px;color:var(--dsw-alias-label-secondary);font-size:13px}
`

    // ------------------------------------------------------------------
    // Small pieces
    // ------------------------------------------------------------------

    function cls(...names) {
      return names.filter(Boolean).join(' ')
    }

    function relativeTime(ms, now, t) {
      const delta = Math.max(0, now - ms)
      if (delta < 60_000) return t('justNow')
      if (delta < 3_600_000) return t('minutesAgo', { count: Math.floor(delta / 60_000) })
      if (delta < 86_400_000) return t('hoursAgo', { count: Math.floor(delta / 3_600_000) })
      return new Intl.DateTimeFormat('zh-CN', {
        timeZone: 'Asia/Shanghai', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
      }).format(new Date(ms))
    }

    /** Compact countdown such as `6d` or `2h40m`; null once the reset passed. */
    function countdown(resetAt, now) {
      if (typeof resetAt !== 'number' || resetAt <= now) return null
      const minutes = Math.ceil((resetAt - now) / 60_000)
      if (minutes < 60) return `${minutes}m`
      const hours = Math.floor(minutes / 60)
      if (hours < 24) return minutes % 60 === 0 ? `${hours}h` : `${hours}h${minutes % 60}m`
      return `${Math.floor(hours / 24)}d`
    }

    function RefreshGlyph({ spinning }) {
      return h('svg', {
        viewBox: '0 0 24 24', width: 14, height: 14, fill: 'none', stroke: 'currentColor',
        strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true,
        className: spinning ? 'udash-spin' : undefined,
      },
      h('path', { d: 'M21 12a9 9 0 1 1-2.64-6.36' }),
      h('polyline', { points: '21 3 21 9 15 9' }),
      )
    }

    /** Gauge glyph for the sidebar rail; stroke follows the row color. */
    function PanelIcon({ size }) {
      return h('svg', {
        viewBox: '0 0 24 24', width: size, height: size, fill: 'none', stroke: 'currentColor',
        strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true,
      },
      h('path', { d: 'M3.3 19a10 10 0 1 1 17.4 0' }),
      h('path', { d: 'M12 14l3.6-4.4' }),
      h('circle', { cx: 12, cy: 14, r: 1.4, fill: 'currentColor', stroke: 'none' }),
      )
    }

    // ------------------------------------------------------------------
    // Card
    // ------------------------------------------------------------------

    function summaryLines(data, now) {
      const lines = Array.isArray(data?.summary) ? data.summary : []
      const visible = lines.slice(0, 3)
      return h('div', { className: 'udash-summary' }, visible.map((line, index) => {
        const reset = countdown(line.resetAt, now)
        return h('span', { className: 'udash-line', key: `${line.label}-${index}` },
          h('span', { className: 'udash-lineLabel' }, `${line.label}:`),
          h('span', { className: `udash-tone-${line.tone || 'neutral'}` }, line.value),
          reset !== null ? h('span', { className: 'udash-reset' }, reset) : null,
        )
      }))
    }

    function detailTables(data) {
      const sections = Array.isArray(data?.sections) ? data.sections : []
      return h('div', null, sections.map((section, sectionIndex) => h('div', { className: 'udash-section', key: sectionIndex },
        h('table', { className: 'udash-table' },
          h('caption', { className: 'udash-caption' }, section.title),
          h('thead', null, h('tr', null, (section.head || []).map((cell, index) => h('th', { key: index }, cell)))),
          h('tbody', null, (section.rows || []).map((row, rowIndex) => h('tr', { key: rowIndex },
            (row.cells || []).map((cell, index) => h('td', {
              key: index,
              className: row.tones?.[index] ? `udash-tone-${row.tones[index]}` : undefined,
            }, cell)),
          ))),
        ),
      )))
    }

    function PlatformCard({ stateKey, state, expanded, onToggle, onRefresh, t, now }) {
      const platform = state?.data?.platform ?? state?.platform ?? stateKey
      const meta = PLATFORM_META[platform] ?? { name: stateKey, color: '#64748B' }
      const ready = state.phase === 'ready' ? state.data : null
      const loading = state.phase === 'loading'
      // The card title is the provider id the Host resolved from the patch;
      // the protocol name only stands in before the first successful query.
      const displayName = (ready?.provider ?? state.provider ?? meta.name).trim() || stateKey

      const onKeyDown = event => {
        if (event.key !== 'Enter' && event.key !== ' ') return
        event.preventDefault()
        onToggle()
      }

      return h('div', { className: cls('udash-card', expanded && ready && 'udash-cardExpanded') },
        h('div', {
          className: 'udash-row', role: 'button', tabIndex: 0,
          'aria-expanded': expanded && ready ? 'true' : 'false',
          'aria-label': `${displayName} ${expanded && ready ? t('collapse') : t('expand')}`,
          onClick: onToggle, onKeyDown,
        },
        h('div', { className: 'udash-icon', style: { background: meta.color }, 'aria-hidden': true },
          h('span', { className: 'udash-letter' }, displayName.charAt(0).toUpperCase()),
        ),
        h('div', { className: 'udash-main' },
          h('div', { className: 'udash-nameRow' },
            h('span', { className: 'udash-name' }, displayName),
          ),
        ),
        h('div', { className: 'udash-right' },
          ready !== null ? summaryLines(ready, now) : null,
          h('div', { className: 'udash-meta' },
            ready !== null ? h('span', null, relativeTime(ready.fetchedAt, now, t)) : null,
            ready !== null && ready.status?.kind === 'unavailable'
              ? h('span', { className: 'udash-tone-bad' }, '●') : null,
            h('button', {
              className: 'udash-iconBtn', disabled: loading,
              'aria-label': t('refresh'), title: t('refresh'),
              onClick: event => { event.stopPropagation(); onRefresh() },
            }, h(RefreshGlyph, { spinning: loading })),
          ),
        ),
        ),
        loading && ready === null
          ? h('div', { className: 'udash-detail' }, h('span', { className: 'udash-empty' }, t('loading')))
          : null,
        state.phase === 'error'
          ? h('div', { className: 'udash-detail' },
            h('div', { className: 'udash-error' },
              state.code === 'not_configured' ? `${t('notConfigured')}:${state.error}` : state.error),
            state.code === 'not_configured'
              ? h('p', { className: 'udash-note' }, t('notConfiguredHint')) : null,
            h('button', { className: 'udash-retry', onClick: onRefresh }, t('retry')),
          )
          : null,
        expanded && ready !== null
          ? h('div', { className: 'udash-detail' },
            detailTables(ready),
            ready.conclusion ? h('p', { className: 'udash-note' }, ready.conclusion) : null,
          )
          : null,
      )
    }

    // ------------------------------------------------------------------
    // Page
    // ------------------------------------------------------------------

    /**
     * The quota panel: one card per provider the Host resolved from the
     * profile patch, independent refresh per card, a refresh-all action, and
     * expandable detail tables. Card state is keyed by provider id and the
     * list exists only after the first full query (before it, a loading
     * placeholder).
     */
    function UsagePage(props) {
      const { query, t } = props
      const [states, setStates] = useState(null)
      const [loadError, setLoadError] = useState(null)
      const [expanded, setExpanded] = useState(() => ({}))
      const [now, setNow] = useState(() => Date.now())
      const [refreshingAll, setRefreshingAll] = useState(false)
      const alive = useRef(true)
      const statesRef = useRef(states)
      statesRef.current = states

      useEffect(() => () => { alive.current = false }, [])

      // One slow clock keeps the "n minutes ago" labels and countdowns honest.
      useEffect(() => {
        const timer = window.setInterval(() => { if (alive.current) setNow(Date.now()) }, 30_000)
        return () => { window.clearInterval(timer) }
      }, [])

      const refreshAll = useCallback(async () => {
        if (!alive.current) return
        setRefreshingAll(true)
        setLoadError(null)
        try {
          const payload = await query()
          const results = payload?.results
          if (!Array.isArray(results)) throw new Error(payload?.error || '空响应')
          if (!alive.current) return
          const next = {}
          for (const result of results) {
            next[result.key] = result.ok
              ? { phase: 'ready', data: result }
              : { phase: 'error', platform: result.platform, provider: result.provider, code: result.code, error: result.message }
          }
          setStates(next)
        } catch (error) {
          if (alive.current) setLoadError(String(error?.message || error))
        } finally {
          if (alive.current) setRefreshingAll(false)
        }
      }, [query])

      const refreshOne = useCallback(async key => {
        if (!alive.current) return
        const platform = statesRef.current?.[key]?.platform
        setStates(previous => ({ ...(previous ?? {}), [key]: { phase: 'loading', platform } }))
        let outcome
        try {
          const payload = await query(key)
          const result = payload?.results?.[0]
          outcome = result === undefined
            ? { phase: 'error', platform, code: 'internal', error: '空响应' }
            : result.ok
              ? { phase: 'ready', data: result }
              : { phase: 'error', platform: result.platform, provider: result.provider, code: result.code, error: result.message }
        } catch (error) {
          outcome = { phase: 'error', platform, code: 'network', error: String(error?.message || error) }
        }
        if (alive.current) setStates(previous => ({ ...(previous ?? {}), [key]: outcome }))
      }, [query])

      const started = useRef(false)
      useEffect(() => {
        if (started.current) return
        started.current = true
        void refreshAll()
      }, [refreshAll])

      const toggle = useCallback(key => {
        setExpanded(previous => ({ ...previous, [key]: !previous[key] }))
      }, [])

      const entries = states === null ? [] : Object.entries(states)

      return h('section', { className: 'udash-page', 'aria-label': t('title') },
        h('style', null, STYLE),
        h('div', { className: 'udash-scroll' },
          h('div', { className: 'udash-content' },
            h('div', { className: 'udash-heading' },
              h('div', { className: 'udash-titles' },
                h('h1', null, t('title')),
                h('div', { className: 'udash-subtitle' }, t('subtitle')),
              ),
              h('button', {
                className: 'udash-refreshAll', onClick: () => { void refreshAll() }, disabled: refreshingAll,
              }, h(RefreshGlyph, { spinning: refreshingAll }), t('refreshAll')),
            ),
            loadError !== null
              ? h('div', { className: 'udash-card' },
                h('div', { className: 'udash-detail' },
                  h('div', { className: 'udash-error' }, loadError),
                  h('button', { className: 'udash-retry', onClick: () => { void refreshAll() } }, t('retry')),
                ),
              )
              : null,
            h('div', { className: 'udash-list' },
              entries.length === 0 && loadError === null
                ? h('div', { className: 'udash-empty' }, t('loading'))
                : entries.map(([key, state]) => h(PlatformCard, {
                  key,
                  stateKey: key,
                  state,
                  expanded: expanded[key] === true,
                  onToggle: () => { toggle(key) },
                  onRefresh: () => { void refreshOne(key) },
                  t,
                  now,
                })),
            ),
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
          () => ctx.locale.register('quotaDashboard', { zh, en }),
          'dsh-quota-dashboard: dictionaries',
        )
        const t = ctx.locale.bind('quotaDashboard')

        /** Query the Host route for one platform (or all when omitted). */
        const query = async platformId => {
          const response = await fetch('/api/dsh-quota-dashboard/query', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(platformId === undefined ? {} : { key: platformId }),
          })
          if (!response.ok) throw new Error(`HTTP ${response.status}`)
          return response.json()
        }

        // The sidebar row below the Plugins entry (plugins=0, schedules=10).
        ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
          name: 'sidebar.panellist',
          id: 'quota-dashboard',
          order: 5,
          locale: 'quotaDashboard',
          label: () => t('panel'),
        }, PanelIcon))

        // The main-column panel the row selects.
        ctx.slots.inject('main', () => ctx.slots.register({
          name: 'main',
          key: 'quota-dashboard',
          locale: 'quotaDashboard',
          inject: () => ({ query }),
        }, UsagePage))
      },
    }
  },
})
