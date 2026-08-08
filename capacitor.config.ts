import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'com.xfish.moyureader',
  appName: '墨读阅读器',
  webDir: 'dist',
  android: {
    backgroundColor: '#e8ecef',
    allowMixedContent: false,
  },
  plugins: {
    CapacitorHttp: { enabled: true },
    StatusBar: {
      overlaysWebView: false,
      style: 'LIGHT',
      backgroundColor: '#1c2b48',
    },
  },
}

export default config
