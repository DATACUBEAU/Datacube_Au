import type { Metadata, Viewport } from 'next';
import { ThemeProvider } from '@/components/theme-provider';
import { Toaster } from '@/components/ui/toaster';
import { UploadJobsProvider } from '@/components/upload/upload-jobs-provider';
import { BackgroundController } from '@/components/background-controller';
import { GlobalListeners } from '@/components/global-listeners';
import { SmartAuthProvider } from '@/hooks/use-smart-auth';
import { NetworkStatusProvider } from '@/components/providers/network-status-provider';
import { FeatureFlagProvider } from '@/components/feature-flag-provider';
import { LimitsProvider } from '@/components/providers/limits-provider';
import { AuthLockOverlay } from '@/components/auth-lock-overlay';
import { SessionDebugPanel } from '@/components/session-debug-panel';
import './globals.css';

const APP_NAME = 'DataCube AU';
const APP_DESCRIPTION = 'Your personal LLM for your own data.';

export const metadata: Metadata = {
  applicationName: APP_NAME,
  title: {
    default: APP_NAME,
    template: `%s | ${APP_NAME}` ,
  },
  description: APP_DESCRIPTION,
  manifest: '/manifest.webmanifest',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: APP_NAME,
  },
  formatDetection: {
    telephone: false,
  },
  icons: {
    icon: '/icon.png',
    shortcut: '/icon.png',
    apple: '/icon.png',
  },
};

export const viewport: Viewport = {
  themeColor: '#3F51B5',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="font-body antialiased">
        <ThemeProvider
          attribute="class"
          defaultTheme="dark"
          enableSystem
          disableTransitionOnChange
        >
          <NetworkStatusProvider>
            <SmartAuthProvider>
              <FeatureFlagProvider>
                <LimitsProvider>
                  <div className="relative isolate" id="app-shell">
                    <BackgroundController />
                    <div className="relative z-10">
                      <UploadJobsProvider>{children}</UploadJobsProvider>
                      <GlobalListeners />
                      <AuthLockOverlay />
                      <SessionDebugPanel />
                      <Toaster />
                    </div>
                  </div>
                </LimitsProvider>
              </FeatureFlagProvider>
            </SmartAuthProvider>
          </NetworkStatusProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
