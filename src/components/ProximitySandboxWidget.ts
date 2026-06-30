// Reactive Proximity Alarm Sandbox — header trigger + slide-in sidebar.
// Sign-in gated (Clerk). Coordinates stay client-side unless the user opts in
// to cloud sync (metadata always, coords only when toggle is on).

import { getCurrentClerkUser, subscribeClerk, openSignIn } from '@/services/clerk';
import {
  getProximityEngine, type ProximityAssetSet,
  type ProximityAlert, type ProximityPrefs, type ThreatCategory,
  type ProximityHistoryEvent,
  pushCloudPrefs, pullCloudPrefs, pushCloudSet, deleteCloudSet, pullCloudSets,
  parseProximityImport, setToGeoJSON, allSetsToGeoJSON,
} from '@/services/proximity-engine';

const CATEGORY_LABEL: Record<ThreatCategory, string> = {
  conflicts: 'Conflicts', hotspots: 'Hotspots', natural: 'Natural disasters',
  outages: 'Internet outages', sanctions: 'Sanctions', iranAttacks: 'Iran/Israel',
  weather: 'Severe weather', earthquakes: 'Earthquakes', military: 'Military movement',
  cyber: 'Cyber threats', other: 'Other',
};
const SEVERITY_COLOR: Record<string, string> = { low: '#3b82f6', medium: '#f59e0b', high: '#ef4444', critical: '#dc2626' };

