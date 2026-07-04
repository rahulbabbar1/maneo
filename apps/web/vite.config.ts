import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    // Split heavy vendors into separate, independently-cacheable chunks so the
    // main app bundle is small and Firebase/React load in parallel (and stay
    // cached across app deploys). Fixes the single ~793 KB chunk warning.
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) {
            // Firestore + its heavy transport deps: only reached via dynamic
            // import, so this becomes an async chunk kept out of initial load.
            if (
              id.includes('firebase/firestore') || id.includes('@firebase/firestore') ||
              id.includes('@firebase/webchannel') || id.includes('@grpc') || id.includes('protobuf')
            ) {
              return 'firestore'
            }
            if (id.includes('firebase') || id.includes('@firebase')) {
              return 'firebase'
            }
            if (id.includes('/react') || id.includes('react-dom') || id.includes('scheduler')) {
              return 'react-vendor'
            }
            return 'vendor'
          }
        },
      },
    },
  },
})
