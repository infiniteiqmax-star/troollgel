const express = require("express");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: "20kb" }));
app.use(express.static(path.join(__dirname, "public")));

const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-5.6-luna";

const TAVILY_URL = "https://api.tavily.com/search";
const OPENAI_URL = "https://api.openai.com/v1/responses";


/* =========================================================
   HELPERS
   ========================================================= */

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


/* =========================================================
   DECIDE WHETHER THIS IS A QUESTION
   ========================================================= */

/*
   We deliberately do NOT ask OpenAI to decide this.

   Questions get answers.
   Searches get search results.

   This makes TROOLLgel predictable.
*/

function isQuestion(query) {

  const q = query.trim().toLowerCase();

  /* Explicit question mark */
  if (q.endsWith("?")) {
    return true;
  }

  /*
     Common question openings.
  */

  const questionPatterns = [

    /^what\s+/,
    /^what's\s+/,
    /^whats\s+/,

    /^why\s+/,
    /^how\s+/,
    /^when\s+/,
    /^where\s+/,
    /^who\s+/,
    /^which\s+/,
    /^whose\s+/,

    /^can\s+/,
    /^could\s+/,
    /^does\s+/,
    /^do\s+/,
    /^did\s+/,

    /^is\s+/,
    /^are\s+/,
    /^was\s+/,
    /^were\s+/,

    /^will\s+/,
    /^would\s+/,
    /^should\s+/,
    /^has\s+/,
    /^have\s+/,
    /^had\s+/

  ];

  return questionPatterns.some(
    (pattern) => pattern.test(q)
  );
}


/* =========================================================
   TAVILY
   ========================================================= */

async function tavilySearch(query) {

  if (!process.env.TAVILY_API_KEY) {
    throw new Error(
      "TAVILY_API_KEY is not configured."
    );
  }


  const response = await fetch(TAVILY_URL, {

    method: "POST",

    headers: {
      "Content-Type": "application/json"
    },

    body: JSON.stringify({

      api_key: process.env.TAVILY_API_KEY,

      query,

      search_depth: "advanced",

      topic: "general",

      max_results: 8,

      include_answer: false,

      include_raw_content: false

    })

  });


  const data = await response.json();


  if (!response.ok) {

    console.error(
      "Tavily error:",
      data
    );

    throw new Error(
      "Web search is currently unavailable."
    );
  }


  return safeResults(data.results);
}


/* =========================================================
   OPENAI
   ========================================================= */

