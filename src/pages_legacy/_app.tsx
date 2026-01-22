import type { AppProps } from 'next/app';
import Head from 'next/head';
import { ThemeProvider } from '@/components/theme-provider';
import { Toaster } from '@/components/ui/toaster';
import { ServiceWorkerRegister } from '@/components/service-worker-register';
import './globals.css';

const APP_NAME = 'DataCube AU';
const APP_DESCRIPTION = 'Your personal LLM for your own data.';

export default function App({ Component, pageProps }: AppProps) {
  return (
    <>
      <Head>
        <title>{APP_NAME}</title>
        <meta name="application-name" content={APP_NAME} />
        <meta name="description" content={APP_DESCRIPTION} />
        <meta name="theme-color" content="#3F51B5" />
        <link rel="manifest" href="/manifest.webmanifest" />
        <link rel="icon" href="/icon.png" />
        <link rel="apple-touch-icon" href="/icon.png" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=PT+Sans:wght@400;700&family=Space+Grotesk:wght@400;700&family=Source+Code+Pro:wght@400;600&display=swap"
        />
      </Head>
      <ThemeProvider attribute="class" defaultTheme="dark" enableSystem disableTransitionOnChange>
        <ServiceWorkerRegister />
        <Component {...pageProps} />
        <Toaster />
      </ThemeProvider>
    </>
  );
}
