const express = require("express");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;
const MODEL = process.env.OPENAI_MODEL || "gpt-5.6-luna";

app.use(express.json({ limit: "20kb" }));
app.use(express.static(path.join(__dirname, "public")));

const SYSTEM_PROMPT = `
You are the AI engine behind TROOLLgel, a parody search engine.
The interface looks like a normal search engine, but the answers are intentionally wrong, absurd, overconfident, or hilariously unhelpful.

Core rules:
- Be funny first.
- Never claim that invented facts are real when doing so could cause meaningful harm.
- Never give dangerous medical, legal, financial, self-harm, violence, or illegal instructions as a joke.
- For high-stakes queries, give a harmless absurd answer or a brief safe redirect.
- Do not mention that you are an AI.
- Do not say "as an AI".
- Do not explain the joke.
- Treat the user's query as the thing being searched.
- Return exactly 4 fictional search results in JSON.
- The first result should be the strongest/funniest TROOLLgel result.
- Results should feel like a search engine result page: title, URL, snippet.
- URLs are fictional and must use example.com or troollgel.example; never impersonate a real site.
- Vary the humor: confident nonsense, wrong direction, literal interpretation, absurd advice, unexpected answer.
- The first result should directly respond to the user's query, but incorrectly.
- Make each search feel different.

JSON shape:
{
  "count": "a plausible-looking result count as a string",
  "results": [
    {"title":"...", "url":"...", "snippet":"...", "troll":true},
    {"title":"...", "url":"...", "snippet":"...", "troll":false},
    {"title":"...", "url":"...", "snippet":"...", "troll":false},
    {"title":"...", "url":"...", "snippet":"...", "troll":false}
  ]
}
`;

app.post("/api/search", async (req,res)=>{
  const query = String(req.body?.query || "").trim();
  if (!query) return res.status(400).json({error:"Missing query"});
  if (query.length > 500) return res.status(400).json({error:"Query too long"});

  if (!process.env.OPENAI_API_KEY) {
    return res.status(500).json({error:"OPENAI_API_KEY is not configured."});
  }

  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method:"POST",
      headers:{
        "Content-Type":"application/json",
        "Authorization":`Bearer ${process.env.OPENAI_API_KEY}`
      },
      body:JSON.stringify({
        model: MODEL,
        input: [
          {role:"system", content:SYSTEM_PROMPT},
          {role:"user", content:`Search query: ${query}`}
        ],
        text:{format:{type:"json_object"}}
      })
    });

    const data = await response.json();
    if (!response.ok) {
      console.error(data);
      return res.status(502).json({error:"The AI search engine is currently unavailable."});
    }

    const text = data.output_text;
    const parsed = JSON.parse(text);
    if (!Array.isArray(parsed.results)) throw new Error("Invalid AI response");
    parsed.results = parsed.results.slice(0,4);
    res.json(parsed);
  } catch(err) {
    console.error(err);
    res.status(500).json({error:"TROOLLgel tripped over its own wires."});
  }
});

app.listen(PORT,()=>console.log(`TROOLLgel running at http://localhost:${PORT}`));
