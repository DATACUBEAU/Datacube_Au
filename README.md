# 🧊 DataCube AU

DataCube AU is an advanced, AI-powered document analysis and knowledge management platform. It transforms scattered notes, textbooks, and study materials into an intelligent, searchable knowledge base using state-of-the-art Retrieval-Augmented Generation (RAG) technology.

[![Next.js](https://img.shields.io/badge/Next.js-15-black?style=flat-square&logo=next.js)](https://nextjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-blue?style=flat-square&logo=typescript)](https://www.typescriptlang.org/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-3.4-38B2AC?style=flat-square&logo=tailwind-css)](https://tailwindcss.com/)
[![Supabase](https://img.shields.io/badge/Supabase-Backend-3ECF8E?style=flat-square&logo=supabase)](https://supabase.com/)
[![PWA](https://img.shields.io/badge/PWA-Ready-orange?style=flat-square)](https://web.dev/progressive-web-apps/)

---

## ✨ Key Features

- **🧠 Intelligent RAG Pipeline**: Seamlessly ingest documents, chunk them, and generate embeddings for high-precision semantic search and context-aware chat.
- **💬 AU Chat Assistant**: Interact with your documents through a natural language interface. Ask questions, get summaries, and extract insights instantly.
- **📝 Exam Generator**: Automatically generate practice exams and quizzes based on your uploaded study materials.
- **🗺️ Knowledge Mapping**: Visualize concepts and their relationships through generated knowledge maps and prompt starters.
- **🚀 Production-Ready Infrastructure**:
  - **Supabase Edge Functions** for scalable, serverless backend logic.
  - **Dedicated RAG Worker** for heavy lifting document ingestion and processing.
  - **Vector Database** for efficient similarity searches.
- **📱 PWA Support**: Installable on mobile and desktop for a native-like experience.
- **👤 Guest Session System**: Try out the platform's core features without mandatory initial registration.

## 🛠️ Tech Stack

### Frontend
- **Framework**: [Next.js 15+](https://nextjs.org/) (App Router)
- **Styling**: [Tailwind CSS](https://tailwindcss.com/)
- **UI Components**: [Radix UI](https://www.radix-ui.com/), [Shadcn UI](https://ui.shadcn.com/)
- **Animations**: [Framer Motion](https://www.framer.com/motion/)
- **Icons**: [Lucide React](https://lucide.dev/)
- **State Management**: [Zustand](https://zustand-demo.pmnd.rs/)
- **Forms**: [React Hook Form](https://react-hook-form.com/) + [Zod](https://zod.dev/)

### Backend & Infrastructure
- **Database & Auth**: [Supabase](https://supabase.com/)
- **Serverless**: Supabase Edge Functions (Deno)
- **RAG Ingestion**: Node.js Worker with OpenAI/OpenRouter
- **Storage**: Supabase Storage for document management
- **Search**: pgvector for vector similarity search

---

## 📂 Project Structure

```text
.
├── src/
│   ├── app/              # Next.js App Router (Dashboard, Login, API routes)
│   ├── components/       # Reusable UI & Feature components
│   ├── hooks/            # Custom React hooks (API, Auth, UI)
│   ├── lib/              # Core logic, Supabase client, API wrappers
│   └── pages_legacy/     # Legacy pages (migration in progress)
├── backend/
│   ├── supabase/         # Migrations and Edge Functions
│   └── rag-worker/       # Background worker for document ingestion
├── public/               # Static assets and PWA manifests
└── shared/               # Shared types and schemas
```

---

## 🚀 Getting Started

### Prerequisites
- Node.js 20+
- Supabase CLI
- Git

### Installation

1. **Clone the repository**:
   ```bash
   git clone https://github.com/Fabian121-ux/Datacube_Au.git
   cd Datacube_Au
   ```

2. **Install dependencies**:
   ```bash
   npm install
   ```

3. **Set up Environment Variables**:
   Create a `.env.local` file in the root and add your Supabase credentials:
   ```env
   NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
   NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
   ```

4. **Run the development server**:
   ```bash
   npm run dev
   ```

---

## 🏗️ Backend Setup (Supabase)

1. **Initialize Supabase**:
   ```bash
   npx supabase --workdir backend init
   ```

2. **Run Migrations**:
   ```bash
   npx supabase --workdir backend db push
   ```

3. **Deploy Edge Functions**:
   ```bash
   npx supabase --workdir backend functions deploy
   ```

   Alternatively:
   ```bash
   cd backend
   npx supabase functions deploy
   ```

---

## 📜 License

This project is private and all rights are reserved.

---

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.
