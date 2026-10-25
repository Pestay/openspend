import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { StatusBar } from 'expo-status-bar'
import { useEffect } from 'react'
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, View } from 'react-native'
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context'
import { configureApi } from './src/api'
import { AuthProvider, useAuth } from './src/auth'
import { Dashboard } from './src/dashboard'
import { colors } from './src/theme'

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 1 } } })

export default function App() {
  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
            <StatusBar style="dark" />
            <Root />
          </SafeAreaView>
        </AuthProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  )
}

function Root() {
  const auth = useAuth()

  useEffect(() => {
    configureApi({ getToken: auth.getIdToken, onUnauthorized: () => void auth.logout() })
    if (auth.status === 'signedOut') queryClient.clear()
  }, [auth])

  if (auth.status === 'loading') return <ActivityIndicator style={{ flex: 1 }} color={colors.primary} />
  if (auth.status === 'signedIn') return <Dashboard />
  return (
    <View style={styles.login}>
      <Image source={require('./assets/icon.png')} style={{ width: 72, height: 72, borderRadius: 16 }} />
      <Text style={styles.title}>OpenSpend</Text>
      <Text style={{ color: colors.muted }}>Usa el email con el que fuiste invitado</Text>
      <Pressable style={styles.button} onPress={auth.login}>
        <Text style={{ color: '#fff', fontWeight: '600' }}>Iniciar sesión</Text>
      </Pressable>
    </View>
  )
}

const styles = StyleSheet.create({
  login: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24 },
  title: { fontSize: 28, fontWeight: '600', color: colors.text },
  button: { backgroundColor: colors.primary, borderRadius: 10, paddingVertical: 12, paddingHorizontal: 32, marginTop: 12 },
})
