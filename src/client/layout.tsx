import { useSuspenseQuery } from '@tanstack/react-query'
import { Link, Outlet, type ErrorComponentProps } from '@tanstack/react-router'
import { meQuery } from './api'

export function RootLayout() {
  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <div className="mx-auto max-w-5xl space-y-6 px-4 py-8">
        <header className="flex flex-wrap items-center justify-between gap-4">
          <Link to="/" className="flex items-center gap-2 text-2xl font-semibold">
            <img src="/logo.svg" alt="" className="h-8 w-8" />
            OpenSpend
          </Link>
          <nav className="flex items-center gap-1 text-sm">
            {[
              { to: '/', label: 'Resumen' },
              { to: '/categorias', label: 'Categorías' },
              { to: '/cuentas', label: 'Cuentas' },
              { to: '/importar', label: 'Importar' },
              { to: '/conectar', label: 'Conectar asistente' },
            ].map((item) => (
              <Link
                key={item.to}
                to={item.to}
                className="rounded px-3 py-1.5 text-slate-600 hover:bg-slate-200"
                activeProps={{ className: 'bg-emerald-50 font-medium text-emerald-800 hover:bg-emerald-100' }}
                activeOptions={{ exact: true, includeSearch: false }}
              >
                {item.label}
              </Link>
            ))}
          </nav>
          <UserMenu />
        </header>
        <Outlet />
      </div>
    </div>
  )
}

function UserMenu() {
  const { data } = useSuspenseQuery(meQuery)
  return (
    <form method="post" action="/auth/logout" className="flex items-center gap-2 text-sm text-slate-500">
      <span>{data.email}</span>
      <button className="rounded px-2 py-1 hover:bg-slate-200">Salir</button>
    </form>
  )
}

// Se muestra mientras se confirma la sesión y se cargan los datos iniciales.
export function Splash() {
  return (
    <div className="grid min-h-screen place-items-center bg-slate-50">
      <img src="/logo.svg" alt="Cargando OpenSpend" className="h-14 w-14 animate-pulse" />
    </div>
  )
}

export function ErrorScreen({ error }: ErrorComponentProps) {
  return (
    <div className="grid min-h-screen place-items-center bg-slate-50 p-4 text-center">
      <div className="space-y-3">
        <img src="/logo.svg" alt="" className="mx-auto h-12 w-12" />
        <p className="text-slate-700">No se pudo cargar OpenSpend.</p>
        <p className="text-sm text-slate-400">{error instanceof Error ? error.message : String(error)}</p>
        <button className="rounded bg-emerald-700 px-3 py-1.5 text-sm text-white" onClick={() => window.location.reload()}>
          Reintentar
        </button>
      </div>
    </div>
  )
}
