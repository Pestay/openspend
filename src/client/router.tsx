import type { QueryClient } from '@tanstack/react-query'
import { createRootRouteWithContext, createRoute, createRouter } from '@tanstack/react-router'
import { z } from 'zod'
import { accountsQuery, categoriesQuery, connectionsQuery, meQuery, summaryQuery, transactionsQuery } from './api'
import { AccountsPage } from './accounts-page'
import { CategoriesPage } from './categories-page'
import { ConnectPage } from './connect-page'
import { Dashboard, DashboardSkeleton } from './dashboard'
import { currentMonth, monthRange } from './dates'
import { ErrorScreen, RootLayout, Splash } from './layout'

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

const dashboardSearch = z.object({
  mes: z
    .string()
    .regex(/^\d{4}-(0[1-9]|1[0-2])$/)
    .optional()
    .catch(undefined),
})

const dashboardRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  validateSearch: dashboardSearch,
  loaderDeps: ({ search }) => ({ mes: search.mes ?? currentMonth() }),
  loader: ({ context: { queryClient }, deps: { mes } }) => {
    const { from, to } = monthRange(mes)
    return Promise.all([
      queryClient.ensureQueryData(summaryQuery(from, to)),
      queryClient.ensureQueryData(transactionsQuery(from, to)),
      queryClient.ensureQueryData(accountsQuery),
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

const connectRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/conectar',
  loader: ({ context: { queryClient } }) => queryClient.ensureQueryData(connectionsQuery),
  component: ConnectPage,
})

const routeTree = rootRoute.addChildren([dashboardRoute, categoriesRoute, accountsRoute, connectRoute])

export function createAppRouter(queryClient: QueryClient) {
  return createRouter({
    routeTree,
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
