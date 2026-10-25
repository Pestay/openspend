import { useQuery } from '@tanstack/react-query'
import { useState, type ReactNode } from 'react'
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import { currentMonth, monthLabel, monthRange, shiftMonth, today } from '../../src/client/dates'
import { formatMoney, type Currency } from '../../src/shared/money'
import { accountsQuery, categoriesQuery, summaryQuery, transactionsQuery, useCreateTransactions, useDeleteTransaction } from './api'
import { useAuth } from './auth'
import { colors } from './theme'

// Versión móvil de src/client/dashboard.tsx: mismas secciones y mismos datos de la API.

const clp = (n: number) => formatMoney(n, 'CLP')

export function Dashboard() {
  const { email, logout } = useAuth()
  const [month, setMonth] = useState(currentMonth())
  const { from, to } = monthRange(month)
  const summary = useQuery(summaryQuery(from, to))
  const transactions = useQuery(transactionsQuery(from, to))
  const accounts = useQuery(accountsQuery)
  const categories = useQuery(categoriesQuery)
  const all = [summary, transactions, accounts, categories]
  const refetchAll = () => void Promise.all(all.map((q) => q.refetch()))

  return (
    <ScrollView
      contentContainerStyle={styles.screen}
      refreshControl={<RefreshControl refreshing={all.some((q) => q.isRefetching)} onRefresh={refetchAll} />}
    >
      <View style={styles.header}>
        <Text style={styles.title}>OpenSpend</Text>
        <Pressable onPress={logout}>
          <Text style={styles.muted}>{email} · Salir</Text>
        </Pressable>
      </View>

      <View style={styles.monthNav}>
        <Pressable onPress={() => setMonth(shiftMonth(month, -1))} hitSlop={12}>
          <Text style={styles.arrow}>←</Text>
        </Pressable>
        <Text style={styles.monthLabel}>{monthLabel(month)}</Text>
        <Pressable onPress={() => setMonth(shiftMonth(month, 1))} hitSlop={12}>
          <Text style={styles.arrow}>→</Text>
        </Pressable>
      </View>

      {all.find((q) => q.error) && <Text style={styles.error}>{all.find((q) => q.error)!.error!.message}</Text>}

      {summary.data ? (
        <View style={styles.row}>
          <Stat label="Ingresos" value={summary.data.incomeClp} color={colors.income} />
          <Stat label="Gastos" value={summary.data.expenseClp} color={colors.expense} />
          <Stat label="Neto" value={summary.data.netClp} color={summary.data.netClp >= 0 ? colors.income : colors.expense} />
        </View>
      ) : (
        <ActivityIndicator color={colors.primary} />
      )}

      <QuickAdd />

      <Card title="Gastos por categoría">
        {summary.data && <CategoryBreakdown byCategory={summary.data.byCategory} />}
      </Card>

      <Card title="Cuentas">
        {accounts.data
          ?.filter((a) => !a.archived)
          .map((a) => (
            <View key={a.id} style={styles.line}>
              <Text>{a.name}</Text>
              <Text style={styles.amount}>{formatMoney(a.balanceMinor, a.currency)}</Text>
            </View>
          ))}
      </Card>

      <Card title="Movimientos">
        <TransactionList from={from} to={to} />
      </Card>
    </ScrollView>
  )
}

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>{title}</Text>
      {children}
    </View>
  )
}

function Stat({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <View style={[styles.card, styles.stat]}>
      <Text style={styles.cardTitle}>{label}</Text>
      <Text style={[styles.statValue, { color }]} adjustsFontSizeToFit numberOfLines={1}>
        {clp(value)}
      </Text>
    </View>
  )
}

function CategoryBreakdown({ byCategory }: { byCategory: { categoryId: number | null; name: string; kind: string; totalClp: number }[] }) {
  const expenses = byCategory.filter((c) => c.kind === 'expense')
  const max = Math.max(1, ...expenses.map((c) => c.totalClp))
  if (expenses.length === 0) return <Text style={styles.muted}>Sin gastos este mes.</Text>
  return expenses.map((c) => (
    <View key={c.categoryId ?? 'none'} style={{ marginBottom: 8 }}>
      <View style={styles.line}>
        <Text>{c.name}</Text>
        <Text style={styles.amount}>{clp(c.totalClp)}</Text>
      </View>
      <View style={styles.barTrack}>
        <View style={[styles.bar, { width: `${(c.totalClp / max) * 100}%` }]} />
      </View>
    </View>
  ))
}

