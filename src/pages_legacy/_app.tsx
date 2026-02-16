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
      </Head>
      <ThemeProvider attribute="class" defaultTheme="dark" enableSystem disableTransitionOnChange>
        <ServiceWorkerRegister />
        <Component {...pageProps} />
        <Toaster />
      </ThemeProvider>
    </>
  );
}
