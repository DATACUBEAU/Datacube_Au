import type { Metadata, Viewport } from 'next';
import { ThemeProvider } from '@/components/theme-provider';
import { Toaster } from '@/components/ui/toaster';
import { UploadJobsProvider } from '@/components/upload/upload-jobs-provider';
import { BackgroundController } from '@/components/background-controller';
import { GlobalListeners } from '@/components/global-listeners';
import { SmartAuthProvider } from '@/hooks/use-smart-auth';
import { NetworkStatusProvider } from '@/components/providers/network-status-provider';
import { FeatureFlagProvider } from '@/components/feature-flag-provider';
import { AccountSnapshotProvider } from '@/components/providers/account-snapshot-provider';
import { LimitsProvider } from '@/components/providers/limits-provider';
import { AuthLockOverlay } from '@/components/auth-lock-overlay';
import { SessionDebugPanel } from '@/components/session-debug-panel';
import { ServiceWorkerUpdater } from '@/components/service-worker-updater';
import './globals.css';

const APP_NAME = 'DataCube AU';
const APP_DESCRIPTION = 'Datacube AU is an AI study platform for your own data.';
const COMPANY_NAME = 'Zahed Investment Ltd';
const COMPANY_RC = '8127949';

export const metadata: Metadata = {
  applicationName: APP_NAME,
  title: {
    default: APP_NAME,
    template: `%s | ${APP_NAME}` ,
  },
  description: APP_DESCRIPTION,
  creator: COMPANY_NAME,
  publisher: COMPANY_NAME,
  authors: [{ name: COMPANY_NAME }],
  openGraph: {
    title: APP_NAME,
    description: `${APP_DESCRIPTION} Built by ${COMPANY_NAME}. RC ${COMPANY_RC}.`,
    siteName: APP_NAME,
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: APP_NAME,
    description: `${APP_DESCRIPTION} Built by ${COMPANY_NAME}. RC ${COMPANY_RC}.`,
  },
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
              <AccountSnapshotProvider>
                <FeatureFlagProvider>
                  <LimitsProvider>
                    <div className="relative isolate" id="app-shell">
                      <BackgroundController />
                      <div className="relative z-10">
                        <UploadJobsProvider>{children}</UploadJobsProvider>
                        <GlobalListeners />
                        <AuthLockOverlay />
                        <SessionDebugPanel />
                        <ServiceWorkerUpdater />
                        <Toaster />
                      </div>
                    </div>
                  </LimitsProvider>
                </FeatureFlagProvider>
              </AccountSnapshotProvider>
            </SmartAuthProvider>
          </NetworkStatusProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
