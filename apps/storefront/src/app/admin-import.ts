import { HttpErrorResponse } from '@angular/common/http';
import { afterNextRender, ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { AdminApi, type AdminSession, type ImportPreview, type ImportResult } from './admin-api';
import { parseXlsx, type XlsxRowValues } from './xlsx-parser';
import { AdminProducts } from './admin-products';
import { translateImportColumn, translateImportReason } from './admin-import-messages';

type GoogleIdentity = { accounts: { id: {
  initialize(options: { client_id: string; nonce: string; callback: (response: { credential: string }) => void }): void;
  renderButton(element: HTMLElement, options: { theme: string; size: string; locale: string }): void;
} } };
declare global { interface Window { google?: GoogleIdentity } }

@Component({
  selector: 'app-admin-import',
  imports: [AdminProducts],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './admin-import.html',
  styleUrl: './admin-import.css',
})
export class AdminImport {
  readonly translateImportReason = translateImportReason;
  readonly translateImportColumn = translateImportColumn;
  private readonly api = inject(AdminApi);
  readonly session = signal<AdminSession | null>(null);
  readonly state = signal<'loading' | 'signed-out' | 'denied' | 'ready'>('loading');
  readonly busy = signal(false);
  readonly message = signal('');
  readonly preview = signal<ImportPreview | null>(null);
  readonly result = signal<ImportResult | null>(null);
  readonly adminMessage = signal('');
  private readonly route = inject(ActivatedRoute, { optional: true });
  readonly section = signal<'home' | 'import' | 'products' | 'product-editor' | 'administrators'>(
    this.route?.snapshot.data['section'] ?? 'import',
  );
  readonly productId = this.route?.snapshot.paramMap?.get('id') ?? null;
  private rows: XlsxRowValues[] | null = null;
  private generation = 0;

  constructor() { afterNextRender(() => void this.restoreSession()); }

  private async restoreSession() {
    try { this.session.set(await this.api.session()); this.state.set('ready'); }
    catch (error) {
      this.state.set('signed-out');
      if (!(error instanceof HttpErrorResponse) || error.status !== 401) this.message.set('Không thể kiểm tra phiên đăng nhập. Vui lòng thử lại.');
    }
  }

  async signIn() {
    if (this.busy()) return;
    this.busy.set(true); this.message.set('');
    try {
      const { googleClientId } = await this.api.config();
      if (typeof googleClientId !== 'string' || !googleClientId.trim()) throw new Error('Chưa cấu hình đăng nhập Google.');
      await this.loadGoogle();
      const { nonce } = await this.api.challenge();
      const container = document.getElementById('google-signin');
      if (!container || !window.google) throw new Error('Không thể sử dụng đăng nhập Google.');
      container.replaceChildren();
      window.google.accounts.id.initialize({ client_id: googleClientId, nonce, callback: response => void this.login(response.credential) });
      window.google.accounts.id.renderButton(container, { theme: 'outline', size: 'large', locale: 'vi' });
    } catch (error) {
      this.message.set(error instanceof Error && ['Chưa cấu hình đăng nhập Google.', 'Không thể sử dụng đăng nhập Google.', 'Không thể tải đăng nhập Google.'].includes(error.message) ? error.message : 'Không thể chuẩn bị đăng nhập. Vui lòng thử lại.');
    } finally { this.busy.set(false); }
  }

  private loadGoogle(): Promise<void> {
    if (window.google) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://accounts.google.com/gsi/client'; script.async = true;
      script.onload = () => resolve();
      script.onerror = () => { script.remove(); reject(new Error('Không thể tải đăng nhập Google.')); };
      document.head.appendChild(script);
    });
  }

  private async login(credential: string) {
    if (this.busy()) return;
    this.busy.set(true); this.message.set('');
    try { await this.api.login(credential); this.session.set(await this.api.session()); this.state.set('ready'); }
    catch { this.state.set('denied'); this.message.set('Đăng nhập không được chấp nhận. Hãy kiểm tra quyền truy cập và thử lại.'); }
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
      if (current === this.generation) this.handleError(error, 'Không thể xem trước bảng tính.');
    } finally { if (current === this.generation) this.busy.set(false); }
  }

  async apply() {
    const session = this.session(), preview = this.preview(), rows = this.rows;
    if (this.busy() || !session || !preview || !rows || preview.errors.length || this.applyLimitMessage(preview)) return;
    this.busy.set(true); this.message.set('');
    try { this.result.set(await this.api.apply(rows, preview, session.csrfToken)); this.preview.set(null); this.rows = null; }
    catch (error) { this.preview.set(null); this.rows = null; this.handleError(error, 'Nhập dữ liệu thất bại. Hãy chọn tệp và xem trước lại.'); }
    finally { this.busy.set(false); }
  }

  applyLimitMessage(preview: ImportPreview): string {
    const exceeded = [
      preview.counts.rows > 400 ? `dòng (${preview.counts.rows}/400)` : '',
      preview.counts.products > 100 ? `nhóm sản phẩm (${preview.counts.products}/100)` : '',
      preview.counts.images > 1000 ? `ảnh (${preview.counts.images}/1.000)` : '',
    ].filter(Boolean);
    return exceeded.length ? `Vượt quá giới hạn nhập: ${exceeded.join(', ')}. Hãy chia nhỏ hoặc giảm dữ liệu trong bảng tính và xem trước lại.` : '';
  }

  async logout() {
    const session = this.session();
    if (!session || this.busy()) return;
    this.busy.set(true); this.message.set('');
    try { await this.api.logout(session.csrfToken); this.clearSession(); }
    catch (error) { this.handleError(error, 'Không thể đăng xuất. Vui lòng thử lại.'); }
    finally { this.busy.set(false); }
  }

  async addAdmin(email: string, input: HTMLInputElement) {
    const session = this.session();
    if (!session || this.busy()) return;
    this.busy.set(true); this.adminMessage.set(''); this.message.set('');
    try { await this.api.addAdmin(email, session.csrfToken); input.value = ''; this.adminMessage.set('Đã thêm quản trị viên. Người này có thể đăng nhập bằng Google.'); }
    catch (error) {
      if (error instanceof HttpErrorResponse && error.status === 409) this.adminMessage.set('Email này đã được đăng ký.');
      else if (error instanceof HttpErrorResponse && error.status === 400) this.adminMessage.set('Hãy nhập địa chỉ Gmail hợp lệ bằng chữ thường.');
      else this.handleError(error, 'Không thể thêm quản trị viên. Vui lòng thử lại.');
    } finally { this.busy.set(false); }
  }

  private clearSession() { ++this.generation; this.rows = null; this.preview.set(null); this.result.set(null); this.adminMessage.set(''); this.session.set(null); this.state.set('signed-out'); }
  expireSession() { this.clearSession(); this.message.set('Phiên đăng nhập đã hết hạn hoặc quyền truy cập bị từ chối. Vui lòng đăng nhập lại.'); }
  private handleError(error: unknown, fallback: string) {
    if (error instanceof HttpErrorResponse && error.status === 401) { this.clearSession(); this.message.set('Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.'); }
    else if (error instanceof HttpErrorResponse && error.status === 403) { this.clearSession(); this.state.set('denied'); this.message.set('Yêu cầu bị từ chối. Vui lòng đăng nhập lại.'); }
    else if (error instanceof HttpErrorResponse && error.status === 409) this.message.set('Danh mục đã thay đổi hoặc có xung đột. Hãy xem trước lại hoặc xử lý xung đột thủ công.');
    else this.message.set(error instanceof Error && !(error instanceof HttpErrorResponse) ? translateImportReason(error.message, fallback) : fallback);
  }
}
