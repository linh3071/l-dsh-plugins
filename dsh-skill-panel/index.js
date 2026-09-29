/**
 * Host half of the dsh-skill-panel bundle.
 *
 * Two authenticated Fetch routes on the shared `/api` channel back the skill
 * management panel:
 *
 * - `query` re-reads the user skill root (`$DSH_HOME/skills`, i.e.
 *   `~/.dsh/skills`) on every call and lists every directory-bundle skill
 *   (`<name>/SKILL.md`) and flat Markdown skill (`<name>.md`) with the same
 *   frontmatter rules the shipped skill-filesystem provider applies:
 *   `name`/`description` must be present, and `disable-model-invocation`
 *   decides whether the model may see the skill. Invalid entries are listed
 *   with their problem so the panel can flag them instead of hiding them.
 *   When the host skill registry is mounted, each row is also decorated with
 *   the registry's live view (`liveModelInvocable`) so the panel can show
 *   whether the file's desired state has reached the catalog yet.
 * - `set` toggles one skill by rewriting the frontmatter of its file:
 *   disabling writes `disable-model-invocation: true`, enabling removes the
 *   field (restoring the default). The edit goes through the YAML document
 *   API, so unrelated keys, their order, and comments are preserved. The
 *   shipped skill-filesystem watcher observes the change and republishes the
 *   model-facing catalog on the next request — no restart involved.
 *
 * Only files under the user skill root are addressable; `set` refuses any
 * path outside it, and only entries that still parse as valid skills.
 */

import { readdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { createRequire } from 'node:module'

/** The bundle ships its own `yaml` dependency (installed beside this file). */
const require = createRequire(import.meta.url)
const YAML = require('yaml')

/** Exact Fetch routes below /api owned by this plugin. */
export const QUERY_PATH = '/api/dsh-skill-panel/query'
export const SET_PATH = '/api/dsh-skill-panel/set'

/** Frontmatter key that hides a skill from the model-facing catalog. */
const DISABLE_MODEL_KEY = 'disable-model-invocation'

/** The same kebab-case grammar the harness accepts as a skill name. */
const SKILL_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/** Services required before the routes register; the skill registry is optional. */
export const inject = ['connection']

/** The user skill root this panel reads and toggles. */
function skillsDir() {
  const home = process.env.DSH_HOME?.trim() || join(homedir(), '.dsh')
  return join(home, 'skills')
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

// ---------------------------------------------------------------------------
// Frontmatter parsing (mirrors the shipped skill-filesystem provider)
// ---------------------------------------------------------------------------

/**
 * Split a skill file into its frontmatter block and body. Mirrors the
 * provider: the first line must be `---` and a later line must close it.
 * @returns the frontmatter text plus byte offsets for lossless reassembly,
 *   or null when the file carries no frontmatter.
 */
function splitFrontmatter(text) {
  const firstEnd = text.indexOf('\n')
  if (firstEnd < 0) return null
  if (text.slice(0, firstEnd).replace(/\r$/, '') !== '---') return null
  let lineStart = firstEnd + 1
  while (lineStart <= text.length) {
    const next = text.indexOf('\n', lineStart)
    const lineEnd = next < 0 ? text.length : next
    if (text.slice(lineStart, lineEnd).replace(/\r$/, '') === '---') {
      return {
        frontmatter: text.slice(firstEnd + 1, lineStart),
        prefix: text.slice(0, firstEnd + 1),
        closeStart: lineStart,
        bodyStart: next < 0 ? text.length : next + 1,
        text,
      }
    }
    if (next < 0) return null
    lineStart = next + 1
  }
  return null
}

/**
 * Read one boolean frontmatter field with the provider's accepted spellings
 * (true/false, 1/0, yes/no, on/off, case-insensitive strings).
 * @returns the value, or undefined when the key is absent.
 * @throws when the key exists with an unsupported type.
 */
function frontmatterBoolean(data, key) {
  if (!Object.hasOwn(data, key)) return undefined
  const value = data[key]
  if (typeof value === 'boolean') return value
  if (value === 1 || value === '1') return true
  if (value === 0 || value === '0') return false
  if (typeof value === 'string') {
    switch (value.toLowerCase()) {
      case 'true': case 'yes': case 'on': return true
      case 'false': case 'no': case 'off': return false
    }
  }
  throw new TypeError(`frontmatter field "${key}" must be a boolean`)
}

/**
 * Parse the invocation policy exactly as the provider does, including the
 * legacy-key rejection that makes the whole skill unloadable.
 */
function parseInvocationPolicy(data) {
  for (const legacy of ['disableModelInvocation', 'modelInvocable', 'userInvocable']) {
    if (Object.hasOwn(data, legacy)) {
      throw new Error(`frontmatter field "${legacy}" is unsupported; use the kebab-case spelling`)
    }
  }
  const disableModelInvocation = frontmatterBoolean(data, DISABLE_MODEL_KEY)
  const userInvocable = frontmatterBoolean(data, 'user-invocable')
  return {
    modelInvocable: disableModelInvocation !== true,
    userInvocable: userInvocable !== false,
  }
}

/**
 * Validate one skill file's frontmatter against the provider's rules.
 * @returns the parsed row, with `valid: false` and a stable problem code
 *   for entries the provider itself would ignore.
 */
function parseSkillText(text) {
  const parts = splitFrontmatter(text)
  if (parts === null) return { valid: false, problem: 'missing-frontmatter' }
  let document
  try {
    document = YAML.parseDocument(parts.frontmatter)
  } catch (error) {
    return { valid: false, problem: 'invalid-yaml', detail: String(error?.message ?? error) }
  }
  if (document.errors.length > 0) {
    return { valid: false, problem: 'invalid-yaml', detail: document.errors.map(error => error.message).join('; ') }
  }
  const data = document.toJS()
  if (!isPlainObject(data)) return { valid: false, problem: 'invalid-yaml', detail: 'frontmatter is not a mapping' }
  const name = typeof data.name === 'string' && data.name.length > 0 ? data.name : undefined
  const description = typeof data.description === 'string' && data.description.length > 0 ? data.description : undefined
  if (name === undefined || description === undefined) return { valid: false, problem: 'missing-fields' }
  if (!SKILL_NAME_PATTERN.test(name)) return { valid: false, problem: 'invalid-name' }
  let invocation
  try {
    invocation = parseInvocationPolicy(data)
  } catch (error) {
    return { valid: false, problem: 'invalid-invocation', detail: String(error?.message ?? error) }
  }
  return {
    valid: true,
    name,
    description,
    modelInvocable: invocation.modelInvocable,
    userInvocable: invocation.userInvocable,
  }
}

// ---------------------------------------------------------------------------
// Skill directory scanning
// ---------------------------------------------------------------------------

/** Follow symlinks like the provider does; null for sockets, FIFOs, etc. */
function entryKind(path) {
  let info
  try {
    info = statSync(path)
  } catch {
    return undefined
  }
  if (info.isDirectory()) return 'directory'
  if (info.isFile()) return 'file'
  return undefined
}

/**
 * One panel row per skill entry under the root, in the provider's
 * alphabetical order. The `.system` subdirectory is skipped with the
 * provider's user-root `skipSystem` semantics.
 */
function scanSkills(root) {
  const rows = []
  let entries
  try {
    entries = readdirSync(root, { withFileTypes: true, encoding: 'utf8' })
  } catch (error) {
    return { error: String(error?.message ?? error), rows }
  }
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.name === '.system') continue
    const entryPath = join(root, entry.name)
    const kind = entry.isDirectory() ? 'directory' : entry.isFile() ? 'file' : entryKind(entryPath)
    let skillPath
    let dirSkill = false
    if (kind === 'directory') {
      skillPath = join(entryPath, 'SKILL.md')
      dirSkill = true
    } else if (kind === 'file' && entry.name.endsWith('.md')) {
      skillPath = entryPath
    } else {
      continue
    }
    const row = { entryName: entry.name, path: skillPath, dirSkill, valid: false }
    let text
    try {
      text = readFileSync(skillPath, 'utf8')
    } catch {
      rows.push({ ...row, problem: dirSkill ? 'missing-skill-md' : 'unreadable' })
      continue
    }
    rows.push({ ...row, ...parseSkillText(text) })
  }
  return { rows }
}

/**
 * Decorate rows with the live registry view when the host mounts the skill
 * service. In this profile the skill providers sit in the default agent
 * preset's standing scope, so the lookup borrows that scope exactly as the
 * shipped session skill catalog does. Paths compare through realpath,
 * matching what the filesystem provider reports; the name map is the
 * fallback for exotic backends.
 */
async function withLiveState(ctx, rows) {
  const registry = ctx.get('skills')
  if (registry === undefined) return rows
  let summaries
  try {
    const presets = ctx.get('agentPresets')
    const lease = presets === undefined ? undefined : await presets.acquireScope(undefined)
    try {
      summaries = await registry.list({ cwd: process.cwd(), ...lease === undefined ? {} : { scope: lease.key } })
    } finally {
      await lease?.[Symbol.asyncDispose]()
    }
  } catch {
    return rows
  }
  const byPath = new Map()
  const byName = new Map()
  for (const summary of summaries) {
    if (typeof summary?.path === 'string') byPath.set(summary.path, summary)
    // Name fallback stays within the same root: a same-name project skill
    // would otherwise report its own shadowed visibility for a user file.
    if (typeof summary?.name === 'string' && summary.source === 'user-dsh') byName.set(summary.name, summary)
  }
  for (const row of rows) {
    if (!row.valid) continue
    let summary = byPath.get(row.path)
    if (summary === undefined) {
      let real
      try {
        real = realpathSync(row.path)
      } catch {
        real = undefined
      }
      if (real !== undefined) summary = byPath.get(real)
    }
    if (summary === undefined) summary = byName.get(row.name)
    if (summary !== undefined && isPlainObject(summary.invocation)) {
      row.liveModelInvocable = summary.invocation.modelInvocable === true
    }
  }
  return rows
}

