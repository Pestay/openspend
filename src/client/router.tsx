import type { QueryClient } from '@tanstack/react-query'
import { createRootRouteWithContext, createRoute, createRouter } from '@tanstack/react-router'
import { z } from 'zod'
import {
  accountsQuery,
  categoriesQuery,
  connectionsQuery,
  importsQuery,
  meQuery,
  summaryQuery,
  transactionsQuery,
} from './api'
import { AccountsPage } from './accounts-page'
import { CategoriesPage } from './categories-page'
import { ImportPage } from './import-page'
import { Dashboard, DashboardSkeleton } from './dashboard'
import { today } from './dates'
import { ErrorScreen, RootLayout, Splash } from './layout'
import { parsePeriod, periodRange } from './period'

// Los loaders precargan los datos en la caché de TanStack Query antes de dibujar la ruta,
// así los componentes nunca muestran estados vacíos mientras cargan.
const rootRoute = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  loader: ({ context: { queryClient } }) =>
    Promise.all([queryClient.ensureQueryData(meQuery), queryClient.ensureQueryData(categoriesQuery)]),
  component: RootLayout,
  // La carga inicial muestra el logo de inmediato, en vez de una pantalla en blanco.
  pendingComponent: Splash,
  pendingMs: 0,
  errorComponent: ErrorScreen,
})

// Período del dashboard en la URL: ?vista=mes&mes=2026-10 · ?vista=anio&anio=2024 · ?vista=todo
const dashboardSearch = z.object({
  vista: z.enum(['mes', 'anio', 'todo']).optional().catch(undefined),
  mes: z
    .string()
    .regex(/^\d{4}-(0[1-9]|1[0-2])$/)
    .optional()
    .catch(undefined),
  anio: z
    .string()
    .regex(/^\d{4}$/)
    .optional()
    .catch(undefined),
})

const dashboardRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  validateSearch: dashboardSearch,
  loaderDeps: ({ search }) => periodRange(parsePeriod(search, today())),
  loader: ({ context: { queryClient }, deps: { from, to } }) => {
    return Promise.all([
      queryClient.ensureQueryData(summaryQuery(from, to)),
      queryClient.ensureQueryData(transactionsQuery(from, to)),
      queryClient.ensureQueryData(accountsQuery),
      queryClient.ensureQueryData(connectionsQuery),
    ])
  },
  component: Dashboard,
  pendingComponent: DashboardSkeleton,
})

const categoriesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/categorias',
  loader: ({ context: { queryClient } }) => queryClient.ensureQueryData(categoriesQuery),
  component: CategoriesPage,
})

const accountsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/cuentas',
  loader: ({ context: { queryClient } }) => queryClient.ensureQueryData(accountsQuery),
  component: AccountsPage,
})

const importRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/importar',
  loader: ({ context: { queryClient } }) =>
    Promise.all([
      queryClient.ensureQueryData(importsQuery),
      queryClient.ensureQueryData(accountsQuery),
    ]),
  component: ImportPage,
})

const routeTree = rootRoute.addChildren([dashboardRoute, categoriesRoute, accountsRoute, importRoute])

export function createAppRouter(queryClient: QueryClient) {
  return createRouter({
    routeTree,
    // La app vive en /app; la raíz y /conectar son páginas públicas estáticas.
    basepath: '/app',
    context: { queryClient },
    // Precarga la ruta al pasar el mouse por un link (ej. cambiar de mes es instantáneo).
    defaultPreload: 'intent',
    // Los datos los cachea TanStack Query; el router no necesita su propia caché.
    defaultPreloadStaleTime: 0,
  })
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof createAppRouter>
  }
}
