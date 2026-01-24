# Quantum — Unified AI Intelligence Suite

> **Where Artificial Intelligence, Knowledge, and Creativity Converge.**  
> *A production-grade AI workspace built with MERN, GenAI, and advanced data visualization.*

---

## Overview

**Quantum** is a **full-scale AI Intelligence Suite**, not just a chatbot.

It is designed as a **single unified workspace** where users can:

- Converse intelligently with AI  
- Analyze documents and content deeply  
- Visualize knowledge and insights in **2D & 3D**  
- Generate executive summaries and strategies  
- Create AI-generated images using diffusion models  
- Securely manage data with **enterprise-grade authentication**

This project demonstrates **real-world system design, AI orchestration, security engineering, and polished UX** — exactly what recruiters look for beyond basic demos.

---

## Live Demo

🔗 **Quantum AI:**  
 https://quantum-chat-frontend.onrender.com/login

---

## Why Quantum Stands Out

- End-to-end **MERN Stack** architecture  
- Multiple **AI systems orchestrated together**  
- Secure **OAuth + JWT hybrid authentication**  
- Advanced **3D knowledge graphs & analytics**  
- Integrated **AI Image Generation (NeuraPix)**  
- Product-level **UI/UX & workflow design**  
- **Production-ready deployment** mindset  

---

## Core Modules

---

## Authentication & Security System (Enterprise-Grade)

Quantum is built with a **security-first architecture**, clearly demonstrated by its authentication flows.

### Features
- Email & Password authentication  
- OAuth 2.0 login with **Google** and **GitHub**  
- Secure **Sign Up / Sign In / Forgot Password** flows  
- Encrypted password storage using **bcrypt**  
- Password reset via **secure email token (SMTP)**  

### Security Design
- **JWT Access Tokens** (15 minutes)  
- **JWT Refresh Tokens** (15 days)  
- Tokens stored in **HttpOnly cookies** (XSS-safe)  
- **Helmet.js** for secure headers (CSP, XSS, CSRF)

*Screenshots show clean, professional authentication UI — exactly what production apps require.*

---

## Quantum Chat — Context-Aware Conversational AI

> An intelligent assistant designed for **deep reasoning, learning, and productivity**.

### Capabilities
- Context-retaining multi-turn conversations  
- Coding help, explanations, reasoning, and creativity  
- Chat history persisted in **MongoDB**  
- File-aware intelligence (chat with documents)  

### Unique Feature
- **One-click conversion of conversations into structured mind maps** using **Mermaid.js**, enabling visual understanding of complex topics.

---

## Insight Engine — Deep Content & Knowledge Intelligence

> Transform raw text into **actionable intelligence**.

### Features
- Readability analysis (Flesch–Kincaid)  
- Tone & sentiment analysis  
- Estimated reading time  
- Entity extraction (organizations, concepts, topics)  
- **Interactive 3D Knowledge Graphs**  
- **Content DNA radar charts**

### Visualization Stack
- **Plotly.js** — 3D entity relationships  
- **Chart.js** — radar & analytics charts  

### Use Cases
- Market & business analysis  
- SEO & content evaluation  
- Academic research  
- Strategic writing  

---

## Quantum Studio — Document Intelligence Workspace

> A powerful learning and research environment.

### Capabilities
- Upload multiple documents (**PDF / TXT / DOCX**)  
- Compare documents side-by-side  
- Generate structured summaries  
- Auto-create **flashcards** for revision  
- Ideal for exams, research papers, and knowledge synthesis  

---

## NeuraPix — AI Image Generation Studio (Integrated)

**NeuraPix**, your previous AI Image Generator project, is now **fully integrated into Quantum** as a creative intelligence module.

### Features
- Text-to-image generation  
- Powered by **Stable Diffusion via Hugging Face**  
- Prompt-driven creative workflows  
- High-quality AI-generated visuals  

### Why This Matters
This demonstrates:
- Modular system design  
- Reusability of prior projects  
- Real-world integration of **GenAI pipelines**

---

## Knowledge Base — Persistent AI Memory

> Your personal AI knowledge repository.

### Features
- Stores uploaded files & insights  
- Global search across workspace  
- Acts as long-term AI memory  
- Enables reuse of past intelligence  

---

## Executive Assistant — Strategy & Decision Intelligence

> AI outputs designed for **business and leadership contexts**.

### Outputs
- Executive summaries  
- Action items  
- Strategic gaps & risks  
- Decision-ready insights  

---

## AI & Intelligence Stack

| Function | Technology |
|--------|------------|
| Conversational AI | Google Gemini Pro |
| Image Generation | Hugging Face (Stable Diffusion) |
| NLP & Analysis | Natural, Sentiment.js |
| Knowledge Graphs | Plotly.js (3D) |
| Visualization | Chart.js, Mermaid.js |

---

## Tech Stack