// ---------------------------------------------------------------------------
// Route handlers
// ---------------------------------------------------------------------------

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  })
}

/** Panel snapshot: the user skill root's entries plus live registry state. */
async function handleQuery(ctx) {
  const root = skillsDir()
  const { rows, error } = scanSkills(root)
  return json({
    generatedAt: Date.now(),
    skillsDir: root,
    registryAvailable: ctx.get('skills') !== undefined,
    skills: await withLiveState(ctx, rows),
    ...error !== undefined ? { error } : {},
  })
}

/**
 * Rewrite one skill file's frontmatter so the model-facing catalog includes
 * (`enabled: true`, field removed) or excludes (`enabled: false`, field set
 * to true) the skill. Only paths strictly inside the user skill root that
 * still parse as valid skills are accepted.
 */
async function handleSet(ctx, request) {
  let body
  try {
    body = await request.json()
  } catch {
    return json({ ok: false, error: { code: 'invalid-json' } }, 400)
  }
  const target = typeof body?.path === 'string' ? body.path : ''
  const enabled = body?.enabled
  if (target === '' || typeof enabled !== 'boolean') {
    return json({ ok: false, error: { code: 'invalid-body' } }, 400)
  }
  const root = resolve(skillsDir())
  const resolved = resolve(target)
  if (resolved === root || !resolved.startsWith(root + sep)) {
    return json({ ok: false, error: { code: 'outside-skills-root' } }, 403)
  }
  let text
  try {
    text = readFileSync(resolved, 'utf8')
  } catch (error) {
    return json({ ok: false, error: { code: 'unreadable', diagnostic: String(error?.message ?? error) } }, 404)
  }
  const parsed = parseSkillText(text)
  if (!parsed.valid) {
    return json({ ok: false, error: { code: 'invalid-skill', diagnostic: parsed.problem ?? '' } }, 409)
  }
  const parts = splitFrontmatter(text)
  if (parts === null) {
    return json({ ok: false, error: { code: 'invalid-skill', diagnostic: 'missing-frontmatter' } }, 409)
  }
  const document = YAML.parseDocument(parts.frontmatter)
  if (document.errors.length > 0) {
    return json({ ok: false, error: { code: 'invalid-skill', diagnostic: 'invalid-yaml' } }, 409)
  }
  const currentlyDisabled = frontmatterBoolean(document.toJS(), DISABLE_MODEL_KEY) === true
  if (currentlyDisabled === !enabled) {
    // Write only on a real transition; a no-op keeps the file byte-identical.
    return json({ ok: true, path: resolved, name: parsed.name, modelInvocable: enabled, changed: false })
  }
  if (enabled) {
    document.delete(DISABLE_MODEL_KEY)
  } else {
    document.set(DISABLE_MODEL_KEY, true)
  }
  const eol = parts.prefix.endsWith('\r\n') ? '\r\n' : '\n'
  // The serializer always ends with one newline; strip it so reassembly adds
  // exactly the newline the closing `---` line needs.
  const frontmatter = document.toString().replaceAll('\n', eol).replace(/(\r?\n)+$/, '')
  const next = `${parts.prefix}${frontmatter}${eol}---${eol}${text.slice(parts.bodyStart)}`
  try {
    writeFileSync(resolved, next, 'utf8')
  } catch (error) {
    return json({ ok: false, error: { code: 'write-failed', diagnostic: String(error?.message ?? error) } }, 500)
  }
  return json({ ok: true, path: resolved, name: parsed.name, modelInvocable: enabled, changed: true })
}

/**
 * Register both panel routes; Connection owns transport trust and browser
 * authentication.
 * @param ctx - Host plugin context.
 */
export function apply(ctx) {
  ctx.effect(
    () => ctx.connection.fetch.register({
      path: QUERY_PATH,
      methods: ['POST'],
      requestBody: 'buffered',
      fetch: () => handleQuery(ctx),
    }),
    'dsh-skill-panel: query route',
  )
  ctx.effect(
    () => ctx.connection.fetch.register({
      path: SET_PATH,
      methods: ['POST'],
      requestBody: 'buffered',
      fetch: request => handleSet(ctx, request),
    }),
    'dsh-skill-panel: set route',
  )
}
