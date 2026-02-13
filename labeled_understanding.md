# Project Labeled Understanding

## Project Overview
- **Project Name**: Datacube AU – Intelligent Document Assistant (PWA)
- **Description**: A Progressive Web App (PWA) built with Next.js (App Router) that allows users to upload documents and interact with them using an AU-powered assistant called AU. Combines Retrieval-Augmented Generation (RAG), prompt enhancement, and predictive assistance to help users understand, summarize, and query their documents efficiently.
- **Tech Stack**: Next.js 14, Supabase, Tailwind CSS, Framer Motion, Zustand.
- **AU Services**: OpenRouter (AU model access)
- **Database**: PostgreSQL (Supabase) with Vector extension.
- **Key Concepts**:
  - **RAG (Retrieval-Augmented Generation)**: Uses vector search to find relevant document chunks for answering questions.
  - **Smart Flowing**: Dynamic UI updates and predictive suggestions based on user context.
  - **AU Assistant (AU)**: RAG pipeline, prompt enhancement
  - **Security**: Supabase Auth with RLS (Row Level Security) and Guest mode.

## Dependencies
- **Key Dependencies**: 
  - `@supabase/supabase-js` (Supabase client)
  - `react-hook-form` (Form handling)
  - `recharts` (Data visualization)
  - `zustand` (State management)
  - `tailwindcss` (Styling)
  - `next-themes` (Dark mode support)

## Environment Variables
- **Required Variables**:
  - `NEXT_PUBLIC_SUPABASE_URL` (Supabase URL)
  - `NEXT_PUBLIC_SUPABASE_ANON_KEY` (Supabase Anon Key)
  - `NEXT_PUBLIC_FIREBASE_API_KEY` (Firebase API Key)
  - `NEXT_PUBLIC_OPENROUTER_API_KEY` (OpenRouter API Key)

## Project Structure
- **Root Files**: 
  - `package.json`, `next.config.ts`, `tsconfig.json`, `README.md`
- **Source Directory**:
  - `src/`
    - `lib/`
    - `pages/`
    - `components/`
    - `hooks/`
    - `constants/`
    - `app/`
      - `app/`
      - `app/api/`
      - `app/layout/`
      - `app/page/`
      - `app/routes/`
      - `app/ui/`
      - `app/utils/`
- **Public Directory**:
  - `public/`
    - `images/`
    - `icons/`
    - `pwa/`

## Key Features
- **Document Upload**: PDF, DOCX, TXT support
- **AU Assistant (AU)**: RAG pipeline, prompt enhancement
- **PWA Support**: Service Worker, Web Manifest
- **Offline-First**: Shell caching
- **Responsive UI**: Mobile, tablet, desktop

## Security
- **RLS Policies**: Row Level Security enabled
- **Authentication**: Firebase email/password
- **Data Protection**: Encryption at rest

## Deployment
- **Target Platform**: Vercel
- **Environment Variables**: Configured in Vercel dashboard
- **CI/CD**: Automated deployment pipeline

## Known Issues
- None reported

## Next Steps
- Implement AU assistant integration
- Optimize PWA performance
- Add dark mode support
- Implement analytics tracking
