import type { Metadata, Viewport } from 'next';
import { ThemeProvider } from '@/components/theme-provider';
import { Toaster } from '@/components/ui/toaster';
import { UploadJobsProvider } from '@/components/upload/upload-jobs-provider';
import { BackgroundController } from '@/components/background-controller';
import { GlobalListeners } from '@/components/global-listeners';
import { SmartAuthProvider } from '@/hooks/use-smart-auth';
import { FeatureFlagProvider } from '@/components/feature-flag-provider';
import { PT_Sans, Space_Grotesk, Source_Code_Pro } from 'next/font/google';
import './globals.css';

const ptSans = PT_Sans({
  subsets: ['latin'],
  weight: ['400', '700'],
  variable: '--font-pt-sans',
});

const spaceGrotesk = Space_Grotesk({
  subsets: ['latin'],
  weight: ['400', '700'],
  variable: '--font-space-grotesk',
});

const sourceCodePro = Source_Code_Pro({
  subsets: ['latin'],
  weight: ['400', '600'],
  variable: '--font-source-code-pro',
});

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
    <html lang="en" suppressHydrationWarning className={`${ptSans.variable} ${spaceGrotesk.variable} ${sourceCodePro.variable}`}>
      <body className="font-body antialiased">
        <ThemeProvider
          attribute="class"
          defaultTheme="dark"
          enableSystem
          disableTransitionOnChange
        >
          <SmartAuthProvider>
            <FeatureFlagProvider>
              <BackgroundController />
              <UploadJobsProvider>{children}</UploadJobsProvider>
              <GlobalListeners />
              <Toaster />
            </FeatureFlagProvider>
          </SmartAuthProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
