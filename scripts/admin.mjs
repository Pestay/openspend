#!/usr/bin/env node
// Administración de usuarios de OpenSpend usando el login de Wrangler (solo quien tiene
// acceso a la cuenta de Cloudflare puede ejecutarlo).
//
//   pnpm admin list                       usuarios y su estado
//   pnpm admin suspend <email>            bloquea dashboard y MCP de inmediato (conserva datos)
//   pnpm admin reactivate <email>         levanta la suspensión
//
// Por defecto opera sobre producción; agrega --local para la base de desarrollo.
import { execFileSync } from 'node:child_process'

const args = process.argv.slice(2)
const local = args.includes('--local')
const [command, email] = args.filter((a) => a !== '--local')

function sql(statement) {
  const out = execFileSync(
    'pnpm',
    ['exec', 'wrangler', 'd1', 'execute', 'openspend', local ? '--local' : '--remote', '--json', '--command', statement],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'], env: { ...process.env, CI: '1' } },
  )
  return JSON.parse(out)[0]
}

function quoteEmail(value) {
  if (!value || !/^[^\s@']+@[^\s@']+\.[^\s@']+$/.test(value)) {
    console.error(`Email inválido: ${value ?? '(vacío)'}`)
    process.exit(1)
  }
  return `'${value}'`
}

function setSuspended(value, suspended) {
  const { results } = sql(
    `UPDATE users SET suspended_at = ${suspended ? "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')" : 'NULL'}
     WHERE email = ${quoteEmail(value)} RETURNING id`,
  )
  if (results.length === 0) {
    console.error(`No existe un usuario con email ${value} (debe haber iniciado sesión al menos una vez).`)
    process.exit(1)
  }
  console.log(suspended ? `Suspendido: ${value}. Ya no puede entrar al dashboard ni usar el MCP.` : `Reactivado: ${value}.`)
}

switch (command) {
  case 'list': {
    const { results } = sql(
      `SELECT email, CASE WHEN suspended_at IS NULL THEN 'activo' ELSE 'suspendido desde ' || suspended_at END AS estado,
              created_at AS desde, (SELECT COUNT(*) FROM transactions t WHERE t.user_id = users.id) AS movimientos
       FROM users ORDER BY created_at`,
    )
    console.table(results)
    break
  }
  case 'suspend':
    setSuspended(email, true)
    break
  case 'reactivate':
    setSuspended(email, false)
    break
  default:
    console.log('Uso: pnpm admin <list | suspend <email> | reactivate <email>> [--local]')
    process.exit(command ? 1 : 0)
}
