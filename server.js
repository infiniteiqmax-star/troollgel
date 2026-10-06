const express = require("express");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

function fallbackAnswer(query) {
  const q = query.toLowerCase();

  if (/weight|diet|hujšan|shujš|dieta/.test(q)) {
    return "Your bathroom scale has started a podcast. Its first episode is called 'We Need to Talk'.";
  }

  if (/hotel|paris|nastanitev/.test(q)) {
    return "Paris has 2,000 hotels and somehow you've managed to ask the one question that made them all check out.";
  }

  if (/burger|hamburger/.test(q)) {
    return "The burgers were ranked by a panel of hungry pigeons. The winner was disqualified for eating the evidence.";
  }

  if (/gravity|gravitacija/.test(q)) {
    return "Gravity is Earth's subscription service. You can jump all you want, but there's no unsubscribe button.";
  }

  if (/cat|cats|mačka|mačke/.test(q)) {
    return "Cats knock things off tables to test whether gravity still works. So far, the results are devastating.";
  }

  return "Scientists have examined your question. Three quit, one moved to Iceland, and the intern is now legally a mushroom.";
}

async function getTrollAnswer(query) {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    return fallbackAnswer(query);
  }

  const instructions = `
You are TROOLLgel, a deliberately absurd troll search engine.

Your ONLY job is to make the user laugh with a clever, unexpected,
highly specific joke about their exact search query.

RULES:
- Never answer the question seriously.
- Never give advice, instructions, or recommendations.
- Never provide links, sources, search results, or alternatives.
- Never list options.
- Return one short joke, ideally 10 to 30 words.
- Make the joke directly relevant to the exact query.
- Use wit, irony, absurd logic, wordplay, and unexpected punchlines.
- Be creative. Avoid generic jokes and predictable AI phrasing.
- Vary your joke structure. Do not repeatedly use fake investigations,
  committees, complaints, or the phrase "Our experts".
- Do not repeat the examples below word for word.
- Keep humour harmless and do not shame the user.

Examples of style:

Query: How to lose weight
Response: "Have you tried stepping on the scale while holding a large cake? At least then the numbers have an explanation."

Query: Best hotels in Paris
Response: "The fanciest hotel in Paris has a pillow menu. The budget option lets you choose which side of your suitcase to sleep on."

Query: Top 10 burgers in New York
Response: "We ranked ten burgers. Number one won by bribing the judges with cheese."

Query: What is gravity?
Response: "Earth's premium subscription service. You can jump, but cancellation is not available."

These examples show the desired style. Invent a fresh response for every query.

Return only the joke. No quotation marks, no explanation, no heading.
`;

  try {
    const response = await fetch(
      "https://api.openai.com/v1/responses",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": "Bearer " + apiKey
        },
        body: JSON.stringify({
          model: process.env.OPENAI_MODEL || "gpt-4.1-mini",
          instructions: instructions,
          input: "User search query: " + query,
          max_output_tokens: 100
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
      for (const item of data.output) {
        if (Array.isArray(item.content)) {
          for (const content of item.content) {
            if (content.type === "output_text" && content.text) {
              answer += content.text + " ";
            }
          }
        }
      }
    }

    answer = answer.trim();

    if (!answer) {
      return fallbackAnswer(query);
    }

    return answer;
  } catch (error) {
    console.error("OpenAI request failed:", error.message);
    return fallbackAnswer(query);
  }
}

app.post("/api/search", async (req, res) => {
  const query = String(
    req.body && req.body.query ? req.body.query : ""
  ).trim();

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
      answer: answer,
      results: [],
      contraResults: []
    });
  } catch (error) {
    console.error("Search route error:", error.message);

    return res.status(500).json({
      error: "TROOLLgel encountered an unexpected error."
    });
  }
});

app.get("/api/health", (req, res) => {
  return res.json({
    ok: true,
    service: "TROOLLgel"
  });
});

app.listen(PORT, () => {
  console.log("TROOLLgel running on port " + PORT);
});
