# seoul-events-mcp

**Ask your AI assistant "what's on in Seoul this weekend?" and get real, current answers in English.**

`seoul-events-mcp` is a [Model Context Protocol](https://modelcontextprotocol.io) server that gives Claude, Cursor or any MCP client live, filterable event listings for Seoul. It combines two sources:

| Source | What it covers | Language |
|---|---|---|
| **[Eventify](https://eventify.azbek.me)** | Meetups, tech and AI talks, startup networking, language exchanges, hikes, parties. Crawled from Meetup and Luma, plus events created on Eventify. | Mostly English |
| **[Seoul Culture Portal](https://culture.seoul.go.kr)** via [Seoul Open Data](https://data.seoul.go.kr) (`culturalEventInfo`) | Concerts, classical and gugak, exhibitions, festivals, theater, dance, workshops run or listed by the city. | Korean (kept as-is, normalized to English fields) |

## Why

Seoul has 2.7M+ foreign residents and millions of visitors, but most event listings are Korean-only, split across city portals, Meetup, Luma and Instagram. Assistants can't answer "free things to do in Mapo on Saturday" without fresh data.

There is already a [Seoul tourism MCP](https://github.com/namuaix/seoul-tourism) for sights, food and Visit Seoul festivals. This server focuses on **what's happening right now**: dated events you can go to this week, community and tech meetups that tourism data doesn't cover, and city culture events, with filters for **date, district, category, free and English-friendly**.

## Tools

| Tool | What it does | Key inputs |
|---|---|---|
| `search_events` | Search both sources | `query`, `date_from`, `date_to` (KST, default next 7 days, max 31), `district`, `category` (one or list), `free_only`, `english_friendly`, `source`, `limit` (≤50) |
| `events_this_weekend` | Saturday–Sunday in Seoul time (or the current weekend if it's already Sat/Sun) | same filters |
| `get_event` | Full details for one id (`eventify:…` / `seoul:…`): longer summary, price, venue, link | `id` |
| `list_categories` | The 20 English category ids, the source that uses each, original Korean labels, and whether each works without Korean | — |
| `list_districts` | The 25 districts (gu) with Korean names and well-known neighborhoods | — |

What the server does for you:
- **One English schema for both sources**: `categories`, `district` (`Mapo-gu` + `마포구`), `is_free`, `price`, `start`/`end` in KST, `online`, `url`, `image`, `summary`. Korean titles stay in `title_ko`, so the assistant can translate them.
- **Districts from messy addresses**: "B1, 362-14 서교동 마포구", "Hongdae Food Street" and "Dosan-daero, Gangnam District" all resolve. You can filter with `Gangnam`, `종로구`, `Hongdae`, `Itaewon` or `Seongsu`.
- **English keywords match Korean titles**: `jazz` finds 재즈, `ballet` finds 발레, `kids` finds 어린이.
- **`english_friendly`**: true for English listings, events tagged for internationals, and non-verbal formats (concerts, dance, exhibitions, festivals). Each event has an `english_note` explaining why.
- **Every event names its source**: `source.name`, a license-aware `attribution` and the original link. External descriptions are short summaries, never full copies.
- **Robust**: 10-minute TTL cache with in-flight de-duplication, 10s timeouts, at most 3 parallel upstream requests. If one source is down you still get results from the other, with a warning. Inputs are validated with zod and errors say how to fix the call.
- **Read-only**: GraphQL *queries* over HTTP GET and public open-data reads only. All tools are annotated `readOnlyHint: true`.

## Install

Requires Node 20+. Not on npm yet, so run it from source or from GitHub:

```bash
git clone https://github.com/azizbeksiddikov/seoul-events-mcp.git
cd seoul-events-mcp && npm install    # also builds dist/
```

### Claude Desktop

`~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "seoul-events": {
      "command": "npx",
      "args": ["-y", "github:azizbeksiddikov/seoul-events-mcp"],
      "env": { "SEOUL_OPEN_API_KEY": "your-free-key (optional)" }
    }
  }
}
```

From a local clone, use `"command": "node", "args": ["/absolute/path/to/seoul-events-mcp/dist/index.js"]`.

### Claude Code

```bash
claude mcp add seoul-events -- npx -y github:azizbeksiddikov/seoul-events-mcp
# or with a Seoul key:
claude mcp add seoul-events -e SEOUL_OPEN_API_KEY=your-key -- node /absolute/path/to/dist/index.js
```

### Cursor

`~/.cursor/mcp.json` (or `.cursor/mcp.json` in a project):

```json
{
  "mcpServers": {
    "seoul-events": {
      "command": "npx",
      "args": ["-y", "github:azizbeksiddikov/seoul-events-mcp"]
    }
  }
}
```

### Remote (Streamable HTTP)

```bash
npm run start:http          # http://localhost:3000/mcp (stateless, JSON responses), GET /health
```

### Configuration

All optional (see `env.example`):

| Variable | Default | Notes |
|---|---|---|
| `SEOUL_OPEN_API_KEY` | public `sample` key | Get a [free key at data.seoul.go.kr](https://data.seoul.go.kr). The sample key returns at most 5 culture events per day; with a key, up to 1,000. |
| `EVENTIFY_API_URL` | `https://eventify.azbek.me/api/graphql` | |
| `CACHE_TTL_SECONDS` | `600` | |
| `PORT` | `3000` | `--http` mode only |

## Example conversation

> **You:** I'm new in Seoul and don't speak Korean. Anything fun and free this weekend?
>
> **Claude** *(calls `events_this_weekend` with `{"free_only": true, "english_friendly": true}`)*:
> Here's what's on this weekend (Oct 24–25):
> - **Saturday International Friends Meetup**, Sat 18:50, Yeoksam (Gangnam). About 100 people, Korean and English, very beginner-friendly. *(Meetup via Eventify)*
> - **1:1 English–Korean Language Exchange**, Sat 17:30, Hapjeong (Mapo). *(Meetup via Eventify)*
> - **Starlight Festival (별빛축제)**, Sat–Sun at the Seoul Science Center, Nowon. A free stargazing festival, fine without Korean. *(Seoul Culture Portal)*
> - **Public-art exhibition "Afterimages of Peace" (평화의 잔상)**, Seoul Changpowon, Dobong. Runs until Dec 13. *(Seoul Culture Portal)*
>
> Want details or directions for any of these?
>
> **You:** Any AI meetups next week?
>
> **Claude** *(calls `search_events` with `{"category": "tech", "date_from": "2026-10-26", "date_to": "2026-11-01"}`)* …

## Architecture

```
 MCP client (Claude Desktop / Claude Code / Cursor)
        │  stdio  or  Streamable HTTP (/mcp)
        ▼
 ┌──────────────────────── seoul-events-mcp ────────────────────────┐
 │ server.ts   5 tools · zod schemas · readOnly annotations · errors │
 │ service.ts  date-range logic (KST) · filters · ranking · merge    │
 │             · partial-failure warnings                            │
 │ data/       categories (EN ⇄ KO ⇄ Eventify) · 25 districts        │
 │             + neighborhoods                                       │
 │ text.ts     language detection · EN→KO keyword synonyms · summary │
 │ cache.ts    TTL cache + in-flight de-dup                          │
 │ sources/                                                          │
 │   eventify.ts ── GET /api/graphql (getEvents, getEvent) ──► Eventify (Meetup, Luma, community)
 │   seoul.ts    ── GET openapi.seoul.go.kr culturalEventInfo/{date} ──► Seoul Open Data
 └───────────────────────────────────────────────────────────────────┘
```

- Eventify returns all active events (upcoming + ongoing, a few dozen) in two cached queries. Filtering happens locally, and events clearly outside Seoul are dropped.
- The Seoul API is queried once per day in the range (capped at 14 days, 3 at a time). Each day is cached, and multi-day exhibitions appear on every day they run. It is skipped entirely when you only ask for categories it never has (for example `tech`).

## Development

```bash
npm test             # Vitest: 33 tests, upstream HTTP mocked with recorded fixtures
npm run eval         # 10 natural-language questions → scripted MCP tool calls → output checks
npm run eval:live    # same, against the live APIs through the built stdio binary
npm run inspector    # MCP Inspector UI
```

The eval (`eval/run.ts`) acts like an assistant: for questions such as *"Any free events in Gangnam this week?"* or *"I don't speak Korean, what can I go to?"*, it makes the tool call an assistant should make and checks the output. Every result must match the filters, overlap the requested dates and carry a URL and attribution. It also checks that `get_event` follows up on a search result and that invalid input (`2026-12-40`) is rejected. Current result: **10/10 on fixtures, 10/10 live**.

## Coverage & limits

- Eventify covers roughly the next month, typically 30–70 events, refreshed weekly. The Seoul Culture Portal lists thousands of city culture events.
- Seoul Culture Portal listings are Korean. Fields are normalized to English, but titles and descriptions are not machine-translated: your assistant translates them.
- `english_friendly` is a heuristic. Check the event page.
- Seoul ids (`seoul:<code>`) resolve in `get_event` after they appear in a search, because the city API has no lookup by id.

## Credits & data licenses

- Culture event data: **Seoul Metropolitan Government, [Seoul Open Data Plaza](https://data.seoul.go.kr)**, dataset *서울시 문화행사 정보 (culturalEventInfo)*, under the Korea Open Government License (KOGL) Type 1, which requires attribution.
- Community events: **[Eventify](https://eventify.azbek.me)** (by the same author). Its listings link back to the original Meetup and Luma pages, and this server returns summaries and links rather than full descriptions.
- Built with the official [`@modelcontextprotocol/sdk`](https://github.com/modelcontextprotocol/typescript-sdk) and [zod](https://zod.dev).

MIT © Azizbek Siddikov
