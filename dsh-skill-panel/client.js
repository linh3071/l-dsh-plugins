// Browser half of the dsh-skill-panel bundle: the sidebar row directly below
// the MCP entry and the skill management page it opens.
//
// The page talks to the bundle's Host half over the shared /api channel. The
// Host re-reads ~/.dsh/skills per query and answers the skill list with the
// live registry state; toggling rewrites the SKILL.md frontmatter through the
// same channel, and the shipped skill watcher hot-republishes the
// model-facing catalog. All chrome colors come from --dsw-alias-* theme
// tokens so the page follows light/dark themes beside the host panels.
/* global window */

window.__ModuleLoader__.load({
  id: '@local/dsh-skill-panel',
  factory(require) {
    const React = require('react')
    const { useState, useEffect, useRef, useCallback } = React
    const h = React.createElement

    // ------------------------------------------------------------------
    // Locale
    // ------------------------------------------------------------------

    const zh = {
      'panel': '技能',
      'title': '技能',
      'subtitle': '读取 ~/.dsh/skills 下的技能；关闭后模型无法获取该技能',
      'refresh': '刷新',
      'retry': '重试',
      'loading': '读取中…',
      'loadError': '加载失败',
      'empty': '技能目录为空（~/.dsh/skills 下没有 SKILL.md 或 *.md 条目）',
      'modelVisible': '模型可见',
      'modelHidden': '模型不可见',
      'liveLabel': '已生效',
      'pendingLabel': '等待刷新',
      'userInvocable': '用户可调用',
      'userNotInvocable': '用户不可调用',
      'dirSkill': '目录',
      'fileSkill': '单文件',
      'invalidRow': '无效条目，宿主已忽略',
      'invalid-missing-frontmatter': '缺少 YAML frontmatter',
      'invalid-invalid-yaml': 'frontmatter 不是有效 YAML',
      'invalid-missing-fields': 'frontmatter 缺少 name 或 description',
      'invalid-invalid-name': 'name 不符合 kebab-case 规则',
      'invalid-invalid-invocation': '调用策略字段非法（如使用了驼峰旧字段）',
      'invalid-missing-skill-md': '目录中没有 SKILL.md',
      'invalid-unreadable': '文件无法读取',
      'appliedText': '已写入，模型目录将在下一轮对话更新',
      'savedNoChange': '已是目标状态，未改动文件',
      'failedText': '操作失败',
      'registryMissing': '宿主技能注册表不可用，仅显示文件状态',
      'note': '开关通过 YAML 文档 API 写入 SKILL.md 的 disable-model-invocation 字段（保留注释与键序）；宿主文件监视器热捕获变更，无需重启。关闭仅对模型隐藏：技能目录与 skill 工具都不再提供该技能，用户以 /名称 直接调用不受影响。',
      'source': '来源',
    }

    const en = {
      'panel': 'Skills',
      'title': 'Skills',
      'subtitle': 'Skills under ~/.dsh/skills; a disabled skill is invisible to the model',
      'refresh': 'Refresh',
      'retry': 'Retry',
      'loading': 'Loading…',
      'loadError': 'Failed to load',
      'empty': 'No skills under ~/.dsh/skills (no SKILL.md or *.md entries)',
      'modelVisible': 'Visible to model',
      'modelHidden': 'Hidden from model',
      'liveLabel': 'Live',
      'pendingLabel': 'Refresh pending',
      'userInvocable': 'User-invocable',
      'userNotInvocable': 'Not user-invocable',
      'dirSkill': 'Directory',
      'fileSkill': 'Single file',
      'invalidRow': 'Invalid entry; ignored by the host',
      'invalid-missing-frontmatter': 'missing YAML frontmatter',
      'invalid-invalid-yaml': 'frontmatter is not valid YAML',
      'invalid-missing-fields': 'frontmatter lacks name or description',
      'invalid-invalid-name': 'name is not kebab-case',
      'invalid-invalid-invocation': 'invalid invocation field (e.g. a legacy camelCase key)',
      'invalid-missing-skill-md': 'no SKILL.md in the directory',
      'invalid-unreadable': 'file could not be read',
      'appliedText': 'Saved; the model catalog updates on the next turn',
      'savedNoChange': 'Already in the target state; file untouched',
      'failedText': 'Operation failed',
      'registryMissing': 'Host skill registry unavailable; showing file state only',
      'note': 'Toggles rewrite the disable-model-invocation frontmatter field of SKILL.md through the YAML document API (comments and key order preserved); the shipped file watcher picks the change up hot, no restart needed. Disabling hides the skill from the model only: the catalog and the skill tool drop it, while invoking it directly with /name keeps working.',
      'source': 'Source',
    }

    // ------------------------------------------------------------------
    // Styles (component-owned; removed with the panel)
    // ------------------------------------------------------------------

    const STYLE = `
.sklp-page{display:flex;width:100%;height:100%;min-width:0;min-height:0;overflow:hidden;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-base);font-size:14px;line-height:1.6}
.sklp-scroll{flex:1;min-height:0;overflow:auto;scrollbar-gutter:stable}
.sklp-content{max-width:900px;margin:0 auto;padding:0 clamp(24px,4vw,48px) 48px}
.sklp-heading{display:flex;align-items:center;justify-content:space-between;gap:16px;padding-top:28px;margin-bottom:14px}
.sklp-titles h1{margin:0;font-size:20px;font-weight:600;letter-spacing:-.01em}
.sklp-subtitle{color:var(--dsw-alias-label-secondary);font-size:13px;margin-top:2px}
.sklp-refresh{display:flex;align-items:center;gap:6px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font-size:13px;padding:6px 14px;border-radius:8px;cursor:pointer}
.sklp-refresh:hover{background:var(--dsw-alias-bg-layer-2)}
.sklp-refresh:disabled{opacity:.6;cursor:default}
.sklp-list{display:flex;flex-direction:column;gap:12px}
.sklp-card{border:1px solid var(--dsw-alias-border-l1);border-radius:12px;background:var(--dsw-alias-bg-layer-1);padding:14px 18px}
.sklp-cardHead{display:flex;align-items:flex-start;gap:12px}
.sklp-name{font-size:15px;font-weight:600;font-variant-numeric:tabular-nums}
.sklp-badges{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:3px}
.sklp-badge{display:inline-flex;align-items:center;gap:5px;border:1px solid var(--dsw-alias-border-l1);border-radius:999px;padding:0 10px;background:var(--dsw-alias-bg-layer-2);font-size:11.5px;color:var(--dsw-alias-label-secondary);line-height:20px;white-space:nowrap}
.sklp-dot{width:7px;height:7px;border-radius:50%;flex:none}
.sklp-spacer{flex:1}
.sklp-switch{position:relative;flex:none;width:38px;height:22px;border-radius:11px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);cursor:pointer;padding:0;transition:background .15s ease,border-color .15s ease}
.sklp-switchOn{background:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary)}
.sklp-switch:disabled{opacity:.45;cursor:default}
.sklp-switch:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}
.sklp-knob{position:absolute;top:2px;left:2px;width:16px;height:16px;border-radius:50%;background:var(--dsw-alias-bg-base);border:1px solid var(--dsw-alias-border-l2);transition:transform .15s ease}
.sklp-switchOn .sklp-knob{transform:translateX(16px);border-color:transparent}
.sklp-desc{margin-top:8px;font-size:13px;color:var(--dsw-alias-label-secondary)}
.sklp-meta{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:10px;font-size:12.5px;color:var(--dsw-alias-label-secondary)}
.sklp-mono{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12px;word-break:break-all;color:var(--dsw-alias-label-primary)}
.sklp-state{margin-top:8px;font-size:12.5px;color:var(--dsw-alias-label-secondary)}
.sklp-stateOk{color:var(--dsw-alias-state-success-primary)}
.sklp-stateWarn{color:var(--dsw-alias-state-warn-primary)}
.sklp-stateBad{color:var(--dsw-alias-state-error-primary)}
.sklp-error{color:var(--dsw-alias-state-error-primary);font-size:13px;word-break:break-all}
.sklp-errorPanel{border:1px solid var(--dsw-alias-border-l1);border-radius:12px;background:var(--dsw-alias-bg-layer-1);padding:16px 18px;margin-bottom:16px}
.sklp-retry{margin-top:8px;border:1px solid var(--dsw-alias-border-l2);background:transparent;color:var(--dsw-alias-label-primary);font-size:12.5px;padding:3px 12px;border-radius:7px;cursor:pointer}
.sklp-retry:hover{background:var(--dsw-alias-bg-layer-2)}
.sklp-empty{padding:6px 2px;color:var(--dsw-alias-label-secondary);font-size:13px}
.sklp-note{margin:18px 0 0;font-size:12px;color:var(--dsw-alias-label-secondary);line-height:1.7}
.sklp-spin{animation:sklp-rotate .9s linear infinite}
@keyframes sklp-rotate{to{transform:rotate(360deg)}}
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
        className: spinning ? 'sklp-spin' : undefined,
      },
      h('path', { d: 'M21 12a9 9 0 1 1-2.64-6.36' }),
      h('polyline', { points: '21 3 21 9 15 9' }),
      )
    }

    /** Book-and-bolt glyph for the sidebar rail. */
    function PanelIcon({ size }) {
      return h('svg', {
        viewBox: '0 0 24 24', width: size, height: size, fill: 'none', stroke: 'currentColor',
        strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true,
      },
      h('path', { d: 'M4 19.5A2.5 2.5 0 0 1 6.5 17H20' }),
      h('path', { d: 'M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z' }),
      h('path', { d: 'M14 7 11 13h3l-1.5 5L17 11h-3z' }),
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
      return h('span', { className: 'sklp-badge' },
        h('span', { className: 'sklp-dot', style: { background: color } }),
        children,
      )
    }

    /** Localized text for one invalid-entry problem code. */
    function problemText(t, problem) {
      return t(`invalid-${String(problem ?? '')}`)
    }

    /** Human text for one toggle outcome. */
    function outcomeText(payload, t) {
      if (payload?.ok !== true) {
        const code = payload?.error?.code ?? ''
        const diagnostic = payload?.error?.diagnostic ?? ''
        const detail = diagnostic !== '' ? diagnostic : code
        return detail === '' ? t('failedText') : `${t('failedText')}：${detail}`
      }
      return payload?.changed === false ? t('savedNoChange') : t('appliedText')
    }

    // ------------------------------------------------------------------
    // Skill card
    // ------------------------------------------------------------------

    function SkillCard({ skill, t, busy, result, onToggle }) {
      const valid = skill.valid === true
      const on = valid && skill.modelInvocable === true
      const name = valid ? skill.name : skill.entryName
      const badges = []
      if (valid) {
        badges.push(on
          ? h(Badge, { key: 'model', tone: 'ok' }, t('modelVisible'))
          : h(Badge, { key: 'model', tone: 'off' }, t('modelHidden')))
        if (skill.liveModelInvocable !== undefined) {
          badges.push(skill.liveModelInvocable === on
            ? h(Badge, { key: 'live', tone: 'ok' }, t('liveLabel'))
            : h(Badge, { key: 'live', tone: 'warn' }, t('pendingLabel')))
        }
        badges.push(h('span', { key: 'shape', className: 'sklp-badge' },
          skill.dirSkill === true ? t('dirSkill') : t('fileSkill')))
        badges.push(h('span', { key: 'user', className: 'sklp-badge' },
          skill.userInvocable === true ? t('userInvocable') : t('userNotInvocable')))
      } else {
        badges.push(h(Badge, { key: 'invalid', tone: 'bad' }, t('invalidRow')))
      }

      let stateLine = null
      if (!valid) {
        stateLine = h('div', { className: 'sklp-state sklp-stateWarn' },
          `${t('invalidRow')}：${problemText(t, skill.problem)}`)
      } else if (skill.liveModelInvocable !== undefined && skill.liveModelInvocable !== on) {
        stateLine = h('div', { className: 'sklp-state sklp-stateWarn' },
          `${t('pendingLabel')}：${t('appliedText')}`)
      }

      const resultLine = result === undefined ? null : h('div', {
        className: cls('sklp-state', result.ok ? 'sklp-stateOk' : 'sklp-stateBad'),
      }, result.text)

      return h('div', { className: 'sklp-card' },
        h('div', { className: 'sklp-cardHead' },
          h('div', { style: { minWidth: 0 } },
            h('div', { className: 'sklp-name' }, name),
            h('div', { className: 'sklp-badges' }, badges),
          ),
          h('div', { className: 'sklp-spacer' }),
          h('button', {
            className: cls('sklp-switch', on && 'sklp-switchOn'),
            role: 'switch',
            'aria-checked': on,
            'aria-label': name,
            disabled: busy || !valid,
            onClick: () => onToggle(skill, !on),
          }, h('span', { className: 'sklp-knob' })),
        ),
        valid && skill.description !== undefined
          ? h('div', { className: 'sklp-desc' }, skill.description)
          : null,
        h('div', { className: 'sklp-meta' },
          h('span', { className: 'sklp-mono' }, skill.path),
        ),
        stateLine,
        resultLine,
      )
    }

    // ------------------------------------------------------------------
    // Page
    // ------------------------------------------------------------------

    function SkillPanelPage(props) {
      const { query, toggle, t } = props
      const [data, setData] = useState(null)
      const [error, setError] = useState(null)
      const [loading, setLoading] = useState(true)
      const [busyPath, setBusyPath] = useState(null)
      const [results, setResults] = useState({})
      const alive = useRef(true)

      useEffect(() => () => { alive.current = false }, [])

      const run = useCallback(async () => {
        setLoading(true)
        setError(null)
        try {
          const payload = await query()
          if (!Array.isArray(payload?.skills)) throw new Error(payload?.error || '空响应')
          if (alive.current) setData(payload)
        } catch (cause) {
          if (alive.current) setError(String(cause?.message || cause))
        } finally {
          if (alive.current) setLoading(false)
        }
      }, [query])

      useEffect(() => { void run() }, [run])

      const onToggle = useCallback(async (skill, enabled) => {
        setBusyPath(skill.path)
        try {
          const payload = await toggle(skill.path, enabled)
          if (alive.current) {
            setResults(current => ({
              ...current,
              [skill.path]: { ok: payload?.ok === true, text: outcomeText(payload, t) },
            }))
          }
        } catch (cause) {
          if (alive.current) {
            setResults(current => ({
              ...current,
              [skill.path]: { ok: false, text: `${t('failedText')}：${String(cause?.message || cause)}` },
            }))
          }
        } finally {
          if (alive.current) setBusyPath(null)
          void run()
        }
      }, [toggle, t, run])

      const skills = data?.skills ?? []

      return h('section', { className: 'sklp-page', 'aria-label': t('title') },
        h('style', null, STYLE),
        h('div', { className: 'sklp-scroll' },
          h('div', { className: 'sklp-content' },
            h('div', { className: 'sklp-heading' },
              h('div', { className: 'sklp-titles' },
                h('h1', null, t('title')),
                h('div', { className: 'sklp-subtitle' }, t('subtitle')),
              ),
              h('button', {
                className: 'sklp-refresh', onClick: () => { void run() }, disabled: loading,
              }, h(RefreshGlyph, { spinning: loading }), t('refresh')),
            ),
            error !== null
              ? h('div', { className: 'sklp-errorPanel' },
                h('div', { className: 'sklp-error' }, `${t('loadError')}：${error}`),
                h('button', { className: 'sklp-retry', onClick: () => { void run() } }, t('retry')),
              )
              : null,
            error === null && data !== null && skills.length === 0
              ? h('div', { className: 'sklp-empty' }, t('empty'))
              : null,
            h('div', { className: 'sklp-list' },
              skills.map(skill => h(SkillCard, {
                key: skill.path,
                skill,
                t,
                busy: busyPath === skill.path,
                result: results[skill.path],
                onToggle,
              })),
            ),
            data !== null && data.registryAvailable === false
              ? h('div', { className: 'sklp-state sklp-stateWarn' }, t('registryMissing'))
              : null,
            data !== null && data.skillsDir
              ? h('p', { className: 'sklp-note' },
                `${t('source')}: `,
                h('span', { className: 'sklp-mono' }, data.skillsDir),
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
          () => ctx.locale.register('skillPanel', { zh, en }),
          'dsh-skill-panel: dictionaries',
        )
        const t = ctx.locale.bind('skillPanel')

        /** Snapshot the Host route: the user skill root's entries plus live state. */
        const query = async () => {
          const response = await fetch('/api/dsh-skill-panel/query', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: '{}',
          })
          if (!response.ok) throw new Error(`HTTP ${response.status}`)
          return response.json()
        }

        /** Toggle one skill through the Host route into its SKILL.md file. */
        const toggle = async (path, enabled) => {
          const response = await fetch('/api/dsh-skill-panel/set', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path, enabled }),
          })
          const payload = await response.json().catch(() => null)
          if (!response.ok) {
            throw new Error(payload?.error?.diagnostic || payload?.error?.code || `HTTP ${response.status}`)
          }
          return payload
        }

        // The sidebar row directly below the MCP entry (plugins=0, MCP=1,
        // this row=2, quota=5, usage=6, schedules=10).
        ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
          name: 'sidebar.panellist',
          id: 'skill-panel',
          order: 2,
          locale: 'skillPanel',
          label: () => t('panel'),
        }, PanelIcon))

        // The main-column panel the row selects.
        ctx.slots.inject('main', () => ctx.slots.register({
          name: 'main',
          key: 'skill-panel',
          locale: 'skillPanel',
          inject: () => ({ query, toggle }),
        }, SkillPanelPage))
      },
    }
  },
})
