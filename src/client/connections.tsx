import { useSuspenseQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { connectionsQuery, useRevokeConnection } from './api'
import { Button, Card, ErrorText } from './ui'

// Asistentes con acceso OAuth al MCP de este usuario, con opción de desconectarlos.
export function Connections() {
  const { data: connections } = useSuspenseQuery(connectionsQuery)
  const revoke = useRevokeConnection()
  const [confirming, setConfirming] = useState<string | null>(null)
  const date = (iso: string) => new Date(iso).toLocaleString('es-CL', { dateStyle: 'medium', timeStyle: 'short' })

  return (
    <Card
      title="Asistentes con acceso"
      action={
        <a href="/conectar/" className="text-sm text-emerald-700 hover:underline">
          Conectar un asistente →
        </a>
      }
    >
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
