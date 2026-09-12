<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />

  <title>TROOLLgel</title>

  <style>
    * {
      box-sizing: border-box;
    }

    html,
    body {
      margin: 0;
      padding: 0;
      min-height: 100%;
      font-family: Arial, Helvetica, sans-serif;
      color: #202124;
      background: #fff;
    }

    body {
      min-height: 100vh;
    }

    button,
    input {
      font-family: inherit;
    }

    /* =========================
       LOGO
    ========================= */

    .logo {
      font-size: 44px;
      line-height: 1;
      font-weight: 400;
      letter-spacing: -2.5px;
      white-space: nowrap;
      user-select: none;
    }

    .logo .blue {
      color: #4285f4;
    }

    .logo .red {
      color: #ea4335;
    }

    .logo .yellow {
      color: #fbbc05;
    }

    .logo .green {
      color: #34a853;
    }

    /* =========================
       HOME
    ========================= */

    #home {
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      padding-top: 18vh;
    }

    .home-logo {
      margin-bottom: 38px;
    }

    .home-search-wrap {
      width: min(680px, calc(100vw - 40px));
    }

    .search-form {
      width: 100%;
    }

    .search-box {
      width: 100%;
      height: 58px;
      border: 1px solid #dfe1e5;
      border-radius: 30px;
      display: flex;
      align-items: center;
      padding: 0 20px;
      box-shadow: 0 2px 8px rgba(60, 64, 67, 0.12);
      transition: box-shadow 0.15s ease;
      background: white;
    }

    .search-box:hover,
    .search-box:focus-within {
      box-shadow:
        0 2px 10px rgba(60, 64, 67, 0.18),
        0 1px 2px rgba(60, 64, 67, 0.08);
    }

    .search-icon {
      width: 21px;
      height: 21px;
      margin-right: 16px;
      flex-shrink: 0;
      position: relative;
    }

    .search-icon::before {
      content: "";
      position: absolute;
      width: 11px;
      height: 11px;
      border: 2px solid #9aa0a6;
      border-radius: 50%;
      left: 1px;
      top: 1px;
    }

    .search-icon::after {
      content: "";
      position: absolute;
      width: 8px;
      height: 2px;
      background: #9aa0a6;
      transform: rotate(45deg);
      left: 12px;
      top: 14px;
      border-radius: 2px;
    }

    .search-input {
      border: none;
      outline: none;
      flex: 1;
      min-width: 0;
      font-size: 17px;
      color: #202124;
      background: transparent;
    }

    .search-input::placeholder {
      color: #80868b;
    }

    .search-submit {
      border: none;
      background: transparent;
      color: #4285f4;
      font-size: 15px;
      cursor: pointer;
      padding: 10px 4px 10px 18px;
    }

    .search-submit:hover {
      text-decoration: underline;
    }

    .home-note {
      margin-top: 38px;
      color: #5f6368;
      font-size: 13px;
    }

    /* =========================
       RESULTS HEADER
    ========================= */

    #results {
      display: none;
      min-height: 100vh;
    }

    .results-header {
      height: 94px;
      border-bottom: 1px solid #eee;
      display: flex;
      align-items: center;
      padding: 0 7.8%;
      gap: 28px;
    }

    .results-logo {
      cursor: pointer;
      flex-shrink: 0;
      font-size: 38px;
      letter-spacing: -2.2px;
    }

    .results-search-wrap {
      width: min(720px, 65vw);
    }

    .results-search-box {
      height: 52px;
    }

    /* =========================
       TABS
    ========================= */

    .tabs-wrap {
      width: min(1060px, calc(100vw - 40px));
      margin: 0 auto;
      border-bottom: 1px solid #eee;
    }

    .tabs {
      height: 54px;
      display: flex;
      align-items: center;
      gap: 34px;
    }

    .tab {
      height: 54px;
      display: flex;
      align-items: center;
      color: #5f6368;
      font-size: 14px;
      position: relative;
    }

    .tab.active {
      color: #1a73e8;
    }

    .tab.active::after {
      content: "";
      position: absolute;
      height: 3px;
      width: 18px;
      background: #1a73e8;
      bottom: -1px;
      left: 50%;
      transform: translateX(-50%);
    }

    /* =========================
       RESULT CONTENT
    ========================= */

    .results-content {
      width: min(1060px, calc(100vw - 40px));
      margin: 0 auto;
      padding-bottom: 80px;
    }

    #count {
      margin-top: 20px;
      font-size: 13px;
      color: #5f6368;
    }

    #search-note {
      margin-top: 10px;
      margin-bottom: 26px;
      font-size: 14px;
      color: #5f6368;
    }

    /* =========================
       NORMAL RESULT
    ========================= */

    .result {
      margin-bottom: 29px;
      max-width: 850px;
    }

    .url {
      font-size: 12px;
      line-height: 18px;
      color: #5f6368;
      margin-bottom: 3px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .title {
      font-size: 20px;
      line-height: 26px;
      margin-bottom: 5px;
    }

    .title a {
      color: #1a0dab;
      text-decoration: none;
    }

    .title a:hover {
      text-decoration: underline;
    }

    .snippet {
      font-size: 14px;
      line-height: 21px;
      color: #4d5156;
      max-width: 850px;
    }

    /* =========================
       TROLL RESULT
    ========================= */

    .result.troll {
      opacity: 0.96;
    }

    .result.troll .title a {
      color: #d93025;
    }

    /* =========================
       AI ANSWER
    ========================= */

    .answer-box {
      max-width: 850px;
      margin: 26px 0 32px;
      padding: 20px 22px;
      border: 1px solid #e5e7eb;
      border-radius: 10px;
      background: #fafafa;
    }

    .answer-label {
      font-size: 12px;
      color: #5f6368;
      margin-bottom: 9px;
    }

    .answer-text {
      font-size: 18px;
      line-height: 29px;
      color: #202124;
    }

    .sources-title {
      max-width: 850px;
      margin: 0 0 18px;
      padding-top: 4px;
      font-size: 14px;
      font-weight: 600;
      color: #5f6368;
    }

    /* =========================
       LOADING / ERROR
    ========================= */

    .loading {
      margin-top: 35px;
      color: #5f6368;
      font-size: 14px;
    }

    .dots::after {
      content: "...";
      animation: dots 1.2s infinite;
    }

    @keyframes dots {
      0% {
        content: "";
      }
      33% {
        content: ".";
      }
      66% {
        content: "..";
      }
      100% {
        content: "...";
      }
    }

    .error {
      margin-top: 35px;
      color: #d93025;
      font-size: 14px;
    }

    /* =========================
       AGAIN BUTTON
    ========================= */

    .again-wrap {
      margin-top: 45px;
      margin-bottom: 30px;
    }

    .again {
      border: 1px solid #dadce0;
      background: white;
      color: #3c4043;
      border-radius: 5px;
      padding: 9px 18px;
      font-size: 14px;
      cursor: pointer;
    }

    .again:hover {
      background: #f8f9fa;
    }

    /* =========================
       MOBILE
    ========================= */

    @media (max-width: 700px) {

      #home {
        padding-top: 15vh;
      }

      .logo {
        font-size: 36px;
      }

      .home-logo {
        margin-bottom: 30px;
      }

      .results-header {
        height: auto;
        min-height: 90px;
        padding: 16px 20px;
        flex-direction: column;
        align-items: flex-start;
        gap: 14px;
      }

      .results-search-wrap {
        width: 100%;
      }

      .results-content,
      .tabs-wrap {
        width: calc(100vw - 40px);
      }

      .tabs {
        gap: 24px;
      }

      .title {
        font-size: 18px;
      }

      .answer-text {
        font-size: 17px;
      }
    }
  </style>