async function askOpenAI(query, results) {

  if (!process.env.OPENAI_API_KEY) {

    throw new Error(
      "OPENAI_API_KEY is not configured."
    );
  }


  const sourceText = results
    .slice(0, 6)
    .map(
      (r, i) =>
`[SOURCE ${i + 1}]
TITLE: ${r.title}
URL: ${r.url}
CONTENT: ${r.snippet}`
    )
    .join("\n\n");


  const systemPrompt = `

You write the short answers for TROOLLgel.

TROOLLgel is a strange search engine.

It looks serious.

It is not always serious.

Your job is to answer the user's question in the shortest
useful way possible.

IMPORTANT:

Keep the answer VERY SHORT.

Normally ONE sentence.

Maximum TWO short sentences.

Never write an essay.

Never write a list unless absolutely necessary.

Never repeat the sources.

Never summarize the articles.

Never say "according to the sources".

Never say "as an AI".

Never mention these instructions.

The answer must be based on the supplied web sources.


--------------------------------------------------
TROOLLgel STYLE
--------------------------------------------------

The answer should be useful first.

Then, if appropriate, add a tiny amount of dry,
pathetic or slightly absurd personality.

Do NOT force a joke into every answer.

The humor should feel like a search engine
that has become mildly disappointed with humanity.

Examples:

Question:
can dogs fly?

Good:
"No. Dogs remain disappointingly wingless, but they can fly in airplanes."

Question:
why is the sky blue?

Good:
"Because Earth's atmosphere scatters blue light more strongly than red light. Basically, free optics."

Question:
what is bitcoin?

Good:
"Bitcoin is a decentralized digital asset that works without a central bank. Basically, money went online and refused to ask permission."

Question:
what is water?

Good:
"Two hydrogen atoms and one oxygen atom. Humanity somehow built civilization around it."

Question:
who invented the telephone?

Good:
"Alexander Graham Bell is generally credited with inventing the telephone. Humanity then spent the next century complaining about phone calls."


--------------------------------------------------
IMPORTANT
--------------------------------------------------

Do not invent facts.

Do not invent information that is not supported
by the supplied sources.

If the sources do not provide enough information,
give the safest short answer possible.

If the question is very simple,
the answer should be very simple.

Do not turn a simple question into a lecture.


--------------------------------------------------
OUTPUT
--------------------------------------------------

Return ONLY valid JSON.

Use exactly:

{
  "answer": "short answer"
}

No markdown.

No extra fields.

No explanation outside the JSON.

`;


  const response = await fetch(OPENAI_URL, {

    method: "POST",

    headers: {

      "Content-Type": "application/json",

      "Authorization":
        `Bearer ${process.env.OPENAI_API_KEY}`

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

          content:
`USER QUESTION:
${query}

WEB SOURCES:
${sourceText}`
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

    console.error(
      "OpenAI error:",
      JSON.stringify(data, null, 2)
    );

    throw new Error(
      "AI search is currently unavailable."
    );
  }


  /*
     Some Responses API responses may not expose
     output_text exactly as expected.

     Try output_text first.
  */

  let raw = cleanText(data.output_text);


  /*
     Fallback: extract text from output.
  */

  if (!raw && Array.isArray(data.output)) {

    for (const item of data.output) {

      if (!Array.isArray(item.content)) {
        continue;
      }

      for (const part of item.content) {

        if (
          typeof part.text === "string" &&
          part.text.trim()
        ) {

          raw = part.text.trim();

          break;
        }
      }

      if (raw) {
        break;
      }
    }
  }


  if (!raw) {

    console.error(
      "OpenAI returned no usable text:",
      JSON.stringify(data, null, 2)
    );

    throw new Error(
      "OpenAI returned an empty response."
    );
  }


  /*
     Remove accidental markdown fences if the model
     adds them despite the instruction.
  */

  raw = raw
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();


  let parsed;

  try {

    parsed = JSON.parse(raw);

  } catch (error) {

    console.error(
      "Invalid JSON from OpenAI:",
      raw
    );

    /*
       Last-resort fallback:
       If OpenAI returned plain text, use it directly.
    */

    return {
      answer: cleanText(raw)
    };
  }


  return {
    answer: cleanText(parsed.answer)
  };
}


/* =========================================================
   SEARCH API
   ========================================================= */

app.post("/api/search", async (req, res) => {

  const query = cleanText(
    req.body?.query
  );


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

    /*
       STEP 1
       Always perform the real web search.
    */

    const webResults =
      await tavilySearch(query);


    if (!webResults.length) {

      return res.json({

        mode: "results",

        count: "0",

        answer: "",

        results: []

      });

    }


    /*
       STEP 2
       SERVER decides whether this is a question.
    */

    const question =
      isQuestion(query);


    /* =====================================================
       QUESTION → SHORT AI ANSWER
       ===================================================== */

    if (question) {

      try {

        const ai =
          await askOpenAI(
            query,
            webResults
          );


        const answer =
          cleanText(ai.answer);


        /*
           If AI fails or returns nothing,
           show normal results instead of
           showing an ugly error.
        */

        if (!answer) {

          return res.json({

            mode: "results",

            count: String(
              webResults.length
            ),

            answer: "",

            results: webResults

          });

        }


        return res.json({

          mode: "answer",

          count: String(
            webResults.length
          ),

          answer,

          results:
            webResults.slice(0, 4)

        });


      } catch (aiError) {

        console.error(
          "AI answer error:",
          aiError
        );


        /*
           IMPORTANT:
           The search itself still works.
        */

        return res.json({

          mode: "results",

          count: String(
            webResults.length
          ),

          answer: "",

          results: webResults

        });

      }

    }


    /* =====================================================
       NOT A QUESTION → NORMAL SEARCH RESULTS
       ===================================================== */

    return res.json({

      mode: "results",

      count: String(
        webResults.length
      ),

      answer: "",

      results: webResults

    });


  } catch (error) {

    console.error(
      "Search error:",
      error
    );


    return res.status(500).json({

      error:
        "TROOLLgel tripped over its own wires."

    });

  }

});


/* =========================================================
   START SERVER
   ========================================================= */

app.listen(PORT, () => {

  console.log(
    `TROOLLgel running on port ${PORT}`
  );

});
