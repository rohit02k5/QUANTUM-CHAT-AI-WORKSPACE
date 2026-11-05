# QUANTUM CHAT AI WORKSPACE — COMPLETE ARCHITECTURAL REVERSE-ENGINEERING & TECHNICAL INTERVIEW MASTER GUIDE

> **Author / Maintainer**: Swarna Venkata Sai Rohit (IIT Bhilai)  
> **Repository**: [https://github.com/rohit02k5/QUANTUM-CHAT-AI-WORKSPACE](https://github.com/rohit02k5/QUANTUM-CHAT-AI-WORKSPACE)  
> **Stack**: MongoDB Atlas, Express.js, React 18, Node.js (MERN) + Google Gemini GenAI + Plotly.js + Mermaid.js + Material-UI (MUI v5)  
> **Document Purpose**: Complete end-to-end technical reference, architectural blueprint, code-level execution traces, security audit, and 12-level interview defense manual.

---

## TABLE OF CONTENTS
1. [Executive Summary & Problem Statement](#1-executive-summary--problem-statement)
2. [Code Ground-Truth vs. Documentation Claim Analysis](#2-code-ground-truth-vs-documentation-claim-analysis)
3. [Complete System Architecture & High-Level Topology](#3-complete-system-architecture--high-level-topology)
4. [Complete Repository File Map & Dependency Hierarchy](#4-complete-repository-file-map--dependency-hierarchy)
5. [Frontend Deep Dive (React 18 Architecture, State, & Routing)](#5-frontend-deep-dive-react-18-architecture-state--routing)
6. [Backend Deep Dive (Node.js, Express, & Server Anatomy)](#6-backend-deep-dive-nodejs-express--server-anatomy)
7. [Express Routing, Lifecycle, & Middleware Pipeline](#7-express-routing-lifecycle--middleware-pipeline)
8. [Database Layer (MongoDB Schemas, Mongoose ODM, & CRUD Operations)](#8-database-layer-mongodb-schemas-mongoose-odm--crud-operations)
9. [Authentication & Security Architecture (JWT, OAuth 2.0, & Cryptography)](#9-authentication--security-architecture-jwt-oauth-20--cryptography)
10. [Google Gemini API Integration & AI Prompt Engineering](#10-google-gemini-api-integration--ai-prompt-engineering)
11. [Document Ingestion, Extraction, & Studio Pipeline](#11-document-ingestion-extraction--studio-pipeline)
12. [Insight Engine: 3D Knowledge Graph & NLP Analytics Pipeline](#12-insight-engine-3d-knowledge-graph--nlp-analytics-pipeline)
13. [Executive Assistant: Strategic Decision Intelligence](#13-executive-assistant-strategic-decision-intelligence)
14. [Mermaid.js Dynamic Mindmap Generation](#14-mermaidjs-dynamic-mindmap-generation)
15. [Knowledge Base & Global Workspace Search](#15-knowledge-base--global-workspace-search)
16. [NeuraPix & Image Generation Architecture: Ground Truth](#16-neurapix--image-generation-architecture-ground-truth)
17. [Complete API Contracts Table](#17-complete-api-contracts-table)
18. [End-to-End Execution Flow Traces (7 Features)](#18-end-to-end-execution-flow-traces-7-features)
19. [Environment Variables Master Audit](#19-environment-variables-master-audit)
20. [Error Handling & Resilience Architecture](#20-error-handling--resilience-architecture)
21. [Asynchronous JavaScript, Event Loop, & Runtime Mechanics](#21-asynchronous-javascript-event-loop--runtime-mechanics)
22. [Third-Party Libraries & Package Audit](#22-third-party-libraries--package-audit)
23. [Local Development Setup (Zero to Running)](#23-local-development-setup-zero-to-running)
24. [Production Deployment & Infrastructure (Render + SPA Rewrites)](#24-production-deployment--infrastructure-render--spa-rewrites)
25. [Performance & Latency Optimization Guide](#25-performance--latency-optimization-guide)
26. [Scalability Blueprint: 100 to 1,000,000 Users](#26-scalability-blueprint-100-to-1000000-users)
27. [Security Audit, Vulnerability Analysis, & Mitigation](#27-security-audit-vulnerability-analysis--mitigation)
28. [Codebase Defects, Bugs, & Inconsistencies to Know](#28-codebase-defects-bugs--inconsistencies-to-know)
29. [Testing Strategy (Automated, Unit, Integration, & Mocking)](#29-testing-strategy-automated-unit-integration--mocking)
30. [Reconstructing the Entire Project from Scratch](#30-reconstructing-the-entire-project-from-scratch)
31. [File-by-File Technical Directory](#31-file-by-file-technical-directory)
32. [Function-by-Function Reference](#32-function-by-function-reference)
33. [12-Level Technical Interview Defense Questions & Answers](#33-12-level-technical-interview-defense-questions--answers)
34. [Interview Scripts (30s, 1m, 2m, 5m Presentations)](#34-interview-scripts-30s-1m-2m-5m-presentations)

---

# 1. EXECUTIVE SUMMARY & PROBLEM STATEMENT

### One-Sentence Definition
> **Quantum is a full-stack, AI-powered intelligence workspace built on the MERN stack (MongoDB Atlas, Express.js, React 18, Node.js) that orchestrates Google Gemini Generative AI to provide multi-turn context-aware chat, document text extraction (PDF/DOCX/TXT), automated Mermaid.js mind-mapping, structured executive decision intelligence, and 3D spatial knowledge graph analytics with Plotly.**

### Problem Being Solved
Knowledge workers, researchers, content strategists, and executives struggle with fragmented workflows across siloed AI tools:
1. Standard chatbots lose document context and lack visual knowledge representation.
2. Synthesizing multi-page reports (PDFs, Word documents) into executive summaries, flashcards, or side-by-side comparisons is manual and time-consuming.
3. Text analytics tools rarely combine NLP metric evaluation (Flesch–Kincaid readability, reading time, tone) with spatial 3D entity relationship graphs and exportable visual mindmaps in a single, authenticated dashboard.

Quantum resolves this by integrating conversational AI, document OCR/text extraction, multi-document comparison, study flashcards, strategic action planning, and 3D graph visualization into a unified authenticated platform.

---

# 2. CODE GROUND-TRUTH VS. DOCUMENTATION CLAIM ANALYSIS

| Feature / Module | Documentation Claim (README) | Actual Code Implementation | Status |
| :--- | :--- | :--- | :--- |
| **Contextual AI Chat** | Multi-turn chat with history persisted in MongoDB | Implemented in `controllers/chatController.js` and `client/src/pages/Chat.js` using `model.startChat({ history })`. History persisted in Mongo `Chat` documents. | **Verified in Code** |
| **Mermaid Mindmaps** | One-click conversion of chat conversations into mindmaps | Implemented in `controllers/chatController.js:123` (`generateMindmap`) and dynamically rendered via `mermaid` in `client/src/pages/Chat.js:21`. | **Verified in Code** |
| **Document Ingestion** | Upload and extract PDF, TXT, DOCX | Implemented in `controllers/fileController.js` using Multer for upload, Gemini Multimodal base64 for PDF extraction, `mammoth` for DOCX, and `fs` for TXT. | **Verified in Code** |
| **Studio: Document Comparison**| Compare multiple documents side-by-side | Implemented in `controllers/studioController.js:10` (`compareDocuments`) and rendered in `client/src/pages/Studio.js`. | **Verified in Code** |
| **Studio: Flashcards** | Auto-generate study flashcards from documents | Implemented in `controllers/studioController.js:59` (`generateFlashcards`) returning JSON `[{q, a}]`. | **Verified in Code** |
| **Insight Engine: 3D Graphs** | 3D Knowledge Graphs & Content DNA radar | Implemented in `controllers/openaiController.js:10` (`analyzeContent`) and rendered using `react-plotly.js` in `client/src/pages/InsightEngine.js`. | **Verified in Code** |
| **Executive Assistant** | Strategic briefs, action items, gaps, and risks | Implemented in `controllers/openaiController.js:52` (`generateActionPlan`) & `client/src/pages/ExecutiveAssistant.js`. | **Verified in Code** |
| **Authentication System** | Email/Password, Google & GitHub OAuth 2.0, JWT, SMTP Reset | Implemented in `controllers/authController.js`, `config/passport.js`, `middlewares/authMiddleware.js`, and `utils/sendEmail.js`. | **Verified in Code** |
| **NeuraPix Image Generation** | Built-in Stable Diffusion image generator via Hugging Face | `@huggingface/inference` is listed in `package.json`, but **no backend route or controller calls Hugging Face**. In the frontend (`Layout.js:79`), Neurapix is an **external link button** opening `https://neurapix-frontend-3.onrender.com/`. | **External Link Only** |
| **Knowledge Base Search** | "Vector-search powered asset management system" | Implemented in `controllers/searchController.js:5` using **MongoDB `$regex` case-insensitive matching** on filenames, file text, and chat messages. No vector embeddings or vector database index exists. | **Regex DB Search (Not Vector DB)** |

---

# 3. COMPLETE SYSTEM ARCHITECTURE & HIGH-LEVEL TOPOLOGY

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                                 BROWSER CLIENT (React 18 SPA)                         │
│                                                                                        │
│  [Pages: Homepage, Chat, Studio, InsightEngine, ExecAssistant, KnowledgeBase, Auth]    │
│  [State / Context: ThemeContext (MUI Dark/Light Mode), Axios Interceptors (JWT Bearer)]│
│  [Visualization: Plotly.js (3D Scatter & Polar Radar), Mermaid.js (Mindmaps)]          │
└───────────────────────────────────────────┬────────────────────────────────────────────┘
                                            │ HTTP / REST (Axios)
                                            │ [BaseURL: /api/v1/...]
                                            ▼
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                             BACKEND RUNTIME (Node.js + Express)                        │
│                                                                                        │
│  [Security & Config: Helmet CSP, CORS, Passport.js OAuth 2.0 (Google/GitHub)]          │
│  [Middlewares: requireSignIn (JWT Verification), Multer (Disk Storage), ErrorHandler]  │
│                                                                                        │
│  ┌──────────────────────────────────────────────────────────────────────────────────┐  │
│  │                                EXPRESS API ROUTES                                │  │
│  │  /api/v1/auth     --> authController.js    (register, login, oauth, pw reset)    │  │
│  │  /api/v1/chat     --> chatController.js    (multi-turn Gemini, mindmap, CRUD)    │  │
│  │  /api/v1/files    --> fileController.js    (Multer upload, PDF/Docx extraction)  │  │
│  │  /api/v1/studio   --> studioController.js  (document comparison, flashcards)     │  │
│  │  /api/v1/openai   --> openaiController.js  (insight engine 3D, action plans)     │  │
│  │  /api/v1/search   --> searchController.js  (global regex search chats & files)   │  │
│  └──────────────────────────────────────────────────────────────────────────────────┘  │
└───────────────────────┬───────────────────────────────┬────────────────────────────────┘
                        │ Mongoose ODM                  │ Google Generative AI SDK
                        ▼                               ▼
      ┌─────────────────────────────────┐   ┌─────────────────────────────────────────┐
      │         MONGODB ATLAS           │   │         GOOGLE GEMINI API               │
      │                                 │   │                                         │
      │  Collections:                   │   │  Model: gemini-2.5-flash                │
      │  - users (auth, oauth IDs)      │   │  - Multi-turn Conversational Chat       │
      │  - chats (messages, history)    │   │  - Multimodal PDF Text Extraction       │
      │  - files (metadata + text)      │   │  - Structured JSON Insight & Analysis   │
      └─────────────────────────────────┘   │  - Mermaid Mindmap Prompting            │
                                            └─────────────────────────────────────────┘
```

---

# 4. COMPLETE REPOSITORY FILE MAP & DEPENDENCY HIERARCHY

```
QUANTUM-CHAT-AI-WORKSPACE/
│
├── server.js                        # Root Express server entry point & middleware mounting
├── package.json                     # Backend & root npm dependencies and scripts
├── .gitignore                       # Git ignore rules for node_modules, .env, uploads
├── check_active_models.js           # CLI diagnostic script: tests Gemini model availability
├── check_db.js                      # CLI diagnostic script: checks MongoDB connection & stats
├── check_models.js                  # CLI diagnostic script: queries Google Generative AI endpoint
├── list_models.js                   # CLI diagnostic script: REST fetch of Gemini models
├── list_models_debug.js             # CLI diagnostic script: writes active models to text file
├── models_output.txt                # Cached list of active Google Gemini model identifiers
│
├── config/
│   ├── db.js                        # Mongoose connection logic using process.env.MONGO_URI
│   └── passport.js                  # Passport OAuth strategies for Google and GitHub
│
├── middlewares/
│   ├── authMiddleware.js            # JWT bearer token verification middleware (requireSignIn)
│   └── errorMiddleware.js           # Centralized Express error handler (CastError, 11000, etc.)
│
├── models/
│   ├── userModel.js                 # User schema (bcrypt hash, getSignedToken, OAuth IDs)
│   ├── Chat.js                      # Chat schema (userId ref, message array [{role, content}])
│   └── File.js                      # File schema (userId ref, path, extracted text content)
│
├── utils/
│   ├── errorResponse.js             # Custom Error subclass attaching statusCode
│   ├── geminiHelper.js              # Resilient Gemini SDK wrapper with exponential retry logic
│   └── sendEmail.js                 # Nodemailer SMTP transporter helper for password resets
│
├── controllers/
│   ├── authController.js            # Register, Login, Logout, Forgot/Reset Password
│   ├── chatController.js            # Get user chats, send message (Gemini chatSession), mindmap
│   ├── fileController.js            # Upload file, Gemini PDF OCR/extraction, Mammoth docx
│   ├── openaiController.js          # (Named openai for legacy) Insight Engine analysis & action plans
│   ├── searchController.js          # Global regex search across Chat and File collections
│   └── studioController.js          # Document comparison synthesis and flashcard generation
│
├── routes/
│   ├── authRoute.js                 # /api/v1/auth routes and OAuth callbacks
│   ├── chatRoutes.js                # /api/v1/chat routes (protected by requireSignIn)
│   ├── fileRoutes.js                # /api/v1/files routes (Multer upload, list, search)
│   ├── openaiRoutes.js              # /api/v1/openai routes (analyze, action-plan, summary)
│   └── studioRoutes.js              # /api/v1/studio routes (compare, flashcards)
│
└── client/                          # React 18 Single Page Application
    ├── package.json                 # Frontend dependencies (MUI, Plotly, Mermaid, Framer Motion)
    ├── tailwind.config.js           # Tailwind CSS utility configuration
    ├── public/
    │   ├── index.html               # Root HTML document mount point (#root)
    │   ├── manifest.json            # Web app manifest
    │   └── robots.txt               # Search crawler rules
    └── src/
        ├── index.js                 # React DOM root render with BrowserRouter & ErrorBoundary
        ├── App.js                   # Application route registry, ProtectedRoute wrapping, Theme
        ├── App.css & index.css      # Global styles and Tailwind directives
        ├── axiosConfig.js           # Axios instance with BaseURL and Authorization JWT interceptor
        ├── setupProxy.js            # CRA development reverse proxy (/api -> localhost:8080)
        ├── theme.js                 # Material-UI Theme token definition (Cyberpunk/Dark & Light)
        │
        ├── context/
        │   └── ThemeContext.js      # React Context holding toggleColorMode and current theme
        │
        ├── components/
        │   ├── AuthLayout.js        # Split-screen responsive layout for Login/Register/ForgotPw
        │   ├── ErrorBoundary.js     # React Class Component error boundary catching UI crashes
        │   ├── Layout.js            # Main dashboard shell with collapsible animated sidebar
        │   ├── NavBar.js            # [Legacy/Unused] Top navigation bar component
        │   ├── ProtectedRoute.js    # Client-side route guard inspecting localStorage authToken
        │   ├── SentimentChart.js    # [Legacy/Unused] Plotly Pie chart for sentiment words
        │   └── WordFrequencyChart.js# [Legacy/Unused] Plotly Bar chart for word frequency
        │
        ├── pages/
        │   ├── Homepage.js          # Dashboard landing with feature launch cards
        │   ├── Login.js             # User login with JWT handling and OAuth redirect parsing
        │   ├── Register.js          # User registration form
        │   ├── ForgotPassword.js    # Request reset email form
        │   ├── ResetPassword.js     # Password reset token validation and update form
        │   ├── Chat.js              # Interactive chat with Gemini, file attachment & Mermaid mindmap
        │   ├── Studio.js            # Multi-document upload, side-by-side comparison & flashcards
        │   ├── KnowledgeBase.js     # Workspace stats, uploaded files gallery & search interface
        │   ├── InsightEngine.js     # 3D Plotly entity relationship graph, radar chart & SEO metrics
        │   ├── ExecutiveAssistant.js# Strategic brief analyzer generating action plans & risk logs
        │   ├── Chatbot.js           # [Legacy/Unrouted] Single-turn chatbot page
        │   ├── DataVisualize.js     # [Legacy/Unrouted] Client-side sentiment and word analyzer
        │   └── Summary.js           # [Legacy/Unrouted] Single-turn text summarizer page
        │
        └── utils/
            └── textProcessing.js    # Client-side stop-word filtering & Sentiment.js helper
```

---

# 5. FRONTEND DEEP DIVE (REACT 18 ARCHITECTURE, STATE, & ROUTING)

### 5.1 Architecture & Core Paradigms
- **Single Page Application (SPA)**: Powered by React 18 and `react-router-dom` v7.
- **Styling Architecture**: Custom Material-UI v5 theme (`client/src/theme.js`) combined with Tailwind CSS utilities and Framer Motion spring physics.
- **Global Theme Engine**: `ThemeContextProvider` wraps the application, exposing `toggleColorMode()` through React Context and recompiling the MUI theme via `useMemo`.
- **API Interceptor Architecture**: `client/src/axiosConfig.js` creates a singleton Axios instance. An outgoing request interceptor retrieves the JWT token from `localStorage` or `sessionStorage` and injects `Authorization: Bearer <token>` into the request headers, while filtering out literal `"undefined"` and `"null"` values.

### 5.2 Page Breakdown & State Machine

```
[ Protected Routes Guard: ProtectedRoute.js (Checks localStorage 'authToken') ]
 │
 ├── / (Layout.js Shell with Collapsible Framer Motion Sidebar)
 │    │
 │    ├── index ---------------> Homepage.js (Hero branding & launch grid)
 │    ├── /chat ---------------> Chat.js (Conversational UI, Gemini streaming, Mermaid SVG)
 │    ├── /studio -------------> Studio.js (Multi-doc comparison & study flashcards)
 │    ├── /insight-engine -----> InsightEngine.js (3D Plotly scatter & radar chart)
 │    ├── /executive-assistant > ExecutiveAssistant.js (Strategy briefs & action logs)
 │    └── /knowledge-base -----> KnowledgeBase.js (Stats, file gallery & global search)
 │
 └── Public Auth Routes (AuthLayout.js Split-Screen)
      ├── /login --------------> Login.js (Password auth + OAuth URL token receiver)
      ├── /register -----------> Register.js (New user creation form)
      ├── /forgot-password ----> ForgotPassword.js (SMTP reset dispatch trigger)
      └── /reset-password/:token ResetPassword.js (Token validation & new password input)
```

---

# 6. BACKEND DEEP DIVE (NODE.JS, EXPRESS, & SERVER ANATOMY)

### 6.1 `server.js` Step-by-Step Walkthrough
1. **Environment Configuration**: `dotenv.config()` executes first, populating `process.env`.
2. **Environment Variable Assertion**: Validates `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `JWT_ACCESS_EXPIREIN`, `JWT_REFRESH_EXPIREIN`.
3. **Reverse Proxy Trust**: `app.set("trust proxy", 1)` configures Express to trust TLS termination headers from reverse proxies (Render/Cloudflare).
4. **Passport Initialization**: `app.use(passport.initialize())` mounts OAuth 2.0 authentication strategies.
5. **Database Initialization**: `connectDB()` establishes an asynchronous Mongoose connection to MongoDB Atlas.
6. **Security Headers**: `helmet.contentSecurityPolicy(...)` sets HTTP Content Security Policy headers preventing unauthorized script execution and clickjacking.
7. **CORS Policy**: Configures allowed origins (`http://localhost:3000` and `https://quantum-chat-frontend.onrender.com`) with `credentials: true`.
8. **Body Parsers & Logging**: `express.json()` and `bodyParser.urlencoded({ extended: true })` parse request payloads; `morgan("dev")` logs HTTP method, endpoint, status code, and latency.
9. **Route Mounting**: Mounts `/api/v1/auth`, `/api/v1/chat`, `/api/v1/files`, `/api/v1/studio`, `/api/v1/openai`, `/api/v1/search`.
10. **Static Asset Serving**: Serves `uploads/` statically via `express.static("uploads")`.
11. **Error Handling**: Mounts centralized `errorHandler` catching unhandled runtime errors.
12. **Server Listener**: Binds to `process.env.PORT || 8080`.

---

# 7. EXPRESS ROUTING, LIFECYCLE, & MIDDLEWARE PIPELINE

### 7.1 Middleware Pipeline Execution Sequence
When a client sends a request (e.g. `POST /api/v1/chat/message`):
```
[ Incoming HTTP Request ]
       │
       ▼
1. Helmet Security Middleware (Sets security headers)
       │
       ▼
2. CORS Middleware (Validates Origin and sets Access-Control-Allow-*)
       │
       ▼
3. Body Parser (express.json() parses raw stream into req.body)
       │
       ▼
4. Morgan Logger (Logs timestamp and method to console)
       │
       ▼
5. Express Router Matching (/api/v1/chat)
       │
       ▼
6. requireSignIn Middleware (authMiddleware.js)
   - Reads Authorization: Bearer <token>
   - jwt.verify(token, JWT_ACCESS_SECRET)
   - User.findById(decoded.id) -> attaches to req.user
   - Calls next()
       │
       ▼
7. Controller (chatController.sendMessage)
   - Executes Gemini SDK inference & MongoDB persistence
   - Returns res.status(200).json(...)
       │
       ▼
[ If Error Thrown: next(error) ] ──► errorHandler (errorMiddleware.js formats error JSON)
```

---

# 8. DATABASE LAYER (MONGODB SCHEMAS, MONGOOSE ODM, & CRUD OPERATIONS)

### 8.1 Data Models & Mongoose Schemas

#### 1. User Model (`models/userModel.js`)
- `username`: `String`, required.
- `email`: `String`, required, unique.
- `password`: `String`, optional (permits passwordless OAuth accounts).
- `googleId`: `String`, optional OAuth identifier.
- `githubId`: `String`, optional OAuth identifier.
- `resetPasswordToken`: `String`, SHA-256 hash of password reset token.
- `resetPasswordExpire`: `Date`, timestamp 10 minutes from creation.
- `createdAt`: `Date`, default `Date.now`.
- **Pre-Save Hook**: `userSchema.pre("save")` hashes `password` using `bcrypt.genSalt(10)` and `bcrypt.hash()` whenever modified.
- **Methods**:
  - `matchPassword(enteredPassword)`: Compares plain password with bcrypt hash.
  - `getSignedToken(res)`: Signs JWT access token (`JWT_ACCESS_SECRET`) and refresh token (`JWT_REFRESH_SECRET`), sets refresh token in `res.cookie("refreshToken", ..., { httpOnly: true, sameSite: "strict" })`, and returns access token.

#### 2. Chat Model (`models/Chat.js`)
- `user`: `mongoose.Schema.Types.ObjectId`, ref: `"User"`, required.
- `title`: `String`, default `"New Chat"`.
- `messages`: Embedded array of subdocuments:
  - `role`: `String` (`'user'` or `'model'`), required.
  - `content`: `String`, required.
  - `timestamp`: `Date`, default `Date.now`.
- `createdAt`: `Date`, default `Date.now`.

#### 3. File Model (`models/File.js`)
- `user`: `mongoose.Schema.Types.ObjectId`, ref: `"User"`, required.
- `filename`: `String`, disk filename in `uploads/`.
- `originalName`: `String`, original uploaded filename.
- `path`: `String`, local filesystem path.
- `mimetype`: `String`, MIME type (`application/pdf`, etc.).
- `size`: `Number`, file byte count.
- `content`: `String`, plain text extracted by Gemini or Mammoth.
- `uploadDate`: `Date`, default `Date.now`.
- `isTemp`: `Boolean`, default `false`.

---

# 9. AUTHENTICATION & SECURITY ARCHITECTURE (JWT, OAUTH 2.0, & CRYPTOGRAPHY)

```
                               ┌──────────────────────┐
                               │  REGISTRATION/LOGIN  │
                               └──────────┬───────────┘
                                          │
            ┌─────────────────────────────┴─────────────────────────────┐
            ▼                                                           ▼
   [Local Credentials]                                          [OAuth 2.0 Provider]
   POST /api/v1/auth/login                                      GET /api/v1/auth/google
   Body: { email, password }                                    Passport GoogleStrategy
            │                                                           │
   User.findOne({ email })                                      Google Consent Screen
            │                                                           │
   user.matchPassword(password)                                 Callback: /api/v1/auth/google/callback
   (bcrypt.compare)                                                     │
            │                                                   Passport finds/creates User
            └─────────────────────────────┬─────────────────────────────┘
                                          │
                                          ▼
                                user.getSignedToken(res)
                                          │
                  ┌───────────────────────┴───────────────────────┐
                  ▼                                               ▼
         [JWT Access Token]                              [JWT Refresh Token]
         Signed (JWT_ACCESS_SECRET)                      Signed (JWT_REFRESH_SECRET)
         Returned in JSON body:                          Attached as HttpOnly Cookie:
         { success: true, token: "..." }                 res.cookie("refreshToken", ...)
                  │                                               │
                  ▼                                               ▼
         React Client stores in                          Browser securely stores
         localStorage / sessionStorage                   cookie for session persistence
```

### Password Reset Cryptography
1. `POST /api/v1/auth/forgot-password` generates a raw token: `crypto.randomBytes(20).toString("hex")`.
2. Hashed token is stored in MongoDB: `user.resetPasswordToken = crypto.createHash("sha256").update(resetToken).digest("hex")`.
3. Unhashed raw token is sent in the email reset link: `${CLIENT_URL}/reset-password/${resetToken}`.
4. On `POST /api/v1/auth/reset-password/:resetToken`, the server hashes `req.params.resetToken` with SHA-256 and matches against `resetPasswordToken` where `resetPasswordExpire > Date.now()`.

---

# 10. GOOGLE GEMINI API INTEGRATION & AI PROMPT ENGINEERING

### 10.1 Exponential Backoff & Resilience (`utils/geminiHelper.js`)
`geminiHelper.js` wraps the Google Generative AI SDK with an automated retry mechanism:
- Detects transient failures: HTTP 503 (Service Unavailable), HTTP 429 (Rate Limited), or `"Overloaded"`.
- Performs exponential backoff ($2\text{s} \rightarrow 4\text{s} \rightarrow 6\text{s}$).
- On persistent failure during attempt 2, automatically falls back from `gemini-2.5-flash` to `gemini-1.5-flash`.

### 10.2 Conversational History Context
In `controllers/chatController.js:66`:
- Transforms past MongoDB messages into Gemini history format: `history = chat.messages.slice(0, -1).map(m => ({ role: m.role === "user" ? "user" : "model", parts: [{ text: m.content }] }))`.
- Initializes session: `const chatSession = model.startChat({ history })`.
- Sends current prompt: `const result = await chatSession.sendMessage(prompt)`.

---

# 11. DOCUMENT INGESTION, EXTRACTION, & STUDIO PIPELINE

### 11.1 Multimodal Extraction Pipeline
1. Multer intercepts `multipart/form-data` and writes the file to the local `uploads/` directory with a timestamped sanitized name.
2. `controllers/fileController.js` identifies the MIME type:
   - **PDF (`application/pdf`)**: Reads binary buffer, converts to base64, and sends inline data directly to Gemini Multimodal:
     ```javascript
     const result = await model.generateContent([
       { inlineData: { data: base64Data, mimeType: "application/pdf" } },
       { text: "Extract all text from this PDF document verbatim. Return only the extracted text." }
     ]);
     ```
   - **DOCX (`application/vnd.openxmlformats-...`)**: Uses `mammoth.extractRawText({ path })`.
   - **TXT (`text/plain`)**: Reads UTF-8 text via `fs.readFileSync(filePath, "utf8")`.
3. Extracted text is stored in the MongoDB `File` document under `content`.

### 11.2 Studio Document Comparison & Flashcards
- **Document Comparison (`studioController.compareDocuments`)**: Loads multiple `File` documents by ID, aggregates their text into a single prompt, and instructs Gemini to return JSON: `{ "similarities": [], "differences": [], "keyInsights": "" }`.
- **Flashcard Generator (`studioController.generateFlashcards`)**: Ingests document text (up to 10,000 characters) and prompts Gemini to produce study flashcards: `[ { "q": "Question?", "a": "Answer" } ]`.

---

# 12. INSIGHT ENGINE: 3D KNOWLEDGE GRAPH & NLP ANALYTICS PIPELINE

### 12.1 Analytical Workflow
1. User provides text $\rightarrow$ `POST /api/v1/openai/analyze`.
2. Gemini evaluates the text and returns a strict JSON payload containing:
   - `entities`: `[ { "name": "...", "type": "Person|Org|Loc", "importance": 1-10 } ]`
   - `relationships`: `[ { "source": "Entity 1", "target": "Entity 2", "relation": "..." } ]`
   - `topics`: `[ { "label": "Topic Name", "score": 1-100 } ]`
   - `seo`: Readability grade, reading time, keyword density, and tone.
3. In `client/src/pages/InsightEngine.js`, the client assigns 3D coordinates $(x, y, z)$ to each entity node.
4. **Plotly.js Visualizations**:
   - `scatter3d`: Renders entity nodes sized by importance score and colored by entity type, with connecting line edges representing relationships.
   - `scatterpolar`: Renders a Content DNA radar chart mapping topic scores.

---

# 13. EXECUTIVE ASSISTANT: STRATEGIC DECISION INTELLIGENCE

### 13.1 Strategic Extraction Pipeline
- In `controllers/openaiController.js:52` (`generateActionPlan`):
  - Ingests text or extracted document content (up to 5,000 characters).
  - Prompts Gemini with an Executive Assistant persona to output structured JSON:
    ```json
    {
      "executiveSummary": "High-level brief",
      "actionItems": ["Action 1", "Action 2"],
      "strategicGaps": ["Missing financial data", "No risk assessment"],
      "keyRisks": ["Risk 1", "Risk 2"]
    }
    ```
- `client/src/pages/ExecutiveAssistant.js` renders categorized cards highlighting strategic gaps and key risk factors with warning indicators.

---

# 14. MERMAID.JS DYNAMIC MINDMAP GENERATION

### 14.1 Mindmap Workflow
1. In `controllers/chatController.js:123` (`generateMindmap`), the server reads the full conversation history from MongoDB.
2. Prompts Gemini to structure the conversation into strict Mermaid mindmap syntax:
   ```text
   mindmap
     root((Central Topic))
       ("Sub Topic 1")
         ("Detail A")
       ("Sub Topic 2")
   ```
3. Strips markdown fences and returns clean Mermaid syntax.
4. `client/src/pages/Chat.js` dynamically loads `import("mermaid")` and initializes the diagram inside `<Mermaid chart={...} />`.
5. Includes interactive SVG zoom modal and one-click SVG file download.

---

# 15. KNOWLEDGE BASE & GLOBAL WORKSPACE SEARCH

### 15.1 Search Implementation
- In `controllers/searchController.js:5` (`globalSearch`):
  - Ingests query parameter `?query=...`.
  - Compiles case-insensitive regex: `const regex = new RegExp(query, "i")`.
  - Executes concurrent queries:
    - `File.find({ user: userId, isTemp: false, $or: [{ originalName: regex }, { content: regex }] })`
    - `Chat.find({ user: userId, "messages.content": regex })`
  - Returns unified results to `client/src/pages/KnowledgeBase.js` for instant navigation.

---

# 16. NEURAPIX & IMAGE GENERATION ARCHITECTURE: GROUND TRUTH

- **Code Reality**: In this repository, text-to-image diffusion generation is **not** handled by a local backend controller.
- In `client/src/components/Layout.js:79` and `client/src/pages/Homepage.js:98`, clicking "Neurapix" opens the standalone external micro-frontend app at `https://neurapix-frontend-3.onrender.com/`.
- The package `@huggingface/inference` is listed in the root `package.json` as a prerequisite dependency.

---

# 17. COMPLETE API CONTRACTS TABLE

| Method | Endpoint | Purpose | Request Payload | Auth Required | Controller Function | External Service / DB | Success Response (200/201) | Error Codes |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `POST` | `/api/v1/auth/register` | Register account | `{ username, email, password }` | None | `registerController` | MongoDB `User` | `{ success: true, token }` | 400, 500 |
| `POST` | `/api/v1/auth/login` | Authenticate credentials | `{ email, password }` | None | `loginController` | MongoDB `User` | `{ success: true, token }` | 400, 401 |
| `POST` | `/api/v1/auth/logout` | Clear refresh cookie | None | None | `logoutController` | None | `{ success: true, message }` | 200 |
| `GET` | `/api/v1/auth/google` | Initiate Google OAuth | None | None | `passport.authenticate` | Google OAuth 2.0 | Redirect to Google | 302 |
| `GET` | `/api/v1/auth/google/callback` | Google OAuth Callback | Query param `code` | None | Route Handler | Google + MongoDB | Redirect `${CLIENT_URL}/login?token=...` | 302 |
| `GET` | `/api/v1/auth/github` | Initiate GitHub OAuth | None | None | `passport.authenticate` | GitHub OAuth 2.0 | Redirect to GitHub | 302 |
| `GET` | `/api/v1/auth/github/callback` | GitHub OAuth Callback | Query param `code` | None | Route Handler | GitHub + MongoDB | Redirect `${CLIENT_URL}/login?token=...` | 302 |
| `POST` | `/api/v1/auth/forgot-password` | Send reset link | `{ email }` | None | `forgotPasswordController` | MongoDB + Nodemailer SMTP | `{ success: true, data: "Email Sent" }` | 404, 500 |
| `POST` | `/api/v1/auth/reset-password/:token`| Reset password | `{ password }` | None | `resetPasswordController` | MongoDB `User` | `{ success: true, token }` | 400, 500 |
| `GET` | `/api/v1/chat/history` | List user chat sessions | None | Bearer JWT | `getUserChats` | MongoDB `Chat` | `{ chats: [...] }` | 401, 500 |
| `GET` | `/api/v1/chat/:chatId` | Get specific chat messages | Path param `chatId` | Bearer JWT | `getChatMessages` | MongoDB `Chat` | `{ chat: {...} }` | 401, 404, 500 |
| `DELETE`| `/api/v1/chat/:chatId` | Delete chat session | Path param `chatId` | Bearer JWT | `deleteChat` | MongoDB `Chat` | `{ message: "Chat deleted" }` | 401, 500 |
| `POST` | `/api/v1/chat/message` | Send message & get AI response | `{ message, chatId, fileId }` | Bearer JWT | `sendMessage` | Gemini API + MongoDB | `{ response, chatId, chat }` | 401, 500 |
| `POST` | `/api/v1/chat/mindmap` | Generate Mermaid mindmap | `{ chatId }` | Bearer JWT | `generateMindmap` | Gemini API + MongoDB | `{ mindmap: "mindmap..." }` | 401, 404, 500 |
| `POST` | `/api/v1/files/upload` | Upload & extract document text | `multipart/form-data` (file) | Bearer JWT | `uploadFile` | Multer + Gemini / Mammoth + MongoDB | `{ message, file: {...} }` | 400, 401, 500 |
| `GET` | `/api/v1/files/list` | List user uploaded files | None | Bearer JWT | `getUserFiles` | MongoDB `File` | `{ files: [...] }` | 401, 500 |
| `GET` | `/api/v1/files/search` | Search files by name | Query param `query` | Bearer JWT | `searchFiles` | MongoDB `File` | `{ results: [...] }` | 401, 500 |
| `POST` | `/api/v1/studio/compare` | Multi-doc comparison | `{ fileIds: [id1, id2] }` | Bearer JWT | `compareDocuments` | Gemini API + MongoDB | `{ similarities, differences, keyInsights }` | 400, 401, 404, 500 |
| `POST` | `/api/v1/studio/flashcards` | Generate study flashcards | `{ fileId, topic }` | Bearer JWT | `generateFlashcards` | Gemini API + MongoDB | `{ flashcards: [{q, a}] }` | 401, 404, 500 |
| `POST` | `/api/v1/openai/analyze` | 3D Knowledge graph & SEO | `{ text }` | None (Unprotected) | `analyzeContent` | Gemini API via `geminiHelper` | Strict JSON analysis object | 400, 500 |
| `POST` | `/api/v1/openai/action-plan` | Strategic executive summary | `{ text }` | None (Unprotected) | `generateActionPlan` | Gemini API via `geminiHelper` | `{ executiveSummary, actionItems, ... }` | 400, 500 |
| `GET` | `/api/v1/search` | Global regex search | Query param `query` | Bearer JWT | `globalSearch` | MongoDB `File` & `Chat` | `{ files: [...], chats: [...] }` | 400, 401, 500 |

---

# 18. END-TO-END EXECUTION FLOW TRACES (7 FEATURES)

### Trace 1: Conversational Chat with Attached PDF File Context
```
USER: Selects "report.pdf", types "Summarize section 2", clicks Send
  │
  ├── [React: Chat.js]
  │   ├── handleFileSelect() sends FormData to POST /api/v1/files/upload
  │   └── handleSend() optimistically appends user message to UI state
  │       Calls axios.post("/api/v1/chat/message", { message, chatId, fileId })
  │
  ├── [Express: server.js -> chatRoutes.js]
  │   └── Middleware requireSignIn verifies Bearer JWT, sets req.user
  │
  ├── [Controller: chatController.sendMessage]
  │   ├── File.findById(fileId) loads extracted PDF text
  │   ├── Appends file text to prompt: `[Attached File Content: ...] ... [End of File]`
  │   ├── Loads past Chat.messages and formats for Gemini SDK: [{ role, parts: [{ text }] }]
  │   ├── model.startChat({ history }) initializes multi-turn session
  │   ├── chatSession.sendMessage(prompt) awaits Gemini API response
  │   ├── chat.messages.push({ role: "model", content: responseText })
  │   └── await chat.save() persists to MongoDB
  │
  └── [React UI Update]
      └── setMessages appends response; ReactMarkdown renders formatted text
```

### Trace 2: Mermaid Mindmap Generation
```
USER: Clicks "Visualize" button in Chat header
  │
  ├── [React: Chat.js]
  │   └── generateMindmap() calls axios.post("/api/v1/chat/mindmap", { chatId })
  │
  ├── [Controller: chatController.generateMindmap]
  │   ├── Chat.findById(chatId) loads full message history
  │   ├── Combines messages and sends formatted prompt to Gemini model.generateContent()
  │   └── Cleans markdown fences (```mermaid) and returns raw mindmap string
  │
  └── [React UI Update]
      ├── Appends message with ```mermaid syntax to chat messages
      └── <Mermaid> component imports "mermaid" library and compiles interactive SVG
```

### Trace 3: Multi-Document Comparison (Studio)
```
USER: Uploads 2 PDFs and clicks "Compare Docs"
  │
  ├── [React: Studio.js]
  │   └── handleCompare() calls axios.post("/api/v1/studio/compare", { fileIds })
  │
  ├── [Controller: studioController.compareDocuments]
  │   ├── File.find({ _id: { $in: fileIds } }) loads text of both documents
  │   ├── Formats comparison prompt and calls Gemini model.generateContent()
  │   └── Parses JSON response: { similarities, differences, keyInsights }
  │
  └── [React UI Update]
      └── setComparisonResult updates state; renders side-by-side comparison tables
```

### Trace 4: Study Flashcard Generation
```
USER: Selects document and clicks "Flashcards"
  │
  ├── [React: Studio.js]
  │   └── handleGenerateFlashcards() calls axios.post("/api/v1/studio/flashcards", { fileId })
  │
  ├── [Controller: studioController.generateFlashcards]
  │   ├── File.findById(fileId) loads document text
  │   ├── Sends prompt to Gemini requesting 5 flashcards in strict JSON: [{ q, a }]
  │   └── Parses JSON and returns { flashcards }
  │
  └── [React UI Update]
      └── setFlashcards updates state; Framer Motion animates interactive study cards
```

### Trace 5: Insight Engine 3D Knowledge Graph & NLP Analytics
```
USER: Pastes research text and clicks "Run Deep Analysis"
  │
  ├── [React: InsightEngine.js]
  │   └── handleAnalyze() calls axios.post("/api/v1/openai/analyze", { text })
  │
  ├── [Controller: openaiController.analyzeContent]
  │   ├── Dispatches structured JSON prompt via geminiHelper.generateContentWithRetry()
  │   └── cleanJSON() strips markdown fences; parses entities, relationships, topics, and SEO
  │
  └── [React UI Update]
      ├── Computes 3D coordinates (x, y, z) for entities
      └── Plotly.js renders 3D scatter plot (scatter3d) and Content DNA radar chart (scatterpolar)
```

### Trace 6: Executive Assistant Strategic Action Plan
```
USER: Pastes strategy document and clicks "Generate Action Plan"
  │
  ├── [React: ExecutiveAssistant.js]
  │   └── handleSubmit() calls axios.post("/api/v1/openai/action-plan", { text })
  │
  ├── [Controller: openaiController.generateActionPlan]
  │   ├── Prompts Gemini with Executive Assistant persona for JSON action plan
  │   └── Returns { executiveSummary, actionItems, strategicGaps, keyRisks }
  │
  └── [React UI Update]
      └── Renders structured cards with action items and highlighted risk factors
```

### Trace 7: OAuth 2.0 Social Authentication (Google / GitHub)
```
USER: Clicks "Google" login button
  │
  ├── [Browser]
  │   └── Redirects to GET /api/v1/auth/google
  │
  ├── [Backend: Passport GoogleStrategy]
  │   ├── Redirects user to Google OAuth consent screen
  │   └── Google redirects back to GET /api/v1/auth/google/callback?code=...
  │
  ├── [Callback Handler: authRoute.js]
  │   ├── Passport finds or creates User record in MongoDB
  │   ├── user.getSignedToken(res) creates JWT access token and refresh cookie
  │   └── res.redirect(`${CLIENT_URL}/login?token=${token}`) redirects to React SPA
  │
  └── [React SPA: Login.js]
      ├── useEffect parses URL query parameter "?token=..."
      ├── localStorage.setItem("authToken", token) saves token
      └── navigate("/") transitions user to authenticated dashboard
```

---

# 19. ENVIRONMENT VARIABLES MASTER AUDIT

| Variable Name | Purpose | Where Read | Consuming Component | Failure Mode If Missing |
| :--- | :--- | :--- | :--- | :--- |
| `PORT` | HTTP Server port | `server.js:57` | Express `app.listen()` | Defaults to port `8080` |
| `DEV_MODE` | Environment indicator | `server.js:66` | Express startup logger | Logs `undefined` in console |
| `MONGO_URI` | MongoDB Atlas connection string | `config/db.js:5` | `mongoose.connect()` | Mongoose throws connection error; app cannot persist data |
| `JWT_ACCESS_SECRET` | Secret key signing access tokens | `userModel.js:47`, `authMiddleware.js:19` | `jwt.sign()` / `jwt.verify()` | Server throws fatal error; JWT signing fails with 500 error |
| `JWT_REFRESH_SECRET` | Secret key signing refresh tokens | `userModel.js:55` | `jwt.sign()` | Refresh cookie generation fails |
| `JWT_ACCESS_EXPIREIN` | Access token lifespan (e.g. `15m`) | `userModel.js:48` | `jwt.sign()` | Tokens fail to sign; immediate expiration errors |
| `JWT_REFRESH_EXPIREIN` | Refresh token lifespan (e.g. `15d`)| `userModel.js:56` | `jwt.sign()` | Cookie token creation fails |
| `GOOGLE_CLIENT_ID` | Google OAuth App Client ID | `config/passport.js:25` | `GoogleStrategy` | Defaults to `"dummy_id"`; Google OAuth fails |
| `GOOGLE_CLIENT_SECRET` | Google OAuth App Secret | `config/passport.js:26` | `GoogleStrategy` | Google OAuth token exchange fails |
| `GITHUB_CLIENT_ID` | GitHub OAuth App Client ID | `config/passport.js:67` | `GitHubStrategy` | Defaults to `"dummy_id"`; GitHub OAuth fails |
| `GITHUB_CLIENT_SECRET` | GitHub OAuth App Secret | `config/passport.js:68` | `GitHubStrategy` | GitHub OAuth token exchange fails |
| `GEMINI_API_KEY` | Google AI Studio API Key | `geminiHelper.js:14`, `chatController.js`, `fileController.js`, `studioController.js` | `GoogleGenerativeAI` | All AI operations fail with `401/403 API Key Invalid` |
| `CLIENT_URL` | Frontend domain for OAuth redirects | `authRoute.js:21`, `authController.js:88` | OAuth redirect & reset email links | Defaults to `http://localhost:3000` |
| `SMTP_EMAIL` | Gmail/SMTP sender address | `utils/sendEmail.js:9` | Nodemailer transporter | Password reset emails cannot be sent |
| `SMTP_PASSWORD` | Gmail App Password / SMTP secret | `utils/sendEmail.js:10` | Nodemailer transporter | SMTP authentication fails (EAUTH) |
| `SMTP_FROM_NAME` | Sender display name | `utils/sendEmail.js:21` | Nodemailer message object | Defaults to `undefined <SMTP_EMAIL>` |
| `REACT_APP_API_URL` | Backend URL for React client | `client/src/axiosConfig.js:9` | Axios instance `baseURL` | Defaults to `https://quantum-chat-backend.onrender.com` in production or `http://localhost:8080` in development |

---

# 20. ERROR HANDLING & RESILIENCE ARCHITECTURE

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                              CENTRALIZED ERROR TAXONOMY                                │
├─────────────────────────┬───────────────────────────────────┬──────────────────────────┤
│ Error Class / Origin    │ Transformation in errorMiddleware │ HTTP Status & Message    │
├─────────────────────────┼───────────────────────────────────┼──────────────────────────┤
│ CastError (Invalid ID)  │ Catches invalid MongoDB ObjectIds │ 404 "Resource not found" │
│ Duplicate Key (11000)   │ Catches duplicate email registers │ 400 "Duplicate value"    │
│ ValidationError         │ Formats Mongoose schema rules     │ 400 "Validation failed"  │
│ Transient AI Overload   │ geminiHelper retry loop (2s/4s/6s)│ Transparent retry        │
│ Uncaught React Error    │ ErrorBoundary.js class component  │ Fallback Error Card UI   │
└─────────────────────────┴───────────────────────────────────┴──────────────────────────┘
```

---

# 21. ASYNCHRONOUS JAVASCRIPT, EVENT LOOP, & RUNTIME MECHANICS

### 21.1 Single-Threaded Non-Blocking I/O
Node.js processes requests on a single thread powered by **libuv**:
1. When an I/O operation starts (e.g. `await mongoose.connect()` or `await chatSession.sendMessage()`), Node hands off the socket/network handle to libuv.
2. The main thread continues executing other synchronous code and handling new incoming HTTP connections.
3. Upon I/O completion, the callback/promise is placed in the **Microtask Queue**.
4. The Event Loop dequeues the microtask and resumes execution after the `await` expression.

---

# 22. THIRD-PARTY LIBRARIES & PACKAGE AUDIT

### Backend (`package.json`)
- `@google/generative-ai` (^0.21.0): Official Google Gemini SDK.
- `express` (^4.21.2): HTTP web framework and routing.
- `mongoose` (^8.9.3): MongoDB Object Data Modeling (ODM).
- `jsonwebtoken` (^9.0.2): HMAC-SHA256 JWT access and refresh token signing.
- `bcryptjs` (^2.4.3): Pure JS password hashing.
- `passport`, `passport-google-oauth20`, `passport-github2`: OAuth 2.0 authentication.
- `multer` (^2.0.2): Multi-part file upload handler.
- `mammoth` (^1.11.0): DOCX text extraction.
- `nodemailer` (^7.0.11): SMTP email delivery.
- `helmet` (^8.0.0): Security HTTP headers.
- `cors` (^2.8.5): Cross-origin resource sharing.
- `morgan` (^1.10.0): HTTP request logger.
- `dotenv` (^16.4.7): Environment variable parser.
- `concurrently` (^9.1.2): Simultaneous server and client development runner.

### Frontend (`client/package.json`)
- `@mui/material` & `@mui/icons-material` (^6.3.0): UI component library.
- `framer-motion` (^12.23.26): Spring animations and layout transitions.
- `react-plotly.js` & `plotly.js` (^2.6.0 / ^2.35.3): 3D entity scatter and radar charting.
- `mermaid` (^11.12.2): Markdown-to-mindmap diagram compiler.
- `react-markdown` (^10.1.0): Markdown parsing.
- `react-syntax-highlighter` (^16.1.0): Syntax highlighting in AI responses.
- `react-hot-toast` (^2.5.1): Notification toast manager.
- `axios` (^1.7.9): HTTP client with request interceptors.

---

# 23. LOCAL DEVELOPMENT SETUP (ZERO TO RUNNING)

```bash
# 1. Clone the repository
git clone https://github.com/rohit02k5/QUANTUM-CHAT-AI-WORKSPACE.git
cd QUANTUM-CHAT-AI-WORKSPACE

# 2. Install backend dependencies
npm install

# 3. Create root .env file
# (Populate with MONGO_URI, JWT_ACCESS_SECRET, GEMINI_API_KEY, etc.)

# 4. Install frontend dependencies
cd client
npm install
cd ..

# 5. Start both servers concurrently
npm run dev
```
- **Backend API**: `http://localhost:8080`
- **Frontend SPA**: `http://localhost:3000`

---

# 24. PRODUCTION DEPLOYMENT & INFRASTRUCTURE (RENDER + SPA REWRITES)

- **Frontend Deployment**: Deployed as a static site on Render (`https://quantum-chat-frontend.onrender.com`).
- **Backend Deployment**: Deployed as a web service on Render (`https://quantum-chat-backend.onrender.com`).
- **SPA Routing Rewrite Rule**: Static site hosting requires redirecting all paths `/*` to `/index.html` to avoid 404 errors on deep route refreshes.

---

# 25. PERFORMANCE & LATENCY OPTIMIZATION GUIDE

1. **Lazy Loading of Visualizations**: `mermaid` and `plotly.js` are heavy bundles (~2MB). In `Chat.js`, `import("mermaid")` is imported dynamically on demand to preserve initial bundle performance.
2. **Exponential Backoff**: `geminiHelper.js` prevents cascading failures during Google API rate limiting.
3. **Optimistic UI Updates**: `Chat.js` appends user messages immediately to local state before awaiting the network response.

---

# 26. SCALABILITY BLUEPRINT: 100 TO 1,000,000 USERS

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                         PRODUCTION-GRADE SCALED ARCHITECTURE                           │
└────────────────────────────────────────────────────────────────────────────────────────┘

    [ Browser Clients ]
            │
            ▼
    [ Cloudflare CDN & DDoS Shield ] (Caches Static React Assets & Terminates SSL)
            │
            ▼
    [ AWS Application Load Balancer / Nginx Reverse Proxy ]
            │
     ┌──────┴──────────────────────────┬─────────────────────────┐
     ▼                                 ▼                         ▼
[ Node.js API Cluster 1 ]   [ Node.js API Cluster 2 ]  [ Node.js API Cluster N ]
(Stateless Auth via JWT)     (Stateless Auth via JWT)   (Stateless Auth via JWT)
     │                                 │                         │
     ├─────────────────────────────────┴─────────────────────────┤
     │
     ├──► [ Redis Cluster ]
     │      - JWT Blacklist & User Session Cache
     │      - Rate Limiting Counters (`express-rate-limit-redis`)
     │      - AI Response Caching (Identical prompts return cached responses)
     │
     ├──► [ BullMQ / RabbitMQ Job Queue ]
     │      │
     │      ▼
     │   [ Asynchronous Background AI Workers ]
     │      - Long-running document text extraction
     │      - Side-by-side comparison processing
     │      - Gemini API rate-limit throttling & retry management
     │
     └──► [ MongoDB Replica Set with Read Replicas ]
            - Primary: Write operations (new chats, user registration)
            - Secondary Replicas: Read queries (chat history, file lists)
            - AWS S3 / Cloudinary: Stores uploaded files (PDF/DOCX) instead of local disk
```

### Scaling Milestones
- **100 – 1,000 Users**: Single Render instance + MongoDB Atlas M0.
- **10,000 Users**: Horizontal scaling (PM2 cluster or multi-instance containers), AWS S3 for Multer uploads, Redis caching for LLM responses.
- **1,000,000 Users**: Microservices architecture, BullMQ asynchronous worker queues for document processing, MongoDB replica sets, dedicated vector database (Pinecone) with `text-embedding-004`.

---

# 27. SECURITY AUDIT, VULNERABILITY ANALYSIS, & MITIGATION

| Severity | Vulnerability / Concern | Code Location | Technical Risk | Required Production Fix |
| :--- | :--- | :--- | :--- | :--- |
| **HIGH** | Unprotected AI Endpoints | `routes/openaiRoutes.js:11-14` | `/analyze`, `/action-plan`, `/summary`, `/chatbot` do **not** use `requireSignIn`. Anyone can make unauthenticated requests to your backend, consuming Gemini API quota. | Add `router.use(requireSignIn)` to `routes/openaiRoutes.js`. |
| **MEDIUM**| Token Exfiltration in OAuth Redirect | `routes/authRoute.js:22,35` | `res.redirect('${clientURL}/login?token=${token}')` passes JWT in the URL query string. URLs are logged in browser history, server logs, and HTTP `Referer` headers. | Return a short-lived authorization code or set the token in an HttpOnly cookie instead of URL parameters. |
| **MEDIUM**| Missing Rate Limiting | `server.js` | No rate-limiting middleware (`express-rate-limit`) is mounted. Malicious actors could spam `/api/v1/auth/login` (brute force) or `/api/v1/chat/message` (denial of service). | Add `express-rate-limit` to sensitive auth and AI routes. |
| **LOW** | Potential Regex DoS (ReDoS) | `controllers/searchController.js:11` | `new RegExp(query, "i")` compiles raw user input directly into a regex. Complex patterns could cause high CPU utilization during MongoDB scans. | Escape special regex characters before instantiation, or use MongoDB Text Indexes. |

---

# 28. CODEBASE DEFECTS, BUGS, & INCONSISTENCIES TO KNOW

1. **Duplicate Response Bug in `studioController.js`**:
   - In `controllers/studioController.js:88-90`, `res.status(200).json({ flashcards });` is called **twice consecutively**, causing an unhandled `ERR_HTTP_HEADERS_SENT` runtime error in Node.
2. **Redundant Error Handler Mount in `server.js`**:
   - In `server.js:47`, `app.use(errorHandler)` is mounted *before* routes are registered, and then mounted again on line 64.
3. **Unprotected Intelligence Endpoints**:
   - `routes/openaiRoutes.js` does not mount `requireSignIn`.
4. **Missing Import in Unused `NavBar.js`**:
   - In `client/src/components/NavBar.js:78`, `<NavLink>` is used without being imported from `react-router-dom`. (Component is legacy/unused).
5. **MongoDB Regex vs. Claimed Vector Search**:
   - UI states "Vector-search powered asset management," but the backend implementation uses MongoDB `$regex`.

---

# 29. TESTING STRATEGY (AUTOMATED, UNIT, INTEGRATION, & MOCKING)

```javascript
// Example Jest / Supertest Integration Test for /api/v1/chat/message
const request = require("supertest");
const app = require("../server");
const mongoose = require("mongoose");

jest.mock("@google/generative-ai", () => ({
  GoogleGenerativeAI: jest.fn().mockImplementation(() => ({
    getGenerativeModel: jest.fn().mockReturnValue({
      startChat: jest.fn().mockReturnValue({
        sendMessage: jest.fn().mockResolvedValue({
          response: { text: () => "Mocked Gemini Response" }
        })
      })
    })
  }))
}));

describe("POST /api/v1/chat/message", () => {
  it("should return 200 OK and model response for authenticated user", async () => {
    const token = "valid_test_jwt";
    const res = await request(app)
      .post("/api/v1/chat/message")
      .set("Authorization", `Bearer ${token}`)
      .send({ message: "Hello AI" });

    expect(res.statusCode).toEqual(200);
    expect(res.body.response).toEqual("Mocked Gemini Response");
  });
});
```

---

# 30. RECONSTRUCTING THE ENTIRE PROJECT FROM SCRATCH

```
STEP 1: Initialize Git repo, root package.json, and React client folder
STEP 2: Configure Express server.js, Helmet, CORS, and Mongoose connection in config/db.js
STEP 3: Define User, Chat, and File Mongoose models
STEP 4: Implement authController.js, passport.js OAuth strategies, and authMiddleware.js
STEP 5: Implement utils/sendEmail.js for SHA-256 password resets
STEP 6: Build utils/geminiHelper.js with exponential backoff and connect gemini-2.5-flash
STEP 7: Build Multer file upload pipeline with Gemini multimodal PDF extraction in fileController.js
STEP 8: Build chatController.js with multi-turn session history and Mermaid mindmap generation
STEP 9: Build studioController.js (comparison & flashcards) and openaiController.js (Insight Engine)
STEP 10: Setup React 18 client with Material-UI ThemeContext, Framer Motion, and ProtectedRoute.js
STEP 11: Implement React pages: Homepage, Chat, Studio, InsightEngine, ExecAssistant, KnowledgeBase, Auth
```

---

# 31. FILE-BY-FILE TECHNICAL DIRECTORY

- `server.js`: Server entry point, middleware registration, route mounting.
- `config/db.js`: Mongoose MongoDB connection initializer.
- `config/passport.js`: Google and GitHub OAuth 2.0 Passport strategies.
- `middlewares/authMiddleware.js`: JWT verification middleware (`requireSignIn`).
- `middlewares/errorMiddleware.js`: Centralized Express error handler.
- `models/userModel.js`: User schema, bcrypt hash hook, JWT token generator.
- `models/Chat.js`: Chat schema with embedded message history subdocuments.
- `models/File.js`: File schema holding metadata and extracted plain text.
- `utils/errorResponse.js`: Custom Error class attaching HTTP status codes.
- `utils/geminiHelper.js`: Google Gemini SDK wrapper with exponential backoff.
- `utils/sendEmail.js`: Nodemailer SMTP transporter for password reset emails.
- `controllers/authController.js`: Authentication, registration, login, password reset handlers.
- `controllers/chatController.js`: Multi-turn chat, session CRUD, Mermaid mindmaps.
- `controllers/fileController.js`: Multer uploads, Gemini PDF extraction, Mammoth DOCX parsing.
- `controllers/studioController.js`: Document comparison and flashcard generator.
- `controllers/openaiController.js`: Insight Engine 3D analytics and Executive Action Plans.
- `controllers/searchController.js`: Global regex workspace search.
- `routes/*.js`: Express route definitions for all API modules.
- `client/src/App.js`: Client route registry with ProtectedRoute guards.
- `client/src/axiosConfig.js`: Axios instance with automated JWT bearer interceptor.
- `client/src/theme.js` & `ThemeContext.js`: Material-UI cyberpunk/dark/light theme tokens and state.
- `client/src/components/Layout.js`: Application dashboard shell with animated collapsible sidebar.
- `client/src/components/AuthLayout.js`: Responsive split-screen auth container.
- `client/src/components/ErrorBoundary.js`: React class error boundary.
- `client/src/pages/Chat.js`: Conversational AI interface with Mermaid rendering and file attachments.
- `client/src/pages/Studio.js`: Document comparison and flashcard study room.
- `client/src/pages/InsightEngine.js`: 3D Plotly entity relationship graphs and radar charts.
- `client/src/pages/ExecutiveAssistant.js`: Executive decision briefs, action items, and risk logs.
- `client/src/pages/KnowledgeBase.js`: Uploaded asset gallery and search interface.
- `client/src/pages/Login.js` & `Register.js`: User authentication views.

---

# 32. FUNCTION-BY-FUNCTION REFERENCE

- `connectDB()`: Connects to MongoDB Atlas using `mongoose.connect()`.
- `requireSignIn(req, res, next)`: Validates JWT token from header, attaches `req.user`.
- `errorHandler(err, req, res, next)`: Formats Mongoose and Express errors into JSON responses.
- `userSchema.methods.getSignedToken(res)`: Signs access token and sets refresh cookie.
- `geminiHelper.generateContentWithRetry(prompt, config, retries)`: Executes Gemini call with exponential backoff.
- `chatController.sendMessage(req, res)`: Ingests user prompt, attaches file text, manages Gemini session history, saves to DB.
- `chatController.generateMindmap(req, res)`: Pulls chat history, prompts Gemini for Mermaid syntax.
- `fileController.uploadFile(req, res)`: Saves file to disk, extracts text using Gemini/Mammoth, saves File record.
- `studioController.compareDocuments(req, res)`: Aggregates text from multiple files, generates comparative synthesis.
- `studioController.generateFlashcards(req, res)`: Generates study flashcards from document text.
- `openaiController.analyzeContent(req, res)`: Produces structured JSON entities, relationships, topics, and SEO metrics.
- `openaiController.generateActionPlan(req, res)`: Generates strategic executive summary, action items, gaps, and risks.
- `searchController.globalSearch(req, res)`: Runs concurrent MongoDB regex query across File and Chat collections.

---

# 33. 12-LEVEL TECHNICAL INTERVIEW DEFENSE QUESTIONS & ANSWERS

#### Level 1: Project Overview
- **Q**: What is Quantum?
- **A**: Quantum is a full-stack AI workspace built on the MERN stack and Google Gemini that unifies conversational AI, document text extraction, interactive Mermaid.js mindmaps, 3D Plotly knowledge graphs, and strategic executive decision planning in a single authenticated platform.

#### Level 2: Implementation Details
- **Q**: How does the frontend handle code blocks and mindmaps returned by the AI?
- **A**: `Chat.js` uses `ReactMarkdown` with a custom code component. Standard code blocks are highlighted using `Prism` (`react-syntax-highlighter`). If the language identifier is `mermaid`, the component delegates rendering to `<Mermaid>`, which dynamically imports `mermaid.js` and renders an interactive, zoomable SVG.

#### Level 3: Backend Mechanics
- **Q**: Why is `app.set("trust proxy", 1)` in `server.js`?
- **A**: When deployed on cloud platforms like Render or behind Cloudflare, requests pass through a reverse proxy. Setting `trust proxy` instructs Express to trust the `X-Forwarded-*` headers, ensuring correct client IP logging and secure HTTPS cookie handling.

#### Level 4: Frontend State & Interceptors
- **Q**: How do Axios requests attach authentication tokens without duplicating code?
- **A**: In `client/src/axiosConfig.js`, we create an Axios instance with an outgoing request interceptor. It reads `authToken` from `localStorage` or `sessionStorage` and injects `Authorization: Bearer <token>` into every request header while filtering invalid token strings.

#### Level 5: Database Design
- **Q**: Why store messages as an embedded subdocument array in `Chat` instead of a separate collection?
- **A**: In conversational AI, messages are always read and written together with their parent chat session. Embedding messages eliminates expensive `$lookup` database joins, providing high-performance reads and atomic writes.

#### Level 6: AI & LLM Orchestration
- **Q**: How do you prevent transient API outages from crashing user chat sessions?
- **A**: `utils/geminiHelper.js` implements exponential backoff with retry logic for HTTP 503 and 429 status codes. If errors persist on attempt 2, the helper automatically switches to a fallback model (`gemini-1.5-flash`).

#### Level 7: Architecture
- **Q**: Why orchestrate LLM requests on the backend rather than calling Google Gemini directly from React?
- **A**: Calling LLMs from the backend protects the `GEMINI_API_KEY` from public exposure, enforces JWT user authentication, sanitizes prompts, attaches contextual database files, and allows server-side rate limiting and usage logging.

#### Level 8: Security
- **Q**: How does your password reset mechanism protect against database leaks?
- **A**: The server generates a random 20-byte token, hashes it with SHA-256 before saving to MongoDB, and sends the raw unhashed token via email. If the database is breached, attackers only see SHA-256 hashes, which cannot be used to reset passwords.

#### Level 9: Scalability
- **Q**: How would you scale the document ingestion pipeline for 100,000 users?
- **A**: Replace local disk storage with AWS S3 pre-signed uploads, decouple document processing using BullMQ message queues backed by Redis, and process OCR/extraction asynchronously using dedicated worker instances.

#### Level 10: Design Trade-offs
- **Q**: Why use MongoDB instead of PostgreSQL for this workspace?
- **A**: MongoDB's schema-less JSON/BSON document model naturally matches the hierarchical structure of chat histories and the varying lengths of extracted unstructured document text without rigid migrations.

#### Level 11: Internal Mechanics
- **Q**: What happens inside Node.js while waiting for Gemini to generate a response?
- **A**: Node delegates the asynchronous HTTPS TLS socket to libuv's event loop and frees the main thread. Other incoming user requests continue executing without blocking until Google's response resolves into the Microtask Queue.

#### Level 12: Production Improvements
- **Q**: What architectural improvements would you make in the next version?
- **A**: 
  1. Add `express-rate-limit` and mount `requireSignIn` across all intelligence routes.
  2. Implement Server-Sent Events (SSE) for real-time token streaming.
  3. Replace MongoDB regex search with vector embeddings (`text-embedding-004`) and Pinecone for true semantic retrieval.

---

# 34. INTERVIEW SCRIPTS (30S, 1M, 2M, 5M PRESENTATIONS)

### 30-Second Elevator Pitch
> *"Quantum is a full-stack AI intelligence workspace built on the MERN stack and Google Gemini. It goes beyond standard chatbots by combining multi-turn context-aware chat, automated Mermaid.js mindmaps, document extraction via Gemini multimodal OCR, and an Insight Engine that renders 3D entity relationship graphs and content analytics using Plotly.js."*

---

### 2-Minute Technical Summary
> *"I built Quantum to solve the fragmented workflow between conversational AI, document synthesis, and data analytics. On the frontend, I used React 18 with a custom Material-UI dark/light theme, Framer Motion for animations, Plotly.js for 3D entity relationship graphs, and dynamic Mermaid.js rendering for mindmaps.*
> 
> *On the backend, I built a modular Express REST API backed by MongoDB Atlas. Authentication is handled through a hybrid system supporting email/password and OAuth 2.0 with Google and GitHub using Passport, issuing JWT access tokens and HttpOnly refresh cookies. I also engineered a secure password reset pipeline using SHA-256 tokens and Nodemailer SMTP.*
> 
> *For AI orchestration, I integrated Google's Generative AI SDK using `gemini-2.5-flash`. To handle transient rate limits and 503 errors, I built a custom GeminiHelper with exponential backoff and model fallback. In the chat module, I preserved multi-turn history using Gemini's `startChat` session API, and for document intelligence, I used Gemini's multimodal inline data for accurate PDF text extraction alongside Mammoth for Word documents."*

---

# 35. PHASE 3B ADDENDUM — MULTIMODAL INGESTION, PAGE CITATIONS & TABLE ANALYST

This addendum extends the architecture guide with the Phase 3B subsystems.

## 35.1 Page-level citations
`utils/dataLoader.js` extracts PDFs one `pdf-parse` page at a time
(`result.pages[i]` — `getText({pageIndex})` is **not** a real pdf-parse v2
API and silently duplicates the whole document). The chunker preserves
per-document boundaries, so chunks carry `metadata.page` and never span
pages. `guard.js` emits `page=` in `<source>` tags; the model is required
(rule 6) to cite `[source N, p.P]`; the client opens an authenticated
`pdfjs-dist` viewer at that page. `File.pagesWithoutText` records pages
under `PDF_MIN_PAGE_CHARS` (scanned-page hint → Deep analysis).
`POST /files/:id/reprocess` regenerates page-aware text chunks for legacy
PDFs — upsert first, prune stale `seq` after, figure/image chunks
untouched.

## 35.2 Image ingestion (untrusted vision output)
PNG/JPEG/WebP validated by **magic bytes** (`utils/image.js`), capped at
`IMAGE_MAX_MB`, stored untouched in GridFS. A `describe` stage asks Gemini
for `{caption, ocrText, dataInsights, tags}` → `File.description` + 1–3
`type:"image"` chunks. OCR text is data, not instructions — it flows
through the same `<source>` wrapping + injection detector (visual prompt
injection). `ImageViewerModal` renders the authenticated blob beside the
description.

## 35.3 PDF deep analysis (resumable vision pipeline)
`POST /files/:id/deep-analysis {pageStart,pageEnd}` → `IngestionJob
kind:"deep-analysis"` → `utils/deepAnalysis.js`: `pdf-lib` slices
~5-page windows (`DEEP_ANALYSIS_WINDOW_PAGES`), sends each to Gemini
`analyzePdfPages` (inline or Files API, always deleted in `finally`),
maps slice-relative page numbers back to absolute, checkpoints
`job.state.deepAnalysis.{doneWindows,items}` per window. Upsert key
`(file,type,page,deepIdx)` ⇒ idempotent reruns. `scanned_text` →
`type:"text"` chunks; figures/charts/tables → `type:"figure"` with
`figureType`. Caps: `MULTIMODAL_MAX_PAGES=20` per run,
`DEEP_ANALYSIS_DAILY_CAP=3` per user/day (TTL `deepanalysisquotas`).

## 35.4 Table analyst (structured spec — model proposes, code disposes)
CSV ingest streams a column profile into `File.tableMeta` (`csv-parse` 7,
ESM `import()`; `TABLE_MAX_ROWS` cap). `POST /files/:id/ask-data` +
agent `analyze_table` both call `services/tableQuery.js`: Gemini emits a
declarative spec only; every column is allow-listed, ops are type-checked,
`contains` is a substring (never RegExp), group keys are `Map`s
(`__proto__`-safe), `limit` clamps to 1000, execution re-parses the CSV
within `TABLE_QUERY_TIMEOUT_MS`. No `eval`, no generated code, no query
strings from the model. Result `{rows,rowCount,truncated,chartSpec}` →
editable-type Plotly chart in `AskDataPanel`.

## 35.5 Reliability additions
`evalRetry` (backoff, counted in `EVAL_MAX_CALLS`, reported as
`evalRetries`) shields the eval harness from quota blips; the
missing-index `$vectorSearch` fallback checks `listSearchIndexes` first
(silent-empty array bug, found on real Atlas);
`scripts/atlas-verify-3b.js` automates the real-cluster checklist with
honest SKIP reporting under quota exhaustion; `DELETE /api/v1/auth/
account` provides throwaway-user cleanup (also used by the smoke test).
