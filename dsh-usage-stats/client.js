// Browser half of the dsh-usage-stats bundle: the sidebar entry below the
// quota panel row and the statistics page it opens in the main column.
//
// The page queries the bundle's Host half over the shared /api channel; the
// Host scans the local session logs and returns folded aggregates. Preset
// range bounds (today / 7d / 30d) are computed here in browser-local time and
// sent explicitly. All chrome colors come from --dsw-alias-* theme tokens so
// the page follows light/dark themes; heatmap cells mix the success token.
/* global window, document */

window.__ModuleLoader__.load({
  id: '@local/dsh-usage-stats',
  factory(require) {
    const React = require('react')
    const { useState, useEffect, useRef, useCallback, useMemo } = React
    const h = React.createElement

    // ------------------------------------------------------------------
    // Locale
    // ------------------------------------------------------------------

    const zh = {
      'panel': '用量统计',
      'title': '用量统计',
      'subtitle': '会话日志中的 token 用量：provider 上报优先，缺失时按 DSH 启发式估算',
      'refresh': '刷新',
      'retry': '重试',
      'loading': '统计中…',
      'groupLabel': '分组',
      'groupProvider': 'Provider',
      'groupModel': 'Provider / 模型',
      'rangeLabel': '范围',
      'today': '今天',
      'last7d': '7 天',
      'last30d': '30 天',
      'custom': '自定义',
      'requests': '请求数',
      'inputTokens': '输入（未缓存）',
      'cacheRead': '缓存读',
      'cacheWrite': '缓存写',
      'outputTokens': '输出',
      'totalTokens': '合计',
      'sessions': '会话数',
      'cacheHitRate': '缓存命中率',
      'badgeReported': '真实上报',
      'badgeEstimated': '估算',
      'retiredTag': '已移除',
      'retiredHint': '该 provider 已不在当前可用列表中，仅历史会话使用过',
      'retiredNote': '「已移除」= 该 provider 已不在当前 LLM 可用列表中（以当前配置为准），其数字仅为历史消耗。',
      'totalFormulaTitle': '合计 = 输入(未缓存) {input} + 缓存读 {cacheRead} + 缓存写 {cacheWrite} + 输出 {output}；输入+输出 与 合计 的差额即 provider 报告的缓存部分。',
      'cacheHitRateHint': '缓存命中率 = 缓存读 ÷ (输入(未缓存) + 缓存读 + 缓存写)。',
      'heatTitle': '近 52 周 · 合计 {total} tokens',
      'less': '少',
      'more': '多',
      'groupTableTitle': '分组明细',
      'colGroup': '分组',
      'colProvider': 'Provider',
      'colModel': '模型',
      'colShare': '占比',
      'empty': '所选范围内没有可统计的用量记录',
      'loadError': '加载失败',
      'auxTitle': '标题请求',
      'auxSearch': '搜索请求',
      'coverage': '数据覆盖',
      'scanned': '扫描',
      'logUnit': '个日志',
      'caliberNote': '口径：每条助手结算计 1 次请求；llm 重试与标题/搜索等辅助 LLM 请求的消耗未计入；按天分桶固定 UTC+8；估算按 DSH token-meter 启发式（4 字符 ≈ 1 token），输入（未缓存）为 provider 报告的未命中缓存部分；合计含缓存读/写，故 输入+输出 ≠ 合计。',
      'weekdayMon': '周一',
      'weekdayWed': '周三',
      'weekdayFri': '周五',
      'intlLocale': 'zh-CN',
    }

    const en = {
      'panel': 'Usage Stats',
      'title': 'Usage Stats',
      'subtitle': 'Token usage from session logs: provider-reported first, heuristic fallback',
      'refresh': 'Refresh',
      'retry': 'Retry',
      'loading': 'Crunching…',
      'groupLabel': 'Group',
      'groupProvider': 'Provider',
      'groupModel': 'Provider / Model',
      'rangeLabel': 'Range',
      'today': 'Today',
      'last7d': '7 days',
      'last30d': '30 days',
      'custom': 'Custom',
      'requests': 'Requests',
      'inputTokens': 'Input (uncached)',
      'cacheRead': 'Cache read',
      'cacheWrite': 'Cache write',
      'outputTokens': 'Output',
      'totalTokens': 'Total',
      'sessions': 'Sessions',
      'cacheHitRate': 'Cache hit',
      'badgeReported': 'reported',
      'badgeEstimated': 'estimated',
      'retiredTag': 'Removed',
      'retiredHint': 'This provider is no longer in the current provider list; only historical sessions used it.',
      'retiredNote': '"Removed" = the provider is absent from the current LLM provider list (current configuration); its numbers are historical usage only.',
      'totalFormulaTitle': 'Total = input (uncached) {input} + cache read {cacheRead} + cache write {cacheWrite} + output {output}; the gap between input+output and total is the provider-reported cache traffic.',
      'cacheHitRateHint': 'Cache hit rate = cache read ÷ (input (uncached) + cache read + cache write).',
      'heatTitle': 'Last 52 weeks · {total} tokens',
      'less': 'Less',
      'more': 'More',
      'groupTableTitle': 'Breakdown',
      'colGroup': 'Group',
      'colProvider': 'Provider',
      'colModel': 'Model',
      'colShare': 'Share',
      'empty': 'No usage records in the selected range',
      'loadError': 'Failed to load',
      'auxTitle': 'Title requests',
      'auxSearch': 'Search requests',
      'coverage': 'Coverage',
      'scanned': 'Scanned',
      'logUnit': 'logs',
      'caliberNote': 'Method: one request per assistant settlement; retries and auxiliary LLM calls (titles, search) are not priced; days are bucketed at UTC+8; estimates follow the DSH token-meter heuristic (4 chars ≈ 1 token); input (uncached) is the provider-reported uncached prompt part; totals include cache traffic, so input+output ≠ total.',
      'weekdayMon': 'Mon',
      'weekdayWed': 'Wed',
      'weekdayFri': 'Fri',
      'intlLocale': 'en-US',
    }

    // ------------------------------------------------------------------
    // Styles (component-owned; removed with the panel)
    // ------------------------------------------------------------------

    const STYLE = `
.ustats-page{display:flex;width:100%;height:100%;min-width:0;min-height:0;overflow:hidden;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-base);font-size:14px;line-height:1.6}
.ustats-scroll{flex:1;min-height:0;overflow:auto;scrollbar-gutter:stable}
.ustats-content{max-width:1060px;margin:0 auto;padding:0 clamp(24px,4vw,48px) 48px}
.ustats-heading{display:flex;align-items:center;justify-content:space-between;gap:16px;padding-top:28px;margin-bottom:14px}
.ustats-titles h1{margin:0;font-size:20px;font-weight:600;letter-spacing:-.01em}
.ustats-subtitle{color:var(--dsw-alias-label-secondary);font-size:13px;margin-top:2px}
.ustats-refreshAll{display:flex;align-items:center;gap:6px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font-size:13px;padding:6px 14px;border-radius:8px;cursor:pointer}
.ustats-refreshAll:hover{background:var(--dsw-alias-bg-layer-2)}
.ustats-refreshAll:disabled{opacity:.6;cursor:default}
.ustats-controls{display:flex;align-items:center;gap:18px;flex-wrap:wrap;margin-bottom:14px}
.ustats-control{display:flex;align-items:center;gap:8px;font-size:13px;color:var(--dsw-alias-label-secondary)}
.ustats-select{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font-size:13px;padding:5px 10px;border-radius:8px;cursor:pointer}
.ustats-ranges{display:flex;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;overflow:hidden}
.ustats-rangeBtn{border:none;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary);font-size:13px;padding:5px 14px;cursor:pointer}
.ustats-rangeBtn+.ustats-rangeBtn{border-left:1px solid var(--dsw-alias-border-l2)}
.ustats-rangeBtn:hover{background:var(--dsw-alias-bg-layer-2)}
.ustats-rangeBtnActive{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font-weight:600}
.ustats-dateInput{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font-size:13px;padding:4px 8px;border-radius:8px;color-scheme:light dark}
.ustats-cards{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin-bottom:12px}
.ustats-card{border:1px solid var(--dsw-alias-border-l1);border-radius:12px;background:var(--dsw-alias-bg-layer-1);padding:11px 15px}
.ustats-cardLabel{font-size:12px;color:var(--dsw-alias-label-secondary);white-space:nowrap}
.ustats-cardValue{font-size:20px;font-weight:650;margin-top:2px;font-variant-numeric:tabular-nums;white-space:nowrap}
.ustats-badgeRow{display:flex;gap:8px;align-items:center;margin:0 0 16px;font-size:12px;color:var(--dsw-alias-label-secondary);flex-wrap:wrap}
.ustats-badge{display:inline-flex;align-items:center;gap:5px;border:1px solid var(--dsw-alias-border-l1);border-radius:999px;padding:1px 10px;background:var(--dsw-alias-bg-layer-1)}
.ustats-dot{width:7px;height:7px;border-radius:50%;flex:none}
.ustats-panel{border:1px solid var(--dsw-alias-border-l1);border-radius:12px;background:var(--dsw-alias-bg-layer-1);padding:16px 18px;margin-bottom:16px}
.ustats-panelTitle{font-size:14px;font-weight:600;margin:0 0 12px}
.ustats-heatWrap{overflow-x:auto;padding-bottom:2px}
.ustats-heatMonths{position:relative;height:17px;margin-left:40px}
.ustats-heatMonth{position:absolute;top:0;font-size:10.5px;color:var(--dsw-alias-label-secondary);white-space:nowrap}
.ustats-heat{display:flex;gap:6px}
.ustats-heatDays{display:grid;grid-template-rows:repeat(7,1fr);gap:3px;width:34px;flex:none;font-size:10px;color:var(--dsw-alias-label-secondary)}
.ustats-heatDays span{display:flex;align-items:center;white-space:nowrap}
.ustats-heatCols{display:flex;gap:3px;flex:1;min-width:0;aspect-ratio:52 / 7}
.ustats-heatCol{display:grid;grid-template-rows:repeat(7,1fr);gap:3px;flex:1;min-width:0}
.ustats-heatCell{width:100%;height:100%;border-radius:3px}
.ustats-heatCellFuture{visibility:hidden}
.ustats-heatLevel0{background:color-mix(in srgb,var(--dsw-alias-border-l2) 32%,var(--dsw-alias-bg-layer-1))}
.ustats-heatLevel1{background:color-mix(in srgb,var(--dsw-alias-state-success-primary) 30%,var(--dsw-alias-bg-layer-1))}
.ustats-heatLevel2{background:color-mix(in srgb,var(--dsw-alias-state-success-primary) 55%,var(--dsw-alias-bg-layer-1))}
.ustats-heatLevel3{background:color-mix(in srgb,var(--dsw-alias-state-success-primary) 78%,var(--dsw-alias-bg-layer-1))}
.ustats-heatLevel4{background:var(--dsw-alias-state-success-primary)}
.ustats-legend{display:flex;align-items:center;justify-content:flex-end;gap:4px;margin-top:10px;font-size:11px;color:var(--dsw-alias-label-secondary)}
.ustats-legendCell{width:11px;height:11px;border-radius:2.5px}
.ustats-tableWrap{overflow-x:auto}
.ustats-table{width:100%;border-collapse:collapse;font-size:13px}
.ustats-table th{text-align:left;color:var(--dsw-alias-label-secondary);font-weight:500;padding:4px 12px 4px 0;border-bottom:1px solid var(--dsw-alias-border-l1);white-space:nowrap}
.ustats-table td{padding:5px 12px 5px 0;border-bottom:1px solid var(--dsw-alias-border-l1);white-space:nowrap}
.ustats-table tr:last-child td{border-bottom:none}
.ustats-share{position:relative;min-width:130px}
.ustats-tagRetired{display:inline-block;margin-left:6px;padding:0 6px;border-radius:999px;background:var(--dsw-alias-label-secondary);color:var(--dsw-alias-bg-base);font-size:10px;line-height:16px;white-space:nowrap;vertical-align:1px}
.ustats-shareBar{position:absolute;top:7px;bottom:7px;left:0;border-radius:3px;background:color-mix(in srgb,var(--dsw-alias-state-success-primary) 62%,transparent)}
.ustats-shareText{position:relative;padding-left:4px;font-variant-numeric:tabular-nums}
.ustats-note{margin:4px 0 0;font-size:12px;color:var(--dsw-alias-label-secondary);line-height:1.7}
.ustats-error{color:var(--dsw-alias-state-error-primary);font-size:13px;word-break:break-all}
.ustats-retry{margin-top:8px;border:1px solid var(--dsw-alias-border-l2);background:transparent;color:var(--dsw-alias-label-primary);font-size:12.5px;padding:3px 12px;border-radius:7px;cursor:pointer}
.ustats-retry:hover{background:var(--dsw-alias-bg-layer-2)}
.ustats-empty{padding:6px 2px;color:var(--dsw-alias-label-secondary);font-size:13px}
.ustats-spin{animation:ustats-rotate .9s linear infinite}
@keyframes ustats-rotate{to{transform:rotate(360deg)}}
`

    // ------------------------------------------------------------------
    // Formatting helpers
    // ------------------------------------------------------------------

    function cls(...names) {
      return names.filter(Boolean).join(' ')
    }

    function pad2(value) {
      return String(value).padStart(2, '0')
    }

    function fmtInt(value) {
      return Number.isFinite(value) ? Math.round(value).toLocaleString('en-US') : '0'
    }

    function trim1(value) {
      const text = value.toFixed(1)
      return text.endsWith('.0') ? text.slice(0, -2) : text
    }

    /** Compact token figures: `912`, `45.2k`, `1.3M`, `2.1B`. */
    function fmtTokens(value) {
      if (!Number.isFinite(value)) return '0'
      if (value < 1000) return String(Math.round(value))
      if (value < 1_000_000) return `${trim1(value / 1000)}k`
      if (value < 1_000_000_000) return `${trim1(value / 1_000_000)}M`
      return `${trim1(value / 1_000_000_000)}B`
    }

    function fmtPercent(fraction) {
      if (!Number.isFinite(fraction)) return '—'
      return `${trim1(fraction * 100)}%`
    }

    // ------------------------------------------------------------------
    // Local-day helpers (preset ranges are computed in the browser locale)
    // ------------------------------------------------------------------

    const DAY_MS = 86_400_000

    function localDayStart(ms) {
      const date = new Date(ms)
      date.setHours(0, 0, 0, 0)
      return date.getTime()
    }

    function addDays(ms, days) {
      const date = new Date(ms)
      date.setDate(date.getDate() + days)
      return date.getTime()
    }

    function dateKey(ms) {
      const date = new Date(ms)
      return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`
    }

    function mondayOf(ms) {
      const date = new Date(ms)
      const shift = (date.getDay() + 6) % 7
      date.setDate(date.getDate() - shift)
      date.setHours(0, 0, 0, 0)
      return date.getTime()
    }

    /** UTC+8 calendar date, matching the Host's day bucketing, as YYYY-MM-DD. */
    function shanghaiDate(ms) {
      return new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
      }).format(new Date(ms))
    }

    /** Preset range bounds; `to` is exclusive. Null while custom input is incomplete. */
    function computeRange(range, customFrom, customTo) {
      const todayStart = localDayStart(Date.now())
      if (range === '7d') return { from: addDays(todayStart, -6), to: addDays(todayStart, 1) }
      if (range === '30d') return { from: addDays(todayStart, -29), to: addDays(todayStart, 1) }
      if (range === 'custom') {
        const fromDate = Date.parse(`${customFrom}T00:00:00`)
        const toDate = Date.parse(`${customTo}T00:00:00`)
        if (!Number.isFinite(fromDate) || !Number.isFinite(toDate)) return null
        const start = Math.min(fromDate, toDate)
        const end = Math.max(fromDate, toDate) + DAY_MS
        return { from: start, to: end }
      }
      return { from: todayStart, to: addDays(todayStart, 1) }
    }

    // ------------------------------------------------------------------
    // Small pieces
    // ------------------------------------------------------------------

    function RefreshGlyph({ spinning }) {
      return h('svg', {
        viewBox: '0 0 24 24', width: 14, height: 14, fill: 'none', stroke: 'currentColor',
        strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true,
        className: spinning ? 'ustats-spin' : undefined,
      },
      h('path', { d: 'M21 12a9 9 0 1 1-2.64-6.36' }),
      h('polyline', { points: '21 3 21 9 15 9' }),
      )
    }

    /** Heatmap glyph for the sidebar rail. */
    function PanelIcon({ size }) {
      return h('svg', {
        viewBox: '0 0 24 24', width: size, height: size, fill: 'none', stroke: 'currentColor',
        strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true,
      },
      h('rect', { x: '3.2', y: '12.2', width: '4.2', height: '8.2', rx: '1.4' }),
      h('rect', { x: '9.9', y: '7.4', width: '4.2', height: '13', rx: '1.4' }),
      h('rect', { x: '16.6', y: '3.6', width: '4.2', height: '16.8', rx: '1.4' }),
      )
    }

    // ------------------------------------------------------------------
    // Calendar heatmap (GitHub-style, Monday-first rows, 26 trailing weeks)
    // ------------------------------------------------------------------

    const HEAT_WEEKS = 52

    function heatCellTitle(cellKey, day, t) {
      if (!day) return cellKey
      return `${cellKey}\n${t('requests')}: ${fmtInt(day.requests)}`
        + `\n${t('inputTokens')}: ${fmtTokens(day.input)}`
        + `\n${t('outputTokens')}: ${fmtTokens(day.output)}`
        + `\n${t('totalTokens')}: ${fmtTokens(day.total)}`
    }

    function Heatmap({ dayMap, t }) {
      const grid = useMemo(() => {
        const today = localDayStart(Date.now())
        const lastMonday = mondayOf(today)
        const start = addDays(lastMonday, -(HEAT_WEEKS - 1) * 7)
        const columns = []
        for (let week = 0; week < HEAT_WEEKS; week += 1) {
          const weekStart = addDays(start, week * 7)
          const cells = []
          for (let day = 0; day < 7; day += 1) {
            const ms = addDays(weekStart, day)
            cells.push({ key: dateKey(ms), future: ms > today })
          }
          columns.push({ weekStart, month: new Date(weekStart).getMonth(), cells })
        }
        return columns
      }, [])

      const max = useMemo(() => {
        let value = 0
        for (const column of grid) {
          for (const cell of column.cells) {
            const day = dayMap.get(cell.key)
            if (day !== undefined && day.total > value) value = day.total
          }
        }
        return value
      }, [grid, dayMap])

      const gridTotal = useMemo(() => {
        let value = 0
        for (const column of grid) {
          for (const cell of column.cells) {
            const day = dayMap.get(cell.key)
            if (day !== undefined) value += day.total
          }
        }
        return value
      }, [grid, dayMap])

      const levelOf = total => {
        if (total <= 0 || max <= 0) return 0
        if (total <= max * 0.25) return 1
        if (total <= max * 0.5) return 2
        if (total <= max * 0.75) return 3
        return 4
      }

      // One label per month; a label shows where the month of a column's
      // Monday differs from the previous column's. Positions are percentages
      // of the columns container so labels track the elastic cell size.
      const monthLabels = []
      const monthFormat = new Intl.DateTimeFormat(t('intlLocale'), { month: 'short' })
      let lastMonth = -1
      grid.forEach((column, index) => {
        if (column.month !== lastMonth) {
          lastMonth = column.month
          monthLabels.push({
            index,
            text: monthFormat.format(new Date(column.weekStart)),
          })
        }
      })

      return h('div', { className: 'ustats-panel' },
        h('h2', { className: 'ustats-panelTitle' }, t('heatTitle', { total: fmtTokens(gridTotal) })),
        h('div', { className: 'ustats-heatWrap' },
          h('div', { className: 'ustats-heatMonths' },
            monthLabels.map(label => h('span', {
              key: label.index, className: 'ustats-heatMonth',
              style: { left: `${(label.index / HEAT_WEEKS) * 100}%` },
            }, label.text)),
          ),
          h('div', { className: 'ustats-heat' },
            h('div', { className: 'ustats-heatDays' }, [0, 1, 2, 3, 4, 5, 6].map(row => h('span', { key: row },
              row === 0 ? t('weekdayMon')
                : row === 2 ? t('weekdayWed')
                  : row === 4 ? t('weekdayFri') : '',
            ))),
            h('div', { className: 'ustats-heatCols' }, grid.map((column, columnIndex) => h('div', {
              className: 'ustats-heatCol', key: columnIndex,
            }, column.cells.map(cell => {
              const day = dayMap.get(cell.key)
              return h('div', {
                key: cell.key,
                className: cls(
                  'ustats-heatCell',
                  `ustats-heatLevel${day !== undefined ? levelOf(day.total) : 0}`,
                  cell.future && 'ustats-heatCellFuture',
                ),
                title: heatCellTitle(cell.key, day, t),
              })
            })))),
          ),
        ),
        h('div', { className: 'ustats-legend' },
          h('span', null, t('less')),
          [0, 1, 2, 3, 4].map(level => h('span', {
            key: level, className: `ustats-legendCell ustats-heatLevel${level}`,
          })),
          h('span', null, t('more')),
        ),
      )
    }

    // ------------------------------------------------------------------
    // Tables
    // ------------------------------------------------------------------

    function SummaryCards({ totals, t }) {
      const hitRate = totals.promptTotal > 0 ? totals.cacheRead / totals.promptTotal : null
      const totalFormula = t('totalFormulaTitle', {
        input: fmtTokens(totals.input),
        cacheRead: fmtTokens(totals.cacheRead),
        cacheWrite: fmtTokens(totals.cacheWrite),
        output: fmtTokens(totals.output),
      })
      // Card order is user-specified: counts and ratios first, then totals,
      // then the token buckets.
      const cards = [
        { label: t('requests'), value: fmtInt(totals.requests) },
        { label: t('sessions'), value: fmtInt(totals.sessions) },
        { label: t('cacheHitRate'), value: fmtPercent(hitRate), title: t('cacheHitRateHint') },
        { label: t('totalTokens'), value: fmtTokens(totals.total), title: totalFormula },
        { label: t('inputTokens'), value: fmtTokens(totals.input) },
        { label: t('outputTokens'), value: fmtTokens(totals.output) },
        { label: t('cacheRead'), value: fmtTokens(totals.cacheRead) },
        { label: t('cacheWrite'), value: fmtTokens(totals.cacheWrite) },
      ]
      return h('div', { className: 'ustats-cards' }, cards.map(card => h('div', {
        className: 'ustats-card', key: card.label, title: card.title,
      },
      h('div', { className: 'ustats-cardLabel' }, card.label),
      h('div', { className: 'ustats-cardValue' }, card.value),
      )))
    }

    function GroupTable({ groups, groupBy, t }) {
      if (groups.length === 0) return null
      const labelHead = groupBy === 'model' ? t('colModel') : t('colProvider')
      const head = [labelHead, groupBy === 'model' ? t('colProvider') : null, t('requests'), t('inputTokens'),
        t('cacheRead'), t('cacheWrite'), t('outputTokens'), t('totalTokens'), t('colShare')]
        .filter(Boolean)
      return h('div', { className: 'ustats-panel' },
        h('h2', { className: 'ustats-panelTitle' }, t('groupTableTitle')),
        h('div', { className: 'ustats-tableWrap' },
          h('table', { className: 'ustats-table' },
            h('thead', null, h('tr', null, head.map((cell, index) => h('th', { key: index }, cell)))),
            h('tbody', null, groups.map(group => {
              const retiredTag = group.retired
                ? h('span', { className: 'ustats-tagRetired', title: t('retiredHint') }, t('retiredTag'))
                : null
              const firstCell = groupBy === 'model'
                ? h('td', { key: 'model' }, group.model)
                : h('td', { key: 'provider' }, h('span', null, group.provider), retiredTag)
              const cells = [
                firstCell,
                h('td', { key: 'requests' }, fmtInt(group.requests)),
                h('td', { key: 'input' }, fmtTokens(group.input)),
                h('td', { key: 'cacheRead' }, fmtTokens(group.cacheRead)),
                h('td', { key: 'cacheWrite' }, fmtTokens(group.cacheWrite)),
                h('td', { key: 'output' }, fmtTokens(group.output)),
                h('td', {
                  key: 'total',
                  title: t('totalFormulaTitle', {
                    input: fmtTokens(group.input),
                    cacheRead: fmtTokens(group.cacheRead),
                    cacheWrite: fmtTokens(group.cacheWrite),
                    output: fmtTokens(group.output),
                  }),
                }, h('strong', null, fmtTokens(group.total))),
                h('td', { key: 'share', className: 'ustats-share' },
                  h('div', { className: 'ustats-shareBar', style: { width: `${Math.max(1, group.share * 100)}%` } }),
                  h('span', { className: 'ustats-shareText' }, fmtPercent(group.share))),
              ]
              if (groupBy === 'model') {
                cells.splice(1, 0, h('td', { key: 'provider' }, h('span', null, group.provider), retiredTag))
              }
              return h('tr', { key: group.key }, cells)
            })),
          ),
        ),
      )
    }

    // ------------------------------------------------------------------
    // Page
    // ------------------------------------------------------------------

    function UsageStatsPage(props) {
      const { query, t } = props
      const [data, setData] = useState(null)
      const [error, setError] = useState(null)
      const [loading, setLoading] = useState(true)
      const [groupBy, setGroupBy] = useState('provider')
      const [range, setRange] = useState('today')
      const [customFrom, setCustomFrom] = useState(() => dateKey(addDays(localDayStart(Date.now()), -6)))
      const [customTo, setCustomTo] = useState(() => dateKey(localDayStart(Date.now())))
      const alive = useRef(true)

      useEffect(() => () => { alive.current = false }, [])

      const request = useMemo(() => {
        const bounds = computeRange(range, customFrom, customTo)
        return bounds === null ? null : { ...bounds, groupBy }
      }, [range, customFrom, customTo, groupBy])

      const run = useCallback(async () => {
        if (request === null) return
        setLoading(true)
        setError(null)
        try {
          const payload = await query(request)
          if (payload?.totals === undefined) throw new Error(payload?.error || '空响应')
          if (alive.current) setData(payload)
        } catch (cause) {
          if (alive.current) setError(String(cause?.message || cause))
        } finally {
          if (alive.current) setLoading(false)
        }
      }, [query, request])

      useEffect(() => { void run() }, [run])

      const dayMap = useMemo(() => new Map((data?.days ?? []).map(day => [day.date, day])), [data])

      const totals = data?.totals ?? null
      const meta = data?.meta ?? null

      return h('section', { className: 'ustats-page', 'aria-label': t('title') },
        h('style', null, STYLE),
        h('div', { className: 'ustats-scroll' },
          h('div', { className: 'ustats-content' },
            h('div', { className: 'ustats-heading' },
              h('div', { className: 'ustats-titles' },
                h('h1', null, t('title')),
                h('div', { className: 'ustats-subtitle' }, t('subtitle')),
              ),
              h('button', {
                className: 'ustats-refreshAll', onClick: () => { void run() }, disabled: loading,
              }, h(RefreshGlyph, { spinning: loading }), t('refresh')),
            ),
            h('div', { className: 'ustats-controls' },
              h('label', { className: 'ustats-control' },
                h('span', null, t('groupLabel')),
                h('select', {
                  className: 'ustats-select', name: 'ustats-group', value: groupBy,
                  onChange: event => { setGroupBy(event.target.value) },
                },
                h('option', { value: 'provider' }, t('groupProvider')),
                h('option', { value: 'model' }, t('groupModel')),
                ),
              ),
              h('div', { className: 'ustats-control' },
                h('span', null, t('rangeLabel')),
                h('div', { className: 'ustats-ranges' },
                  [['today', t('today')], ['7d', t('last7d')], ['30d', t('last30d')], ['custom', t('custom')]]
                    .map(([value, label]) => h('button', {
                      key: value,
                      className: cls('ustats-rangeBtn', range === value && 'ustats-rangeBtnActive'),
                      onClick: () => { setRange(value) },
                    }, label)),
                ),
              ),
              range === 'custom'
                ? h('div', { className: 'ustats-control' },
                  h('input', {
                    className: 'ustats-dateInput', type: 'date', name: 'ustats-from', value: customFrom,
                    onChange: event => { setCustomFrom(event.target.value) }, 'aria-label': t('coverage'),
                  }),
                  h('span', null, '–'),
                  h('input', {
                    className: 'ustats-dateInput', type: 'date', name: 'ustats-to', value: customTo,
                    onChange: event => { setCustomTo(event.target.value) }, 'aria-label': t('coverage'),
                  }),
                )
                : null,
            ),
            error !== null
              ? h('div', { className: 'ustats-panel' },
                h('div', { className: 'ustats-error' }, `${t('loadError')}:${error}`),
                h('button', { className: 'ustats-retry', onClick: () => { void run() } }, t('retry')),
              )
              : null,
            data === null && error === null
              ? h('div', { className: 'ustats-empty' }, t('loading'))
              : null,
            data !== null && totals.requests === 0
              ? h('div', { className: 'ustats-empty' }, t('empty'))
              : null,
            data !== null && totals.requests > 0 ? h('div', null,
              h(SummaryCards, { totals, t }),
              h('div', { className: 'ustats-badgeRow' },
                h('span', { className: 'ustats-badge' },
                  h('span', { className: 'ustats-dot', style: { background: 'var(--dsw-alias-state-success-primary)' } }),
                  `${t('badgeReported')} ${fmtInt(totals.reported)}`),
                totals.estimated > 0
                  ? h('span', { className: 'ustats-badge' },
                    h('span', { className: 'ustats-dot', style: { background: 'var(--dsw-alias-state-warn-primary)' } }),
                    `${t('badgeEstimated')} ${fmtInt(totals.estimated)}`)
                  : null,
              ),
              h(Heatmap, { dayMap, t }),
              h(GroupTable, { groups: data.groups, groupBy: data.groupBy, t }),
            ) : null,
            meta !== null ? h('p', { className: 'ustats-note' },
              `${t('coverage')} ${meta.coverage.from !== null ? shanghaiDate(meta.coverage.from) : '—'}`
              + ` ~ ${meta.coverage.to !== null ? shanghaiDate(meta.coverage.to) : '—'}`
              + ` · ${t('scanned')} ${fmtInt(meta.files)} ${t('logUnit')}`
              + ` · ${t('auxTitle')} ${fmtInt(meta.aux.titleRequests)}`
              + ` · ${t('auxSearch')} ${fmtInt(meta.aux.searchRequests)}`,
              h('br'),
              t('caliberNote'),
              data !== null && data.groups.some(group => group.retired)
                ? [h('br'), t('retiredNote')]
                : null,
            ) : null,
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
          () => ctx.locale.register('usageStats', { zh, en }),
          'dsh-usage-stats: dictionaries',
        )
        const t = ctx.locale.bind('usageStats')

        /** Query the Host route with explicit epoch-ms bounds and grouping. */
        const query = async params => {
          const response = await fetch('/api/dsh-usage-stats/query', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(params),
          })
          if (!response.ok) throw new Error(`HTTP ${response.status}`)
          return response.json()
        }

        // The sidebar row below the quota panel entry (plugins=0, quota=5,
        // schedules=10): this panel sits directly under 额度面板.
        ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
          name: 'sidebar.panellist',
          id: 'usage-stats',
          order: 6,
          locale: 'usageStats',
          label: () => t('panel'),
        }, PanelIcon))

        // The main-column panel the row selects.
        ctx.slots.inject('main', () => ctx.slots.register({
          name: 'main',
          key: 'usage-stats',
          locale: 'usageStats',
          inject: () => ({ query }),
        }, UsageStatsPage))
      },
    }
  },
})
