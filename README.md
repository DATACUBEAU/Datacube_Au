# Datacube AU

Datacube AU is a comprehensive educational platform built with Next.js, designed to provide advanced document management, AI-powered study assistance, and exam preparation tools. The platform integrates seamlessly with Supabase for backend services and Firebase for real-time features.

## 🚀 Features

-   **Smart Authentication**: Secure user authentication via Supabase Auth, with seamless Firebase integration for real-time services.
-   **Document Management**: robust system for uploading, organizing, and managing study materials.
-   **AI Assistant (RAG)**: Retrieval-Augmented Generation powered chat interface for querying documents and getting intelligent answers.
-   **Exam Tools**: Features for generating practice exams and predicting exam topics.
-   **Real-time Communication**: Direct messaging and broadcast system using Firestore.
-   **PWA Support**: Fully functional Progressive Web App with offline capabilities.
-   **Responsive UI**: Modern, accessible interface built with Tailwind CSS and Shadcn UI.

## 🛠 Tech Stack

-   **Frontend**: [Next.js 14](https://nextjs.org/) (App Router), [React](https://react.dev/), [TypeScript](https://www.typescriptlang.org/)
-   **Styling**: [Tailwind CSS](https://tailwindcss.com/), [Shadcn UI](https://ui.shadcn.com/)
-   **Backend / Database**: [Supabase](https://supabase.com/) (PostgreSQL, Auth, Edge Functions, Storage)
-   **Real-time / NoSQL**: [Firebase](https://firebase.google.com/) (Firestore)
-   **State Management**: React Context & Hooks
-   **Testing**: Playwright

## 📂 Project Structure

```
Datacube-Au/
├── public/                 # Static assets (images, icons, PWA files)
├── rag-worker/             # RAG (Retrieval-Augmented Generation) worker service
│   ├── src/                # Worker source code
│   └── ...
├── src/
│   ├── app/                # Next.js App Router pages and API routes
│   │   ├── api/            # Backend API endpoints (Next.js)
│   │   ├── dashboard/      # Main application dashboard
│   │   ├── login/          # Authentication pages
│   │   └── ...
│   ├── components/         # Reusable React components
│   │   ├── ui/             # UI primitives (buttons, inputs, etc.)
│   │   ├── providers/      # Context providers
│   │   └── ...
│   ├── hooks/              # Custom React hooks
│   ├── lib/                # Utility functions and API clients
│   │   ├── supabase-client/# Supabase configuration
│   │   ├── firebase/       # Firebase configuration
│   │   └── ...
│   └── ...
├── tests/                  # End-to-end and integration tests
├── .env.local              # Local environment variables (gitignored)
├── next.config.ts          # Next.js configuration
├── package.json            # Project dependencies and scripts
├── tailwind.config.ts      # Tailwind CSS configuration
└── tsconfig.json           # TypeScript configuration
```

## 🏁 Getting Started

### Prerequisites

-   Node.js (v18 or higher recommended)
-   pnpm (recommended) or npm
-   Supabase project
-   Firebase project

### Installation

1.  **Clone the repository**
    ```bash
    git clone https://github.com/your-org/datacube-au.git
    cd datacube-au
    ```

2.  **Install dependencies**
    ```bash
    npm install
    # or
    pnpm install
    ```

3.  **Environment Setup**
    Create a `.env.local` file in the root directory and add your Supabase and Firebase credentials:

    ```env
    # Supabase
    NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
    NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key

    # Firebase
    NEXT_PUBLIC_FIREBASE_API_KEY=your_firebase_api_key
    NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=your_project.firebaseapp.com
    NEXT_PUBLIC_FIREBASE_PROJECT_ID=your_project_id
    NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=your_project.appspot.com
    NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=your_sender_id
    NEXT_PUBLIC_FIREBASE_APP_ID=your_app_id
    ```

4.  **Run the development server**
    ```bash
    npm run dev
    # or
    pnpm dev
    ```

    Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

## 📜 Scripts

-   `npm run dev`: Starts the development server.
-   `npm run build`: Builds the application for production.
-   `npm run start`: Starts the production server.
-   `npm run lint`: Runs ESLint to check for code quality issues.
-   `npm run test`: Runs the test suite.

## 🤝 Contributing

Contributions are welcome! Please follow these steps:

1.  Fork the project.
2.  Create your feature branch (`git checkout -b feature/AmazingFeature`).
3.  Commit your changes (`git commit -m 'Add some AmazingFeature'`).
4.  Push to the branch (`git push origin feature/AmazingFeature`).
5.  Open a Pull Request.

## 📄 License

[MIT](LICENSE)
