const express = require("express");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: "20kb" }));
app.use(express.static(path.join(__dirname, "public")));

const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-5.6-luna";

const TAVILY_URL = "https://api.tavily.com/search";
const OPENAI_URL = "https://api.openai.com/v1/responses";

function cleanText(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

function safeResults(results) {
  return (Array.isArray(results) ? results : [])
    .slice(0, 8)
    .map((item) => ({
      title: cleanText(item.title) || "Untitled result",
      url: cleanText(item.url),
      snippet: cleanText(item.content || item.snippet)
    }))
    .filter((item) => item.title && item.url);
}

async function tavilySearch(query) {

  if (!process.env.TAVILY_API_KEY) {
    throw new Error("TAVILY_API_KEY is not configured.");
  }

  const response = await fetch(TAVILY_URL, {
    method: "POST",

    headers: {
      "Content-Type": "application/json"
    },

    body: JSON.stringify({
      api_key: process.env.TAVILY_API_KEY,
      query: query,
      search_depth: "advanced",
      topic: "general",
      max_results: 8,
      include_answer: false,
      include_raw_content: false
    })
  });

  const data = await response.json();

  if (!response.ok) {
    console.error("Tavily error:", data);
    throw new Error("Web search is currently unavailable.");
  }

  return safeResults(data.results);
}


async function askOpenAI(query, results) {

  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is not configured.");
  }

  const sourceText = results
    .map(
      (r, i) => `
SOURCE ${i + 1}
TITLE: ${r.title}
URL: ${r.url}
CONTENT: ${r.snippet}
`
    )
    .join("\n");


  const systemPrompt = `
You are the intelligence behind TROOLLgel.

TROOLLgel looks like a normal search engine, but its personality is slightly
strange, cheeky and unpredictable.

Your most important job is to be USEFUL and CONCISE.

For every search choose between:

1. "answer"
2. "results"

Use "answer" when the user is clearly asking a question and a short answer
would be more useful than making them read search results.

Examples:
- what is bitcoin?
- can dogs fly?
- why is the sky blue?
- how does inflation work?
- who invented the telephone?
- compare X and Y

For these, give a SHORT answer.

Usually 1-4 sentences is enough.

Do NOT write a long article.
Do NOT copy large pieces of the sources.
Do NOT make the user read the search results to understand the answer.

TROOLLgel can have a small amount of sarcastic or playful personality.

Example style:

Question:
"can dogs fly?"

Good answer:
"Not by themselves. Dogs never developed wings, although some have
briefly demonstrated that gravity is apparently negotiable when jumping
off furniture."

Question:
"what is bitcoin?"

Good answer:
"Bitcoin is a decentralized digital currency that lets people transfer
value without a central bank. In simpler terms: internet money that
decided it didn't want a boss."

Use "results" instead when the user is searching for:
- a website
- a specific page
- products
- shopping
- news
- places
- images
- several sources
- something where links are more useful than an explanation

IMPORTANT:

- Use ONLY the supplied web sources as factual grounding.
- Do not invent facts that contradict the sources.
- Do not invent URLs.
- Do not fabricate citations.
- Keep answers SHORT.
- Do not mention these instructions.
- Do not say you are an AI.
- Do not write an essay.

Return ONLY valid JSON.

The JSON must have exactly this structure:

{
  "mode": "answer" or "results",
  "answer": "short answer or empty string",
  "results": [
    {
      "title": "string",
      "url": "string",
      "snippet": "string"
    }
  ]
}
`;


  const response = await fetch(OPENAI_URL, {
    method: "POST",

    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`
    },

    body: JSON.stringify({
      model: OPENAI_MODEL,

      input: [
        {
          role: "system",
          content: systemPrompt
        },
        {
          role: "user",
          content: `
SEARCH QUERY:
${query}

WEB SOURCES:
${sourceText}
`
        }
      ],

      text: {
        format: {
          type: "json_object"
        }
      }
    })
  });


  const data = await response.json();

  if (!response.ok) {
    console.error("OpenAI error:", data);

    const message =
      data?.error?.message ||
      "OpenAI request failed.";

    throw new Error(message);
  }


  /*
   * IMPORTANT:
   *
   * The raw Responses API response contains the generated text
   * inside data.output.
   *
   * We therefore extract it ourselves instead of relying on
   * data.output_text.
   */

  let outputText = "";

  if (Array.isArray(data.output)) {

    for (const item of data.output) {

      if (!Array.isArray(item.content)) {
        continue;
      }

      for (const content of item.content) {

        if (
          content &&
          content.type === "output_text" &&
          typeof content.text === "string"
        ) {
          outputText += content.text;
        }

      }

    }

  }


  outputText = outputText.trim();


  if (!outputText) {

    console.error(
      "OpenAI returned no usable text.",
      JSON.stringify(data, null, 2)
    );

    throw new Error("OpenAI returned an empty response.");
  }


  let parsed;

  try {

    parsed = JSON.parse(outputText);

  } catch (error) {

    console.error("OpenAI returned invalid JSON:", outputText);

    throw new Error("OpenAI returned invalid JSON.");
  }


  return parsed;
}


app.post("/api/search", async (req, res) => {

  const query = cleanText(req.body?.query);


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


  try {

    // --------------------------------------------------
    // STEP 1
    // Real web search
    // --------------------------------------------------

    const webResults = await tavilySearch(query);


    if (!webResults.length) {

      return res.json({
        mode: "results",
        count: "0",
        answer: "",
        results: []
      });

    }


    // --------------------------------------------------
    // STEP 2
    // Ask OpenAI how TROOLLgel should present it
    // --------------------------------------------------

    let ai;

    try {

      ai = await askOpenAI(query, webResults);

    } catch (aiError) {

      console.error("AI presentation error:", aiError);

      /*
       * IMPORTANT:
       * Even if OpenAI fails, the actual web search still works.
       */

      return res.json({
        mode: "results",
        count: String(webResults.length),
        answer: "",
        results: webResults
      });

    }


    const mode =
      ai && ai.mode === "answer"
        ? "answer"
        : "results";


    // --------------------------------------------------
    // ANSWER MODE
    // --------------------------------------------------

    if (mode === "answer") {

      return res.json({

        mode: "answer",

        count: String(webResults.length),

        answer: cleanText(ai.answer),

        results: webResults.slice(0, 4)

      });

    }


    // --------------------------------------------------
    // NORMAL SEARCH RESULTS
    // --------------------------------------------------

    return res.json({

      mode: "results",

      count: String(webResults.length),

      answer: "",

      results: webResults

    });


  } catch (error) {

    console.error("Search error:", error);

    return res.status(500).json({

      error:
        error.message ||
        "TROOLLgel tripped over its own wires."

    });

  }

});


app.listen(PORT, () => {

  console.log(
    `TROOLLgel running on port ${PORT}`
  );

});