### Frontend
- React.js 18  
- React Router v6  
- Tailwind CSS + Emotion  
- Material UI (MUI v5)  
- Framer Motion (animations)  
- Plotly.js (3D graphs)  
- Mermaid.js (mind maps)

### Backend
- Node.js  
- Express.js  
- MongoDB Atlas  
- Mongoose ODM  
- JWT + Passport.js  
- Nodemailer (SMTP)  
- OAuth 2.0 (Google & GitHub)

---

## Architecture Philosophy

- Modular & scalable backend  
- Clear separation of concerns  
- API-first design  
- Stateless authentication  
- Cloud-deployment ready  

---

## Engineering Challenges & Learnings

- Designing secure OAuth + JWT token rotation  
- Managing long AI conversation context efficiently  
- Rendering performant 3D knowledge graphs  
- Orchestrating multiple AI services in a unified UX  
- Handling SPA routing & OAuth redirects in production  

---

## High-Level Architecture

```text
Frontend (React)
   ↓
Backend (Express API)
   ↓
AI Services (Gemini, Hugging Face)
   ↓
MongoDB Atlas
```
---
## Local Setup
```text
git clone https://github.com/rohit02k5/QUANTUM-CHAT-AI.git
cd QUANTUM-CHAT-AI
```

Backend
```text
npm install
npm run server
```
Frontend
```text
cd client
npm install
npm start
```
Deployment Ready
Quantum is production-ready and designed for deployment on platforms like Render or Vercel.

SPA routing handled correctly

OAuth redirect-safe

Environment-based configuration

Secure CORS policies



Screenshots & UI Highlights

Screenshots demonstrate authentication flows, AI chat, document intelligence, 3D graphs, and executive insights.

<img width="1919" height="916" alt="Screenshot 2025-12-14 164516" src="https://github.com/user-attachments/assets/932350f9-e891-4c6f-be5e-19915d9f97ca" />
<img width="1919" height="896" alt="Screenshot 2025-12-14 164504" src="https://github.com/user-attachments/assets/4f6bd8bf-f121-42fd-9869-ab644832775c" />
<img width="1919" height="866" alt="Screenshot 2025-12-14 164605" src="https://github.com/user-attachments/assets/26a8a7e2-a8b4-4777-818a-7d47630e4feb" />
<img width="1891" height="897" alt="Screenshot 2025-12-12 223530" src="https://github.com/user-attachments/assets/ea8d2f37-b15b-4ec2-8832-21b682a03637" />
<img width="1911" height="890" alt="Screenshot 2025-12-12 230217" src="https://github.com/user-attachments/assets/d6cb3174-a9eb-4687-ba7f-47e5b1f6d256" />
<img width="1884" height="897" alt="Screenshot 2025-12-12 231022" src="https://github.com/user-attachments/assets/a27c9b16-4533-4e3e-bd2e-89f3e184470f" />
<img width="1721" height="914" alt="Screenshot 2025-12-12 231005" src="https://github.com/user-attachments/assets/6ae1fabf-405c-4734-a780-6040ff5f0b1d" />
<img width="1718" height="886" alt="Screenshot 2025-12-12 231609" src="https://github.com/user-attachments/assets/10e392a3-b3b2-4da6-8c81-5079906ada1e" />
<img width="1883" height="897" alt="Screenshot 2025-12-12 231638" src="https://github.com/user-attachments/assets/a169b37a-dca3-471e-b271-8988b73a13af" />
<img width="1894" height="891" alt="Screenshot 2025-12-12 231717" src="https://github.com/user-attachments/assets/3b47a9f0-25f1-4c1d-bd8b-eb442b70bded" />
<img width="1894" height="895" alt="Screenshot 2025-12-12 232629" src="https://github.com/user-attachments/assets/18574d9f-f645-463c-9c49-fb964a0fc175" />
<img width="1881" height="869" alt="Screenshot 2025-12-12 232843" src="https://github.com/user-attachments/assets/8e76531d-cf4f-490a-99b4-d9e793471b8e" />
<img width="1866" height="891" alt="Screenshot 2025-12-12 232954" src="https://github.com/user-attachments/assets/367ed399-d6cf-481e-a94a-ee9b3650106b" />
<img width="1874" height="894" alt="Screenshot 2025-12-12 233108" src="https://github.com/user-attachments/assets/82246672-5c9e-4e7d-abd3-67cc5e95fd93" />
<img width="1914" height="900" alt="Screenshot 2025-12-12 233308" src="https://github.com/user-attachments/assets/934328b2-8c45-4782-ba0e-eac66e388b70" />

Author

Swarna Venkata Sai Rohit
B.Tech Electrical Engineering — IIT Bhilai
Full-Stack & AI Systems Engineer

GitHub: https://github.com/rohit02k5
Linkedin: https://www.linkedin.com/in/svs-rohit-baa147283
Email: rohitiitbh@gmail.com
