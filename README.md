# AlphaX - AI-Powered Video Editor

A production-grade, AI-powered web video editor built with Next.js 14, Supabase, and WebCodecs.

## 🎯 Features

- **Local-First Architecture**: Videos never leave your machine
- **AI-Powered Editing**: Edit videos with natural language prompts
- **Style Learning**: AI learns your editing preferences over time
- **Professional Tools**: Color grading, VFX, compositing, and more
- **Real-time Sync**: Metadata synced across devices via Supabase

## 🛠️ Tech Stack

- **Framework**: Next.js 14 (App Router)
- **Language**: TypeScript
- **Styling**: Tailwind CSS
- **Database**: Supabase (PostgreSQL)
- **State**: Zustand
- **Video Processing**: WebCodecs API + Web Workers
- **UI Components**: OpenCut-inspired editor interface

## 📁 Project Structure

```
alphax/
├── app/                    # Next.js App Router
│   ├── (auth)/            # Authentication routes
│   ├── (dashboard)/       # Protected dashboard routes
│   ├── editor/            # Video editor page
│   └── api/               # API routes for AI
├── components/            # React components
│   ├── editor/           # Editor UI components (from OpenCut)
│   ├── ui/               # Reusable UI primitives
│   └── auth/             # Authentication components
├── lib/                   # Utilities
│   ├── supabase/         # Supabase client & server utils
│   ├── stores/           # Zustand state stores
│   ├── video/            # Video processing utilities
│   └── db/               # Database types & helpers
├── types/                 # TypeScript type definitions
└── public/               # Static assets

```

## 🚀 Getting Started

### Prerequisites

- Node.js 18+ 
- npm or yarn
- Supabase account (free tier works)

### Installation

1. **Clone OpenCut for UI components** (separate repo):
   ```bash
   git clone https://github.com/ohmplatform/OpenCut opencut-source
   ```

2. **Install dependencies**:
   ```bash
   npm install
   ```

3. **Set up environment variables**:
   ```bash
   cp .env.local.example .env.local
   # Edit .env.local with your Supabase credentials
   ```

4. **Run development server**:
   ```bash
   npm run dev
   ```

5. **Open browser**: Navigate to [http://localhost:3000](http://localhost:3000)

## 📋 Development Roadmap

### Phase 1: Foundation (Weeks 1-4) - IN PROGRESS
- [x] Project initialization
- [x] Folder structure setup
- [ ] Supabase configuration
- [ ] Authentication system
- [ ] Basic video import

### Phase 2: Editor UI (Weeks 5-8)
- [ ] Extract OpenCut UI components
- [ ] Timeline component
- [ ] Video preview canvas
- [ ] Basic editing tools

### Phase 3: Advanced Features (Weeks 9-12)
- [ ] Effects & overlays
- [ ] Color grading
- [ ] Audio mixing
- [ ] Export system

### Phase 4: AI Integration (Weeks 13-18)
- [ ] OpenAI API setup
- [ ] Prompt-based editing
- [ ] Style learning
- [ ] Auto-captions

## 🔧 Available Scripts

```bash
npm run dev          # Start development server
npm run build        # Build for production
npm run start        # Start production server
npm run lint         # Run ESLint
npm run type-check   # Run TypeScript type checking
```

## 📖 Documentation

See [TECHNICAL_ARCHITECTURE.md](../TECHNICAL_ARCHITECTURE.md) for detailed technical documentation.

## 🤝 Contributing

This is a personal project, but suggestions are welcome!

## 📄 License

MIT

---

**Built with ❤️ for content creators worldwide**
