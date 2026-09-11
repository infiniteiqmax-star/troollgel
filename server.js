const express = require("express");
const path = require("path");

const app = express();

app.use(express.json({ limit: "1mb" }));

// Serve the website
app.use(express.static(path.join(__dirname, "public")));

// Health check
app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    service: "TROOLLgel",
    message: "The wires appear to be connected."
  });
});

// Main search endpoint
app.post("/api/search", async (req, res) => {
  const query = String(req.body?.query || "").trim();

  if (!query) {
    return res.status(400).json({
      error: "Please enter a search query."
    });
  }

  if (query.length > 500) {
    return res.status(400).json({
      error: "That search is suspiciously long."
    });
  }

  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    console.error("OPENAI_API_KEY is missing.");
    return res.status(500).json({
      error: "OPENAI_API_KEY is not configured."
    });
  }

  const systemPrompt = `
You are the search engine behind TROOLLgel.

TROOLLgel looks and behaves like a normal search engine, but its results can be subtly strange, funny, misleading, absurd, or unexpectedly useful.

The user gives you a search query.

Your job is to create a believable search-results page.

IMPORTANT:

- Return exactly 4 results.
- Results should NOT always be AI answers.
- Some results should look like normal web links.
- Some results should contain a direct answer.
- Some results can mix a link with an answer.
- The combination should vary from query to query.
- Do not always put the funny result first.
- Do not make every result obviously absurd.
- Preserve uncertainty.
- The user should initially be able to believe that this is a normal search engine.
- The humor should sometimes only become obvious after reading the result carefully.

Possible result types:

1. "link"
A normal-looking search result with a fictional but plausible URL.

2. "answer"
A direct answer to the query, presented like a search result.

3. "mixed"
A link-like result followed by a short answer or interpretation.

Possible humor styles:

- confidently wrong
- technically correct but useless
- literal interpretation
- absurd expert reasoning
- unexpected logic
- almost completely normal except for one strange detail
- surprisingly useful answer with a ridiculous explanation
- completely unnecessary confidence

Do NOT always make the result funny.

Some searches should receive mostly normal-looking results.

Some searches should receive one suspicious result.

Some searches should receive several strange results.

The goal is uncertainty.

IMPORTANT:
Do not pretend that fictional websites are real.
Use safe fictional domains such as:

example.com
troollgel.example
search.example

Do not impersonate real websites, people, companies or institutions.

For high-risk medical, legal, financial, self-harm, violence or illegal queries, keep the response safe and do not provide harmful instructions.

Do not mention that you are an AI.

Do not explain the joke.

Return ONLY valid JSON in exactly this structure:

{
  "count": "About 123,456 results",
  "results": [
    {
      "title": "Example result title",
      "url": "https://example.com/example",
      "snippet": "Example search-result description.",
      "type": "link"
    },
    {
      "title": "Example answer",
      "url": "https://troollgel.example/search",
      "snippet": "Example answer presented as a search result.",
      "type": "answer"
    }
  ]
}
`;

  try {
    const response = await fetch(
      "https://api.openai.com/v1/responses",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model: process.env.OPENAI_MODEL || "gpt-5.6-luna",

          input: [
            {
              role: "system",
              content: systemPrompt
            },
            {
              role: "user",
              content: `Search query: ${query}`
            }
          ],

          text: {
            format: {
              type: "json_object"
            }
          }
        })
      }
    );

    const data = await response.json();

    // OpenAI returned an error
    if (!response.ok) {
      console.error(
        "OpenAI API error:",
        JSON.stringify(data, null, 2)
      );

      return res.status(502).json({
        error: "The TROOLLgel search engine could not reach its brain."
      });
    }

    /*
      Responses API returns generated text inside
      the response output structure.

      We deliberately extract it instead of using
      data.output_text, because this endpoint is using
      the raw HTTP API rather than the OpenAI SDK.
    */

    let text = "";

    if (Array.isArray(data.output)) {
      for (const item of data.output) {
        if (!Array.isArray(item.content)) continue;

        for (const content of item.content) {
          if (
            content &&
            content.type === "output_text" &&
            typeof content.text === "string"
          ) {
            text += content.text;
          }
        }
      }
    }

    if (!text) {
      console.error(
        "OpenAI returned no usable text:",
        JSON.stringify(data, null, 2)
      );

      return res.status(502).json({
        error: "TROOLLgel received an answer but couldn't read it."
      });
    }

    // Remove accidental markdown fences if the model adds them
    text = text
      .trim()
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/\s*```$/i, "")
      .trim();

    let parsed;

    try {
      parsed = JSON.parse(text);
    } catch (parseError) {
      console.error(
        "Could not parse OpenAI JSON:",
        text
      );

      return res.status(502).json({
        error: "TROOLLgel received something that looked like JSON."
      });
    }

    // Basic validation
    if (
      !parsed ||
      !Array.isArray(parsed.results)
    ) {
      console.error(
        "Invalid result structure:",
        JSON.stringify(parsed, null, 2)
      );

      return res.status(502).json({
        error: "TROOLLgel received an invalid search result."
      });
    }

    // Keep the result page controlled
    parsed.results = parsed.results
      .slice(0, 4)
      .map((result) => ({
        title: String(result.title || "Untitled result"),
        url: String(result.url || "https://example.com"),
        snippet: String(result.snippet || ""),
        type: ["link", "answer", "mixed"].includes(result.type)
          ? result.type
          : "link"
      }));

    if (!parsed.count) {
      parsed.count = "About 42,000 results";
    }

    return res.status(200).json(parsed);

  } catch (error) {
    console.error(
      "TROOLLgel search error:",
      error
    );

    return res.status(500).json({
      error: "TROOLLgel tripped over its own wires."
    });
  }
});

// Fallback for the homepage
app.get("*", (req, res) => {
  res.sendFile(
    path.join(__dirname, "public", "index.html")
  );
});

// Local development only
if (!process.env.VERCEL) {
  const PORT = process.env.PORT || 3000;

  app.listen(PORT, () => {
    console.log(
      `TROOLLgel running on http://localhost:${PORT}`
    );
  });
}

// Vercel uses the exported Express application
module.exports = app;