const STYLE_ID = 'wm-rpas-styles';
const CSS = `
.wc-px-btn{position:relative;display:inline-flex;align-items:center;justify-content:center;
  width:32px;height:32px;background:transparent;color:var(--text-secondary,#ccc);
  border:1px solid transparent;border-radius:8px;cursor:pointer;margin:0 2px;}
.wc-px-btn:hover{background:var(--surface-hover,#1e1e1e);color:var(--accent,#fff);border-color:var(--border,#2a2a2a);}
.wc-px-btn.has-alerts{color:#fca5a5;}
.wc-px-badge{position:absolute;top:-3px;right:-3px;min-width:16px;height:16px;padding:0 4px;
  background:#ef4444;color:#fff;border-radius:999px;font:700 10px/16px system-ui,sans-serif;
  text-align:center;border:2px solid var(--bg,#0a0a0a);}
.wc-px-btn.pulse{animation:wc-px-pulse 1.4s ease-out infinite;}
@keyframes wc-px-pulse{0%{box-shadow:0 0 0 0 rgba(239,68,68,.45)}70%{box-shadow:0 0 0 8px rgba(239,68,68,0)}100%{box-shadow:0 0 0 0 rgba(239,68,68,0)}}

.wc-px-backdrop{position:fixed;inset:0;background:rgba(0,0,0,.45);backdrop-filter:blur(2px);
  z-index:1199;opacity:0;pointer-events:none;transition:opacity .22s ease;}
.wc-px-backdrop.open{opacity:1;pointer-events:auto;}

.wc-px-side{position:fixed;top:var(--wm-chrome-top,56px);right:0;bottom:0;
  width:min(440px,100vw);background:var(--bg,#0a0a0a);color:var(--text,#e8e8e8);
  border-left:1px solid var(--border,#2a2a2a);z-index:1200;display:flex;flex-direction:column;
  transform:translateX(100%);transition:transform .25s cubic-bezier(.25,.8,.3,1);
  box-shadow:-12px 0 32px rgba(0,0,0,.4);font:14px/1.5 system-ui,sans-serif;}
.wc-px-side.open{transform:translateX(0);}
@media (max-width:720px){.wc-px-side{width:100vw;}}

.wc-px-head{display:flex;align-items:center;gap:8px;padding:12px 14px;border-bottom:1px solid var(--border,#2a2a2a);
  background:color-mix(in srgb,var(--bg,#0a0a0a) 88%,var(--surface,#141414));}
.wc-px-head .title{flex:1;font:800 12px/1 inherit;letter-spacing:.12em;text-transform:uppercase;}
.wc-px-head .sub{font:500 11px/1 inherit;color:var(--text-muted,#888);margin-top:4px;}
.wc-px-head .close{display:inline-flex;align-items:center;justify-content:center;width:30px;height:30px;
  background:transparent;color:var(--text-secondary,#ccc);border:1px solid transparent;border-radius:6px;cursor:pointer;}
.wc-px-head .close:hover{background:var(--surface-hover,#1e1e1e);color:var(--accent,#fff);}

.wc-px-tabs{display:flex;gap:0;padding:0 10px;border-bottom:1px solid var(--border-subtle,#1a1a1a);background:var(--bg-secondary,#111);}
.wc-px-tabs button{flex:1;background:transparent;border:none;color:var(--text-muted,#888);cursor:pointer;
  padding:10px 6px;font:700 11px/1 inherit;letter-spacing:.08em;text-transform:uppercase;border-bottom:2px solid transparent;}
.wc-px-tabs button:hover{color:var(--text,#e8e8e8);}
.wc-px-tabs button.is-active{color:var(--accent,#fff);border-bottom-color:var(--semantic-info,#3b82f6);}
.wc-px-tabs .ct{display:inline-block;min-width:18px;padding:0 5px;margin-left:6px;
  background:var(--surface-active,#1a1a2e);color:var(--accent,#fff);border-radius:999px;font-size:10px;line-height:16px;}

.wc-px-body{flex:1;overflow-y:auto;padding:14px;display:flex;flex-direction:column;gap:12px;}
.wc-px-body::-webkit-scrollbar{width:6px}.wc-px-body::-webkit-scrollbar-thumb{background:var(--border,#2a2a2a);border-radius:3px}

.wc-px-set{border:1px solid var(--border,#2a2a2a);border-radius:10px;background:var(--surface,#141414);overflow:hidden;}
.wc-px-set-head{display:flex;align-items:center;gap:8px;padding:9px 11px;background:var(--bg-secondary,#111);}
.wc-px-set-head .swatch{width:10px;height:10px;border-radius:50%;flex:0 0 auto;}
.wc-px-set-head .name{flex:1;font:700 12.5px/1.2 inherit;background:transparent;border:none;color:var(--text,#e8e8e8);outline:none;padding:2px 4px;border-radius:4px;}
.wc-px-set-head .name:focus{background:var(--surface-active,#1a1a2e);}
.wc-px-set-head .iconbtn{display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;
  background:transparent;color:var(--text-muted,#888);border:none;border-radius:5px;cursor:pointer;}
.wc-px-set-head .iconbtn:hover{background:var(--surface-hover,#1e1e1e);color:var(--accent,#fff);}
.wc-px-set-head .iconbtn.del:hover{color:#ef4444;background:rgba(239,68,68,.1);}
.wc-px-set-meta{display:flex;align-items:center;gap:10px;padding:7px 11px;font-size:11.5px;color:var(--text-muted,#888);border-top:1px solid var(--border-subtle,#1a1a1a);}
.wc-px-set-meta label{display:flex;align-items:center;gap:5px;}
.wc-px-set-meta input[type="number"]{width:60px;background:var(--bg,#0a0a0a);color:var(--text,#e8e8e8);border:1px solid var(--border,#2a2a2a);border-radius:4px;padding:3px 5px;font:inherit;font-size:11.5px;}

.wc-px-emptybox{padding:24px 14px;text-align:center;color:var(--text-muted,#888);border:1px dashed var(--border,#2a2a2a);border-radius:10px;line-height:1.5;font-size:12.5px;}
.wc-px-emptybox b{display:block;color:var(--text,#e8e8e8);margin-bottom:6px;letter-spacing:.04em;}

.wc-px-btn-primary{display:inline-flex;align-items:center;justify-content:center;gap:6px;
  background:var(--accent,#fff);color:var(--bg,#0a0a0a);border:none;border-radius:8px;
  padding:9px 14px;font:700 12px/1 inherit;letter-spacing:.04em;cursor:pointer;}
.wc-px-btn-primary:hover{filter:brightness(.92);}
.wc-px-btn-ghost{display:inline-flex;align-items:center;justify-content:center;gap:6px;
  background:transparent;color:var(--text-secondary,#ccc);border:1px solid var(--border,#2a2a2a);border-radius:8px;
  padding:8px 12px;font:600 11.5px/1 inherit;cursor:pointer;}
.wc-px-btn-ghost:hover{background:var(--surface-hover,#1e1e1e);color:var(--accent,#fff);}
.wc-px-actions{display:flex;flex-wrap:wrap;gap:8px;}

.wc-px-alert{display:flex;flex-direction:column;gap:4px;padding:10px 12px;border-radius:10px;
  background:var(--surface,#141414);border:1px solid var(--border,#2a2a2a);border-left:3px solid #3b82f6;cursor:pointer;}
.wc-px-alert:hover{background:var(--surface-hover,#1e1e1e);}
.wc-px-alert .row1{display:flex;align-items:center;gap:8px;}
.wc-px-alert .dot{width:8px;height:8px;border-radius:50%;flex:0 0 auto;animation:wc-px-pulse 1.4s ease-out infinite;}
.wc-px-alert .ttl{flex:1;min-width:0;font:600 12.5px/1.3 inherit;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.wc-px-alert .km{font:700 11px/1 inherit;color:var(--accent,#fff);}
.wc-px-alert .row2{font-size:11px;color:var(--text-muted,#888);display:flex;gap:8px;flex-wrap:wrap;}
.wc-px-alert.sev-critical{border-left-color:#dc2626;}
.wc-px-alert.sev-high{border-left-color:#ef4444;}
.wc-px-alert.sev-medium{border-left-color:#f59e0b;}
.wc-px-alert.sev-low{border-left-color:#3b82f6;}

.wc-px-pref{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:10px 12px;
  background:var(--surface,#141414);border:1px solid var(--border,#2a2a2a);border-radius:10px;}
.wc-px-pref .lbl{font:600 12px/1.3 inherit;}
.wc-px-pref .hint{font-size:11px;color:var(--text-muted,#888);margin-top:2px;}
.wc-px-pref input[type="number"],.wc-px-pref select{background:var(--bg,#0a0a0a);color:var(--text,#e8e8e8);
  border:1px solid var(--border,#2a2a2a);border-radius:6px;padding:5px 8px;font:inherit;font-size:12px;}
.wc-px-cats{display:grid;grid-template-columns:1fr 1fr;gap:5px 10px;padding:10px 12px;
  background:var(--surface,#141414);border:1px solid var(--border,#2a2a2a);border-radius:10px;}
.wc-px-cats label{display:flex;align-items:center;gap:6px;font-size:12px;cursor:pointer;color:var(--text-secondary,#ccc);}

.wc-px-gate{display:flex;flex-direction:column;align-items:center;justify-content:center;flex:1;padding:32px;text-align:center;gap:14px;}
.wc-px-gate h3{margin:0;font:700 13px/1.3 inherit;letter-spacing:.06em;text-transform:uppercase;}
.wc-px-gate p{margin:0;color:var(--text-muted,#888);font-size:12.5px;max-width:300px;line-height:1.55;}

.wc-px-import{display:flex;flex-direction:column;gap:8px;padding:12px;border:1px solid var(--border,#2a2a2a);border-radius:10px;background:var(--surface,#141414);}
.wc-px-import textarea{width:100%;min-height:120px;max-height:240px;background:var(--bg,#0a0a0a);color:var(--text,#e8e8e8);
  border:1px solid var(--border,#2a2a2a);border-radius:8px;padding:8px;font:12px/1.45 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;resize:vertical;}
.wc-px-import .err{color:#fca5a5;font-size:11.5px;}
.wc-px-import .hint{color:var(--text-muted,#888);font-size:11.5px;line-height:1.5;}

.wc-px-hist{display:flex;flex-direction:column;gap:6px;}
.wc-px-hist-day{font:700 10.5px/1 inherit;letter-spacing:.1em;text-transform:uppercase;color:var(--text-muted,#888);
  padding:8px 2px 4px;border-bottom:1px solid var(--border-subtle,#1a1a1a);margin-top:4px;}
.wc-px-hist-row{display:flex;align-items:flex-start;gap:8px;padding:7px 10px;border:1px solid var(--border-subtle,#1a1a1a);border-radius:8px;background:var(--surface,#141414);}
.wc-px-hist-row .chip{flex:0 0 auto;font:700 9.5px/1 inherit;letter-spacing:.08em;text-transform:uppercase;padding:3px 6px;border-radius:4px;}
.wc-px-hist-row .chip.entered{background:rgba(239,68,68,.18);color:#fca5a5;}
.wc-px-hist-row .chip.left{background:rgba(34,197,94,.16);color:#86efac;}
.wc-px-hist-row .body{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px;font-size:12px;}
.wc-px-hist-row .ttl{font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.wc-px-hist-row .meta{color:var(--text-muted,#888);font-size:11px;display:flex;gap:6px;flex-wrap:wrap;}
.wc-px-hist-row .sev{width:6px;height:6px;border-radius:50%;display:inline-block;margin-right:4px;vertical-align:middle;}
.wc-px-hist-row .time{flex:0 0 auto;color:var(--text-muted,#888);font:600 11px/1.3 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;}

.wc-px-set-actions{display:flex;flex-wrap:wrap;gap:6px;padding:7px 11px;border-top:1px solid var(--border-subtle,#1a1a1a);}
.wc-px-set-actions button{font:600 10.5px/1 inherit;padding:6px 9px;background:transparent;color:var(--text-muted,#888);
  border:1px solid var(--border,#2a2a2a);border-radius:6px;cursor:pointer;letter-spacing:.04em;}
.wc-px-set-actions button:hover{color:var(--accent,#fff);background:var(--surface-hover,#1e1e1e);}
`;

function ensureStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const el = document.createElement('style'); el.id = STYLE_ID; el.textContent = CSS;
  document.head.appendChild(el);
}

function uid(): string { return 'set_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36); }
function assetUid(): string { return 'a_' + Math.random().toString(36).slice(2, 8); }
function escapeHtml(s: string): string { return s.replace(/[&<>"']/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c] as string)); }
function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'assets';
}
function downloadBlob(filename: string, content: string, mime: string): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 0);
}

/* ───────────────── widget ───────────────── */

class ProximityWidget {
  private trigger!: HTMLButtonElement;
  private side!: HTMLElement;
  private backdrop!: HTMLElement;
  private tab: 'alerts' | 'history' | 'assets' | 'settings' = 'alerts';
  private open = false;
  private engine = getProximityEngine();
  private cloudSyncedAt = 0;
  private showImport = false;
  private importError = '';

  mount(host: HTMLElement): void {
    ensureStyles();
    this.trigger = document.createElement('button');
    this.trigger.className = 'wc-px-btn';
    this.trigger.setAttribute('aria-label', 'Proximity Alarm Sandbox');
    this.trigger.title = 'Proximity Alarm Sandbox';
    this.trigger.innerHTML = this.triggerIcon();
    this.trigger.addEventListener('click', () => this.toggle());
    host.appendChild(this.trigger);

    this.backdrop = document.createElement('div'); this.backdrop.className = 'wc-px-backdrop';
    this.backdrop.addEventListener('click', () => this.close());
    document.body.appendChild(this.backdrop);

    this.side = document.createElement('aside'); this.side.className = 'wc-px-side';
    document.body.appendChild(this.side);

    this.engine.addEventListener('change', () => { this.updateBadge(); if (this.open) this.renderBody(); });
    subscribeClerk(() => { this.render(); void this.syncFromCloud(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && this.open) this.close(); });

    this.render();
    void this.syncFromCloud();
  }

  private triggerIcon(): string {
    return `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><circle cx="12" cy="12" r="7" opacity=".55"/><circle cx="12" cy="12" r="11" opacity=".25"/></svg>`;
  }

  private updateBadge(): void {
    const n = this.engine.getAlerts().length;
    this.trigger.classList.toggle('has-alerts', n > 0);
    this.trigger.classList.toggle('pulse', n > 0);
    let badge = this.trigger.querySelector('.wc-px-badge') as HTMLElement | null;
    if (n > 0) {
      if (!badge) { badge = document.createElement('span'); badge.className = 'wc-px-badge'; this.trigger.appendChild(badge); }
      badge.textContent = n > 99 ? '99+' : String(n);
    } else if (badge) badge.remove();
  }

  private toggle(): void { this.open ? this.close() : this.openSide(); }
  private openSide(): void {
    this.open = true; this.side.classList.add('open'); this.backdrop.classList.add('open');
    this.render();
  }
  private close(): void {
    this.open = false; this.side.classList.remove('open'); this.backdrop.classList.remove('open');
  }

  private render(): void {
    const user = getCurrentClerkUser();
    if (!user) {
      this.side.innerHTML = `
        <div class="wc-px-head">
          <div style="flex:1"><div class="title">Proximity Alarm</div><div class="sub">Sign in required</div></div>
          <button class="close" data-act="close" aria-label="Close">✕</button>
        </div>
        <div class="wc-px-gate">
          <h3>Private asset overlay</h3>
          <p>Sign in to import your operational locations, set warning radii, and receive instant proximity alerts when live threats enter your danger zones. Coordinates remain on your device by default.</p>
          <button class="wc-px-btn-primary" data-act="signin">Sign in</button>
        </div>`;
      this.side.querySelector('[data-act="close"]')?.addEventListener('click', () => this.close());
      this.side.querySelector('[data-act="signin"]')?.addEventListener('click', () => openSignIn());
      return;
    }
    const alerts = this.engine.getAlerts();
    const setsCount = this.engine.getSets().reduce((n, s) => n + s.assets.length, 0);
    const histCount = this.engine.getHistory().length;
    this.side.innerHTML = `
      <div class="wc-px-head">
        <div style="flex:1;min-width:0">
          <div class="title">Proximity Sandbox</div>
          <div class="sub">${setsCount} asset${setsCount === 1 ? '' : 's'} · ${alerts.length} active alert${alerts.length === 1 ? '' : 's'}</div>
        </div>
        <button class="close" data-act="close" aria-label="Close">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
      <div class="wc-px-tabs">
        <button data-tab="alerts" class="${this.tab==='alerts'?'is-active':''}">Alerts ${alerts.length ? `<span class="ct">${alerts.length}</span>` : ''}</button>
        <button data-tab="history" class="${this.tab==='history'?'is-active':''}">History ${histCount ? `<span class="ct">${histCount > 99 ? '99+' : histCount}</span>` : ''}</button>
        <button data-tab="assets" class="${this.tab==='assets'?'is-active':''}">Assets</button>
        <button data-tab="settings" class="${this.tab==='settings'?'is-active':''}">Settings</button>
      </div>
      <div class="wc-px-body" id="wc-px-body"></div>`;
    this.side.querySelector('[data-act="close"]')?.addEventListener('click', () => this.close());
    this.side.querySelectorAll<HTMLButtonElement>('.wc-px-tabs button').forEach((b) => {
      b.addEventListener('click', () => { this.tab = b.dataset.tab as typeof this.tab; this.render(); });
    });
    this.renderBody();
  }

  private renderBody(): void {
    const body = this.side.querySelector('#wc-px-body') as HTMLElement | null;
    if (!body) return;
    if (this.tab === 'alerts') body.innerHTML = this.renderAlerts();
    else if (this.tab === 'history') body.innerHTML = this.renderHistory();
    else if (this.tab === 'assets') body.innerHTML = this.renderAssets();
    else body.innerHTML = this.renderSettings();
    this.bindBody(body);
  }

  private renderAlerts(): string {
    const alerts = this.engine.getAlerts();
    if (!alerts.length) return `<div class="wc-px-emptybox"><b>All clear</b>No live threats inside any private danger zone right now. Detection re-runs every few seconds against the active map feeds.</div>`;
    return alerts.map((a) => this.renderAlertRow(a)).join('');
  }
  private renderAlertRow(a: ProximityAlert): string {
    const sev = a.threat.severity;
    return `<div class="wc-px-alert sev-${sev}" data-alert="${escapeHtml(a.key)}">
      <div class="row1">
        <span class="dot" style="background:${SEVERITY_COLOR[sev]}"></span>
        <span class="ttl">${escapeHtml(a.threat.title)}</span>
        <span class="km">${a.distanceKm.toFixed(1)} km</span>
      </div>
      <div class="row2">
        <span>↳ ${escapeHtml(a.asset.label)}</span>
        <span>${CATEGORY_LABEL[a.threat.category]}</span>
        <span>radius ${a.effectiveRadiusKm} km</span>
      </div>
    </div>`;
  }

  private renderAssets(): string {
    const sets = this.engine.getSets();
    const list = sets.length ? sets.map((s) => this.renderSetCard(s)).join('') :
      `<div class="wc-px-emptybox"><b>No private assets yet</b>Import a JSON or GeoJSON file with your operational locations. Files never leave your device unless cloud sync is enabled in Settings.</div>`;
    const importPanel = this.showImport ? this.renderImportPanel() : '';
    return `<div class="wc-px-actions">
      <button class="wc-px-btn-primary" data-act="import-toggle">${this.showImport ? 'Cancel' : 'Import / Paste'}</button>
      <button class="wc-px-btn-ghost" data-act="example">Add sample set</button>
      ${sets.length ? `<button class="wc-px-btn-ghost" data-act="export-all">Export all (GeoJSON)</button>` : ''}
    </div>${importPanel}${list}`;
  }

  private renderImportPanel(): string {
    return `<div class="wc-px-import">
      <div class="hint">Paste GeoJSON FeatureCollection, a JSON array of <code>{lat,lon,label,radiusKm}</code>, or one location per line as <code>lat,lon,label,radiusKm</code>.</div>
      <textarea id="wc-px-paste" placeholder='{"type":"FeatureCollection","features":[...]}\n— or —\n51.5074, -0.1278, HQ London, 50'></textarea>
      ${this.importError ? `<div class="err">${escapeHtml(this.importError)}</div>` : ''}
      <div class="wc-px-actions">
        <button class="wc-px-btn-primary" data-act="paste-import">Add from paste</button>
        <button class="wc-px-btn-ghost" data-act="file-import">Choose file…</button>
      </div>
    </div>`;
  }
  private renderSetCard(s: ProximityAssetSet): string {
    return `<div class="wc-px-set" data-set="${escapeHtml(s.id)}">
      <div class="wc-px-set-head">
        <span class="swatch" style="background:${escapeHtml(s.color)}"></span>
        <input class="name" data-act="rename" value="${escapeHtml(s.name)}" maxlength="60"/>
        <button class="iconbtn" data-act="toggle" title="${s.enabled ? 'Disable' : 'Enable'}">${s.enabled ? '●' : '○'}</button>
        <button class="iconbtn del" data-act="delete" title="Delete set">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/></svg>
        </button>
      </div>
      <div class="wc-px-set-meta">
        <label>Radius <input type="number" min="1" max="2000" step="1" data-act="radius" value="${s.defaultRadiusKm}"/> km</label>
        <span style="margin-left:auto">${s.assets.length} point${s.assets.length === 1 ? '' : 's'}</span>
      </div>
      <div class="wc-px-set-actions">
        <button data-act="export-json">Export JSON</button>
        <button data-act="export-geojson">Export GeoJSON</button>
      </div>
    </div>`;
  }

  private renderHistory(): string {
    const hist = [...this.engine.getHistory()].reverse();
    if (!hist.length) {
      return `<div class="wc-px-emptybox"><b>No alert history yet</b>Once a live threat enters or leaves one of your danger zones, the timeline will track it here. History stays on this device.</div>`;
    }
    let html = `<div class="wc-px-actions"><button class="wc-px-btn-ghost" data-act="clear-history">Clear history</button></div><div class="wc-px-hist">`;
    let currentDay = '';
    for (const h of hist) {
      const d = new Date(h.ts);
      const dayKey = d.toDateString();
      if (dayKey !== currentDay) {
        currentDay = dayKey;
        html += `<div class="wc-px-hist-day">${escapeHtml(dayKey)}</div>`;
      }
      html += this.renderHistoryRow(h);
    }
    html += `</div>`;
    return html;
  }

  private renderHistoryRow(h: ProximityHistoryEvent): string {
    const time = new Date(h.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const sevColor = SEVERITY_COLOR[h.severity] || '#3b82f6';
    return `<div class="wc-px-hist-row">
      <span class="chip ${h.action}">${h.action === 'entered' ? 'IN' : 'OUT'}</span>
      <div class="body">
        <div class="ttl"><span class="sev" style="background:${sevColor}"></span>${escapeHtml(h.threatTitle)}</div>
        <div class="meta">
          <span>↳ ${escapeHtml(h.assetLabel)}</span>
          <span>${escapeHtml(h.setName)}</span>
          <span>${CATEGORY_LABEL[h.category]}</span>
          <span>${h.distanceKm.toFixed(1)} km / ${h.effectiveRadiusKm} km</span>
        </div>
      </div>
      <span class="time">${escapeHtml(time)}</span>
    </div>`;
  }

  private renderSettings(): string {
    const p = this.engine.getPrefs();
    const cats: ThreatCategory[] = ['conflicts','hotspots','natural','outages','earthquakes','iranAttacks','military','cyber'];
    return `
      <div class="wc-px-pref">
        <div><div class="lbl">Default warning radius</div><div class="hint">Used when an asset has no per-point radius.</div></div>
        <div><input type="number" min="1" max="2000" data-pref="defaultRadiusKm" value="${p.defaultRadiusKm}"/> km</div>
      </div>
      <div class="wc-px-pref">
        <div><div class="lbl">Severity threshold</div><div class="hint">Ignore events weaker than this level.</div></div>
        <select data-pref="severityThreshold">
          ${['low','medium','high'].map((v) => `<option value="${v}" ${p.severityThreshold===v?'selected':''}>${v.toUpperCase()}</option>`).join('')}
        </select>
      </div>
      <div class="wc-px-pref">
        <div><div class="lbl">Audible ping</div><div class="hint">Soft tone when a new threat enters a danger zone.</div></div>
        <label class="wc-px-btn-ghost" style="cursor:pointer"><input type="checkbox" data-pref="audiblePing" ${p.audiblePing?'checked':''}/> ${p.audiblePing?'On':'Off'}</label>
      </div>
      <div class="wc-px-pref">
        <div><div class="lbl">Cloud sync coordinates</div><div class="hint">Off keeps private locations on this device only.</div></div>
        <label class="wc-px-btn-ghost" style="cursor:pointer"><input type="checkbox" data-pref="syncCoordinates" ${p.syncCoordinates?'checked':''}/> ${p.syncCoordinates?'Sync on':'Local only'}</label>
      </div>
      <div class="wc-px-cats">
        ${cats.map((c) => `<label><input type="checkbox" data-cat="${c}" ${p.enabledCategories.includes(c)?'checked':''}/> ${CATEGORY_LABEL[c]}</label>`).join('')}
      </div>
      <div class="wc-px-actions">
        <button class="wc-px-btn-ghost" data-act="purge">Delete all local data</button>
      </div>`;
  }

  /* ───────────────── interactions ───────────────── */

  private bindBody(body: HTMLElement): void {
    if (this.tab === 'assets') {
      body.querySelector('[data-act="import-toggle"]')?.addEventListener('click', () => {
        this.showImport = !this.showImport; this.importError = ''; this.renderBody();
      });
      body.querySelector('[data-act="paste-import"]')?.addEventListener('click', () => this.doPasteImport());
      body.querySelector('[data-act="file-import"]')?.addEventListener('click', () => this.pickFile());
      body.querySelector('[data-act="export-all"]')?.addEventListener('click', () => this.exportAll());
      body.querySelector('[data-act="example"]')?.addEventListener('click', () => this.addSample());
      body.querySelectorAll<HTMLElement>('.wc-px-set').forEach((card) => this.bindSetCard(card));
    }
    if (this.tab === 'history') {
      body.querySelector('[data-act="clear-history"]')?.addEventListener('click', () => {
        if (!confirm('Clear all proximity alert history on this device?')) return;
        this.engine.clearHistory();
        this.render();
      });
    }
    if (this.tab === 'settings') {
      body.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-pref]').forEach((el) => {
        el.addEventListener('change', () => this.updatePref(el));
      });
      body.querySelectorAll<HTMLInputElement>('[data-cat]').forEach((cb) => {
        cb.addEventListener('change', () => this.toggleCategory(cb));
      });
      body.querySelector('[data-act="purge"]')?.addEventListener('click', () => this.purge());
    }
  }

  private bindSetCard(card: HTMLElement): void {
    const setId = card.dataset.set!;
    const find = () => this.engine.getSets().find((s) => s.id === setId);
    card.querySelector<HTMLInputElement>('[data-act="rename"]')?.addEventListener('change', (e) => {
      const s = find(); if (!s) return;
      s.name = (e.target as HTMLInputElement).value.trim() || s.name;
      s.updatedAt = Date.now(); this.persistSets(s);
    });
    card.querySelector<HTMLInputElement>('[data-act="radius"]')?.addEventListener('change', (e) => {
      const s = find(); if (!s) return;
      s.defaultRadiusKm = Math.max(1, Math.min(2000, Number((e.target as HTMLInputElement).value) || 50));
      this.persistSets(s);
    });
    card.querySelector('[data-act="toggle"]')?.addEventListener('click', () => {
      const s = find(); if (!s) return;
      s.enabled = !s.enabled; this.persistSets(s); this.render();
    });
    card.querySelector('[data-act="delete"]')?.addEventListener('click', () => {
      const s = find(); if (!s) return;
      if (!confirm(`Delete asset set "${s.name}"? This cannot be undone.`)) return;
      const next = this.engine.getSets().filter((x) => x.id !== setId);
      this.engine.setSets(next);
      const u = getCurrentClerkUser(); if (u) void deleteCloudSet(u.id, setId);
      this.render();
    });
    card.querySelector('[data-act="export-json"]')?.addEventListener('click', () => {
      const s = find(); if (!s) return;
      downloadBlob(`${slugify(s.name)}.json`, JSON.stringify({ name: s.name, color: s.color, defaultRadiusKm: s.defaultRadiusKm, assets: s.assets }, null, 2), 'application/json');
    });
    card.querySelector('[data-act="export-geojson"]')?.addEventListener('click', () => {
      const s = find(); if (!s) return;
      downloadBlob(`${slugify(s.name)}.geojson`, JSON.stringify(setToGeoJSON(s), null, 2), 'application/geo+json');
    });
  }

  private persistSets(updated?: ProximityAssetSet): void {
    this.engine.setSets([...this.engine.getSets()]);
    const u = getCurrentClerkUser();
    if (u && updated) void pushCloudSet(u.id, updated, this.engine.getPrefs().syncCoordinates);
  }

  private updatePref(el: HTMLInputElement | HTMLSelectElement): void {
    const key = el.dataset.pref as keyof ProximityPrefs;
    const prefs: ProximityPrefs = { ...this.engine.getPrefs() };
    if (el instanceof HTMLInputElement && el.type === 'checkbox') {
      (prefs as unknown as Record<string, unknown>)[key] = el.checked;
    } else if (el instanceof HTMLInputElement && el.type === 'number') {
      (prefs as unknown as Record<string, unknown>)[key] = Number(el.value) || 0;
    } else {
      (prefs as unknown as Record<string, unknown>)[key] = el.value;
    }
    this.engine.setPrefs(prefs);
    const u = getCurrentClerkUser(); if (u) void pushCloudPrefs(u.id, prefs);
    this.render();
  }

  private toggleCategory(cb: HTMLInputElement): void {
    const cat = cb.dataset.cat as ThreatCategory;
    const prefs = { ...this.engine.getPrefs() };
    prefs.enabledCategories = cb.checked
      ? [...new Set([...prefs.enabledCategories, cat])]
      : prefs.enabledCategories.filter((c) => c !== cat);
    this.engine.setPrefs(prefs);
    const u = getCurrentClerkUser(); if (u) void pushCloudPrefs(u.id, prefs);
  }

  private pickFile(): void {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = '.json,.geojson,application/json';
    input.addEventListener('change', async () => {
      const file = input.files?.[0]; if (!file) return;
      try {
        const txt = await file.text();
        const assets = parseProximityImport(txt);
        const set: ProximityAssetSet = {
          id: uid(), name: file.name.replace(/\.(geo)?json$/i, '') || 'Imported assets',
          color: '#22d3ee', defaultRadiusKm: this.engine.getPrefs().defaultRadiusKm,
          assets, enabled: true, updatedAt: Date.now(),
        };
        this.engine.setSets([...this.engine.getSets(), set]);
        const u = getCurrentClerkUser(); if (u) void pushCloudSet(u.id, set, this.engine.getPrefs().syncCoordinates);
        this.showImport = false; this.importError = '';
        this.render();
      } catch (err) {
        this.importError = `Import failed: ${(err as Error).message}`;
        this.showImport = true;
        this.render();
      }
    });
    input.click();
  }

  private doPasteImport(): void {
    const ta = this.side.querySelector<HTMLTextAreaElement>('#wc-px-paste');
    if (!ta) return;
    const text = ta.value;
    try {
      const assets = parseProximityImport(text);
      const set: ProximityAssetSet = {
        id: uid(),
        name: `Pasted assets ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`,
        color: '#22d3ee', defaultRadiusKm: this.engine.getPrefs().defaultRadiusKm,
        assets, enabled: true, updatedAt: Date.now(),
      };
      this.engine.setSets([...this.engine.getSets(), set]);
      const u = getCurrentClerkUser(); if (u) void pushCloudSet(u.id, set, this.engine.getPrefs().syncCoordinates);
      this.showImport = false; this.importError = '';
      this.render();
    } catch (err) {
      this.importError = (err as Error).message;
      this.renderBody();
    }
  }

  private exportAll(): void {
    const sets = this.engine.getSets();
    if (!sets.length) return;
    downloadBlob('proximity-assets.geojson', JSON.stringify(allSetsToGeoJSON(sets), null, 2), 'application/geo+json');
  }

  private addSample(): void {
    const set: ProximityAssetSet = {
      id: uid(), name: 'Sample assets', color: '#a78bfa',
      defaultRadiusKm: this.engine.getPrefs().defaultRadiusKm, enabled: true, updatedAt: Date.now(),
      assets: [
        { id: assetUid(), label: 'HQ — London', lat: 51.5074, lon: -0.1278 },
        { id: assetUid(), label: 'Hub — Singapore', lat: 1.3521, lon: 103.8198 },
        { id: assetUid(), label: 'Depot — Houston', lat: 29.7604, lon: -95.3698 },
      ],
    };
    this.engine.setSets([...this.engine.getSets(), set]);
    const u = getCurrentClerkUser(); if (u) void pushCloudSet(u.id, set, this.engine.getPrefs().syncCoordinates);
    this.render();
  }

  private purge(): void {
    if (!confirm('Delete all local proximity data on this device?')) return;
    this.engine.setSets([]);
    this.render();
  }

  private async syncFromCloud(): Promise<void> {
    const u = getCurrentClerkUser(); if (!u) return;
    if (Date.now() - this.cloudSyncedAt < 5000) return;
    this.cloudSyncedAt = Date.now();
    const [prefs, sets] = await Promise.all([pullCloudPrefs(u.id), pullCloudSets(u.id)]);
    if (prefs) this.engine.setPrefs(prefs);
    if (sets.length) {
      // Merge: cloud sets that already exist locally are replaced.
      const local = this.engine.getSets();
      const byId = new Map(local.map((s) => [s.id, s]));
      for (const c of sets) if (c.assets.length) byId.set(c.id, c);
      this.engine.setSets(Array.from(byId.values()));
    }
    if (this.open) this.render();
  }
}

let _widget: ProximityWidget | null = null;

export function initProximityWidget(): void {
  if (_widget) return;
  const host = document.getElementById('proximityMount');
  if (!host) { console.warn('[rpas] mount point #proximityMount missing'); return; }
  _widget = new ProximityWidget();
  _widget.mount(host);
}
