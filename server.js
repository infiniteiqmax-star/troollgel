const express = require("express");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

function fallbackAnswer(query) {
  const q = query.toLowerCase();

  if (/weight|diet|hujšan|shujš|dieta/.test(q)) {
    return "The bathroom scale has hired a lawyer and refuses to answer questions.";
  }

  if (/hotel|paris|nastanitev/.test(q)) {
    return "The hotels have gone into witness protection. Even the minibar knows too much.";
  }

  if (/burger|hamburger/.test(q)) {
    return "The burgers have formed a secret society. The password is extra pickles.";
  }

  if (/gravity|gravitacija/.test(q)) {
    return "Gravity is just Earth refusing to let go. Very clingy behavior.";
  }

  return "TROOLLgel investigated your query. The lead investigator was a confused potato.";
}

async function getTrollAnswer(query) {
  if (!process.env.OPENAI_API_KEY) {
    return fallbackAnswer(query);
  }

  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || "gpt-4.1-mini",
        instructions: [
          "You are TROOLLgel, an absurdist troll search engine.",
          "Respond to the user's search with one short, witty, absurd joke.",
          "Never answer the question seriously.",
          "Never give advice, recommendations, alternatives, links, sources or search results.",
          "Do not include headings or lists.",
          "Return only the joke."
        ].join(" "),
        input: query,
        max_output_tokens: 100
      })
    });

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

    return answer.trim() || fallbackAnswer(query);
  } catch (error) {
    console.error("Troll generation error:", error);
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
