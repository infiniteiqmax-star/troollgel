# TROOLLgel MVP

This is the first real, AI-connected MVP.

## What it does
- Google-style homepage and results page
- Search query is sent to `/api/search`
- Server calls the OpenAI Responses API
- AI generates four different fictional search results
- The first result is the actual TROOLLgel joke
- API key stays on the server, never in browser code

## Run it
1. Install Node.js 20+.
2. Copy `.env.example` to `.env`.
3. Put your OpenAI API key in `.env`.
4. Install dependencies: `npm install`
5. Start: `npm start`
6. Open `http://localhost:3000`

For production, deploy the Node app to a server/host and add `OPENAI_API_KEY` as a server-side environment variable.
