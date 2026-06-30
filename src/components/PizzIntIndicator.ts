import type { PizzIntStatus, GdeltTensionPair } from '@/types';
import { t } from '@/services/i18n';
import { h, replaceChildren } from '@/utils/dom-utils';

const DEFCON_COLORS: Record<number, string> = {
  1: '#ff0040',
  2: '#ff4400',
  3: '#ffaa00',
  4: '#00aaff',
  5: '#2d8a6e',
};

export class PizzIntIndicator {
  private element: HTMLElement;
  private panel: HTMLElement;
  private toggleButton: HTMLButtonElement;
  private isExpanded = false;
  private status: PizzIntStatus | null = null;
  private tensions: GdeltTensionPair[] = [];
  private static openCount = 0;
  private readonly closeOnOutsideClick = (e: MouseEvent) => {
    if (!this.isExpanded) return;
    const target = e.target as Node | null;
    if (target && (this.element.contains(target) || this.panel.contains(target))) return;
    this.closePanel();
  };
  private readonly closeOnEscape = (e: KeyboardEvent) => {
    if (e.key === 'Escape') this.closePanel();
  };
  private readonly repositionPanel = () => {
    if (!this.isExpanded) return;
    this.updatePanelPosition();
  };

  constructor() {
    const panel = h('div', { className: 'pizzint-panel hidden' },
      h('div', { className: 'pizzint-header' },
        h('span', { className: 'pizzint-title' }, t('components.pizzint.title')),
        h('button', {
          className: 'pizzint-close',
          onClick: () => this.closePanel(),
        }, '×'),
      ),
      h('div', { className: 'pizzint-status-bar' },
        h('div', { className: 'pizzint-defcon-label' }),
      ),
      h('div', { className: 'pizzint-locations' }),
      h('div', { className: 'pizzint-tensions' },
        h('div', { className: 'pizzint-tensions-title' }, t('components.pizzint.tensionsTitle')),
        h('div', { className: 'pizzint-tensions-list' }),
      ),
      h('div', { className: 'pizzint-footer' },
        h('span', { className: 'pizzint-source' },
          t('components.pizzint.source'), ' ',
          h('a', { href: 'https://pizzint.watch', target: '_blank', rel: 'noopener' }, 'PizzINT'),
        ),
        h('span', { className: 'pizzint-updated' }),
      ),
    );

    this.panel = panel;
    this.panel.setAttribute('role', 'dialog');
    this.panel.tabIndex = -1;
    this.panel.style.position = 'fixed';
    this.panel.style.zIndex = '2147483200';
    this.toggleButton = h('button', {
        className: 'pizzint-toggle',
        title: t('components.pizzint.title'),
        'aria-haspopup': 'dialog',
        'aria-expanded': 'false',
        onClick: () => {
          const willOpen = !this.isExpanded;
          if (willOpen) {
            document.dispatchEvent(new CustomEvent('wm:header-dropdown-open', { detail: { id: 'pizzint' } }));
          }
          this.togglePanel();
        },
      },
        h('span', { className: 'pizzint-icon' }, '🍕'),
        h('span', { className: 'pizzint-defcon' }, '--'),
        h('span', { className: 'pizzint-score' }, '--%'),
      ) as HTMLButtonElement;

    this.element = h('div', { className: 'pizzint-indicator' },
      this.toggleButton,
    );

    document.body.appendChild(this.panel);
    window.addEventListener('resize', this.repositionPanel);
    window.addEventListener('scroll', this.repositionPanel, true);
    document.addEventListener('click', this.closeOnOutsideClick);
    document.addEventListener('keydown', this.closeOnEscape);

    document.addEventListener('wm:header-dropdown-open', (e) => {
      const detail = (e as CustomEvent<{ id: string }>).detail;
      if (detail?.id !== 'pizzint' && this.isExpanded) {
        this.closePanel();
      }
    });

  }

  private togglePanel(): void {
    if (this.isExpanded) {
      this.closePanel();
    } else {
      this.openPanel();
    }
  }

  private openPanel(): void {
    this.isExpanded = true;
    PizzIntIndicator.openCount += 1;
    PizzIntIndicator.syncGlobalOverlayState();
    this.panel.classList.remove('hidden');
    this.toggleButton.setAttribute('aria-expanded', 'true');
    this.updatePanelPosition();
    this.panel.focus({ preventScroll: true });
  }

  private closePanel(): void {
    if (!this.isExpanded) return;
    this.isExpanded = false;
    PizzIntIndicator.openCount = Math.max(0, PizzIntIndicator.openCount - 1);
    PizzIntIndicator.syncGlobalOverlayState();
    this.panel.classList.add('hidden');
    this.toggleButton.setAttribute('aria-expanded', 'false');
  }

  private static syncGlobalOverlayState(): void {
    document.body.classList.toggle('wm-header-dropdown-active', PizzIntIndicator.openCount > 0);
  }

