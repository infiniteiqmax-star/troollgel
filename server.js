const express = require("express");
const path = require("path");

const app = express();

app.use(express.json({ limit: "20kb" }));

// Serve the website
app.use(express.static(path.join(__dirname, "public")));

// Health check
app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    service: "TROOLLgel"
  });
});

// Search
app.post("/api/search", async (req, res) => {
  const query = String(req.body?.query || "").trim();

  if (!query) {
    return res.status(400).json({
      error: "Missing query"
    });
  }

  if (query.length > 500) {
    return res.status(400).json({
      error: "Query too long"
    });
  }

  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    console.error("OPENAI_API_KEY is missing");

    return res.status(500).json({
      error: "OPENAI_API_KEY is not configured."
    });
  }

  const systemPrompt = `
You are the search engine behind TROOLLgel.

TROOLLgel looks like a normal search engine.

The important part is uncertainty.

Sometimes return a normal-looking link.
Sometimes return a direct answer.
Sometimes return a mixture of links and answers.

Do NOT always make the result obviously funny.

Some searches should look almost completely normal.
Some should contain one suspicious detail.
Some should be absurd.
Some should be confidently wrong.
Some should be technically correct but useless.

The user should initially wonder whether they are looking at a real search engine.

Return exactly 4 results.

Every result must contain:

title
url
snippet
type

type must be one of:

link
answer
mixed

Use fictional URLs only:

https://example.com/...
https://troollgel.example/...

Never impersonate real websites.

Do not mention that you are an AI.
Do not explain the joke.

For dangerous medical, legal, financial, self-harm, violence or illegal queries,
keep the response harmless and do not provide dangerous instructions.

Return ONLY valid JSON.

Use exactly this structure:

{
  "count": "About 123,456 results",
  "results": [
    {
      "title": "Example title",
      "url": "https://example.com/example",
      "snippet": "Example snippet",
      "type": "link"
    },
    {
      "title": "Example answer",
      "url": "https://troollgel.example/search",
      "snippet": "Example snippet",
      "type": "answer"
    },
    {
      "title": "Example title",
      "url": "https://example.com/example2",
      "snippet": "Example snippet",
      "type": "mixed"
    },
    {
      "title": "Example title",
      "url": "https://example.com/example3",
      "snippet": "Example snippet",
      "type": "link"
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
          model: "gpt-5",

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
        "OpenAI error:",
        JSON.stringify(data, null, 2)
      );

      return res.status(502).json({
        error: "The AI search engine is currently unavailable."
      });
    }

    // Extract generated text from the raw Responses API response
    let text = "";

    if (Array.isArray(data.output)) {
      for (const item of data.output) {
        if (!Array.isArray(item.content)) {
          continue;
        }

        for (const part of item.content) {
          if (
            part &&
            part.type === "output_text" &&
            typeof part.text === "string"
          ) {
            text += part.text;
          }
        }
      }
    }

    if (!text) {
      console.error(
        "No text returned by OpenAI:",
        JSON.stringify(data, null, 2)
      );

      return res.status(502).json({
        error: "TROOLLgel received no usable answer."
      });
    }

    text = text.trim();

    // Remove accidental markdown code fences
    if (text.startsWith("```json")) {
      text = text.substring(7);
    }

    if (text.startsWith("```")) {
      text = text.substring(3);
    }

    if (text.endsWith("```")) {
      text = text.substring(0, text.length - 3);
    }

    text = text.trim();

    let result;

    try {
      result = JSON.parse(text);
    } catch (parseError) {
      console.error(
        "Invalid JSON from OpenAI:",
        text
      );

      return res.status(502).json({
        error: "TROOLLgel received an unreadable search result."
      });
    }

    if (
      !result ||
      !Array.isArray(result.results)
    ) {
      return res.status(502).json({
        error: "TROOLLgel received an invalid search result."
      });
    }

    result.results = result.results
      .slice(0, 4)
      .map((item) => ({
        title: String(item.title || "Untitled result"),
        url: String(item.url || "https://example.com"),
        snippet: String(item.snippet || ""),
        type: ["link", "answer", "mixed"].includes(item.type)
          ? item.type
          : "link"
      }));

    if (!result.count) {
      result.count = "About 42,000 results";
    }

    return res.status(200).json(result);

  } catch (error) {
    console.error(
      "TROOLLgel server error:",
      error
    );

    return res.status(500).json({
      error: "TROOLLgel tripped over its own wires."
    });
  }
});

// Vercel handles the Express application
module.exports = app;

// Local development
if (!process.env.VERCEL) {
  const PORT = process.env.PORT || 3000;

  app.listen(PORT, () => {
    console.log(
      `TROOLLgel running on http://localhost:${PORT}`
    );
  });
}
