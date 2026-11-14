import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, EventEmitter, inject, Input, OnInit, Output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AdminApi, type AdminImage, type AdminProduct, type AdminProductFilters, type AdminProductInput, type AdminTrendingProduct, type AdminVariant } from './admin-api';
import type { Category } from './catalog-api';

const emptyProduct = (): AdminProductInput => ({
  sku: null, slug: '', name: '', description: null, brandName: null, priceMinor: null,
  currency: 'VND', isActive: true, isTrending: false, trendingSortOrder: 0,
});

@Component({
  selector: 'app-admin-products',
  imports: [FormsModule],
  templateUrl: './admin-products.html',
  styleUrl: './admin-products.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AdminProducts implements OnInit {
  @Input({ required: true }) csrfToken = '';
  @Input() mode: 'list' | 'editor' = 'list';
  @Input() productId: string | null = null;
  @Output() sessionExpired = new EventEmitter<void>();
  private readonly api = inject(AdminApi);
  readonly products = signal<AdminProduct[]>([]);
  readonly categories = signal<Category[]>([]);
  readonly categoriesError = signal(false);
  readonly pageSize = 50;
  readonly offset = signal(0);
  readonly total = signal(0);
  readonly images = signal<AdminImage[]>([]);
  readonly variants = signal<AdminVariant[]>([]);
  readonly selectedImages = signal<string[]>([]);
  readonly selectedVariant = signal('');
  readonly variantImagesState = signal<'idle' | 'loading' | 'ready' | 'error'>('idle');
  private variantImagesRequest = 0;
  private variantImagesVersion = '';
  readonly editingId = signal<string | null>(null);
  readonly xlsxOwned = signal(false);
  readonly busy = signal(false);
  readonly message = signal('');
  readonly error = signal('');
  readonly listLoaded = signal(false);
  readonly listError = signal(false);
  readonly editorLoaded = signal(false);
  readonly trendingView = signal(false);
  readonly trendingProducts = signal<AdminTrendingProduct[]>([]);
  readonly trendingVersion = signal('');
  readonly trendingBusy = signal(false);
  readonly trendingLoaded = signal(false);
  readonly trendingError = signal('');
  readonly trendingMessage = signal('');
  readonly expandedActions = signal<Set<string>>(new Set());
  toggleActions(key: string) {
    this.expandedActions.update(current => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }
  closeActions(key: string, trigger: HTMLButtonElement, event: Event) {
    if (!this.expandedActions().has(key)) return;
    event.stopPropagation();
    this.expandedActions.update(current => {
      const next = new Set(current);
      next.delete(key);
      return next;
    });
    trigger.focus();
  }
  private draggedTrendingIndex: number | null = null;
  private draggedImage: { index: number; variant: boolean } | null = null;
  variantDescription = '';
  priceText = '';
  priceInvalid = false;
  filters: AdminProductFilters = { search: '', status: '', trending: '', category: '' };
  private appliedFilters: AdminProductFilters = {};
  draft = emptyProduct();
  private originalTrending: { isTrending: boolean } | null = null;
  isHidden = false;
  private originalHidden: boolean | null = null;

  ngOnInit() {
    if (this.mode === 'list') { void this.refresh(); void this.loadCategories(); }
    else if (this.productId) void this.loadEditor();
    else this.editorLoaded.set(true);
  }

  async loadEditor() {
    if (!this.productId) return;
    this.editorLoaded.set(false);
    await this.run(async () => {
      const { product } = await this.api.product(this.productId!);
      const [images, variants] = await Promise.all([this.api.images(product.id), this.api.variants(product.id)]);
      this.setDraft(product);
      this.isHidden = Boolean(product.isHidden);
      this.originalHidden = this.isHidden;
      this.images.set(images.images); this.variants.set(variants.variants);
      this.editorLoaded.set(true);
    });
  }

  private async run(action: () => Promise<void>) {
    if (this.busy()) return;
    this.busy.set(true); this.error.set(''); this.message.set('');
    try { await action(); }
    catch (error) {
      if (error instanceof HttpErrorResponse && (error.status === 401 || error.status === 403)) {
        this.sessionExpired.emit();
      } else if (this.mode === 'list') {
        this.error.set('Không thể hoàn tất thao tác. Vui lòng thử lại.');
      } else if (error instanceof HttpErrorResponse && error.status === 404) {
        this.error.set('Không tìm thấy sản phẩm. Có thể sản phẩm đã bị xóa.');
      } else if (error instanceof HttpErrorResponse && error.status === 409) {
        this.error.set(error.error?.error?.code === 'XLSX_OWNED_FIELDS'
          ? 'SKU, tên, thương hiệu, giá, tiền tệ và trạng thái được quản lý bằng XLSX. Hãy sửa bảng tính và nhập lại.'
          : 'Danh mục đang được cập nhật hoặc dữ liệu bị xung đột. Vui lòng thử lại.');
      } else {
        this.error.set('Không thể hoàn tất thao tác. Hãy kiểm tra dữ liệu và thử lại.');
      }
    } finally { this.busy.set(false); }
  }

  async refresh() {
    await this.run(async () => { await this.loadProducts(this.offset()); });
  }

  async loadCategories() {
    this.categoriesError.set(false);
    try { this.categories.set(await this.api.categories()); }
    catch { this.categoriesError.set(true); }
  }

  async showTrending() {
    this.trendingView.set(true);
    await this.refreshTrending();
  }

  async refreshTrending() {
    if (this.trendingBusy()) return;
    this.trendingBusy.set(true);
    this.trendingError.set('');
    try {
      const snapshot = await this.api.trendingProducts();
      this.trendingProducts.set(snapshot.products);
      this.trendingVersion.set(snapshot.version);
      this.trendingLoaded.set(true);
    } catch (error) {
      this.trendingVersion.set('');
      this.trendingLoaded.set(false);
      if (error instanceof HttpErrorResponse && (error.status === 401 || error.status === 403)) this.sessionExpired.emit();
      else this.trendingError.set('Không thể tải danh sách nổi bật. Vui lòng thử lại.');
    } finally { this.trendingBusy.set(false); }
  }

  startTrendingDrag(index: number, event: DragEvent) {
    if (this.trendingBusy() || !this.trendingVersion()) { event.preventDefault(); return; }
    this.draggedTrendingIndex = index;
    event.dataTransfer?.setData('text/plain', String(index));
    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
  }

  endTrendingDrag() { this.draggedTrendingIndex = null; }

  async dropTrending(index: number, event: DragEvent) {
    event.preventDefault();
    const from = this.draggedTrendingIndex;
    this.draggedTrendingIndex = null;
    if (from !== null) await this.reorderTrending(from, index);
  }

  async reorderTrending(from: number, to: number) {
    const items = [...this.trendingProducts()];
    if (this.trendingBusy() || !this.trendingVersion() || from < 0 || to < 0 || from >= items.length || to >= items.length || from === to) return;
    const [item] = items.splice(from, 1);
    items.splice(to, 0, item);
    this.trendingBusy.set(true);
    this.trendingError.set('');
    this.trendingMessage.set('');
    try {
      await this.api.orderTrending(items.map(product => product.id), this.trendingVersion(), this.csrfToken);
      this.trendingVersion.set('');
      const snapshot = await this.api.trendingProducts();
      this.trendingProducts.set(snapshot.products);
      this.trendingVersion.set(snapshot.version);
      this.trendingMessage.set('Đã lưu thứ tự sản phẩm nổi bật.');
    } catch (error) {
      this.trendingVersion.set('');
      if (error instanceof HttpErrorResponse && (error.status === 401 || error.status === 403)) this.sessionExpired.emit();
      else if (error instanceof HttpErrorResponse && error.status === 409) this.trendingError.set('Danh sách đã thay đổi hoặc đang được cập nhật. Hãy tải lại trước khi sắp xếp.');
      else this.trendingError.set('Không thể lưu hoặc tải lại thứ tự. Hãy tải lại danh sách.');
    } finally { this.trendingBusy.set(false); }
  }

  async removeTrending(product: AdminTrendingProduct) {
    if (this.trendingBusy() || !this.trendingVersion()) return;
    this.trendingBusy.set(true);
    this.trendingError.set('');
    this.trendingMessage.set('');
    try {
      await this.api.removeTrending(product.id, this.trendingVersion(), this.csrfToken);
      this.trendingVersion.set('');
      const snapshot = await this.api.trendingProducts();
      this.trendingProducts.set(snapshot.products);
      this.trendingVersion.set(snapshot.version);
      this.trendingMessage.set('Đã bỏ sản phẩm khỏi danh sách nổi bật.');
    } catch (error) {
      this.trendingVersion.set('');
      if (error instanceof HttpErrorResponse && (error.status === 401 || error.status === 403)) this.sessionExpired.emit();
      else if (error instanceof HttpErrorResponse && error.status === 409) this.trendingError.set('Danh sách đã thay đổi hoặc đang được cập nhật. Hãy tải lại trước khi chỉnh sửa.');
      else this.trendingError.set('Không thể bỏ sản phẩm hoặc tải lại danh sách. Hãy tải lại danh sách.');
    } finally { this.trendingBusy.set(false); }
  }

  private async loadProducts(offset: number) {
    this.listError.set(false);
    try {
      const fetchPage = (pageOffset: number) => Object.keys(this.appliedFilters).length
        ? this.api.products(this.pageSize, pageOffset, this.appliedFilters)
        : this.api.products(this.pageSize, pageOffset);
      let result = await fetchPage(offset);
      if (offset > 0 && offset >= result.total) {
        offset = Math.max(0, Math.ceil(result.total / this.pageSize) - 1) * this.pageSize;
        result = await fetchPage(offset);
      }
      this.products.set(result.products);
      this.total.set(result.total);
      this.offset.set(offset);
      this.listLoaded.set(true);
    } catch (error) {
      this.listError.set(true);
      throw error;
    }
  }

  async applyFilters() {
    if (this.busy()) return;
    const category = this.filters.category?.trim() ?? '';
    if (category && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(category)) {
      this.error.set('Danh mục không hợp lệ.');
      return;
    }
    this.appliedFilters = Object.fromEntries(Object.entries(this.filters).map(([key, value]) => [key, value?.trim() ?? '']).filter(([, value]) => value));
    this.offset.set(0);
    await this.refresh();
  }

  async clearFilters() {
    if (this.busy()) return;
    this.filters = { search: '', status: '', trending: '', category: '', sort: '' };
    await this.applyFilters();
  }

  openRow(product: Pick<AdminProduct, 'id'>, event: MouseEvent) {
    if (event.defaultPrevented || (event.target instanceof Element && event.target.closest('a, button, input, select, textarea, [role="button"]'))) return;
    window.location.assign(`/admin/products/${this.encodeId(product.id)}/edit`);
  }

  formatPrice(product: AdminProduct): string {
    if (product.priceMinor === null) return '—';
    try {
      const formatter = new Intl.NumberFormat('vi-VN', { style: 'currency', currency: product.currency });
      const digits = formatter.resolvedOptions().maximumFractionDigits;
      if (digits === undefined) return `${product.priceMinor} ${product.currency} (đơn vị nhỏ nhất)`;
      return formatter.format(product.priceMinor / 10 ** digits);
    } catch { return `${product.priceMinor} ${product.currency} (đơn vị nhỏ nhất)`; }
  }

  async changePage(offset: number) {
    if (offset < 0 || offset >= this.total()) return;
    await this.run(async () => { await this.loadProducts(offset); });
  }

  create() {
    this.editingId.set(null); this.draft = emptyProduct(); this.images.set([]);
    this.originalTrending = null;
    this.originalHidden = null; this.isHidden = false;
    this.priceText = ''; this.priceInvalid = false;
    this.xlsxOwned.set(false);
    this.variants.set([]); this.selectedVariant.set(''); this.selectedImages.set([]);
    this.variantImagesRequest++; this.variantImagesState.set('idle');
  }

  async edit(product: AdminProduct) {
    this.setDraft(product);
    await this.run(async () => {
      const [images, variants] = await Promise.all([this.api.images(product.id), this.api.variants(product.id)]);
      this.images.set(images.images); this.variants.set(variants.variants);
    });
  }

  private setDraft(product: AdminProduct) {
    this.originalHidden = null;
    this.originalTrending = { isTrending: Boolean(product.isTrending) };
    this.editingId.set(product.id);
    this.xlsxOwned.set(Boolean(product.xlsxOwned));
    this.draft = { sku: product.sku, slug: product.slug, name: product.name, description: product.description,
      brandName: product.brandName, priceMinor: product.priceMinor, currency: product.currency,
      isActive: Boolean(product.isActive), isTrending: Boolean(product.isTrending), trendingSortOrder: product.trendingSortOrder };
    this.priceText = product.priceMinor === null ? '' : String(product.priceMinor).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    this.priceInvalid = false;
    this.images.set([]); this.variants.set([]); this.selectedVariant.set(''); this.selectedImages.set([]);
    this.variantImagesRequest++; this.variantImagesState.set('idle');
  }

  async saveVisibility() {
    const id = this.editingId();
    if (!id || this.originalHidden === null || this.isHidden === this.originalHidden || this.busy()) return;
    const isHidden = this.isHidden;
    await this.run(async () => {
      await this.api.saveVisibility(id, isHidden, this.csrfToken);
      if (this.editingId() === id) {
        this.originalHidden = isHidden;
        this.message.set('Đã lưu thiết lập hiển thị trên website.');
      }
    });
  }

  async save() {
    const id = this.editingId();
    const input: import('./admin-api').AdminProductUpdate = { ...this.draft, sku: this.xlsxOwned() ? this.draft.sku : this.draft.sku || null, description: this.draft.description || null, brandName: this.xlsxOwned() ? this.draft.brandName : this.draft.brandName || null };
    if (id) delete input.trendingSortOrder;
    if (id && this.originalTrending) {
      if (input.isTrending === this.originalTrending.isTrending) delete input.isTrending;
    }
    await this.run(async () => {
      await this.api.saveProduct(input, id, this.csrfToken);
      if (id && this.originalTrending) {
        if (input.isTrending !== undefined) this.originalTrending.isTrending = input.isTrending;
      }
      if (id) this.message.set('Đã lưu sản phẩm.');
      else window.location.assign('/admin/products');
    });
  }

  async removeProduct(product: AdminProduct) {
    if (!confirm(`Xóa ${product.name}? Không thể hoàn tác thao tác này.`)) return;
    await this.run(async () => {
      await this.api.deleteProduct(product.id, this.csrfToken);
      await this.loadProducts(this.offset());
      if (this.editingId() === product.id) this.create();
      this.message.set('Đã xóa sản phẩm.');
    });
  }

  async upload(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0]; input.value = '';
    const id = this.editingId();
    if (!file || !id) return;
    if (file.size > 5 * 1024 * 1024 || !['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(file.type)) {
      this.error.set('Chọn ảnh JPEG, PNG, WebP hoặc GIF không quá 5 MiB.'); return;
    }
    await this.run(async () => {
      const { url } = await this.api.uploadImage(file, this.csrfToken);
      try { await this.api.attachImage(id, url, this.csrfToken); }
      catch { this.error.set('Ảnh đã tải lên nhưng không thể gắn vào sản phẩm.'); return; }
      this.images.set((await this.api.images(id)).images);
      this.message.set('Đã tải lên và gắn ảnh.');
    });
  }

  async removeImage(image: AdminImage) {
    const id = this.editingId();
    if (!id || !confirm('Xóa ảnh khỏi sản phẩm và các biến thể?')) return;
    await this.run(async () => {
      await this.api.deleteImage(id, image.id, this.csrfToken);
      this.images.set((await this.api.images(id)).images);
      if (this.editingId() === id && this.selectedVariant()) await this.selectVariant(this.selectedVariant());
      this.message.set('Đã xóa ảnh.');
    });
  }

  async uploadVariant(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0]; input.value = '';
    const productId = this.editingId(), variantId = this.selectedVariant();
    const version = this.variantImagesVersion;
    const selectionRequest = this.variantImagesRequest;
    if (!file || !productId || !variantId || !version || this.busy() || this.variantImagesState() !== 'ready') return;
    if (file.size > 5 * 1024 * 1024 || !['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(file.type)) {
      this.error.set('Chọn ảnh JPEG, PNG, WebP hoặc GIF không quá 5 MiB.'); return;
    }
    let stage: 'upload' | 'attach' | 'assign' | 'refresh' = 'upload';
    await this.run(async () => {
      try {
        const { url } = await this.api.uploadImage(file, this.csrfToken);
        stage = 'attach';
        const { id } = await this.api.attachImage(productId, url, this.csrfToken);
        stage = 'assign';
        await this.api.attachVariantImage(productId, variantId, id, this.csrfToken, version);
        stage = 'refresh';
        const [productImages, variantImages] = await Promise.all([this.api.images(productId), this.api.images(productId, variantId)]);
        if (this.editingId() === productId) this.images.set(productImages.images);
        if (this.editingId() === productId && this.selectedVariant() === variantId && selectionRequest === this.variantImagesRequest) {
          ++this.variantImagesRequest;
          this.selectedImages.set(variantImages.images.map(image => image.id));
          this.variantImagesVersion = variantImages.version ?? '';
          this.variantImagesState.set(this.variantImagesVersion ? 'ready' : 'error');
        }
        if (this.editingId() === productId && this.selectedVariant() === variantId) this.message.set('Đã tải ảnh lên, thêm vào sản phẩm và gắn cho biến thể đã chọn.');
      } catch (error) {
        if (stage === 'assign' || stage === 'refresh') {
          try {
            const productImages = await this.api.images(productId);
            if (this.editingId() === productId) this.images.set(productImages.images);
          } catch { /* The message below asks for a reload. */ }
        }
        if (this.editingId() === productId && this.selectedVariant() === variantId && (stage === 'assign' || stage === 'refresh')) {
          ++this.variantImagesRequest;
          this.variantImagesState.set('error');
          if (stage === 'assign' && error instanceof HttpErrorResponse && error.status === 409) await this.selectVariant(variantId);
        }
        if (error instanceof HttpErrorResponse && (error.status === 401 || error.status === 403)) this.sessionExpired.emit();
        this.error.set(stage === 'upload' ? 'Không thể tải ảnh lên. Vui lòng thử lại.'
          : stage === 'attach' ? 'Ảnh đã tải lên nhưng chưa thể thêm vào sản phẩm.'
          : stage === 'assign' ? 'Ảnh đã thêm vào sản phẩm nhưng chưa thể gắn vào biến thể. Hãy tải lại và chọn ảnh trong thư viện.'
          : 'Ảnh đã thêm vào sản phẩm và biến thể, nhưng không thể tải lại danh sách. Hãy tải lại trang.');
      }
    });
  }

  async moveImage(index: number, delta: number, variant = false) {
    await this.reorderImages(index, index + delta, variant);
  }

  async reorderImages(index: number, target: number, variant = false) {
    const id = this.editingId(), variantId = this.selectedVariant();
    const version = this.variantImagesVersion;
    const selectionRequest = this.variantImagesRequest;
    const ids = variant ? [...this.selectedImages()] : this.images().map(image => image.id);
    if (!id || (variant && (!variantId || !version || this.variantImagesState() !== 'ready')) || index < 0 || index >= ids.length || target < 0 || target >= ids.length || index === target) return;
    const [item] = ids.splice(index, 1);
    ids.splice(target, 0, item);
    await this.run(async () => {
      let result;
      try { result = await this.api.orderImages(id, ids, this.csrfToken, variant ? variantId : undefined, variant ? version : undefined); }
      catch (error) { if (variant && await this.reloadVariantConflict(error, id, variantId)) return; throw error; }
      if (variant && this.editingId() === id && this.selectedVariant() === variantId && selectionRequest === this.variantImagesRequest) {
        this.selectedImages.set(ids); this.variantImagesVersion = result.version ?? '';
        if (!this.variantImagesVersion) this.variantImagesState.set('error');
      }
      else if (variant) return;
      else this.images.set((await this.api.images(id)).images);
      this.message.set('Đã lưu thứ tự ảnh.');
    });
  }

  async selectVariant(id: string) {
    const request = ++this.variantImagesRequest;
    const changed = this.selectedVariant() !== id;
    this.selectedVariant.set(id); this.selectedImages.set([]);
    this.variantImagesVersion = '';
    this.variantImagesState.set('idle');
    if (changed) this.variantDescription = this.variants().find(item => item.id === id)?.description ?? '';
    const productId = this.editingId();
    if (!id || !productId) return;
    this.variantImagesState.set('loading');
    try {
      const result = await this.api.images(productId, id);
      if (request !== this.variantImagesRequest || this.editingId() !== productId) return;
      this.selectedImages.set(result.images.map(image => image.id));
      this.variantImagesVersion = result.version ?? '';
      this.variantImagesState.set(this.variantImagesVersion ? 'ready' : 'error');
    } catch (error) {
      if (request !== this.variantImagesRequest || this.editingId() !== productId) return;
      this.variantImagesState.set('error');
      if (error instanceof HttpErrorResponse && (error.status === 401 || error.status === 403)) this.sessionExpired.emit();
    }
  }

  async toggleVariantImage(imageId: string, checked: boolean, checkbox?: HTMLInputElement) {
    const productId = this.editingId(), variantId = this.selectedVariant();
    const version = this.variantImagesVersion;
    const selectionRequest = this.variantImagesRequest;
    if (!productId || !variantId || !version || this.variantImagesState() !== 'ready') {
      if (checkbox) checkbox.checked = this.selectedImages().includes(imageId);
      return;
    }
    const ids = checked ? [...this.selectedImages(), imageId] : this.selectedImages().filter(id => id !== imageId);
    await this.run(async () => {
      let result;
      try { result = await this.api.orderImages(productId, ids, this.csrfToken, variantId, version); }
      catch (error) { if (await this.reloadVariantConflict(error, productId, variantId)) return; throw error; }
      if (this.editingId() === productId && this.selectedVariant() === variantId && selectionRequest === this.variantImagesRequest) {
        this.selectedImages.set(ids); this.variantImagesVersion = result.version ?? '';
        if (!this.variantImagesVersion) this.variantImagesState.set('error');
        this.message.set('Đã lưu ảnh biến thể.');
      }
    });
    if (checkbox) checkbox.checked = this.selectedImages().includes(imageId);
  }

  private async reloadVariantConflict(error: unknown, productId: string, variantId: string): Promise<boolean> {
    if (!(error instanceof HttpErrorResponse) || error.status !== 409) return false;
    if (this.editingId() === productId && this.selectedVariant() === variantId) {
      await this.selectVariant(variantId);
      this.error.set(this.variantImagesState() === 'ready'
        ? 'Ảnh biến thể đã thay đổi hoặc đang được cập nhật. Danh sách đã được tải lại; vui lòng kiểm tra và thử lại.'
        : 'Không thể tải lại ảnh biến thể. Vui lòng tải lại trước khi thử lại.');
    }
    return true;
  }

  async saveVariantDescription() {
    const productId = this.editingId(), variantId = this.selectedVariant();
    if (!productId || !variantId) return;
    const description = this.variantDescription || null;
    await this.run(async () => {
      await this.api.saveVariantDescription(productId, variantId, description, this.csrfToken);
      this.variants.update(items => items.map(item => item.id === variantId ? { ...item, description } : item));
      this.message.set('Đã lưu mô tả biến thể.');
    });
  }

  updatePrice(input: HTMLInputElement) {
    const raw = input.value;
    const digits = raw.replace(/\./g, '');
    const valid = /^\d*$/.test(digits) && (!digits || Number.isSafeInteger(Number(digits)));
    this.priceInvalid = !valid;
    input.setCustomValidity(valid ? '' : 'Giá phải là số nguyên không âm trong phạm vi cho phép.');
    if (!valid) { this.priceText = raw; return; }
    const before = raw.slice(0, input.selectionStart ?? raw.length).replace(/\./g, '').length;
    this.draft.priceMinor = digits ? Number(digits) : null;
    this.priceText = digits.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    input.value = this.priceText;
    let position = 0, count = 0;
    while (position < this.priceText.length && count < before) {
      if (this.priceText[position] !== '.') count++;
      position++;
    }
    input.setSelectionRange(position, position);
  }

  startImageDrag(index: number, variant: boolean, event: DragEvent) {
    if (this.busy()) { event.preventDefault(); return; }
    this.draggedImage = { index, variant };
    event.dataTransfer?.setData('text/plain', String(index));
    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
  }
  endImageDrag() { this.draggedImage = null; }
  async dropImage(index: number, variant: boolean, event: DragEvent) {
    event.preventDefault();
    const dragged = this.draggedImage;
    this.draggedImage = null;
    if (dragged?.variant === variant) await this.reorderImages(dragged.index, index, variant);
  }

  openPreview(dialog: HTMLDialogElement, url: string, image: HTMLImageElement) {
    image.src = url;
    dialog.showModal();
  }

  imageUrl(id: string): string { return this.images().find(image => image.id === id)?.url ?? ''; }
  encodeId(id: string): string { return encodeURIComponent(id); }
}
