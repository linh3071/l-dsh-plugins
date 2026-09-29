// Smoke test: drives the real route handlers through a minimal mock ctx with
// a temporary DSH_HOME, verifying scan, toggle, comment preservation, path
// escape refusal, and no-op byte stability. Run: node tests/smoke.mjs
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { equal, ok } from 'node:assert/strict'

const home = mkdtempSync(join(tmpdir(), 'sklp-'))
process.env.DSH_HOME = home
const root = join(home, 'skills')
mkdirSync(join(root, 'demo-skill'), { recursive: true })
mkdirSync(join(root, '.system'), { recursive: true })
mkdirSync(join(root, 'broken'), { recursive: true })
const original = [
  '---',
  '# 主注释',
  'name: demo-skill',
  'description: 一个演示技能 # 行尾注释',
  'user-invocable: true',
  'argument-hint: "[date]"',
  '---',
  '',
  '# 演示正文',
  '',
  '正文保持不变。',
  '',
].join('\n')
writeFileSync(join(root, 'demo-skill', 'SKILL.md'), original, 'utf8')
writeFileSync(join(root, 'flat-skill.md'), '---\nname: flat-skill\ndescription: 扁平技能\n---\n\n正文\n', 'utf8')
writeFileSync(join(root, 'broken', 'SKILL.md'), 'no frontmatter here\n', 'utf8')
writeFileSync(join(root, '.system', 'hidden.md'), '---\nname: hidden\ndescription: skipped\n---\nx\n', 'utf8')
writeFileSync(join(home, 'outside.md'), '---\nname: outside\ndescription: x\n---\nx\n', 'utf8')

const routes = {}
const ctx = {
  effect: fn => { const dispose = fn(); return dispose },
  get: () => undefined,
  connection: { fetch: { register: registration => { routes[registration.path] = registration; return () => {} } } },
}
const { apply, QUERY_PATH, SET_PATH } = await import('../index.js')
apply(ctx)

const call = async (path, body) => {
  const response = await routes[path].fetch(new Request(`http://host${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  }))
  return { status: response.status, payload: await response.json() }
}

// query: rows, order, .system skipped, invalid flagged
let { status, payload } = await call(QUERY_PATH)
equal(status, 200)
ok(Array.isArray(payload.skills), 'skills array')
equal(payload.skills.length, 3, 'demo + flat + broken rows')
const demo = payload.skills.find(s => s.name === 'demo-skill')
const flat = payload.skills.find(s => s.name === 'flat-skill')
const broken = payload.skills.find(s => s.entryName === 'broken')
ok(demo.valid && demo.modelInvocable === true && demo.dirSkill === true, 'demo row')
ok(flat.valid && flat.dirSkill === false, 'flat row')
equal(broken.valid, false, 'broken row invalid')
equal(broken.problem, 'missing-frontmatter')

// set disable: field added, comments and body preserved
;({ status, payload } = await call(SET_PATH, { path: demo.path, enabled: false }))
equal(status, 200)
ok(payload.ok && payload.changed === true && payload.modelInvocable === false)
let text = readFileSync(demo.path, 'utf8')
ok(text.includes('disable-model-invocation: true'), 'disable field present')
ok(text.includes('# 主注释'), 'head comment preserved')
ok(text.includes('description: 一个演示技能 # 行尾注释'), 'inline comment preserved')
ok(text.includes('argument-hint: "[date]"'), 'other keys preserved')
ok(text.endsWith('正文保持不变。\n'), 'body preserved')
;({ payload } = await call(QUERY_PATH))
equal(payload.skills.find(s => s.name === 'demo-skill').modelInvocable, false, 'query reflects disable')

// no-op set: byte-identical file
const before = readFileSync(demo.path, 'utf8')
await call(SET_PATH, { path: demo.path, enabled: false })
equal(readFileSync(demo.path, 'utf8'), before, 'no-op keeps bytes')

// set enable: field removed, content restored
;({ payload } = await call(SET_PATH, { path: demo.path, enabled: true }))
ok(payload.ok && payload.changed === true && payload.modelInvocable === true)
text = readFileSync(demo.path, 'utf8')
ok(!text.includes('disable-model-invocation'), 'field removed')
ok(text.startsWith(original), 'frontmatter restored to original')

// rejections: path escape, invalid skill, bad body
;({ status, payload } = await call(SET_PATH, { path: join(home, 'outside.md'), enabled: false }))
equal(status, 403, 'outside root refused')
;({ status } = await call(SET_PATH, { path: broken.path, enabled: false }))
equal(status, 409, 'invalid skill refused')
;({ status } = await call(SET_PATH, { path: demo.path, enabled: 'yes' }))
equal(status, 400, 'non-boolean refused')

// CRLF file: line endings preserved
const crlf = '---\r\nname: crlf-skill\r\ndescription: CRLF 技能\r\n---\r\n\r\n正文\r\n'
writeFileSync(join(root, 'crlf-skill.md'), crlf, 'utf8')
;({ payload } = await call(QUERY_PATH))
const crlfRow = payload.skills.find(s => s.name === 'crlf-skill')
ok(crlfRow?.valid === true, 'crlf parsed')
await call(SET_PATH, { path: crlfRow.path, enabled: false })
const crlfText = readFileSync(crlfRow.path, 'utf8')
ok(crlfText.includes('disable-model-invocation: true\r\n'), 'crlf disable written')
ok(!crlfText.includes('\n---\n'), 'no lone LF introduced')

rmSync(home, { recursive: true, force: true })
console.log('SMOKE-OK')
