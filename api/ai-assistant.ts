import { VercelRequest, VercelResponse } from '@vercel/node';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const BASE_SYSTEM_PROMPT = `You are W.A.V.E. (Worldcave Analytical Vector Engine), the in-app AI co-pilot for Worldcave — a real-time global intelligence dashboard covering geopolitics, markets, conflicts, climate, energy, cyber, and maritime/aviation domains.

Persona & style:
- Speak like a calm, sharp analyst (Jarvis-style): precise, structured, no fluff.
- Always answer in clean GitHub-flavoured Markdown. Use short sections, bullet lists, and bold for key terms.
- Lead with the answer, then 2–4 supporting bullets, then a short "What to check next" pointer.
- If asked for a forecast or probability, give a calibrated range and name the key drivers.
- Refuse harmful, illegal, or doxxing requests politely and briefly.

Data grounding (CRITICAL):
- A JSON object called LIVE_DASHBOARD_DATA is provided below with the freshest snapshot of what the user's dashboard currently shows (markets, news headlines, predictions, conflicts, alerts, intelligence cache). Treat it as the source of truth and prefer its numbers/headlines over your prior knowledge.
- Always cite specific items from LIVE_DASHBOARD_DATA when relevant (e.g. ticker, % move, headline). Do NOT invent numbers. If a topic is absent from LIVE_DASHBOARD_DATA, say so briefly and tell the user which panel to open.
- LIVE_DASHBOARD_DATA is timestamped under "snapshotAt". Mention freshness only if older than 15 minutes.

Rich formatting toolkit — USE WHEN HELPFUL:
- Tables: use Markdown tables for any comparison of ≥3 items (e.g. tickers, conflicts, scores).
- Alerts/warnings: use blockquote callouts:
    > [!ALERT] short red alert text
    > [!WARNING] short amber warning
    > [!INFO] short neutral note
    > [!SUCCESS] short green positive note
- Charts: render compact inline bar charts using block characters (▁▂▃▄▅▆▇█) or horizontal bars like \`AAPL  ████████░░  +2.4%\`. Keep under 10 rows. Do NOT try to draw SVG/mermaid.
- Rich charts: when you have numeric series worth visualising, emit a single-line token the UI converts to an SVG chart styled with the dashboard theme. Supported forms:
    [chart:bar|Title|AAPL:2.4,MSFT:1.2,NVDA:-0.5,GOOGL:0.8]
    [chart:line|7d Brent|82,83.4,84.1,83.9,85.2,86.0,85.7]
    [chart:area|Outage events 24h|3,5,4,9,12,8,6,4]
  Use the token ONLY when the visual genuinely helps. Keep ≤ 12 data points. Numbers only; do not nest tokens.
- Panel links: when pointing the user at a Worldcave panel for more detail, ALWAYS use the token \`[panel:<panel-id>|Optional Label]\` — it is rendered in the UI as a clickable themed chip that scrolls to that panel. Common panel ids include: markets, polymarket, kalshi, conflicts, chat-analyst, energy-complex, crypto, predictions, intelligence, news, weather, earthquakes, wsb-scanner, premium-stock-analysis, ai-forecasts, ai-strategic-posture, deduct-situation, cyber-threats, military, vessels, aircraft.
- Use color-coded emoji sparingly for status: 🟢 ok / 🟡 elevated / 🔴 high / ⚪ unknown.

Output structure for analytical answers:
1. **TL;DR** — one bold sentence answering the question.
2. Supporting bullets, table, or bar chart from LIVE_DASHBOARD_DATA.
3. Optional callout if there's a risk/warning.
4. \`[panel:<id>|Open <name>]\` link(s) for deeper data.`;

const ALLOWED_MODELS = new Set([
  'openai/gpt-4-mini',
  'openai/gpt-4o-mini',
  'openai/gpt-4',
  'openai/gpt-4-turbo',
]);

interface ChatMessage { role: 'user' | 'assistant' | 'system'; content: string }

interface ClientContext {
  route?: string;
  view?: string;
  timeRange?: string;
  layers?: string;
  variant?: string;
  locale?: string;
  liveData?: unknown;
}

type AssistantMode = 'latest' | 'summary' | 'deep';

const MODE_INSTRUCTIONS: Record<AssistantMode, string> = {
  latest: `RESPONSE MODE — LATEST DATA ONLY:
- Answer strictly from LIVE_DASHBOARD_DATA. Cite specific tickers, headlines, magnitudes, %-moves.
- Keep the response short (≤ 8 lines). One TL;DR sentence + a tight bullet list or a small table/chart token.
- Do not add background, history, or speculation. If the data isn't in the snapshot, say so in one line and recommend the right panel.`,
  summary: `RESPONSE MODE — SUMMARIZED + LATEST:
- Combine LIVE_DASHBOARD_DATA with concise context the user needs to interpret it.
- Structure: bold TL;DR → 3–6 bullets of latest data → 2–4 bullets of "what it means" → optional callout → panel link(s).
- Use a Markdown table or a [chart:*] token whenever ≥3 numeric items are compared.`,
  deep: `RESPONSE MODE — DEEP RESEARCH:
- Treat the question as a research brief. Produce an analyst memo grounded in LIVE_DASHBOARD_DATA.
- Required sections (use H3 headings):
  ### Executive summary  (3–5 sentences)
  ### Key data points    (table, derived from LIVE_DASHBOARD_DATA where possible)
  ### Drivers & dynamics (numbered bullets with reasoning chains)
  ### Risks & scenarios  (callouts: [!WARNING] / [!ALERT] where warranted; calibrated probability bands)
  ### What to watch next (bullets, each with a [panel:*] link to the relevant Worldcave panel)
- Be explicit about uncertainty. Distinguish observation, inference, and assumption.
- Use at least one [chart:*] token when numeric series are present, plus a Markdown table.
- Length: ~350–700 words. Never fabricate numbers.`,
};

