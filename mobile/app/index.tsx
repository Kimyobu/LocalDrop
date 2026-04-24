/**
 * LocalDrop Mobile — Connect Screen
 * Auto-Discovery LAN scanning + Manual IP fallback + PIN input
 */
import { useState, useEffect } from 'react'
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  Alert, ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView,
} from 'react-native'
import { router } from 'expo-router'
import * as Network from 'expo-network'
import * as Device from 'expo-device'
import { setServer, pair, getStatus } from '../src/api/client'
import { discoverServer, probeDirectIP } from '../src/services/discovery'

export default function ConnectScreen() {
  const [ip, setIp] = useState('')
  const [port, setPort] = useState('8700')
  const [pin, setPin] = useState('')
  const [loading, setLoading] = useState(false)
  const [scanning, setScanning] = useState(false)
  const [serverInfo, setServerInfo] = useState<any>(null)
  const [step, setStep] = useState<'scan' | 'ip' | 'pin'>('scan')

  useEffect(() => {
    scanNetwork()
  }, [])

  const scanNetwork = async () => {
    setScanning(true)
    setStep('scan')
    try {
      // เพิ่ม timeout ครอบ discoverServer ป้องกันค้างนาน
      // เปลี่ยนแค่ส่วนนี้ใน scanNetwork()
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Scan timeout')), 45000) // 10s → 45s
      )
      const server = await Promise.race([discoverServer(), timeoutPromise])
      handleServerFound(server.ip, server.port, { name: server.name })
    } catch (err: any) {
      console.log('[Discovery] Failed:', err.message)
      setStep('ip')
    } finally {
      setScanning(false)
    }
  }

  const handleServerFound = async (foundIp: string, foundPort: number, statusData: any) => {
    setIp(foundIp)
    setPort(foundPort.toString())
    setServerInfo(statusData)
    setServer(foundIp, foundPort)

    if (statusData.pinRequired) {
      setStep('pin')
    } else {
      // Auto-connect for No-PIN mode
      setLoading(true)
      try {
        const dName = Device.deviceName || Device.modelName || 'Mobile Device'
        const result = await pair(dName)
        if (result.success) {
          router.replace('/dashboard')
        } else {
          Alert.alert('Error', result.error || 'Connection failed')
          setStep('ip')
        }
      } catch {
        setStep('ip')
      } finally {
        setLoading(false)
      }
    }
  }

  const handleCheckServer = async () => {
    const trimmedIp = ip.trim()
    if (!trimmedIp) return Alert.alert('Error', 'กรุณาใส่ IP address')

    if (!/^(\d{1,3}\.){3}\d{1,3}$/.test(trimmedIp)) {
      return Alert.alert('รูปแบบ IP ผิด', 'ตัวอย่าง: 192.168.0.100')
    }

    const portNum = parseInt(port) || 8700
    setLoading(true)
    try {
      // ลอง probe ตรงก่อน (มี retry ในตัว)
      console.log(`[Connect] Probing ${trimmedIp}:${portNum}...`)
      const probeResult = await probeDirectIP(trimmedIp, portNum)

      if (!probeResult) {
        throw new Error(`ไม่สามารถเชื่อมต่อ ${trimmedIp}:${portNum} ได้`)
      }

      setServer(trimmedIp, portNum)
      const status = await getStatus()
      setServerInfo(status)

      if (status.pinRequired) {
        setStep('pin')
      } else {
        const dName = Device.deviceName || Device.modelName || 'Mobile'
        const result = await pair(dName)
        if (result.success) {
          router.replace('/dashboard')
        } else {
          Alert.alert('Error', result.error || 'Pairing failed')
        }
      }
    } catch (err: any) {
      // clear state เมื่อ fail
      setServer('', 0)

      const errMsg = err.message || ''
      let helpText = `IP: ${trimmedIp}:${portNum}\n\n`
      if (errMsg.includes('Cleartext') || errMsg.includes('CLEARTEXT')) {
        helpText += '⚠️ Android บล็อก HTTP cleartext\n'
        helpText += 'กรุณา rebuild APK ใหม่ (expo-build-properties ต้อง set usesCleartextTraffic)'
      } else {
        helpText += 'สาเหตุที่เป็นไปได้:\n'
        helpText += '• Desktop app ยังไม่ได้เปิด\n'
        helpText += '• มือถือกับคอมอยู่คนละ WiFi\n'
        helpText += '• Firewall block port 8700\n\n'
        helpText += `Error: ${errMsg}`
      }

      Alert.alert('เชื่อมต่อไม่ได้', helpText)
    } finally {
      setLoading(false)
    }
  }

  const handlePair = async () => {
    if (!pin.trim()) return Alert.alert('Error', 'Please enter the PIN shown on desktop')

    setLoading(true)
    try {
      const dName = Device.deviceName || Device.modelName || 'Mobile Device'
      const result = await pair(dName, pin.trim())
      if (result.success) {
        router.replace('/dashboard')
      } else {
        Alert.alert('Invalid PIN', 'The PIN you entered is incorrect. Check the desktop app.')
        setPin('')
      }
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Pairing failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.logo}>⚡</Text>
        <Text style={styles.title}>LocalDrop</Text>
        <Text style={styles.subtitle}>LAN File Sharing</Text>
      </View>

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.formContainer}
      >
        <ScrollView contentContainerStyle={styles.formScroll} keyboardShouldPersistTaps="handled">

          {step === 'scan' ? (
            /* ── Step 0: Scanning ──── */
            <View style={[styles.card, { alignItems: 'center', paddingVertical: 40 }]}>
              <ActivityIndicator size="large" color="#00B2FF" style={{ marginBottom: 20 }} />
              <Text style={styles.cardTitle}>Scanning Network...</Text>
              <Text style={[styles.cardSubtitle, { textAlign: 'center' }]}>
                Looking for LocalDrop desktop app on your local network
              </Text>

              <TouchableOpacity
                style={[styles.btn, { backgroundColor: '#F1F5F9', marginTop: 20, width: '100%', elevation: 0, shadowOpacity: 0 }]}
                onPress={() => setStep('ip')}
              >
                <Text style={[styles.btnText, { color: '#64748B' }]}>Enter IP Manually</Text>
              </TouchableOpacity>
            </View>
          ) : step === 'ip' ? (
            /* ── Step 1: Enter IP ──── */
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Connect Manually</Text>
              <Text style={styles.cardSubtitle}>
                Could not find server automatically. Enter the IP address shown on the desktop app.
              </Text>

              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>IP Address</Text>
                <TextInput
                  style={styles.input}
                  placeholder="192.168.0.xxx"
                  placeholderTextColor="#94A3B8"
                  value={ip}
                  onChangeText={setIp}
                  keyboardType="decimal-pad"
                  autoFocus
                />
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>Port</Text>
                <TextInput
                  style={styles.input}
                  placeholder="8700"
                  placeholderTextColor="#94A3B8"
                  value={port}
                  onChangeText={setPort}
                  keyboardType="number-pad"
                />
              </View>

              <TouchableOpacity
                style={[styles.btn, loading && styles.btnDisabled]}
                onPress={handleCheckServer}
                disabled={loading}
                activeOpacity={0.8}
              >
                {loading ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <Text style={styles.btnText}>Connect →</Text>
                )}
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.backBtn}
                onPress={scanNetwork}
              >
                <Text style={styles.backBtnText}>↻ Rescan Network</Text>
              </TouchableOpacity>
            </View>
          ) : (
            /* ── Step 2: Enter PIN ──── */
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Enter PIN</Text>
              <Text style={styles.cardSubtitle}>
                Found "{serverInfo?.name || 'Desktop'}". Enter the 6-digit PIN shown on the screen.
              </Text>

              <View style={styles.inputGroup}>
                <TextInput
                  style={[styles.input, styles.pinInput]}
                  placeholder="000000"
                  placeholderTextColor="#CBD5E1"
                  value={pin}
                  onChangeText={setPin}
                  keyboardType="number-pad"
                  maxLength={6}
                  autoFocus
                  textAlign="center"
                />
              </View>

              <TouchableOpacity
                style={[styles.btn, loading && styles.btnDisabled]}
                onPress={handlePair}
                disabled={loading}
                activeOpacity={0.8}
              >
                {loading ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <Text style={styles.btnText}>Pair 🔗</Text>
                )}
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.backBtn}
                onPress={() => { setStep('ip'); setPin('') }}
              >
                <Text style={styles.backBtnText}>← Change Server</Text>
              </TouchableOpacity>
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FFFFFF' },
  header: {
    backgroundColor: '#00B2FF',
    paddingTop: 80,
    paddingBottom: 40,
    alignItems: 'center',
    borderBottomLeftRadius: 32,
    borderBottomRightRadius: 32,
  },
  logo: { fontSize: 48, marginBottom: 8 },
  title: { fontSize: 28, fontWeight: '800', color: '#FFFFFF', letterSpacing: -0.5 },
  subtitle: { fontSize: 14, color: 'rgba(255,255,255,0.8)', marginTop: 4 },

  formContainer: { flex: 1 },
  formScroll: { padding: 24, paddingTop: 32 },

  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 16,
    elevation: 4,
    borderWidth: 1,
    borderColor: '#F1F5F9',
  },
  cardTitle: { fontSize: 20, fontWeight: '700', color: '#1E293B', marginBottom: 4 },
  cardSubtitle: { fontSize: 14, color: '#94A3B8', marginBottom: 24, lineHeight: 20 },

  inputGroup: { marginBottom: 16 },
  inputLabel: { fontSize: 13, fontWeight: '600', color: '#475569', marginBottom: 6 },
  input: {
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 12,
    padding: 14,
    fontSize: 16,
    color: '#1E293B',
  },
  pinInput: {
    fontSize: 32,
    fontWeight: '800',
    letterSpacing: 12,
    paddingVertical: 18,
  },

  btn: {
    backgroundColor: '#00B2FF',
    borderRadius: 14,
    padding: 16,
    alignItems: 'center',
    marginTop: 8,
    shadowColor: '#00B2FF',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  btnDisabled: { opacity: 0.6 },
  btnText: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },

  backBtn: { marginTop: 16, alignItems: 'center', padding: 8 },
  backBtnText: { color: '#00B2FF', fontSize: 14, fontWeight: '600' },
})
