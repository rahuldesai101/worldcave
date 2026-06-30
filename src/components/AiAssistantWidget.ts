// Header-mounted AI assistant trigger (W.A.V.E.) with a theme-matched
// slide-in right sidebar. Sign-in gated (Clerk). Streams answers from the
// `ai-assistant` Supabase edge function (Lovable AI Gateway).

import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { getCurrentClerkUser, subscribeClerk, openSignIn } from '@/services/clerk';
import { fetchRemoteThreads, upsertRemoteThread, deleteRemoteThread } from '@/services/ai-chat-storage';

interface ChatMessage { role: 'user' | 'assistant'; content: string }
interface ChatThread {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  mode: AssistantMode;
  model: string;
  messages: ChatMessage[];
}
type AssistantMode = 'latest' | 'summary' | 'deep';

const ENDPOINT = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ai-assistant`;
const ANON_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
const THREADS_KEY = 'wc-ai-threads-v2';
const ACTIVE_THREAD_KEY = 'wc-ai-active-thread-v2';
const MODEL_KEY = 'wc-ai-model-v1';
const MODE_KEY = 'wc-ai-mode-v1';
const LEGACY_HISTORY_KEY = 'wc-ai-history-v1';

interface ModelOption { id: string; label: string }
const MODELS: ModelOption[] = [
  { id: 'google/gemini-3-flash-preview', label: 'Gemini 3 Flash · fast' },
  { id: 'google/gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
  { id: 'google/gemini-2.5-pro', label: 'Gemini 2.5 Pro · deep' },
  { id: 'openai/gpt-5-mini', label: 'GPT-5 mini' },
  { id: 'openai/gpt-5', label: 'GPT-5 · premium' },
];
const DEFAULT_MODEL = 'google/gemini-3-flash-preview';

function modelLabel(id: string): string {
  return MODELS.find(m => m.id === id)?.label ?? MODELS.find(m => m.id === DEFAULT_MODEL)?.label ?? 'Gemini 3 Flash';
}

function modelHint(id: string): string {
  if (id.includes('pro') || id.includes('gpt-5')) return 'Advanced reasoning and harder research';
  if (id.includes('mini') || id.includes('2.5-flash')) return 'Balanced speed and analysis';
  return 'Fast answers for live dashboard work';
}

interface ModeOption { id: AssistantMode; label: string; hint: string }
const MODES: ModeOption[] = [
  { id: 'latest',  label: 'Latest',  hint: 'Strictly from live dashboard data' },
  { id: 'summary', label: 'Summary', hint: 'Summarized + latest data (default)' },
  { id: 'deep',    label: 'Deep',    hint: 'Deep research / analyst memo' },
];
const DEFAULT_MODE: AssistantMode = 'summary';

interface QuickAction { label: string; prompt: string; icon: string }
const QUICK_ACTIONS: QuickAction[] = [
  { icon: '◉', label: 'Daily brief', prompt: 'Give me a concise daily intelligence brief: top 5 stories across geopolitics, markets, conflicts, and energy. Bullet points, 1 line each, with why-it-matters.' },
  { icon: '⚡', label: 'Market pulse', prompt: 'Summarize the current state of global markets: equities, commodities, FX, crypto. Call out the single biggest mover and likely catalyst.' },
  { icon: '⚔', label: 'Active conflicts', prompt: 'List the active military/armed conflicts with the most movement in the last 48 hours. For each: who, where, escalation direction (up/down/flat).' },
  { icon: '⛽', label: 'Energy & oil', prompt: 'Analyze the current energy complex: crude, nat gas, key chokepoints, refining stress. What should I watch this week?' },
  { icon: '☢', label: 'Threat scan', prompt: 'Scan for elevated geopolitical, nuclear, cyber, and disaster threats right now. Rate each Low / Elevated / High with a one-line reason.' },
  { icon: '🔎', label: 'Explain view', prompt: 'Explain what the user is currently looking at on the Worldcave dashboard based on the live context provided, and suggest 3 useful follow-up questions.' },
];

const TRIGGER_SVG = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 2l2.39 6.36L21 9.27l-5 4.87L17.18 21 12 17.77 6.82 21 8 14.14l-5-4.87 6.61-.91L12 2z"/></svg>';

// Inline SVG icon set — single source for the redesigned WAVE chrome.
const ICONS = {
  history: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/><path d="M12 7v5l3 2"/></svg>',
  plus:    '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
  refresh: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a9 9 0 1 1-3-6.7"/><path d="M21 4v5h-5"/></svg>',
  close:   '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  send:    '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 2L11 13"/><path d="M22 2l-7 20-4-9-9-4 20-7z"/></svg>',
  stop:    '<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="1.5"/></svg>',
  edit:    '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 1 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/></svg>',
  trash:   '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>',
  chevron: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>',
  model:   '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="5" width="14" height="14" rx="2"/><path d="M9 1v4M15 1v4M9 19v4M15 19v4M1 9h4M1 15h4M19 9h4M19 15h4"/></svg>',
};

const STYLES = `
/* Header trigger button — matches existing header control styling */
.wc-ai-trigger{display:inline-flex;align-items:center;gap:6px;height:28px;padding:0 10px;
  background:var(--surface,#141414);color:var(--text,#e8e8e8);border:1px solid var(--border,#2a2a2a);
  border-radius:6px;font:600 11px/1 inherit;letter-spacing:.04em;text-transform:uppercase;
  cursor:pointer;transition:background .15s ease,border-color .15s ease,color .15s ease;}
.wc-ai-trigger:hover{background:var(--surface-hover,#1e1e1e);border-color:var(--border-strong,#444);color:var(--accent,#fff);}
.wc-ai-trigger.is-open{background:var(--surface-active,#1a1a2e);border-color:var(--accent,#fff);color:var(--accent,#fff);}
.wc-ai-trigger svg{flex:0 0 auto}

/* Backdrop + responsive assistant shell */
.wc-ai-backdrop{position:fixed;left:0;right:0;top:var(--wm-chrome-top,40px);bottom:0;
  background:rgba(0,0,0,.42);backdrop-filter:blur(4px);
  z-index:2147481900;opacity:0;transition:opacity .22s ease;pointer-events:none;}
.wc-ai-backdrop.is-open{opacity:1;pointer-events:auto;}
.wc-ai-side{position:fixed;top:var(--wm-chrome-top,40px);right:0;
  height:calc(100vh - var(--wm-chrome-top,40px));
  height:calc(100dvh - var(--wm-chrome-top,40px));
  width:min(980px,calc(100vw - 16px));max-width:100vw;
  background:var(--bg,#0a0a0a);color:var(--text,#e8e8e8);
  border-left:1px solid var(--border,#2a2a2a);
  border-top:1px solid var(--border,#2a2a2a);
  box-shadow:-18px 0 55px rgba(0,0,0,.55);
  display:flex;flex-direction:row;z-index:2147482000;font-family:inherit;
  transform:translateX(100%);transition:transform .28s cubic-bezier(.25,.8,.3,1);
  will-change:transform;overflow:hidden;}
.wc-ai-side.is-open{transform:translateX(0);}

/* Threads rail — drawer on every breakpoint so chat never gets squeezed/stuck. */
.wc-ai-rail{position:absolute;top:0;left:0;bottom:0;z-index:5;display:flex;flex-direction:column;width:300px;max-width:min(82vw,340px);flex:0 0 auto;
  background:color-mix(in srgb,var(--bg-secondary,#111) 92%,var(--surface-active,#1a1a2e));
  border-right:1px solid var(--border,#2a2a2a);
  min-width:0;overflow:hidden;transform:translateX(-105%);box-shadow:10px 0 30px rgba(0,0,0,.56);
  transition:transform .25s cubic-bezier(.25,.8,.3,1);}
.wc-ai-side.rail-open .wc-ai-rail{transform:translateX(0);}
.wc-ai-rail-head{display:flex;align-items:center;gap:8px;padding:12px 10px;
  border-bottom:1px solid var(--border-subtle,#1a1a1a);}
.wc-ai-rail-title{flex:1;font:700 10.5px/1 inherit;letter-spacing:.1em;text-transform:uppercase;
  color:var(--text-muted,#888);}
.wc-ai-rail-head .new-chat{display:inline-flex;align-items:center;justify-content:center;gap:5px;
  background:var(--accent,#fff);color:var(--bg,#0a0a0a);border:none;border-radius:999px;
  width:34px;height:28px;padding:0;font:600 11px/1 inherit;cursor:pointer;transition:filter .15s ease,transform .15s ease;}
.wc-ai-rail-head .new-chat span{display:none;}
.wc-ai-rail-head .new-chat:hover{filter:brightness(.92);transform:translateY(-1px);}
.wc-ai-rail-head .rail-close{display:inline-flex;align-items:center;justify-content:center;
  width:30px;height:30px;background:transparent;color:var(--text-secondary,#ccc);
  border:1px solid transparent;border-radius:999px;cursor:pointer;}
.wc-ai-rail-head .rail-close:hover{background:var(--surface-hover,#1e1e1e);color:var(--accent,#fff);}
.wc-ai-rail-list{flex:1;overflow-y:auto;padding:8px 7px;display:flex;flex-direction:column;gap:4px;}
.wc-ai-rail-list::-webkit-scrollbar{width:6px}.wc-ai-rail-list::-webkit-scrollbar-thumb{background:var(--border,#2a2a2a);border-radius:3px}
.wc-ai-thread{display:flex;align-items:center;gap:6px;padding:9px 9px;border-radius:9px;
  background:transparent;color:var(--text-secondary,#bbb);border:1px solid transparent;
  cursor:pointer;font:500 12.5px/1.3 inherit;position:relative;}
.wc-ai-thread:hover{background:var(--surface,#141414);color:var(--text,#e8e8e8);}
.wc-ai-thread.is-active{background:var(--surface-active,#1a1a2e);color:var(--accent,#fff);border-color:var(--border-strong,#444);
  box-shadow:inset 3px 0 0 var(--semantic-info,#3b82f6);}
.wc-ai-thread .t-title{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.wc-ai-thread .t-meta{font-size:10px;color:var(--text-muted,#666);margin-left:4px;flex:0 0 auto;}
.wc-ai-thread .t-act{display:inline-flex;align-items:center;justify-content:center;
  width:22px;height:22px;border-radius:4px;
  opacity:1;background:transparent;border:none;color:var(--text-muted,#888);
  cursor:pointer;padding:0;line-height:0;}
.wc-ai-thread:hover .t-act,.wc-ai-thread.is-active .t-act{opacity:1;}
.wc-ai-thread .t-act:hover{background:var(--surface-hover,#222);color:var(--accent,#fff);}
.wc-ai-thread .t-act.del:hover{color:#ef4444;background:rgba(239,68,68,.1);}
.wc-ai-rail-empty{padding:18px 12px;color:var(--text-muted,#666);font-size:11.5px;text-align:center;
  line-height:1.5;}

/* Main column */
.wc-ai-main{display:flex;flex-direction:column;flex:1;min-width:0;width:100%;position:relative;background:var(--bg,#0a0a0a);}

/* Header bar — Claude/Gemini-inspired, no duplicate hamburger. */
.wc-ai-head{display:flex;align-items:center;gap:8px;padding:10px 12px;
  background:color-mix(in srgb,var(--bg,#0a0a0a) 86%,var(--surface,#141414));
  border-bottom:1px solid var(--border,#2a2a2a);}
.wc-ai-head-title{flex:1;display:flex;align-items:center;gap:8px;min-width:0;}
.wc-ai-head-brand{font:800 12px/1 inherit;letter-spacing:.12em;text-transform:uppercase;
  color:var(--text,#e8e8e8);flex:0 0 auto;}
.wc-ai-head-thread{font:500 12px/1 inherit;color:var(--text-muted,#888);
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0;}
.wc-ai-dot{width:7px;height:7px;border-radius:50%;background:#22c55e;box-shadow:0 0 8px #22c55e;flex:0 0 auto;}
.wc-ai-dot.busy{background:#f59e0b;box-shadow:0 0 8px #f59e0b;animation:wc-ai-pulse 1s infinite;}
@keyframes wc-ai-pulse{50%{opacity:.4}}
.wc-ai-iconbtn{display:inline-flex;align-items:center;justify-content:center;width:30px;height:30px;
  background:transparent;color:var(--text-secondary,#ccc);border:1px solid transparent;border-radius:6px;
  cursor:pointer;flex:0 0 auto;transition:background .15s ease,color .15s ease,border-color .15s ease;}
.wc-ai-iconbtn:hover{background:var(--surface-hover,#1e1e1e);color:var(--accent,#fff);border-color:var(--border,#2a2a2a);}
.wc-ai-iconbtn svg{display:block}

/* Sub-bar: Gemini-like custom dropdown + compact reasoning modes */
.wc-ai-sub{display:flex;align-items:center;gap:10px;padding:9px 12px;flex-wrap:nowrap;
  border-bottom:1px solid var(--border-subtle,#1a1a1a);background:var(--bg-secondary,#111);position:relative;z-index:3;}
.wc-ai-model-wrap{position:relative;flex:1 1 230px;min-width:0;}
.wc-ai-model-trigger{display:flex;align-items:center;gap:7px;width:100%;height:34px;padding:0 10px;
  background:var(--surface,#141414);color:var(--text,#e8e8e8);border:1px solid var(--border,#2a2a2a);
  border-radius:10px;font:650 12px/1 inherit;cursor:pointer;outline:none;}
.wc-ai-model-trigger:hover,.wc-ai-model-trigger[aria-expanded="true"]{background:var(--surface-hover,#1e1e1e);border-color:var(--border-strong,#444);}
.wc-ai-model-trigger .model-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0;}
.wc-ai-model-trigger .model-ico,.wc-ai-model-trigger .model-chevron{display:inline-flex;align-items:center;justify-content:center;flex:0 0 auto;color:var(--text-muted,#888);}
.wc-ai-model-trigger .model-chevron{margin-left:auto;}
.wc-ai-model-menu{position:absolute;left:0;top:calc(100% + 7px);width:min(310px,calc(100vw - 28px));
  background:color-mix(in srgb,var(--surface,#141414) 94%,var(--bg,#0a0a0a));
  border:1px solid var(--border-strong,#444);border-radius:15px;padding:8px;
  box-shadow:0 18px 42px rgba(0,0,0,.58);opacity:0;transform:translateY(-6px) scale(.98);
  pointer-events:none;transition:opacity .16s ease,transform .16s ease;z-index:9;}
.wc-ai-model-wrap.is-open .wc-ai-model-menu{opacity:1;transform:translateY(0) scale(1);pointer-events:auto;}
.wc-ai-model-option{display:grid;grid-template-columns:18px 1fr;gap:8px;align-items:center;width:100%;
  background:transparent;color:var(--text-secondary,#ccc);border:0;border-radius:10px;padding:9px 8px;text-align:left;cursor:pointer;font-family:inherit;}
.wc-ai-model-option:hover{background:var(--surface-hover,#1e1e1e);color:var(--text,#e8e8e8);}
.wc-ai-model-option.is-active{color:var(--accent,#fff);}
.wc-ai-model-option .check{color:var(--semantic-info,#3b82f6);font-weight:800;text-align:center;}
.wc-ai-model-option .m-label{display:block;font:700 12.5px/1.15 inherit;}
.wc-ai-model-option .m-hint{display:block;margin-top:2px;color:var(--text-muted,#888);font:500 11px/1.25 inherit;}
.wc-ai-select{position:absolute;opacity:0;pointer-events:none;width:1px;height:1px;}

/* Mode segmented control */
.wc-ai-modes{display:inline-flex;background:var(--surface,#141414);border:1px solid var(--border,#2a2a2a);
  border-radius:999px;padding:2px;gap:2px;flex:0 0 auto;}
.wc-ai-modes button{background:transparent;border:none;color:var(--text-secondary,#bbb);cursor:pointer;
  padding:7px 11px;border-radius:999px;font:700 10px/1 inherit;letter-spacing:.06em;text-transform:uppercase;
  transition:background .15s ease,color .15s ease;}
.wc-ai-modes button:hover{color:var(--accent,#fff);}
.wc-ai-modes button.is-active{background:var(--accent,#fff);color:var(--bg,#0a0a0a);}

/* Body */
.wc-ai-body{flex:1;overflow-y:auto;padding:18px 20px;display:flex;flex-direction:column;gap:13px;
  font-size:13.5px;line-height:1.55;}
.wc-ai-body::-webkit-scrollbar{width:8px}
.wc-ai-body::-webkit-scrollbar-thumb{background:var(--border,#2a2a2a);border-radius:4px}

.wc-ai-msg{padding:9px 12px;border-radius:14px;max-width:94%;word-wrap:break-word;overflow-wrap:break-word;
  border:1px solid transparent;}
.wc-ai-msg.user{align-self:flex-end;background:var(--surface-active,#1a1a2e);color:var(--accent,#fff);
  border-color:var(--border-strong,#444);}
.wc-ai-msg.assistant{align-self:flex-start;background:transparent;color:var(--text,#e8e8e8);
  border-color:transparent;position:relative;width:100%;max-width:100%;padding:4px 0;}
.wc-ai-msg.assistant p{margin:0 0 8px 0}.wc-ai-msg.assistant p:last-child{margin-bottom:0}
.wc-ai-msg.assistant ul,.wc-ai-msg.assistant ol{margin:4px 0 8px 18px;padding:0}
.wc-ai-msg.assistant code{background:var(--bg-secondary,#111);padding:1px 5px;border-radius:4px;
  font-size:12px;border:1px solid var(--border-subtle,#1a1a1a);}
.wc-ai-msg.assistant pre{background:var(--bg-secondary,#111);padding:9px;border-radius:6px;
  overflow-x:auto;font-size:12px;border:1px solid var(--border-subtle,#1a1a1a);}
.wc-ai-msg.assistant h3,.wc-ai-msg.assistant h4{margin:6px 0 4px;font-size:13px;
  color:var(--accent,#fff);letter-spacing:.02em;}
.wc-ai-msg .copy-btn{position:absolute;top:0;right:0;background:transparent;border:none;
  color:var(--text-muted,#666);font-size:11px;cursor:pointer;opacity:0;transition:opacity .15s;}
.wc-ai-msg.assistant:hover .copy-btn{opacity:1}
.wc-ai-msg .copy-btn:hover{color:var(--accent,#fff)}

/* Tables */
.wc-ai-msg.assistant table{border-collapse:collapse;margin:6px 0;width:100%;font-size:12px;}
.wc-ai-msg.assistant th,.wc-ai-msg.assistant td{border:1px solid var(--border-subtle,#1a1a1a);padding:4px 7px;text-align:left;}
.wc-ai-msg.assistant thead th{background:var(--bg-secondary,#111);color:var(--accent,#fff);font-weight:600;letter-spacing:.03em;}
.wc-ai-msg.assistant tbody tr:nth-child(even){background:rgba(255,255,255,.02);}

/* Themed panel-link chips */
.wc-ai-panel-chip{display:inline-flex;align-items:center;gap:4px;margin:2px 4px 2px 0;padding:3px 9px;
  background:var(--surface-active,#1a1a2e);color:var(--accent,#7dd3fc);
  border:1px solid var(--accent,#3b82f6);border-radius:999px;font:600 11px/1.4 inherit;
  letter-spacing:.02em;cursor:pointer;transition:background .15s,color .15s,transform .1s,box-shadow .2s;}
.wc-ai-panel-chip:hover{background:var(--accent,#3b82f6);color:var(--bg,#0a0a0a);transform:translateY(-1px);}
.wc-ai-panel-chip.is-targeting{background:#3b82f6;color:#0a0a0a;box-shadow:0 0 0 3px rgba(59,130,246,.35);animation:wc-ai-chip-pulse 1.1s ease-out;}
.wc-ai-panel-chip.is-done{background:#22c55e;color:#04210d;border-color:#22c55e;}
.wc-ai-panel-chip.is-miss{background:rgba(239,68,68,.18);color:#fecaca;border-color:#ef4444;}
@keyframes wc-ai-chip-pulse{0%{box-shadow:0 0 0 0 rgba(59,130,246,.55)}100%{box-shadow:0 0 0 8px rgba(59,130,246,0)}}

/* Rich SVG charts */
.wc-ai-chart{margin:8px 0;padding:8px 10px;border:1px solid var(--border-subtle,#1a1a1a);
  border-radius:6px;background:var(--bg-secondary,#0e0e0e);}
.wc-ai-chart-title{font:600 11px/1.4 inherit;color:var(--accent,#fff);letter-spacing:.06em;
  text-transform:uppercase;margin-bottom:6px;}
.wc-ai-chart svg{display:block;width:100%;height:auto;font-family:inherit;}
.wc-ai-chart text{fill:var(--text-secondary,#bbb);font-size:10px;}
.wc-ai-chart .axis{stroke:var(--border,#2a2a2a);stroke-width:1;}
.wc-ai-chart .grid{stroke:var(--border-subtle,#1a1a1a);stroke-width:1;stroke-dasharray:2 3;}
.wc-ai-chart .bar-pos{fill:#22c55e;}
.wc-ai-chart .bar-neg{fill:#ef4444;}
.wc-ai-chart .bar-neutral{fill:#3b82f6;}
.wc-ai-chart .series-line{fill:none;stroke:#7dd3fc;stroke-width:1.75;}
.wc-ai-chart .series-area{fill:rgba(125,211,252,.18);stroke:#7dd3fc;stroke-width:1.5;}
.wc-ai-chart .point{fill:#7dd3fc;}

/* Callouts */
.wc-ai-callout{display:flex;align-items:flex-start;gap:8px;margin:8px 0;padding:8px 10px;
  border-left:3px solid var(--border-strong,#444);border-radius:4px;background:var(--bg-secondary,#111);
  font-size:12.5px;line-height:1.45;}
.wc-ai-callout .wc-ai-callout-tag{font:700 10px/1.4 inherit;letter-spacing:.08em;text-transform:uppercase;
  padding:2px 6px;border-radius:3px;flex:0 0 auto;}
.wc-ai-callout[data-callout="alert"]{border-left-color:#ef4444;background:rgba(239,68,68,.08);}
.wc-ai-callout[data-callout="alert"] .wc-ai-callout-tag{background:#ef4444;color:#fff;}
.wc-ai-callout[data-callout="warning"]{border-left-color:#f59e0b;background:rgba(245,158,11,.08);}
.wc-ai-callout[data-callout="warning"] .wc-ai-callout-tag{background:#f59e0b;color:#1a1100;}
.wc-ai-callout[data-callout="info"]{border-left-color:#3b82f6;background:rgba(59,130,246,.08);}
.wc-ai-callout[data-callout="info"] .wc-ai-callout-tag{background:#3b82f6;color:#fff;}
.wc-ai-callout[data-callout="success"]{border-left-color:#22c55e;background:rgba(34,197,94,.08);}
.wc-ai-callout[data-callout="success"] .wc-ai-callout-tag{background:#22c55e;color:#04210d;}

.wc-ai-typing{display:inline-block;width:6px;height:6px;border-radius:50%;
  background:var(--text-dim,#888);animation:wc-ai-blink 1.2s infinite;}
@keyframes wc-ai-blink{0%,80%,100%{opacity:.3}40%{opacity:1}}

/* Quick actions grid */
.wc-ai-actions{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:6px;padding:8px 0 0;}
.wc-ai-actions button{display:flex;align-items:center;gap:8px;text-align:left;
  background:var(--surface,#141414);color:var(--text-secondary,#ccc);
  border:1px solid var(--border,#2a2a2a);border-radius:10px;padding:9px 11px;
  font:500 12px/1.2 inherit;cursor:pointer;transition:background .15s,color .15s,border-color .15s,transform .12s;}
.wc-ai-actions button:hover{background:var(--surface-hover,#1e1e1e);color:var(--accent,#fff);
  border-color:var(--border-strong,#444);transform:translateY(-1px);}
.wc-ai-actions .qa-icon{font-size:14px;opacity:.9}

/* Footer composer */
.wc-ai-foot{padding:12px 16px;border-top:1px solid var(--border,#2a2a2a);
  background:var(--bg-secondary,#111);display:flex;gap:8px;align-items:flex-end;}
.wc-ai-foot textarea{flex:1;background:var(--surface,#141414);color:var(--text,#e8e8e8);
  border:1px solid var(--border,#2a2a2a);border-radius:18px;padding:11px 14px;
  font-family:inherit;font-size:13.5px;resize:none;outline:none;min-height:40px;max-height:160px;
  line-height:1.45;transition:border-color .15s ease;}
.wc-ai-foot textarea:focus{border-color:var(--accent,#fff);}
.wc-ai-foot .send-btn{display:inline-flex;align-items:center;justify-content:center;
  height:40px;width:40px;background:var(--accent,#fff);color:var(--bg,#0a0a0a);
  border:none;border-radius:999px;cursor:pointer;flex:0 0 auto;transition:filter .15s ease,opacity .15s ease,transform .15s ease;}
.wc-ai-foot .send-btn:hover{filter:brightness(.92);}
.wc-ai-foot .send-btn:disabled{opacity:.4;cursor:not-allowed}
.wc-ai-foot .stop-btn{display:inline-flex;align-items:center;justify-content:center;gap:5px;
  height:40px;padding:0 12px;background:transparent;color:var(--text-secondary,#ccc);
  border:1px solid var(--border,#2a2a2a);border-radius:8px;cursor:pointer;font:600 11px/1 inherit;
  letter-spacing:.04em;text-transform:uppercase;flex:0 0 auto;}
.wc-ai-foot .stop-btn:hover{color:var(--accent,#fff);border-color:var(--accent,#fff)}

.wc-ai-hint{padding:6px 12px;font-size:10.5px;color:var(--text-muted,#666);
  border-top:1px solid var(--border-subtle,#1a1a1a);background:var(--bg-secondary,#111);
  display:flex;justify-content:space-between;align-items:center;gap:8px;}

/* Sign-in gate */
.wc-ai-gate{display:flex;flex-direction:column;align-items:center;justify-content:center;
  flex:1;padding:32px;text-align:center;gap:14px;}
.wc-ai-gate .glyph{font-size:38px;color:var(--accent,#fff);opacity:.85}
.wc-ai-gate h3{margin:0;font:600 14px/1.3 inherit;color:var(--text,#e8e8e8);letter-spacing:.04em;text-transform:uppercase;}
.wc-ai-gate p{margin:0;color:var(--text-dim,#888);font-size:12.5px;max-width:280px;line-height:1.5;}
.wc-ai-gate button{background:var(--accent,#fff);color:var(--bg,#0a0a0a);border:none;border-radius:6px;
  padding:9px 22px;cursor:pointer;font:600 12px/1 inherit;letter-spacing:.06em;text-transform:uppercase;}

/* Rail scrim — clickable backdrop for the mobile/tablet rail drawer. */
.wc-ai-rail-scrim{position:absolute;inset:0;background:rgba(0,0,0,.5);z-index:4;
  opacity:0;pointer-events:none;transition:opacity .2s ease;}
.wc-ai-side.rail-open .wc-ai-rail-scrim{opacity:1;pointer-events:auto;}

/* ─────────────── Tablet (<=1024px): rail collapses into drawer ─────────────── */
@media (max-width:1024px){
  .wc-ai-side{width:min(860px,calc(100vw - 10px));}
  .wc-ai-thread .t-act{opacity:1;}
}

/* ─────────────── Mobile (<=720px): full-bleed, compact chrome ─────────────── */
@media (max-width:720px){
  .wc-ai-backdrop{background:rgba(0,0,0,.18);backdrop-filter:blur(2px);}
  .wc-ai-side{left:0;right:0;width:100vw;border-left:none;border-top:0;box-shadow:none;}
  .wc-ai-rail{width:86vw;max-width:320px;}

  .wc-ai-head{padding:8px 10px;gap:5px;min-height:48px;}
  .wc-ai-iconbtn{width:34px;height:34px;border-radius:999px;background:var(--surface,#141414);}
  .wc-ai-head-brand{font-size:11px;}
  .wc-ai-head-thread{font-size:11px;}
  .wc-ai-head .wc-ai-iconbtn[data-action="clear"]{display:none;}

  .wc-ai-sub{padding:7px 10px;gap:7px;align-items:flex-start;flex-wrap:wrap;}
  .wc-ai-model-wrap{flex:1 1 100%;}
  .wc-ai-model-trigger{height:36px;border-radius:12px;}
  .wc-ai-model-menu{width:100%;}
  .wc-ai-modes{flex:1 1 100%;justify-content:space-between;border-radius:12px;}
  .wc-ai-modes button{flex:1;padding:8px 4px;font-size:10px;letter-spacing:.04em;}

  .wc-ai-body{padding:14px 16px 6px;font-size:14px;gap:12px;}
  .wc-ai-msg{max-width:100%;}
  .wc-ai-msg.user{max-width:90%;border-radius:16px;padding:10px 12px;}
  .wc-ai-msg.assistant table{font-size:11px;}

  .wc-ai-foot{padding:9px 10px calc(9px + env(safe-area-inset-bottom,0px));gap:7px;}
  .wc-ai-foot textarea{font-size:14px;min-height:44px;padding:11px 14px;border-radius:22px;}
  .wc-ai-foot .send-btn{height:42px;width:42px;}
  .wc-ai-foot .stop-btn{height:42px;padding:0 12px;font-size:11px;}

  .wc-ai-hint{padding:5px 10px;font-size:10px;}
  .wc-ai-hint > span:first-child{display:none;}

  .wc-ai-actions{grid-template-columns:1fr 1fr;}
  .wc-ai-thread{padding:10px 10px;font-size:13px;}
}

@media (max-width:420px){
  .wc-ai-head-thread{display:none;}
  .wc-ai-actions{grid-template-columns:1fr;}
  .wc-ai-body{padding-left:12px;padding-right:12px;}
}
`;

const PURIFY_CFG = {
  ALLOWED_TAGS: ['p','strong','em','b','i','br','hr','ul','ol','li','code','pre','blockquote','h2','h3','h4','h5','a','span','div','table','thead','tbody','tr','th','td','button',
    'svg','g','rect','line','polyline','polygon','path','text','tspan','circle','title'],
  ALLOWED_ATTR: ['class','data-panel-link','data-callout','title','viewBox','xmlns','width','height',
    'x','y','x1','y1','x2','y2','cx','cy','r','d','points','fill','stroke','stroke-width','stroke-dasharray',
    'text-anchor','dominant-baseline','transform','rx','ry','opacity'],
};

/* ────────────────────────────  RICH RENDERING  ──────────────────────────── */

function transformPanelLinks(raw: string): string {
  // [panel:id|Label]  →  themed chip
  return raw.replace(/\[panel:([a-z0-9_-]+)(?:\|([^\]]+))?\]/gi, (_m, id: string, label?: string) => {
    const safeId = id.toLowerCase().replace(/[^a-z0-9_-]/g, '');
    const safeLabel = (label || `Open ${safeId}`).replace(/[<>&"]/g, c => ({ '<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;' }[c] as string));
    return `<button type="button" class="wc-ai-panel-chip" data-panel-link="${safeId}" title="Scroll to ${safeId} panel">→ ${safeLabel}</button>`;
  });
}

function esc(s: string): string {
  return s.replace(/[<>&"]/g, c => ({ '<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;' }[c] as string));
}

function renderBarChart(title: string, items: Array<{ label: string; value: number }>): string {
  const w = 520, rowH = 22, padL = 90, padR = 60, padT = 4, padB = 4;
  const h = padT + padB + rowH * items.length;
  const maxAbs = Math.max(1, ...items.map(i => Math.abs(i.value)));
  const hasNeg = items.some(i => i.value < 0);
  const innerW = w - padL - padR;
  const zeroX = hasNeg ? padL + innerW / 2 : padL;
  const scale = hasNeg ? (innerW / 2) / maxAbs : innerW / maxAbs;

  const rows = items.map((it, i) => {
    const y = padT + i * rowH + 4;
    const barLen = Math.max(2, Math.abs(it.value) * scale);
    const x = it.value < 0 ? zeroX - barLen : zeroX;
    const cls = it.value > 0 ? 'bar-pos' : it.value < 0 ? 'bar-neg' : 'bar-neutral';
    const valTxt = (it.value > 0 ? '+' : '') + (Math.round(it.value * 100) / 100).toString();
    const valX = it.value < 0 ? x - 4 : x + barLen + 4;
    const anchor = it.value < 0 ? 'end' : 'start';
    return `
      <text x="${padL - 6}" y="${y + 10}" text-anchor="end">${esc(it.label).slice(0,16)}</text>
      <rect class="${cls}" x="${x}" y="${y}" width="${barLen}" height="${rowH - 8}" rx="2"/>
      <text x="${valX}" y="${y + 10}" text-anchor="${anchor}">${valTxt}</text>
    `;
  }).join('');

  const axis = hasNeg
    ? `<line class="axis" x1="${zeroX}" y1="${padT}" x2="${zeroX}" y2="${h - padB}"/>`
    : `<line class="axis" x1="${padL}" y1="${padT}" x2="${padL}" y2="${h - padB}"/>`;

  return `<div class="wc-ai-chart"><div class="wc-ai-chart-title">${esc(title)}</div>
    <svg viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg">${axis}${rows}</svg></div>`;
}

function renderLineChart(title: string, values: number[], kind: 'line' | 'area'): string {
  const w = 520, h = 160, padL = 36, padR = 12, padT = 14, padB = 22;
  const innerW = w - padL - padR, innerH = h - padT - padB;
  const min = Math.min(...values), max = Math.max(...values);
  const span = max - min || 1;
  const stepX = values.length > 1 ? innerW / (values.length - 1) : 0;
  const pts = values.map((v, i) => {
    const x = padL + i * stepX;
    const y = padT + innerH - ((v - min) / span) * innerH;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const polyline = pts.join(' ');
  const grid = [0, 0.25, 0.5, 0.75, 1].map(t => {
    const y = padT + innerH * t;
    const lbl = (max - span * t);
    return `<line class="grid" x1="${padL}" y1="${y}" x2="${w - padR}" y2="${y}"/>
      <text x="${padL - 4}" y="${y + 3}" text-anchor="end">${(Math.round(lbl * 100) / 100)}</text>`;
  }).join('');
  const pointDots = values.map((_, i) => {
    const parts = (pts[i] ?? '').split(',');
    const x = parts[0] ?? '0';
    const y = parts[1] ?? '0';
    return `<circle class="point" cx="${x}" cy="${y}" r="2.5"/>`;
  }).join('');
  const series = kind === 'area'
    ? `<polygon class="series-area" points="${padL},${padT + innerH} ${polyline} ${padL + (values.length - 1) * stepX},${padT + innerH}"/>`
    : `<polyline class="series-line" points="${polyline}"/>`;
  return `<div class="wc-ai-chart"><div class="wc-ai-chart-title">${esc(title)}</div>
    <svg viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg">${grid}${series}${pointDots}</svg></div>`;
}

function transformCharts(raw: string): string {
  // [chart:bar|Title|A:1,B:-2,C:3]
  // [chart:line|Title|1,2,3,4]
  // [chart:area|Title|1,2,3,4]
  return raw.replace(/\[chart:(bar|line|area)\|([^|\]]{1,80})\|([^\]]{1,800})\]/gi,
    (_m, kind: string, title: string, body: string) => {
      try {
        if (kind === 'bar') {
          const items = body.split(',').map(s => s.trim()).filter(Boolean).slice(0, 12).map(s => {
            const [lbl, val] = s.split(':');
            return { label: (lbl || '').trim(), value: Number((val || '').trim()) };
          }).filter(it => it.label && Number.isFinite(it.value));
          if (!items.length) return _m;
          return renderBarChart(title.trim(), items);
        }
        const values = body.split(',').map(s => Number(s.trim())).filter(n => Number.isFinite(n)).slice(0, 24);
        if (values.length < 2) return _m;
        return renderLineChart(title.trim(), values, kind === 'area' ? 'area' : 'line');
      } catch { return _m; }
    });
}

function transformCallouts(html: string): string {
  // > [!ALERT] foo  blockquote   →  styled callout div
  return html.replace(/<blockquote>\s*<p>\s*\[!(ALERT|WARNING|INFO|SUCCESS)\]\s*([\s\S]*?)<\/p>\s*<\/blockquote>/gi,
    (_m, kind: string, body: string) =>
      `<div class="wc-ai-callout" data-callout="${kind.toLowerCase()}"><span class="wc-ai-callout-tag">${kind}</span><span class="wc-ai-callout-body">${body.trim()}</span></div>`);
}

function md(raw: string): string {
  // Charts first (raw tokens), then panel chips, then markdown, then callouts.
  const pre = transformPanelLinks(transformCharts(raw));
  const html = marked.parse(pre) as string;
  const withCallouts = transformCallouts(html);
  return DOMPurify.sanitize(withCallouts, PURIFY_CFG);
}

function compactNum(n: unknown): number | null {
  if (typeof n !== 'number' || !Number.isFinite(n)) return null;
  return Math.round(n * 100) / 100;
}

function buildLiveSnapshot(): Record<string, unknown> {
  const state = (window as unknown as { __worldcaveState?: Record<string, unknown> }).__worldcaveState;
  const snap: Record<string, unknown> = { snapshotAt: new Date().toISOString() };
  if (!state) return snap;

  try {
    const markets = Array.isArray(state.latestMarkets) ? state.latestMarkets as Array<Record<string, unknown>> : [];
    if (markets.length) {
      snap.markets = markets.slice(0, 25).map(m => ({
        symbol: m.symbol, name: m.name,
        price: compactNum(m.price as number),
        changePct: compactNum((m.changePercent ?? m.changePct) as number),
      }));
    }
  } catch { /* ignore */ }

  try {
    const news = Array.isArray(state.allNews) ? state.allNews as Array<Record<string, unknown>> : [];
    if (news.length) {
      snap.topHeadlines = news.slice(0, 15).map(n => ({
        title: n.title, source: n.source, category: n.category,
        publishedAt: n.publishedAt, country: n.country,
      }));
    }
  } catch { /* ignore */ }

  try {
    const preds = Array.isArray(state.latestPredictions) ? state.latestPredictions as Array<Record<string, unknown>> : [];
    if (preds.length) {
      snap.predictions = preds.slice(0, 12).map(p => ({
        question: p.question ?? p.title, probability: compactNum(p.probability as number),
        source: p.source, endDate: p.endDate,
      }));
    }
  } catch { /* ignore */ }

  try {
    const clusters = Array.isArray(state.latestClusters) ? state.latestClusters as Array<Record<string, unknown>> : [];
    if (clusters.length) {
      snap.eventClusters = clusters.slice(0, 12).map(c => ({
        title: c.title, severity: c.severity, country: c.country,
        category: c.category, count: c.count,
      }));
    }
  } catch { /* ignore */ }

  try {
    const cache = state.intelligenceCache as Record<string, unknown> | undefined;
    if (cache) {
      const intel: Record<string, unknown> = {};
      const earthquakes = cache.earthquakes as Array<Record<string, unknown>> | undefined;
      if (Array.isArray(earthquakes) && earthquakes.length) {
        intel.recentEarthquakes = earthquakes.slice(0, 6).map(e => ({
          mag: e.magnitude, place: e.place, time: e.time,
        }));
      }
      const outages = cache.outages as unknown[] | undefined;
      if (Array.isArray(outages)) intel.internetOutageCount = outages.length;
      const protests = cache.protests as { events?: unknown[] } | undefined;
      if (protests?.events) intel.protestEventCount = protests.events.length;
      const oref = cache.orefAlerts as Record<string, unknown> | undefined;
      if (oref) intel.orefAlerts = oref;
      const mil = cache.military as Record<string, unknown> | undefined;
      if (mil) intel.militaryActivity = {
        flights: Array.isArray(mil.flights) ? (mil.flights as unknown[]).length : 0,
        vessels: Array.isArray(mil.vessels) ? (mil.vessels as unknown[]).length : 0,
      };
      if (Object.keys(intel).length) snap.intelligence = intel;
    }
  } catch { /* ignore */ }

  try {
    const layers = state.mapLayers as Record<string, boolean> | undefined;
    if (layers) {
      snap.activeLayers = Object.entries(layers).filter(([, v]) => v).map(([k]) => k);
    }
    snap.timeRange = state.currentTimeRange;
    snap.location = state.resolvedLocation;
  } catch { /* ignore */ }

  return snap;
}

/* ────────────────────────────  THREAD STORAGE  ──────────────────────────── */

function genId(): string {
  try { return crypto.randomUUID(); }
  catch { return `t_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`; }
}

function isValidMessage(m: unknown): m is ChatMessage {
  if (!m || typeof m !== 'object') return false;
  const r = (m as { role?: unknown }).role;
  const c = (m as { content?: unknown }).content;
  return (r === 'user' || r === 'assistant') && typeof c === 'string';
}

function loadThreads(): ChatThread[] {
  try {
    const raw = localStorage.getItem(THREADS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed
          .filter(t => t && typeof t.id === 'string' && Array.isArray(t.messages))
          .map(t => ({
            id: String(t.id),
            title: typeof t.title === 'string' && t.title.trim() ? t.title : 'New research',
            createdAt: Number(t.createdAt) || Date.now(),
            updatedAt: Number(t.updatedAt) || Date.now(),
            mode: (['latest', 'summary', 'deep'].includes(t.mode) ? t.mode : DEFAULT_MODE) as AssistantMode,
            model: MODELS.some(m => m.id === t.model) ? String(t.model) : DEFAULT_MODEL,
            messages: (t.messages as unknown[]).filter(isValidMessage).slice(-80) as ChatMessage[],
          }));
      }
    }
    // One-time migration from the old single-conversation history key.
    const legacy = localStorage.getItem(LEGACY_HISTORY_KEY);
    if (legacy) {
      const parsed = JSON.parse(legacy);
      if (Array.isArray(parsed) && parsed.length) {
        const msgs = parsed.filter(isValidMessage).slice(-80) as ChatMessage[];
        const t: ChatThread = {
          id: genId(),
          title: deriveTitle(msgs),
          createdAt: Date.now(),
          updatedAt: Date.now(),
          mode: DEFAULT_MODE,
          model: DEFAULT_MODEL,
          messages: msgs,
        };
        localStorage.removeItem(LEGACY_HISTORY_KEY);
        return [t];
      }
    }
  } catch { /* ignore */ }
  return [];
}

function saveThreads(threads: ChatThread[]): void {
  try { localStorage.setItem(THREADS_KEY, JSON.stringify(threads.slice(0, 50))); } catch { /* ignore */ }
}

function loadActiveId(): string | null {
  try { return localStorage.getItem(ACTIVE_THREAD_KEY); } catch { return null; }
}
function saveActiveId(id: string): void {
  try { localStorage.setItem(ACTIVE_THREAD_KEY, id); } catch { /* ignore */ }
}

function deriveTitle(messages: ChatMessage[]): string {
  const firstUser = messages.find(m => m.role === 'user');
  if (!firstUser) return 'New research';
  const t = firstUser.content.replace(/\s+/g, ' ').trim().slice(0, 48);
  return t || 'New research';
}

function timeAgo(ts: number): string {
  const s = Math.max(1, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

function getContext(): Record<string, string> {
  const ctx: Record<string, string> = {};
  try {
    const url = new URL(window.location.href);
    ctx.route = url.pathname + url.search;
    const view = url.searchParams.get('view'); if (view) ctx.view = view;
    const tr = url.searchParams.get('timeRange'); if (tr) ctx.timeRange = tr;
    const layers = url.searchParams.get('layers'); if (layers) ctx.layers = layers.split(',').slice(0, 12).join(',');
    ctx.locale = navigator.language;
    const variant = (import.meta.env.VITE_VARIANT as string | undefined) ?? 'full';
    ctx.variant = variant;
  } catch { /* ignore */ }
  return ctx;
}

export class AiAssistantWidget {
  private trigger: HTMLButtonElement;
  private backdrop: HTMLDivElement;
  private side: HTMLDivElement;
  private bodyEl: HTMLDivElement;
  private statusDot: HTMLSpanElement;
  private modelSelect: HTMLSelectElement;
  private modelWrap!: HTMLDivElement;
  private modelTrigger!: HTMLButtonElement;
  private modelMenu!: HTMLDivElement;
  private railList!: HTMLDivElement;
  private modeBar!: HTMLDivElement;
  private threads: ChatThread[] = [];
  private activeId: string = '';
  private mode: AssistantMode = DEFAULT_MODE;
  private streaming = false;
  private isOpen = false;
  private abort: AbortController | null = null;
  private model: string = DEFAULT_MODEL;
  private syncedUserId: string | null = null;
  private pendingSync = new Map<string, number>();
  private syncTimer: number | null = null;

  constructor() {
    if (!document.getElementById('wc-ai-styles')) {
      const style = document.createElement('style');
      style.id = 'wc-ai-styles';
      style.textContent = STYLES;
      document.head.appendChild(style);
    }

    this.threads = loadThreads();
    try { this.model = localStorage.getItem(MODEL_KEY) || DEFAULT_MODEL; } catch { /* ignore */ }
    if (!MODELS.some(m => m.id === this.model)) this.model = DEFAULT_MODEL;
    try {
      const m = (localStorage.getItem(MODE_KEY) || DEFAULT_MODE) as AssistantMode;
      this.mode = (['latest', 'summary', 'deep'].includes(m) ? m : DEFAULT_MODE) as AssistantMode;
    } catch { /* ignore */ }

    // Resolve active thread (existing → from storage → first → new)
    const storedActive = loadActiveId();
    if (storedActive && this.threads.some(t => t.id === storedActive)) {
      this.activeId = storedActive;
    } else if (this.threads.length) {
      this.activeId = this.threads[0]!.id;
    } else {
      const t = this.createBlankThread();
      this.threads.push(t);
      this.activeId = t.id;
      saveThreads(this.threads);
    }
    saveActiveId(this.activeId);

    // Trigger (mounted into header)
    this.trigger = document.createElement('button');
    this.trigger.type = 'button';
    this.trigger.className = 'wc-ai-trigger';
    this.trigger.title = 'Open W.A.V.E. AI Assistant';
    this.trigger.setAttribute('aria-label', 'Open AI Assistant');
    this.trigger.innerHTML = `${TRIGGER_SVG}<span>W.A.V.E.</span>`;
    this.trigger.addEventListener('click', () => this.toggle());

    // Backdrop
    this.backdrop = document.createElement('div');
    this.backdrop.className = 'wc-ai-backdrop';
    this.backdrop.addEventListener('click', () => this.close());
    document.body.appendChild(this.backdrop);

    // Sidebar shell
    this.side = document.createElement('div');
    this.side.className = 'wc-ai-side';
    this.side.setAttribute('role', 'dialog');
    this.side.setAttribute('aria-label', 'AI Assistant');
    this.side.setAttribute('aria-hidden', 'true');
    this.side.innerHTML = `
      <aside class="wc-ai-rail" data-rail>
        <div class="wc-ai-rail-head">
          <span class="wc-ai-rail-title">Research</span>
          <button class="new-chat" data-action="new-chat" title="Start a new research chat">${ICONS.plus}<span>New</span></button>
          <button class="rail-close" data-action="close-rail" title="Close" aria-label="Close chats">${ICONS.close}</button>
        </div>
        <div class="wc-ai-rail-list" data-rail-list></div>
      </aside>
      <div class="wc-ai-main">
        <div class="wc-ai-rail-scrim" data-rail-scrim></div>
        <div class="wc-ai-head">
          <button class="wc-ai-iconbtn" data-action="toggle-rail" title="Chat history" aria-label="Chat history">${ICONS.history}</button>
          <div class="wc-ai-head-title">
            <span class="wc-ai-dot" data-status></span>
            <span class="wc-ai-head-brand">W.A.V.E.</span>
            <span class="wc-ai-head-thread" data-thread-title>AI Assistant</span>
          </div>
          <button class="wc-ai-iconbtn" data-action="new-chat" title="New chat" aria-label="New chat">${ICONS.plus}</button>
          <button class="wc-ai-iconbtn" data-action="clear" title="Clear this chat" aria-label="Clear">${ICONS.refresh}</button>
          <button class="wc-ai-iconbtn" data-action="close" title="Close" aria-label="Close">${ICONS.close}</button>
        </div>
        <div class="wc-ai-sub">
          <div class="wc-ai-model-wrap" data-model-wrap>
            <button class="wc-ai-model-trigger" data-action="toggle-model" type="button" aria-haspopup="listbox" aria-expanded="false">
              <span class="model-ico">${ICONS.model}</span>
              <span class="model-name" data-model-name>Model</span>
              <span class="model-chevron">${ICONS.chevron}</span>
            </button>
            <div class="wc-ai-model-menu" data-model-menu role="listbox" aria-label="Model"></div>
          </div>
          <select class="wc-ai-select" data-model aria-label="Model"></select>
          <div class="wc-ai-modes" data-modes role="tablist" aria-label="Response mode"></div>
        </div>
        <div class="wc-ai-body" data-body></div>
        <div class="wc-ai-foot" data-foot></div>
        <div class="wc-ai-hint">
          <span>Enter to send · Shift+Enter newline</span>
          <span data-msg-count></span>
        </div>
      </div>
    `;
    document.body.appendChild(this.side);

    this.bodyEl = this.side.querySelector<HTMLDivElement>('[data-body]')!;
    this.railList = this.side.querySelector<HTMLDivElement>('[data-rail-list]')!;
    this.modeBar = this.side.querySelector<HTMLDivElement>('[data-modes]')!;
    this.modelWrap = this.side.querySelector<HTMLDivElement>('[data-model-wrap]')!;
    this.modelTrigger = this.side.querySelector<HTMLButtonElement>('[data-action="toggle-model"]')!;
    this.modelMenu = this.side.querySelector<HTMLDivElement>('[data-model-menu]')!;
    // Delegated handler: chips inserted by md() in any rendered assistant message.
    this.bodyEl.addEventListener('click', (ev) => {
      const target = (ev.target as HTMLElement | null)?.closest('[data-panel-link]') as HTMLButtonElement | null;
      if (!target) return;
      const id = target.getAttribute('data-panel-link');
      if (!id) return;
      this.openPanel(id, target);
    });
    this.statusDot = this.side.querySelector<HTMLSpanElement>('[data-status]')!;
    this.modelSelect = this.side.querySelector<HTMLSelectElement>('[data-model]')!;
    for (const m of MODELS) {
      const opt = document.createElement('option');
      opt.value = m.id; opt.textContent = m.label;
      if (m.id === this.model) opt.selected = true;
      this.modelSelect.appendChild(opt);
    }
    this.renderModelMenu();
    this.modelSelect.addEventListener('change', () => {
      this.model = this.modelSelect.value;
      try { localStorage.setItem(MODEL_KEY, this.model); } catch { /* ignore */ }
      const t = this.active();
      if (t) { t.model = this.model; this.persist(); }
      this.renderModelMenu();
    });

    // Mode segmented control
    for (const mo of MODES) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = mo.label;
      b.title = mo.hint;
      b.setAttribute('data-mode', mo.id);
      b.setAttribute('role', 'tab');
      b.addEventListener('click', () => this.setMode(mo.id));
      this.modeBar.appendChild(b);
    }

    // Delegated chrome actions (multiple buttons share data-action values).
    this.side.addEventListener('click', (ev) => {
      const btn = (ev.target as HTMLElement | null)?.closest('[data-action]') as HTMLElement | null;
      if (!btn || !this.side.contains(btn)) return;
      const action = btn.getAttribute('data-action');
      switch (action) {
        case 'close': this.close(); break;
        case 'clear': this.clear(); break;
        case 'toggle-model':
          this.toggleModelMenu();
          break;
        case 'new-chat':
          this.newChat();
          this.side.classList.remove('rail-open');
          this.closeModelMenu();
          break;
        case 'toggle-rail':
          this.side.classList.toggle('rail-open');
          this.closeModelMenu();
          break;
        case 'close-rail':
          this.side.classList.remove('rail-open');
          break;
      }
    });
    this.modelMenu.addEventListener('click', (ev) => {
      const opt = (ev.target as HTMLElement | null)?.closest('[data-model-id]') as HTMLButtonElement | null;
      if (!opt) return;
      this.setModel(opt.getAttribute('data-model-id') || DEFAULT_MODEL);
      this.closeModelMenu();
    });
    document.addEventListener('click', (ev) => {
      if (!this.isOpen) return;
      const target = ev.target as Node | null;
      if (target && !this.modelWrap.contains(target)) this.closeModelMenu();
    });
    // Tapping the scrim closes the rail drawer.
    this.side.querySelector('[data-rail-scrim]')!.addEventListener('click', () => {
      this.side.classList.remove('rail-open');
    });

    // Rail delegate: select / delete
    this.railList.addEventListener('click', (ev) => {
      const target = ev.target as HTMLElement;
      const del = target.closest('[data-thread-del]') as HTMLElement | null;
      if (del) {
        ev.stopPropagation();
        const id = del.getAttribute('data-thread-del');
        if (id) this.deleteThread(id);
        return;
      }
      const ren = target.closest('[data-thread-rename]') as HTMLElement | null;
      if (ren) {
        ev.stopPropagation();
        const id = ren.getAttribute('data-thread-rename');
        if (id) this.renameThread(id);
        return;
      }
      const item = target.closest('[data-thread-id]') as HTMLElement | null;
      if (!item) return;
      const id = item.getAttribute('data-thread-id');
      if (id && id !== this.activeId) this.selectThread(id);
      // Auto-close the drawer on mobile after picking a thread.
      this.side.classList.remove('rail-open');
    });
    this.railList.addEventListener('dblclick', (ev) => {
      const item = (ev.target as HTMLElement).closest('[data-thread-id]') as HTMLElement | null;
      if (!item) return;
      const id = item.getAttribute('data-thread-id');
      if (id) this.renameThread(id);
    });

    // ESC to close
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.isOpen) this.close();
    });

    // Try mounting into header now and on later re-renders
    this.mountTrigger();
    const mountInterval = window.setInterval(() => this.mountTrigger(), 1000);
    window.setTimeout(() => window.clearInterval(mountInterval), 15000);

    subscribeClerk(() => { if (this.isOpen) this.render(); });
    subscribeClerk(() => { void this.syncFromCloud(); });
    void this.syncFromCloud();
  }

  private async syncFromCloud(): Promise<void> {
    const user = getCurrentClerkUser();
    if (!user) { this.syncedUserId = null; return; }
    if (this.syncedUserId === user.id) return;
    this.syncedUserId = user.id;
    const remote = await fetchRemoteThreads(user.id);
    if (!remote.length) {
      for (const t of this.threads) {
        if (t.messages.length) this.queueSync(t.id);
      }
      return;
    }
    const byId = new Map(this.threads.map(t => [t.id, t]));
    for (const r of remote) {
      const rUpdated = new Date(r.updated_at).getTime();
      const local = byId.get(r.id);
      const msgs = Array.isArray(r.messages)
        ? ((r.messages as unknown[]).filter(isValidMessage).slice(-80) as ChatMessage[])
        : [];
      const mode = (['latest', 'summary', 'deep'].includes(r.mode) ? r.mode : DEFAULT_MODE) as AssistantMode;
      const model = MODELS.some(m => m.id === r.model) ? r.model : DEFAULT_MODEL;
      if (!local || rUpdated > local.updatedAt) {
        const merged: ChatThread = {
          id: r.id, title: r.title || 'New research',
          createdAt: new Date(r.created_at).getTime(),
          updatedAt: rUpdated, mode, model, messages: msgs,
        };
        if (local) Object.assign(local, merged);
        else this.threads.push(merged);
      }
    }
    this.threads.sort((a, b) => b.updatedAt - a.updatedAt);
    saveThreads(this.threads);
    if (this.isOpen) this.render();
  }

  private queueSync(threadId: string): void {
    const user = getCurrentClerkUser();
    if (!user) return;
    this.pendingSync.set(threadId, Date.now());
    if (this.syncTimer != null) return;
    this.syncTimer = window.setTimeout(() => {
      this.syncTimer = null;
      const u = getCurrentClerkUser();
      if (!u) { this.pendingSync.clear(); return; }
      const ids = Array.from(this.pendingSync.keys());
      this.pendingSync.clear();
      for (const id of ids) {
        const t = this.threads.find(x => x.id === id);
        if (t) void upsertRemoteThread(u.id, t);
      }
    }, 600);
  }

  private renameThread(id: string): void {
    const t = this.threads.find(x => x.id === id);
    if (!t) return;
    const next = window.prompt('Rename research chat', t.title);
    if (next == null) return;
    const title = next.trim().slice(0, 80);
    if (!title || title === t.title) return;
    t.title = title;
    t.updatedAt = Date.now();
    saveThreads(this.threads);
    this.queueSync(t.id);
    this.render();
  }

  /* ──────────  thread helpers  ────────── */

  private createBlankThread(): ChatThread {
    return {
      id: genId(),
      title: 'New research',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      mode: this.mode,
      model: this.model,
      messages: [],
    };
  }

  private active(): ChatThread | undefined {
    return this.threads.find(t => t.id === this.activeId);
  }

  private get messages(): ChatMessage[] {
    return this.active()?.messages ?? [];
  }

  private persist(): void {
    const t = this.active();
    if (t) t.updatedAt = Date.now();
    // Most-recently-updated first.
    this.threads.sort((a, b) => b.updatedAt - a.updatedAt);
    saveThreads(this.threads);
    saveActiveId(this.activeId);
    if (t) this.queueSync(t.id);
  }

  private newChat(): void {
    this.abort?.abort();
    this.abort = null;
    this.streaming = false;
    const t = this.createBlankThread();
    this.threads.unshift(t);
    this.activeId = t.id;
    this.persist();
    this.render();
  }

  private selectThread(id: string): void {
    if (this.streaming) { this.abort?.abort(); }
    this.activeId = id;
    const t = this.active();
    if (t) {
      this.mode = t.mode;
      this.model = t.model;
      this.modelSelect.value = this.model;
    }
    saveActiveId(this.activeId);
    this.render();
  }

  private deleteThread(id: string): void {
    const idx = this.threads.findIndex(t => t.id === id);
    if (idx < 0) return;
    this.threads.splice(idx, 1);
    const user = getCurrentClerkUser();
    if (user) void deleteRemoteThread(user.id, id);
    if (this.activeId === id) {
      if (this.threads.length === 0) {
        const t = this.createBlankThread();
        this.threads.push(t);
        this.activeId = t.id;
      } else {
        this.activeId = this.threads[0]!.id;
      }
    }
    this.persist();
    this.render();
  }

  private setMode(m: AssistantMode): void {
    this.mode = m;
    try { localStorage.setItem(MODE_KEY, m); } catch { /* ignore */ }
    const t = this.active();
    if (t) { t.mode = m; this.persist(); }
    this.renderModes();
  }

  /* ──────────  lifecycle  ────────── */

  private mountTrigger(): void {
    const mount = document.getElementById('aiAssistantMount');
    if (!mount) return;
    if (this.trigger.parentElement === mount) return;
    mount.innerHTML = '';
    mount.appendChild(this.trigger);
  }

  private toggle(): void {
    if (this.isOpen) this.close(); else this.open();
  }

  private open(): void {
    this.isOpen = true;
    // Rail starts closed on tablet/mobile so the chat surface is visible first.
    this.side.classList.remove('rail-open');
    this.side.classList.add('is-open');
    this.backdrop.classList.add('is-open');
    this.side.setAttribute('aria-hidden', 'false');
    this.trigger.classList.add('is-open');
    this.render();
  }

  private close(): void {
    this.isOpen = false;
    this.side.classList.remove('is-open');
    this.side.classList.remove('rail-open');
    this.closeModelMenu();
    this.backdrop.classList.remove('is-open');
    this.side.setAttribute('aria-hidden', 'true');
    this.trigger.classList.remove('is-open');
  }

  private clear(): void {
    this.abort?.abort();
    this.abort = null;
    this.streaming = false;
    const t = this.active();
    if (t) { t.messages = []; t.title = 'New research'; this.persist(); }
    this.render();
  }

  /* ──────────  panel-chip navigation  ────────── */

  private findPanel(panelId: string): HTMLElement | null {
    const direct = document.querySelector(`[data-panel="${panelId}"]`) as HTMLElement | null;
    if (direct) return direct;
    // Try common id / aria-label / class fallbacks so chips work across panels.
    const byId = document.getElementById(panelId) as HTMLElement | null;
    if (byId) return byId;
    const byAria = document.querySelector(`[aria-label*="${panelId}" i]`) as HTMLElement | null;
    if (byAria) return byAria;
    const byClass = document.querySelector(`.panel-${panelId}, .${panelId}-panel`) as HTMLElement | null;
    return byClass;
  }

  private expandCollapsedAncestors(el: HTMLElement): void {
    let cur: HTMLElement | null = el;
    while (cur && cur !== document.body) {
      // <details> elements
      if (cur.tagName === 'DETAILS') (cur as HTMLDetailsElement).open = true;
      // aria-expanded toggles (click the controlling button if collapsed)
      if (cur.getAttribute('aria-expanded') === 'false') {
        const id = cur.id;
        if (id) {
          const ctrl = document.querySelector(`[aria-controls="${id}"]`) as HTMLElement | null;
          if (ctrl) ctrl.click();
        }
      }
      // hidden attribute / display:none collapsed parents
      if (cur.hasAttribute('hidden')) cur.removeAttribute('hidden');
      cur = cur.parentElement;
    }
    // Also click the panel's own collapse toggle if it indicates collapsed.
    const ownToggle = el.querySelector('[data-panel-toggle][aria-expanded="false"], .panel-collapse[aria-expanded="false"]') as HTMLElement | null;
    if (ownToggle) ownToggle.click();
  }

  private openPanel(panelId: string, chip?: HTMLButtonElement): void {
    const el = this.findPanel(panelId);
    if (chip) {
      chip.classList.remove('is-done', 'is-miss');
      chip.classList.add('is-targeting');
    }
    if (!el) {
      if (chip) {
        chip.classList.remove('is-targeting');
        chip.classList.add('is-miss');
        chip.title = `Panel "${panelId}" not found on this page`;
      }
      return;
    }
    this.expandCollapsedAncestors(el);
    this.close();
    setTimeout(() => {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.classList.remove('search-highlight');
      void el.offsetWidth;
      el.classList.add('search-highlight');
      setTimeout(() => el.classList.remove('search-highlight'), 3100);
      if (chip) {
        chip.classList.remove('is-targeting');
        chip.classList.add('is-done');
        setTimeout(() => chip.classList.remove('is-done'), 2400);
      }
    }, 280);
  }

  /* ──────────  rendering  ────────── */

  private render(): void {
    this.renderRail();
    this.renderModes();
    this.renderModelMenu();
    this.renderTitle();
    this.renderBody();
  }

  private renderTitle(): void {
    const t = this.active();
    const titleEl = this.side.querySelector<HTMLSpanElement>('[data-thread-title]');
    if (titleEl) {
      titleEl.textContent = t && t.messages.length ? `W.A.V.E. · ${t.title}` : 'W.A.V.E. · AI Assistant';
    }
  }

  private renderModes(): void {
    this.modeBar.querySelectorAll('button').forEach(b => {
      const m = b.getAttribute('data-mode');
      b.classList.toggle('is-active', m === this.mode);
      b.setAttribute('aria-selected', String(m === this.mode));
    });
  }

  private renderModelMenu(): void {
    const nameEl = this.side.querySelector<HTMLSpanElement>('[data-model-name]');
    if (nameEl) nameEl.textContent = modelLabel(this.model);
    this.modelTrigger.setAttribute('aria-label', `Model: ${modelLabel(this.model)}`);
    this.modelMenu.innerHTML = '';
    for (const m of MODELS) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'wc-ai-model-option' + (m.id === this.model ? ' is-active' : '');
      b.setAttribute('data-model-id', m.id);
      b.setAttribute('role', 'option');
      b.setAttribute('aria-selected', String(m.id === this.model));
      b.innerHTML = `<span class="check">${m.id === this.model ? '✓' : ''}</span><span><span class="m-label">${esc(m.label)}</span><span class="m-hint">${esc(modelHint(m.id))}</span></span>`;
      this.modelMenu.appendChild(b);
    }
  }

  private toggleModelMenu(): void {
    const open = !this.modelWrap.classList.contains('is-open');
    this.modelWrap.classList.toggle('is-open', open);
    this.modelTrigger.setAttribute('aria-expanded', String(open));
  }

  private closeModelMenu(): void {
    if (!this.modelWrap) return;
    this.modelWrap.classList.remove('is-open');
    this.modelTrigger?.setAttribute('aria-expanded', 'false');
  }

  private setModel(model: string): void {
    if (!MODELS.some(m => m.id === model)) return;
    this.model = model;
    this.modelSelect.value = model;
    try { localStorage.setItem(MODEL_KEY, this.model); } catch { /* ignore */ }
    const t = this.active();
    if (t) { t.model = this.model; this.persist(); }
    this.renderModelMenu();
  }

  private renderRail(): void {
    const list = this.railList;
    list.innerHTML = '';
    if (this.threads.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'wc-ai-rail-empty';
      empty.textContent = 'No research yet. Start a new chat to begin.';
      list.appendChild(empty);
      return;
    }
    for (const t of this.threads) {
      const row = document.createElement('div');
      row.className = 'wc-ai-thread' + (t.id === this.activeId ? ' is-active' : '');
      row.setAttribute('data-thread-id', t.id);
      row.title = t.title;
      row.innerHTML = `
        <span class="t-title">${esc(t.title)}</span>
        <span class="t-meta">${timeAgo(t.updatedAt)}</span>
        <button class="t-act" data-thread-rename="${t.id}" title="Rename" aria-label="Rename">${ICONS.edit}</button>
        <button class="t-act del" data-thread-del="${t.id}" title="Delete" aria-label="Delete">${ICONS.trash}</button>
      `;
      list.appendChild(row);
    }
  }

  private renderBody(): void {
    const body = this.bodyEl;
    const foot = this.side.querySelector<HTMLDivElement>('[data-foot]')!;
    const counter = this.side.querySelector<HTMLSpanElement>('[data-msg-count]')!;
    const msgs = this.messages;
    counter.textContent = msgs.length ? `${msgs.length} msg${msgs.length > 1 ? 's' : ''} · ${this.mode}` : `mode: ${this.mode}`;
    this.statusDot.classList.toggle('busy', this.streaming);

    const user = getCurrentClerkUser();
    if (!user) {
      body.innerHTML = '';
      foot.innerHTML = '';
      const gate = document.createElement('div');
      gate.className = 'wc-ai-gate';
      gate.innerHTML = `
        <div class="glyph">✦</div>
        <h3>Sign in to W.A.V.E.</h3>
        <p>The Worldcave AI assistant is available to signed-in users. Sign in to access daily briefs, market pulse, threat scans, and live context-aware analysis.</p>
      `;
      const btn = document.createElement('button');
      btn.textContent = 'Sign in to continue';
      btn.addEventListener('click', () => openSignIn());
      gate.appendChild(btn);
      body.appendChild(gate);
      return;
    }

    body.innerHTML = '';
    if (msgs.length === 0) {
      const intro = document.createElement('div');
      intro.className = 'wc-ai-msg assistant';
      const firstName = (user.name?.split(' ')[0] || 'analyst').replace(/[<>&]/g, '');
      intro.innerHTML = md(
        `Online, **${firstName}**. I'm W.A.V.E. — your Worldcave intelligence co-pilot.\n\n` +
        `This is a fresh research session. Reply mode is **${this.mode.toUpperCase()}** — change it in the bar above any time.\n\n` +
        `I can brief you on world events, decode market moves, scan threats, and explain what you're looking at. ` +
        `Pick a quick action or ask anything.`
      );
      body.appendChild(intro);

      const actions = document.createElement('div');
      actions.className = 'wc-ai-actions';
      actions.style.padding = '4px 0 0';
      QUICK_ACTIONS.forEach(qa => {
        const b = document.createElement('button');
        b.innerHTML = `<span class="qa-icon">${qa.icon}</span><span>${qa.label}</span>`;
        b.addEventListener('click', () => this.send(qa.prompt));
        actions.appendChild(b);
      });
      body.appendChild(actions);
    } else {
      for (const m of msgs) {
        const el = document.createElement('div');
        el.className = `wc-ai-msg ${m.role}`;
        if (m.role === 'assistant') {
          el.innerHTML = md(m.content || '<span class="wc-ai-typing"></span>');
          const copy = document.createElement('button');
          copy.className = 'copy-btn';
          copy.type = 'button';
          copy.textContent = 'copy';
          copy.addEventListener('click', async (e) => {
            e.stopPropagation();
            try { await navigator.clipboard.writeText(m.content); copy.textContent = 'copied'; setTimeout(() => copy.textContent = 'copy', 1200); } catch { /* ignore */ }
          });
          el.appendChild(copy);
        } else {
          el.textContent = m.content;
        }
        body.appendChild(el);
      }
    }
    body.scrollTop = body.scrollHeight;

    // Composer
    foot.innerHTML = '';
    const ta = document.createElement('textarea');
    ta.placeholder = this.mode === 'deep'
      ? 'Deep research mode — ask a research question…'
      : this.mode === 'latest'
        ? 'Latest-only mode — ask about live dashboard data…'
        : 'Ask W.A.V.E. anything…';
    ta.rows = 1;
    ta.addEventListener('input', () => {
      ta.style.height = 'auto';
      ta.style.height = Math.min(ta.scrollHeight, 140) + 'px';
    });
    const sendBtn = document.createElement('button');
    sendBtn.className = 'send-btn';
    sendBtn.title = 'Send';
    sendBtn.setAttribute('aria-label', 'Send');
    sendBtn.innerHTML = ICONS.send;
    const stopBtn = document.createElement('button');
    stopBtn.className = 'stop-btn';
    stopBtn.innerHTML = `${ICONS.stop}<span>Stop</span>`;

    const submit = () => {
      const txt = ta.value.trim();
      if (!txt || this.streaming) return;
      ta.value = '';
      ta.style.height = 'auto';
      this.send(txt);
    };
    sendBtn.addEventListener('click', submit);
    stopBtn.addEventListener('click', () => { this.abort?.abort(); });
    ta.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); }
    });
    foot.appendChild(ta);
    if (this.streaming) {
      sendBtn.disabled = true;
      foot.appendChild(stopBtn);
    } else {
      foot.appendChild(sendBtn);
    }
    setTimeout(() => ta.focus(), 0);
  }

  private async send(text: string): Promise<void> {
    const t = this.active();
    if (!t) return;
    t.messages.push({ role: 'user', content: text });
    t.messages.push({ role: 'assistant', content: '' });
    if (t.messages.filter(m => m.role === 'user').length === 1) {
      t.title = deriveTitle(t.messages);
    }
    this.streaming = true;
    this.persist();
    this.render();

    const assistantIdx = t.messages.length - 1;
    this.abort = new AbortController();

    try {
      const res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(ANON_KEY ? { 'apikey': ANON_KEY, 'Authorization': `Bearer ${ANON_KEY}` } : {}),
        },
        body: JSON.stringify({
          messages: t.messages.slice(0, -1).map(m => ({ role: m.role, content: m.content })),
          model: this.model,
          mode: this.mode,
          context: { ...getContext(), liveData: buildLiveSnapshot() },
        }),
        signal: this.abort.signal,
      });

      if (!res.ok) {
        let msg = `Request failed (${res.status})`;
        try { const j = await res.json(); if (j?.error) msg = j.error; } catch { /* ignore */ }
        t.messages[assistantIdx] = { role: 'assistant', content: `_${msg}_` };
        this.streaming = false;
        this.persist();
        this.render();
        return;
      }

      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      let acc = '';
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop() ?? '';
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data:')) continue;
          const data = trimmed.slice(5).trim();
          if (data === '[DONE]') continue;
          try {
            const chunk = JSON.parse(data);
            const delta = chunk?.choices?.[0]?.delta?.content;
            if (typeof delta === 'string') {
              acc += delta;
              t.messages[assistantIdx] = { role: 'assistant', content: acc };
              const last = this.bodyEl.querySelectorAll('.wc-ai-msg.assistant');
              const el = last[last.length - 1] as HTMLDivElement | undefined;
              if (el) {
                el.innerHTML = md(acc);
                this.bodyEl.scrollTop = this.bodyEl.scrollHeight;
              }
            }
          } catch { /* ignore parse */ }
        }
      }
      if (!acc) t.messages[assistantIdx] = { role: 'assistant', content: '_No response from assistant._' };
    } catch (err) {
      const prev = t.messages[assistantIdx]?.content ?? '';
      if ((err as Error)?.name === 'AbortError') {
        t.messages[assistantIdx] = { role: 'assistant', content: prev + '\n\n_Stopped._' };
      } else {
        t.messages[assistantIdx] = { role: 'assistant', content: `_Connection error: ${(err as Error).message}_` };
      }
    } finally {
      this.streaming = false;
      this.abort = null;
      this.persist();
      this.render();
    }
  }
}

let widget: AiAssistantWidget | null = null;
export function initAiAssistantWidget(): void {
  if (widget || typeof document === 'undefined') return;
  widget = new AiAssistantWidget();
}
