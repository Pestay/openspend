import { useState } from 'react'
import { EXAMPLES, fillTemplate, GUIDES, mcpUrl as mcpUrlFor, rich } from '../shared/connect-guide'
import { Connections } from './connections'
import { Card } from './ui'

// Conectar asistentes sin salir de la app: URL del MCP, pasos por cliente y asistentes con acceso.
export function ConnectPage() {
  const mcpUrl = mcpUrlFor(window.location.origin)
  return (
    <>
      <Card title="URL del servidor MCP">
        <CopyRow text={mcpUrl} className="text-sm" />
        <p className="mt-2 text-xs text-slate-400">
          Al conectar, el asistente te pedirá iniciar sesión en OpenSpend y aprobar el acceso. Solo verá tus datos.
        </p>
      </Card>

      <div className="grid gap-6 md:grid-cols-2">
        {GUIDES.map((guide) => (
          <section key={guide.id} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="font-semibold">
              {guide.title}
              {guide.subtitle && <span className="font-normal text-slate-400"> · {guide.subtitle}</span>}
            </h2>
            <ol className="mt-3 list-inside list-decimal space-y-2 text-sm text-slate-700">
              {guide.steps.map((step) => (
                <li key={step}>
                  <RichText text={step} />
                </li>
              ))}
            </ol>
            {guide.snippet && (
              <CopyRow text={fillTemplate(guide.snippet.template, mcpUrl)} block={guide.snippet.block} className="my-2 text-xs" />
            )}
            {guide.after && (
              <p className="text-sm text-slate-700">
                <RichText text={guide.after} />
              </p>
            )}
            {guide.note && <p className="text-xs text-slate-400">{guide.note}</p>}
          </section>
        ))}
      </div>

      <Card title="Prueba con frases como">
        <ul className="flex flex-wrap gap-2 text-sm">
          {EXAMPLES.map((example) => (
            <li key={example} className="rounded-full bg-emerald-50 px-3 py-1 text-emerald-800">
              “{example}”
            </li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-slate-400">
          Antes de guardar, el asistente te muestra una vista previa para que confirmes o corrijas.
        </p>
      </Card>

      <Connections />
    </>
  )
}

function RichText({ text }: { text: string }) {
  return rich(text).map((segment, i) =>
    segment.bold ? (
      <strong key={i}>{segment.text}</strong>
    ) : segment.code ? (
      <code key={i} className="rounded bg-slate-100 px-1">
        {segment.text}
      </code>
    ) : (
      segment.text
    ),
  )
}

function CopyRow({ text, block, className = '' }: { text: string; block?: boolean; className?: string }) {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    await navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }
  const box = 'min-w-0 flex-1 overflow-x-auto rounded border border-slate-200 bg-slate-50 px-3 py-2'
  return (
    <div className={`flex items-start gap-2 ${className}`}>
      {block ? <pre className={box}>{text}</pre> : <code className={`${box} whitespace-nowrap`}>{text}</code>}
      <button onClick={copy} className="rounded border border-slate-300 bg-white px-3 py-2 text-sm hover:bg-slate-50">
        {copied ? 'Copiado ✓' : 'Copiar'}
      </button>
    </div>
  )
}