</head>

<body>

  <!-- =========================
       HOME PAGE
  ========================= -->

  <main id="home">

    <div class="home-logo logo" aria-label="TROOLLgel">
      <span class="blue">T</span><span class="red">R</span><span class="yellow">O</span><span class="blue">O</span><span class="green">L</span><span class="red">L</span><span class="blue">g</span><span class="red">e</span><span class="green">l</span>
    </div>

    <div class="home-search-wrap">

      <form id="homeForm" class="search-form">

        <div class="search-box">

          <div class="search-icon"></div>

          <input
            id="homeQuery"
            class="search-input"
            type="text"
            autocomplete="off"
            placeholder="Search TROOLLgel"
            aria-label="Search"
          />

          <button
            class="search-submit"
            type="submit"
          >
            Search
          </button>

        </div>

      </form>

    </div>

    <div class="home-note">
      Results may contain information that is slightly less reliable than usual.
    </div>

  </main>


  <!-- =========================
       RESULTS PAGE
  ========================= -->

  <main id="results">

    <header class="results-header">

      <div
        id="logoBack"
        class="results-logo logo"
        aria-label="TROOLLgel"
        title="Back to TROOLLgel"
      >
        <span class="blue">T</span><span class="red">R</span><span class="yellow">O</span><span class="blue">O</span><span class="green">L</span><span class="red">L</span><span class="blue">g</span><span class="red">e</span><span class="green">l</span>
      </div>

      <div class="results-search-wrap">

        <form id="resultForm" class="search-form">

          <div class="search-box results-search-box">

            <div class="search-icon"></div>

            <input
              id="resultQuery"
              class="search-input"
              type="text"
              autocomplete="off"
              aria-label="Search"
            />

            <button
              class="search-submit"
              type="submit"
            >
              Search
            </button>

          </div>

        </form>

      </div>

    </header>


    <div class="tabs-wrap">

      <nav class="tabs">

        <div class="tab active">
          All
        </div>

        <div class="tab">
          Images
        </div>

        <div class="tab">
          News
        </div>

        <div class="tab">
          Maps
        </div>

        <div class="tab">
          More
        </div>

      </nav>

    </div>


    <section class="results-content">

      <div id="count"></div>

      <div id="search-note"></div>

      <div id="list"></div>

      <div class="again-wrap">
        <button id="again" class="again">
          New search
        </button>
      </div>

    </section>

  </main>


  <script>

    const home = document.getElementById("home");
    const results = document.getElementById("results");
    const list = document.getElementById("list");

    const homeQuery = document.getElementById("homeQuery");
    const resultQuery = document.getElementById("resultQuery");

    const count = document.getElementById("count");
    const note = document.getElementById("search-note");


    /* =========================
       HTML ESCAPING
    ========================= */

    function esc(value) {

      return String(value ?? "").replace(/[&<>"']/g, function(c) {

        return {
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;"
        }[c];

      });

    }


    /* =========================
       LIMIT VERY LONG SNIPPETS
    ========================= */

    function shortSnippet(value, max = 330) {

      const text = String(value ?? "")
        .replace(/\s+/g, " ")
        .trim();

      if (text.length <= max) {
        return text;
      }

      return text.slice(0, max).trim() + "…";
    }


    /* =========================
       RENDER RESULTS
    ========================= */

    function renderResults(data) {

      if (!data || typeof data !== "object") {
        throw new Error("Invalid response from server.");
      }


      /*
       * AI ANSWER
       */

      if (
        data.mode === "answer" &&
        data.answer &&
        String(data.answer).trim()
      ) {

        count.textContent =
          "About " +
          (data.count || "a suspicious number") +
          " results";

        note.textContent =
          "TROOLLgel found something that looks like an answer. It may still be wrong.";


        const sources =
          Array.isArray(data.results)
            ? data.results.slice(0, 4)
            : [];


        list.innerHTML = `

          <article class="answer-box">

            <div class="answer-label">
              TROOLLgel answer
            </div>

            <div class="answer-text">
              ${esc(data.answer)}
            </div>

          </article>

          ${
            sources.length
              ? `

                <div class="sources-title">
                  Sources
                </div>

                ${sources.map(function(x) {

                  return `

                    <article class="result">

                      <div class="url">
                        ${esc(x.url)}
                      </div>

                      <div class="title">

                        <a
                          href="${esc(x.url)}"
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          ${esc(x.title)}
                        </a>

                      </div>

                      <div class="snippet">
                        ${esc(shortSnippet(x.snippet))}
                      </div>

                    </article>

                  `;

                }).join("")}

              `
              : ""
          }

        `;

        return;
      }


      /*
       * NORMAL SEARCH RESULTS
       */

      count.textContent =
        "About " +
        (data.count || "a suspicious number") +
        " results";


      note.textContent =
        "Results are generated by TROOLLgel and may be slightly less reliable than usual.";


      const items =
        Array.isArray(data.results)
          ? data.results
          : [];


      if (!items.length) {

        list.innerHTML = `
          <div class="error">
            TROOLLgel found absolutely nothing. Impressive.
          </div>
        `;

        return;
      }


      list.innerHTML =
        items.map(function(x) {

          return `

            <article class="result ${x.troll ? "troll" : ""}">

              <div class="url">
                ${esc(x.url)}
              </div>

              <div class="title">

                <a
                  href="${esc(x.url)}"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  ${esc(x.title)}
                </a>

              </div>

              <div class="snippet">
                ${esc(shortSnippet(x.snippet))}
              </div>

            </article>

          `;

        }).join("");

    }


    /* =========================
       SEARCH
    ========================= */

    async function search(query) {

      const q = String(query || "").trim();

      if (!q) {
        return;
      }


      home.style.display = "none";
      results.style.display = "block";

      resultQuery.value = q;


      list.innerHTML = `
        <div class="loading">
          Searching the internet<span class="dots"></span>
        </div>
      `;

      count.textContent = "";
      note.textContent = "";


      window.scrollTo(0, 0);


      try {

        const response = await fetch("/api/search", {

          method: "POST",

          headers: {
            "Content-Type": "application/json",
            "Accept": "application/json"
          },

          body: JSON.stringify({
            query: q
          })

        });


        const raw = await response.text();


        let data;

        try {

          data = JSON.parse(raw);

        } catch (jsonError) {

          console.error(
            "Server returned non-JSON response:",
            raw
          );

          throw new Error(
            raw ||
            "The server returned an invalid response."
          );

        }


        if (!response.ok) {

          throw new Error(
            data.error ||
            data.message ||
            "Search failed."
          );

        }


        renderResults(data);


      } catch (error) {

        console.error(
          "TROOLLgel search error:",
          error
        );


        count.textContent = "";


        note.textContent = "";


        list.innerHTML = `

          <div class="error">
            ${esc(
              error.message ||
              "TROOLLgel tripped over its own wires."
            )}
          </div>

        `;

      }

    }


    /* =========================
       HOME SEARCH
    ========================= */

    document
      .getElementById("homeForm")
      .addEventListener("submit", function(e) {

        e.preventDefault();

        search(homeQuery.value);

      });


    /* =========================
       RESULTS SEARCH
    ========================= */

    document
      .getElementById("resultForm")
      .addEventListener("submit", function(e) {

        e.preventDefault();

        search(resultQuery.value);

      });


    /* =========================
       BACK TO HOME
    ========================= */

    document
      .getElementById("logoBack")
      .addEventListener("click", function() {

        results.style.display = "none";
        home.style.display = "flex";

        homeQuery.focus();

        window.scrollTo(0, 0);

      });


    /* =========================
       NEW SEARCH
    ========================= */

    document
      .getElementById("again")
      .addEventListener("click", function() {

        results.style.display = "none";
        home.style.display = "flex";

        homeQuery.value = "";

        homeQuery.focus();

        window.scrollTo(0, 0);

      });


    /* =========================
       START
    ========================= */

    window.addEventListener("load", function() {

      homeQuery.focus();

    });

  </script>

</body>
</html>