function QuickAdd() {
  const { data: categories = [] } = useQuery(categoriesQuery)
  const create = useCreateTransactions()
  const [kind, setKind] = useState<'expense' | 'income'>('expense')
  const [currency, setCurrency] = useState<Currency>('CLP')
  const [amount, setAmount] = useState('')
  const [description, setDescription] = useState('')
  const [categoryId, setCategoryId] = useState<number | undefined>()
  const [warning, setWarning] = useState<string | null>(null)

  async function submit() {
    const value = Number(amount.replace(',', '.'))
    if (!(value > 0)) return
    const result = await create.mutateAsync([
      { date: today(), kind, amount: value, currency, categoryId, description: description.trim() || undefined },
    ])
    setWarning(result.duplicates.length > 0 ? 'Guardado, pero parece un duplicado de un movimiento existente.' : null)
    setAmount('')
    setDescription('')
    setCategoryId(undefined)
  }

  return (
    <Card title="Agregar movimiento">
      <View style={styles.chips}>
        <Chip label="Gasto" active={kind === 'expense'} onPress={() => (setKind('expense'), setCategoryId(undefined))} />
        <Chip label="Ingreso" active={kind === 'income'} onPress={() => (setKind('income'), setCategoryId(undefined))} />
        <View style={{ flex: 1 }} />
        <Chip label="CLP" active={currency === 'CLP'} onPress={() => setCurrency('CLP')} />
        <Chip label="USD" active={currency === 'USD'} onPress={() => setCurrency('USD')} />
      </View>
      <TextInput style={styles.input} placeholder="Monto" keyboardType="decimal-pad" value={amount} onChangeText={setAmount} />
      <TextInput style={styles.input} placeholder="Descripción" value={description} onChangeText={setDescription} />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
        {categories
          .filter((c) => c.kind === kind)
          .map((c) => (
            <Chip
              key={c.id}
              label={`${c.icon ?? ''} ${c.name}`}
              active={categoryId === c.id}
              onPress={() => setCategoryId(categoryId === c.id ? undefined : c.id)}
            />
          ))}
      </ScrollView>
      <Pressable style={[styles.button, create.isPending && { opacity: 0.5 }]} onPress={submit} disabled={create.isPending}>
        <Text style={styles.buttonText}>Guardar</Text>
      </Pressable>
      {create.error && <Text style={styles.error}>{create.error.message}</Text>}
      {warning && <Text style={{ color: colors.warning, marginTop: 8 }}>{warning}</Text>}
    </Card>
  )
}

function Chip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={[styles.chip, active && styles.chipActive]}>
      <Text style={active ? { color: '#fff' } : undefined}>{label}</Text>
    </Pressable>
  )
}

function TransactionList({ from, to }: { from: string; to: string }) {
  const { data: transactions } = useQuery(transactionsQuery(from, to))
  const { data: categories = [] } = useQuery(categoriesQuery)
  const remove = useDeleteTransaction()
  const categoryById = new Map(categories.map((c) => [c.id, c]))

  if (!transactions) return <ActivityIndicator color={colors.primary} />
  if (transactions.length === 0) return <Text style={styles.muted}>Sin movimientos este mes.</Text>
  return transactions.map((t) => {
    const category = t.categoryId ? categoryById.get(t.categoryId) : undefined
    const sign = t.kind === 'income' ? '+' : t.kind === 'expense' ? '−' : ''
    const color = t.kind === 'income' ? colors.income : t.kind === 'expense' ? colors.expense : colors.text
    return (
      // Mantener presionado para eliminar (en la web es la ✕ al pasar el mouse).
      <Pressable key={t.id} style={styles.txn} onLongPress={() => remove.mutate(t.id)}>
        <Text style={[styles.muted, { width: 44 }]}>{t.date.slice(5)}</Text>
        <Text>{category?.icon ?? '•'}</Text>
        <Text style={{ flex: 1 }} numberOfLines={1}>
          {t.description ?? t.merchant ?? category?.name ?? '—'}
          {t.possibleDuplicateOf ? ' ⚠︎' : ''}
        </Text>
        <Text style={[styles.amount, { color }]}>
          {sign}
          {formatMoney(t.amountMinor, t.currency)}
        </Text>
      </Pressable>
    )
  })
}

const styles = StyleSheet.create({
  screen: { padding: 16, gap: 16, backgroundColor: colors.background, minHeight: '100%' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  title: { fontSize: 24, fontWeight: '600', color: colors.text },
  muted: { color: colors.muted, fontSize: 13 },
  monthNav: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 16 },
  arrow: { fontSize: 20, paddingHorizontal: 8 },
  monthLabel: { width: 170, textAlign: 'center', fontWeight: '500', textTransform: 'capitalize' },
  row: { flexDirection: 'row', gap: 8 },
  card: { backgroundColor: colors.card, borderRadius: 12, borderWidth: 1, borderColor: colors.border, padding: 16 },
  cardTitle: { color: colors.muted, fontSize: 13, fontWeight: '500', marginBottom: 8 },
  stat: { flex: 1, padding: 12 },
  statValue: { fontSize: 18, fontWeight: '600' },
  line: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 },
  amount: { fontVariant: ['tabular-nums'] },
  barTrack: { height: 6, borderRadius: 3, backgroundColor: colors.border, marginTop: 4 },
  bar: { height: 6, borderRadius: 3, backgroundColor: colors.expense },
  chips: { flexDirection: 'row', gap: 6, marginBottom: 8 },
  chip: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, borderWidth: 1, borderColor: colors.border },
  chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  input: { borderWidth: 1, borderColor: colors.border, borderRadius: 8, padding: 10, marginBottom: 8 },
  button: { backgroundColor: colors.primary, borderRadius: 8, padding: 12, alignItems: 'center' },
  buttonText: { color: '#fff', fontWeight: '600' },
  error: { color: colors.expense, marginTop: 8 },
  txn: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.border },
})
