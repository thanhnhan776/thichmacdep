import { HttpErrorResponse } from '@angular/common/http';
import { afterNextRender, ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { AdminApi, type AdminSession, type ImportPreview, type ImportResult } from './admin-api';
import { parseXlsx, type XlsxRowValues } from './xlsx-parser';

type GoogleIdentity = { accounts: { id: {
  initialize(options: { client_id: string; nonce: string; callback: (response: { credential: string }) => void }): void;
  renderButton(element: HTMLElement, options: { theme: string; size: string }): void;
} } };
declare global { interface Window { google?: GoogleIdentity } }

@Component({
  selector: 'app-admin-import',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './admin-import.html',
  styleUrl: './admin-import.css',
})
export class AdminImport {
  private readonly api = inject(AdminApi);
  readonly session = signal<AdminSession | null>(null);
  readonly state = signal<'loading' | 'signed-out' | 'denied' | 'ready'>('loading');
  readonly busy = signal(false);
  readonly message = signal('');
  readonly preview = signal<ImportPreview | null>(null);
  readonly result = signal<ImportResult | null>(null);
  readonly adminMessage = signal('');
  private rows: XlsxRowValues[] | null = null;
  private generation = 0;

  constructor() { afterNextRender(() => void this.restoreSession()); }

  private async restoreSession() {
    try { this.session.set(await this.api.session()); this.state.set('ready'); }
    catch (error) {
      this.state.set('signed-out');
      if (!(error instanceof HttpErrorResponse) || error.status !== 401) this.message.set('Unable to check your session. Please try again.');
    }
  }

  async signIn() {
    if (this.busy()) return;
    this.busy.set(true); this.message.set('');
    try {
      const { googleClientId } = await this.api.config();
      if (typeof googleClientId !== 'string' || !googleClientId.trim()) throw new Error('Google sign-in is not configured.');
      await this.loadGoogle();
      const { nonce } = await this.api.challenge();
      const container = document.getElementById('google-signin');
      if (!container || !window.google) throw new Error('Google sign-in is unavailable.');
      container.replaceChildren();
      window.google.accounts.id.initialize({ client_id: googleClientId, nonce, callback: response => void this.login(response.credential) });
      window.google.accounts.id.renderButton(container, { theme: 'outline', size: 'large' });
    } catch (error) {
      this.message.set(error instanceof Error && !(error instanceof HttpErrorResponse) ? error.message : 'Unable to prepare sign-in. Please try again.');
    } finally { this.busy.set(false); }
  }

  private loadGoogle(): Promise<void> {
    if (window.google) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://accounts.google.com/gsi/client'; script.async = true;
      script.onload = () => resolve();
      script.onerror = () => { script.remove(); reject(new Error('Unable to load Google sign-in.')); };
      document.head.appendChild(script);
    });
  }

  private async login(credential: string) {
    if (this.busy()) return;
    this.busy.set(true); this.message.set('');
    try { await this.api.login(credential); this.session.set(await this.api.session()); this.state.set('ready'); }
    catch { this.state.set('denied'); this.message.set('Sign-in was not accepted. Check that your account is authorized and try again.'); }
    finally { this.busy.set(false); }
  }

  async selectFile(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    const current = ++this.generation;
    this.rows = null; this.preview.set(null); this.result.set(null); this.message.set('');
    if (!file || !this.session()) { this.busy.set(false); return; }
    this.busy.set(true);
    try {
      const parsed = await parseXlsx(file);
      const rows = parsed.rows.map(row => row.values);
      const preview = await this.api.preview(rows, this.session()!.csrfToken);
      if (current !== this.generation) return;
      this.rows = rows; this.preview.set(preview);
    } catch (error) {
      if (current === this.generation) this.handleError(error, 'Unable to preview this workbook.');
    } finally { if (current === this.generation) this.busy.set(false); }
  }

  async apply() {
    const session = this.session(), preview = this.preview(), rows = this.rows;
    if (this.busy() || !session || !preview || !rows || preview.errors.length || this.applyLimitMessage(preview)) return;
    this.busy.set(true); this.message.set('');
    try { this.result.set(await this.api.apply(rows, preview, session.csrfToken)); this.preview.set(null); this.rows = null; }
    catch (error) { this.preview.set(null); this.rows = null; this.handleError(error, 'Import failed. Select the file and preview again.'); }
    finally { this.busy.set(false); }
  }

  applyLimitMessage(preview: ImportPreview): string {
    const exceeded = [
      preview.counts.rows > 400 ? `rows (${preview.counts.rows}/400)` : '',
      preview.counts.products > 100 ? `product groups (${preview.counts.products}/100)` : '',
      preview.counts.images > 1000 ? `image entries (${preview.counts.images}/1,000)` : '',
    ].filter(Boolean);
    return exceeded.length ? `Apply limit exceeded: ${exceeded.join(', ')}. Split or reduce the workbook and preview again.` : '';
  }

  async logout() {
    const session = this.session();
    if (!session || this.busy()) return;
    this.busy.set(true); this.message.set('');
    try { await this.api.logout(session.csrfToken); this.clearSession(); }
    catch (error) { this.handleError(error, 'Could not sign out. Please try again.'); }
    finally { this.busy.set(false); }
  }

  async addAdmin(email: string, input: HTMLInputElement) {
    const session = this.session();
    if (!session || this.busy()) return;
    this.busy.set(true); this.adminMessage.set(''); this.message.set('');
    try { await this.api.addAdmin(email, session.csrfToken); input.value = ''; this.adminMessage.set('Administrator added. They can now sign in with Google.'); }
    catch (error) {
      if (error instanceof HttpErrorResponse && error.status === 409) this.adminMessage.set('This email is already registered.');
      else if (error instanceof HttpErrorResponse && error.status === 400) this.adminMessage.set('Enter a valid lowercase Gmail address.');
      else this.handleError(error, 'Unable to add administrator. Please try again.');
    } finally { this.busy.set(false); }
  }

  private clearSession() { ++this.generation; this.rows = null; this.preview.set(null); this.result.set(null); this.adminMessage.set(''); this.session.set(null); this.state.set('signed-out'); }
  private handleError(error: unknown, fallback: string) {
    if (error instanceof HttpErrorResponse && error.status === 401) { this.clearSession(); this.message.set('Your session has expired. Please sign in again.'); }
    else if (error instanceof HttpErrorResponse && error.status === 403) { this.clearSession(); this.state.set('denied'); this.message.set('Request denied. Please sign in again.'); }
    else if (error instanceof HttpErrorResponse && error.status === 409) this.message.set('The catalog changed or there is a conflict. Preview again or resolve the conflict manually.');
    else this.message.set(error instanceof Error && !(error instanceof HttpErrorResponse) ? error.message : fallback);
  }
}