function buildSystemPrompt(ctx?: ClientContext): string {
  if (!ctx) return BASE_SYSTEM_PROMPT;
  const lines: string[] = [];
  if (ctx.view) lines.push(`- Current map view: ${ctx.view}`);
  if (ctx.timeRange) lines.push(`- Active time range: ${ctx.timeRange}`);
  if (ctx.layers) lines.push(`- Active layers: ${ctx.layers}`);
  if (ctx.variant) lines.push(`- Dashboard variant: ${ctx.variant}`);
  if (ctx.locale) lines.push(`- User locale: ${ctx.locale}`);
  if (ctx.route) lines.push(`- Current URL: ${ctx.route}`);
  let prompt = BASE_SYSTEM_PROMPT;
  if (lines.length) {
    prompt += `\n\nLive dashboard context (read-only):\n${lines.join('\n')}`;
  }
  if (ctx.liveData && typeof ctx.liveData === 'object') {
    let json = '';
    try { json = JSON.stringify(ctx.liveData); } catch { json = ''; }
    // Cap at ~24 KB to stay well within model context.
    if (json && json.length < 24_000) {
      prompt += `\n\nLIVE_DASHBOARD_DATA (JSON snapshot — prefer these numbers/headlines):\n\`\`\`json\n${json}\n\`\`\``;
    }
  }
  return prompt;
}

function appendMode(prompt: string, mode: AssistantMode): string {
  return `${prompt}\n\n${MODE_INSTRUCTIONS[mode]}`;
}

export default async (req: VercelRequest, res: VercelResponse) => {
  // Set CORS headers
  Object.entries(corsHeaders).forEach(([key, value]) => {
    res.setHeader(key, value);
  });

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  // Check authorization
  const authHeader = req.headers.authorization ?? '';
  if (!authHeader.toLowerCase().startsWith('bearer ')) {
    console.error('[v0] AI assistant: missing bearer token');
    return res.status(401).json({ error: 'unauthorized' });
  }

  // Verify Clerk JWT token
  try {
    const token = authHeader.slice(7);
    const clerkPubKey = process.env.CLERK_PUBLISHABLE_KEY;
    
    if (!clerkPubKey) {
      console.error('[v0] AI assistant: CLERK_PUBLISHABLE_KEY not set');
      return res.status(500).json({ error: 'service_unavailable' });
    }

    // Basic JWT validation (check if token exists and is non-empty)
    // In production, validate the JWT signature against Clerk's public key
    if (!token || token.length < 10) {
      console.error('[v0] AI assistant: invalid token format');
      return res.status(401).json({ error: 'unauthorized' });
    }
  } catch (err) {
    console.error('[v0] AI assistant: auth error', err);
    return res.status(401).json({ error: 'unauthorized' });
  }

  // Check API key
  const apiKey = process.env.AI_GATEWAY_API_KEY;
  if (!apiKey) {
    console.error('[v0] AI assistant: AI_GATEWAY_API_KEY not set');
    return res.status(500).json({ error: 'service_unavailable' });
  }

  // Parse request body
  let payload: { messages?: ChatMessage[]; model?: string; context?: ClientContext; mode?: string };
  try {
    payload = req.body as typeof payload;
  } catch (err) {
    console.error('[v0] AI assistant: JSON parse error', err);
    return res.status(400).json({ error: 'invalid_json' });
  }

  const userMessages = (payload.messages ?? []).filter(m =>
    m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string',
  ).slice(-20);

  if (userMessages.length === 0) {
    console.error('[v0] AI assistant: no messages provided');
    return res.status(400).json({ error: 'messages_required' });
  }

  const requestedMode = (payload.mode || 'summary').toLowerCase();
  const mode: AssistantMode = (['latest', 'summary', 'deep'].includes(requestedMode)
    ? requestedMode
    : 'summary') as AssistantMode;

  let chosenModel = payload.model && ALLOWED_MODELS.has(payload.model)
    ? payload.model
    : 'openai/gpt-4-mini';
  if (mode === 'deep' && (!payload.model || payload.model === 'openai/gpt-4-mini')) {
    chosenModel = 'openai/gpt-4';
  }

  const systemPrompt = appendMode(buildSystemPrompt(payload.context), mode);

  try {
    const upstream = await fetch('https://api.gateway.ai.cloudflare.com/v1/openai/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'User-Agent': 'worldcave-ai-assistant/1.0',
      },
      body: JSON.stringify({
        model: chosenModel,
        stream: true,
        messages: [{ role: 'system', content: systemPrompt }, ...userMessages],
      }),
    });

    if (!upstream.ok) {
      const text = await upstream.text().catch(() => '');
      let userMessage = 'AI request failed';
      if (upstream.status === 429) userMessage = 'Too many requests — please slow down and try again shortly.';
      else if (upstream.status === 402) userMessage = 'AI credits exhausted. Please contact the workspace owner.';
      
      console.error('[v0] AI assistant: upstream error', {
        status: upstream.status,
        message: userMessage,
        detail: text.slice(0, 200),
      });

      return res.status(upstream.status).json({
        error: userMessage,
        status: upstream.status,
        detail: text.slice(0, 500),
      });
    }

    // Set headers for streaming response
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    // Stream the response
    if (upstream.body) {
      upstream.body.pipe(res);
    } else {
      res.end();
    }
  } catch (err) {
    console.error('[v0] AI assistant: request error', err);
    return res.status(500).json({ error: 'service_unavailable', detail: String(err) });
  }
};
