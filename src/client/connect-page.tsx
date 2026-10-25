import { useSuspenseQuery } from '@tanstack/react-query'
import { useState, type ReactNode } from 'react'
import { connectionsQuery, useRevokeConnection } from './api'
import { Button, Card, ErrorText } from './ui'

const mcpUrl = () => `${window.location.origin}/mcp`

const EXAMPLES = [
  'Hoy gasté 8 lucas en almuerzo y 4.200 en uber',
  'Ayer pagué Netflix, 9,99 dólares',
  'Me llegó el sueldo: 1.800.000',
  '¿Cuánto llevo gastado este mes por categoría?',
  'El uber de ayer era de trabajo, pásalo a Transporte',
]

export function ConnectPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Conecta tu asistente</h1>
        <p className="mt-1 text-sm text-slate-500">
          Registra y consulta tus gastos conversando con Claude, ChatGPT u otro asistente compatible con MCP. No necesitas
          programar ni API keys: solo pegar una URL e iniciar sesión.
        </p>
      </div>

      <Card title="URL del servidor MCP">
        <CopyField value={mcpUrl()} />
        <p className="mt-2 text-xs text-slate-400">
          Al conectar, el asistente te pedirá iniciar sesión en OpenSpend y aprobar el acceso. Solo verá tus datos.
        </p>
      </Card>

      <div className="grid gap-6 md:grid-cols-2">
        <Guide title="Claude (web, escritorio y celular)">
          <li>
            Abre <strong>Settings → Connectors</strong> y elige <strong>Add custom connector</strong>.
          </li>
          <li>
            Nombre <code>OpenSpend</code> y pega la URL de arriba.
          </li>
          <li>
            Presiona <strong>Connect</strong>, inicia sesión y elige <strong>Permitir</strong>.
          </li>
          <li>Queda disponible también en la app del celular.</li>
        </Guide>
        <Guide title="ChatGPT">
          <li>
            Abre <strong>Settings → Apps &amp; Connectors</strong> (puede requerir activar el modo desarrollador según tu
            plan).
          </li>
          <li>Crea un conector nuevo con la URL de arriba y autenticación OAuth.</li>
          <li>
            Inicia sesión y elige <strong>Permitir</strong>.
          </li>
        </Guide>
        <Guide title="Claude Code">
          <li>En la terminal:</li>
          <CopyField value={`claude mcp add --transport http --scope user openspend ${mcpUrl()}`} />
          <li>
            Luego, dentro de Claude Code: <code>/mcp</code> → <strong>openspend</strong> → <strong>Authenticate</strong>.
          </li>
        </Guide>
        <Guide title="Otros (Cursor, VS Code, Cline…)">
          <li>Agrega un servidor MCP remoto (HTTP) con esta configuración:</li>
          <CopyField value={JSON.stringify({ mcpServers: { openspend: { url: mcpUrl() } } }, null, 2)} multiline />
          <li>El cliente debe soportar login OAuth para servidores MCP.</li>
        </Guide>
      </div>

      <Card title="Prueba con frases como">
        <ul className="flex flex-wrap gap-2">
          {EXAMPLES.map((e) => (
            <li key={e} className="rounded-full bg-emerald-50 px-3 py-1 text-sm text-emerald-800">
              “{e}”
            </li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-slate-400">
          Antes de guardar, el asistente te muestra una vista previa para que confirmes o corrijas.
        </p>
      </Card>

      <Connections />
    </div>
  )
}

function Guide({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card title={title}>
      <ol className="list-inside list-decimal space-y-2 text-sm text-slate-700 [&_code]:rounded [&_code]:bg-slate-100 [&_code]:px-1">
        {children}
      </ol>
    </Card>
  )
}

function CopyField({ value, multiline = false }: { value: string; multiline?: boolean }) {
  const [copied, setCopied] = useState(false)
  async function copy() {
    await navigator.clipboard.writeText(value)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }
  return (
    <div className="my-1 flex items-start gap-2">
      <code
        className={`min-w-0 flex-1 rounded border border-slate-200 bg-slate-50 px-2 py-1.5 text-xs text-slate-700 ${multiline ? 'whitespace-pre' : 'truncate'} overflow-x-auto`}
      >
        {value}
      </code>
      <Button type="button" variant="secondary" onClick={copy}>
        {copied ? 'Copiado ✓' : 'Copiar'}
      </Button>
    </div>
  )
}

function Connections() {
  const { data: connections } = useSuspenseQuery(connectionsQuery)
  const revoke = useRevokeConnection()
  const [confirming, setConfirming] = useState<string | null>(null)
  const date = (iso: string) => new Date(iso).toLocaleString('es-CL', { dateStyle: 'medium', timeStyle: 'short' })

  return (
    <Card title="Asistentes con acceso">
      {connections.length === 0 ? (
        <p className="text-sm text-slate-400">Aún no has conectado ningún asistente.</p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {connections.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center gap-3 py-2 text-sm">
              <span className="min-w-0 flex-1">
                <span className="font-medium">{c.clientName}</span>
                <span className="ml-2 text-xs text-slate-400">
                  {c.redirectHost ? `${c.redirectHost} · ` : ''}conectado el {date(c.connectedAt)}
                </span>
              </span>
              {confirming === c.id ? (
                <span className="flex items-center gap-2">
                  <span className="text-xs text-slate-500">¿Quitar el acceso?</span>
                  <Button variant="danger" disabled={revoke.isPending} onClick={() => revoke.mutate(c.id)}>
                    Desconectar
                  </Button>
                  <Button variant="ghost" onClick={() => setConfirming(null)}>
                    Cancelar
                  </Button>
                </span>
              ) : (
                <Button variant="ghost" onClick={() => setConfirming(c.id)}>
                  Desconectar
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      <ErrorText error={revoke.error} />
      <p className="mt-3 text-xs text-slate-400">
        Desconectar invalida de inmediato los tokens de ese asistente; para volver a usarlo tendrás que conectarlo de nuevo.
      </p>
    </Card>
  )
}
