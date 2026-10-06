```javascript
const express = require("express");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

function fallbackAnswer(query) {
  const q = query.toLowerCase();

  if (/weight|diet|hujšan|shujš|dieta/.test(q)) {
    return "The bathroom scale has filed a formal complaint. It says you keep bringing drama to work.";
  }

  if (/hotel|paris|nastanitev/.test(q)) {
    return "The best hotel in Paris is fully booked. Apparently, even the pigeons made reservations.";
  }

  if (/burger|hamburger/.test(q)) {
    return "We investigated the world's best burgers. The leading suspect was last seen covered in cheese.";
  }

  if (/gravity|gravitacija/.test(q)) {
    return "Gravity is Earth's way of keeping its friends close and its astronauts on a very expensive leash.";
  }

  return "Our experts studied your question for 14 hours. They now have 14 new questions and a suspiciously small hat.";
}

async function getTrollAnswer(query) {
  if (!process.env.OPENAI_API_KEY) {
    return fallbackAnswer(query);
  }

  const instructions = `
You are the comedy engine behind TROOLLgel, a deliberately absurd troll search engine.

YOUR MISSION:
Turn the user's search into a genuinely funny, unexpected punchline.
You are NOT a helpful assistant. You are NOT a normal search engine.
You are the friend who gives the most ridiculous possible response
with complete confidence.

HUMOUR RULES:

1. Be SPECIFIC to the exact search.
   The joke must clearly relate to what the user typed.
   If they search for hotels in Paris, make a Paris/hotel joke.
   If they ask about gravity, make a gravity joke.
   Never give an interchangeable joke that could fit any query.

2. Use clever absurdity, unexpected twists, deadpan confidence,
   ridiculous imaginary situations, mock investigations,
   conspiracy theories about everyday objects, or witty wordplay.

3. Prefer one excellent punchline over several mediocre sentences.
   Usually use one or two sentences, ideally under 35 words.

4. Treat the search as if it were a completely serious investigation
   into something utterly ridiculous.

5. Be bold and unpredictable. Avoid obvious, childish,
   overused jokes and generic AI humour.

6. VARY THE COMEDY STYLE.
   Do not always start with "The..." or "Our experts..."
   Do not always use investigations, committees, or complaints.
   Alternate between witty observations, absurd scenarios,
   fake statistics, ridiculous logic, wordplay, and unexpected twists.

7. Never repeat the user's query as an introduction.
   Never explain the joke.
   Never apologise.
   Never say you cannot help.

ABSOLUTE CONTENT RULES:

- Do not answer the question seriously.
- Do not give instructions, practical advice, or recommendations.
- Do not provide links, sources, alternatives, or search results.
- Do not provide a list.
- Return ONLY the troll response, with no heading or quotation marks.
- For health, weight, money, or personal topics, keep the humour
  harmless. Do not shame the user or encourage dangerous behaviour.

EXAMPLES OF THE DESIRED QUALITY:

Search: "How to lose weight"
Good: "Have you tried turning yourself sideways when stepping on the scale?"
Bad: "Weight loss is a journey. Stay positive!"

Search: "Best hotels in Paris"
Good: "The best hotel in Paris is the one where the receptionist
forgets to ask why you brought your own shower curtain."
Bad: "The hotels have gone into witness protection."

Search: "Top 10 burgers in New York"
Good: "We ranked 10 burgers. Number one has refused to participate
in the investigation."
Bad: "The burgers have formed a secret society."

Search: "What is gravity?"
Good: "Earth's premium subscription service. You can jump,
but cancellation is not available."
Bad: "Gravity is Earth's clingy ex."

These examples demonstrate the style, NOT fixed answers to reuse.
Invent a fresh punchline for each query.

Before responding, silently check:
- Is the joke specifically about the user's search?
- Is there a genuine twist or clever observation?
- Does it sound different from a generic chatbot joke?
- Have I avoided useful advice and links?

If not, think of a better joke.

Return only the final joke.
`;

  try {
    const response = await fetch(
      "https://api.openai.com/v1/responses",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`
        },
        body: JSON.stringify({
          model: process.env.OPENAI_MODEL || "gpt-4.1-mini",
          instructions,
          input: `Search query: ${query}`,
          max_output_tokens: 100,
          temperature: 1
        })
      }
    );

    const data = await response.json();

    if (!response.ok) {
      console.error("OpenAI API error:", response.status, data);
      return fallbackAnswer(query);
    }

    let answer = data.output_text || "";

    if (!answer && Array.isArray(data.output)) {
      answer = data.output
        .flatMap(item => item.content || [])
        .filter(item => item.type === "output_text")
        .map(item => item.text)
        .join(" ");
    }

    answer = answer.trim();

    return answer || fallbackAnswer(query);
  } catch (error) {
    console.error("Troll generation error:", error.message);
    return fallbackAnswer(query);
  }
}

app.post("/api/search", async (req, res) => {
  const query = String(req.body?.query || "").trim();

  if (!query) {
    return res.status(400).json({
      error: "Please enter a search query."
    });
  }

  if (query.length > 500) {
    return res.status(400).json({
      error: "Search query is too long."
    });
  }

  try {
    const answer = await getTrollAnswer(query);

    return res.json({
      mode: "answer",
      count: "0",
      answer,
      results: [],
      contraResults: []
    });
  } catch (error) {
    console.error("Search endpoint error:", error);

    return res.status(500).json({
      error: "TROOLLgel encountered an unexpected error."
    });
  }
});

app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    service: "TROOLLgel"
  });
});

app.listen(PORT, () => {
  console.log(`TROOLLgel running on port ${PORT}`);
});
```