  private updatePanelPosition(): void {
    const rect = this.toggleButton.getBoundingClientRect();
    const panelWidth = this.panel.offsetWidth || 320;
    const viewportWidth = document.documentElement.clientWidth;
    const margin = 8;
    const left = Math.min(Math.max(rect.left, margin), Math.max(margin, viewportWidth - panelWidth - margin));
    this.panel.style.left = `${left}px`;
    this.panel.style.top = `${Math.max(margin, rect.bottom + margin)}px`;
  }

  public updateStatus(status: PizzIntStatus): void {
    this.status = status;
    this.render();
  }

  public updateTensions(tensions: GdeltTensionPair[]): void {
    this.tensions = tensions;
    this.renderTensions();
  }

  private render(): void {
    if (!this.status) return;

    const defconEl = this.element.querySelector('.pizzint-defcon') as HTMLElement;
    const scoreEl = this.element.querySelector('.pizzint-score') as HTMLElement;
    const labelEl = this.panel.querySelector('.pizzint-defcon-label') as HTMLElement;
    const locationsEl = this.panel.querySelector('.pizzint-locations') as HTMLElement;
    const updatedEl = this.panel.querySelector('.pizzint-updated') as HTMLElement;

    const color = DEFCON_COLORS[this.status.defconLevel] || '#888';
    defconEl.textContent = t('components.pizzint.defcon', { level: String(this.status.defconLevel) });
    defconEl.style.background = color;
    // Black on every DEFCON hue clears WCAG AA 4.5:1 (green #2d8a6e→4.97:1,
    // blue #00aaff→8.2:1); white failed on levels 4–5 (4.22:1 / 2.56:1).
    defconEl.style.color = '#000';

    scoreEl.textContent = `${this.status.aggregateActivity}%`;
    labelEl.textContent = this.getDefconLabel(this.status.defconLevel);
    labelEl.style.color = color;

    replaceChildren(locationsEl,
      ...this.status.locations.map(loc =>
        h('div', { className: 'pizzint-location' },
          h('span', { className: 'pizzint-location-name' }, loc.name),
          h('span', { className: `pizzint-location-status ${this.getStatusClass(loc)}` }, this.getStatusLabel(loc)),
        ),
      ),
    );

    const timeAgo = this.formatTimeAgo(this.status.lastUpdate);
    updatedEl.textContent = t('components.pizzint.updated', { timeAgo });
  }

  private renderTensions(): void {
    const listEl = this.panel.querySelector('.pizzint-tensions-list') as HTMLElement;
    if (!listEl) return;

    replaceChildren(listEl,
      ...this.tensions.map(tp => {
        const trendIcon = tp.trend === 'rising' ? '↑' : tp.trend === 'falling' ? '↓' : '→';
        const changeText = tp.changePercent > 0 ? `+${tp.changePercent}%` : `${tp.changePercent}%`;
        return h('div', { className: 'pizzint-tension-row' },
          h('span', { className: 'pizzint-tension-label' }, tp.label),
          h('span', { className: 'pizzint-tension-score' },
            h('span', { className: 'pizzint-tension-value' }, tp.score.toFixed(1)),
            h('span', { className: `pizzint-tension-trend ${tp.trend}` }, `${trendIcon} ${changeText}`),
          ),
        );
      }),
    );
  }

  private getStatusClass(loc: { is_closed_now: boolean; is_spike: boolean; current_popularity: number }): string {
    if (loc.is_closed_now) return 'closed';
    if (loc.is_spike) return 'spike';
    if (loc.current_popularity >= 70) return 'high';
    if (loc.current_popularity >= 40) return 'elevated';
    if (loc.current_popularity >= 15) return 'nominal';
    return 'quiet';
  }

  private getStatusLabel(loc: { is_closed_now: boolean; is_spike: boolean; current_popularity: number }): string {
    if (loc.is_closed_now) return t('components.pizzint.statusClosed');
    if (loc.is_spike) return `${t('components.pizzint.statusSpike')} ${loc.current_popularity}%`;
    if (loc.current_popularity >= 70) return `${t('components.pizzint.statusHigh')} ${loc.current_popularity}%`;
    if (loc.current_popularity >= 40) return `${t('components.pizzint.statusElevated')} ${loc.current_popularity}%`;
    if (loc.current_popularity >= 15) return `${t('components.pizzint.statusNominal')} ${loc.current_popularity}%`;
    return `${t('components.pizzint.statusQuiet')} ${loc.current_popularity}%`;
  }

  private formatTimeAgo(date: Date): string {
    const diff = Date.now() - date.getTime();
    if (diff < 60000) return t('components.pizzint.justNow');
    if (diff < 3600000) return t('components.pizzint.minutesAgo', { m: String(Math.floor(diff / 60000)) });
    return t('components.pizzint.hoursAgo', { h: String(Math.floor(diff / 3600000)) });
  }

  private getDefconLabel(level: number): string {
    const key = `components.pizzint.defconLabels.${level}`;
    const localized = t(key);
    return localized === key ? this.status?.defconLabel || '' : localized;
  }

  public getElement(): HTMLElement {
    return this.element;
  }

  public hide(): void {
    this.closePanel();
    this.element.style.display = 'none';
  }

  public show(): void {
    this.element.style.display = '';
  }
}
