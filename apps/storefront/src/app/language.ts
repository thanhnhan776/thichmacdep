import { DOCUMENT } from '@angular/common';
import { Injectable, afterNextRender, inject, signal } from '@angular/core';

export type Language = 'vi' | 'en';
const messages = {
  vi: { language: 'Ngôn ngữ', loading: 'Đang tải…', tikTok: 'TikTok', instagram: 'Instagram', zalo: 'Zalo', messenger: 'Messenger', otherContact: 'Liên hệ', skip: 'Đến nội dung', menu: 'Danh mục điều hướng', close: 'Đóng menu', open: 'Menu', home: 'Trang chủ', products: 'Tất cả sản phẩm', categories: 'Danh mục', catalogue: 'Danh mục sản phẩm', contact: 'Liên hệ', unavailable: 'Thông tin cửa hàng hiện không khả dụng.', collection: 'Bộ sưu tập', search: 'Tìm kiếm sản phẩm', searchPlaceholder: 'Tìm trong bộ sưu tập', searchButton: 'Tìm', all: 'Tất cả', breadcrumb: 'Đường dẫn', productCategories: 'Danh mục sản phẩm', productPages: 'Trang sản phẩm', previous: 'Trước', next: 'Tiếp', page: 'Trang', previousPage: 'Trang trước', nextPage: 'Trang tiếp theo', results: 'kết quả', showing: 'Đang hiển thị', of: 'trong tổng số', noProducts: 'Không có sản phẩm trên trang này', tryOther: 'Thử tìm kiếm hoặc danh mục khác, hoặc quay lại trang trước.', viewAll: 'Xem tất cả sản phẩm', invalid: 'Tìm kiếm không hợp lệ', checkSearch: 'Vui lòng kiểm tra và thử lại.', categoryMissing: 'Không tìm thấy danh mục', categoryUnavailable: 'Danh mục này hiện không khả dụng.', catalogUnavailable: 'Danh mục sản phẩm hiện không khả dụng', loadError: 'Không thể tải bộ sưu tập. Vui lòng thử lại sau.', images: 'Hình ảnh sản phẩm', viewImage: 'Xem hình ảnh', imageUnavailable: 'Không có hình ảnh', noImagePrefix: 'Không có hình ảnh:', priceContact: 'Liên hệ để biết giá', variant: 'Phiên bản', contactStore: 'Liên hệ cửa hàng', askStore: 'Hỏi cửa hàng về tình trạng hàng và giao hàng.', copyInquiry: 'Sao chép yêu cầu sản phẩm', copied: 'Đã sao chép yêu cầu sản phẩm.', copyFailed: 'Không thể sao chép. Vui lòng liên hệ trực tiếp cửa hàng.', description: 'Mô tả', productMissing: 'Không tìm thấy sản phẩm', browse: 'Xem sản phẩm', productUnavailable: 'Sản phẩm hiện không khả dụng', tryLater: 'Vui lòng thử lại sau.', pageMissing: 'Không tìm thấy trang', size: 'Kích cỡ', switch: 'Switch to English' },
  en: { language: 'Language', loading: 'Loading…', tikTok: 'TikTok', instagram: 'Instagram', zalo: 'Zalo', messenger: 'Messenger', otherContact: 'Contact', skip: 'Skip to content', menu: 'Main navigation', close: 'Close menu', open: 'Menu', home: 'Home', products: 'All products', categories: 'Categories', catalogue: 'Catalogue', contact: 'Contact', unavailable: 'Store information is currently unavailable.', collection: 'The collection', search: 'Search products', searchPlaceholder: 'Search the collection', searchButton: 'Search', all: 'All', breadcrumb: 'Breadcrumb', productCategories: 'Product categories', productPages: 'Product pages', previous: 'Previous', next: 'Next', page: 'Page', previousPage: 'Previous page', nextPage: 'Next page', results: 'results', showing: 'Showing', of: 'of', noProducts: 'No products on this page', tryOther: 'Try another search or category, or return to an earlier page.', viewAll: 'View all products', invalid: 'Invalid search', checkSearch: 'Please check your search and try again.', categoryMissing: 'Category not found', categoryUnavailable: 'That category is not available.', catalogUnavailable: 'Catalog unavailable', loadError: "We couldn't load the collection. Please try again later.", images: 'Product images', viewImage: 'View image', imageUnavailable: 'Image unavailable', noImagePrefix: 'No image:', priceContact: 'Contact for price', variant: 'Variant', contactStore: 'Contact the store', askStore: 'Ask the store about availability and delivery.', copyInquiry: 'Copy product inquiry', copied: 'Copied product inquiry.', copyFailed: 'Unable to copy. Please contact the store directly.', description: 'Description', productMissing: 'Product not found', browse: 'Browse products', productUnavailable: 'Product unavailable', tryLater: 'Please try again later.', pageMissing: 'Page not found', size: 'Size', switch: 'Chuyển sang tiếng Việt' },
} as const;

@Injectable({ providedIn: 'root' })
export class LanguageService {
  private readonly document = inject(DOCUMENT);
  readonly current = signal<Language>('vi');
  readonly text = () => messages[this.current()];
  constructor() {
    afterNextRender(() => {
      const saved = globalThis.localStorage?.getItem('storefront-language');
      if (saved === 'vi' || saved === 'en') this.set(saved);
    });
  }
  set(language: Language): void {
    this.current.set(language);
    this.document.documentElement.lang = language;
    if (typeof globalThis.localStorage !== 'undefined') globalThis.localStorage.setItem('storefront-language', language);
  }
  toggle(): void { this.set(this.current() === 'vi' ? 'en' : 'vi'); }
  formatPrice(amount: number, language = this.current()): string {
    return `${new Intl.NumberFormat(language === 'vi' ? 'vi-VN' : 'en-US').format(amount)} ₫`;
  }
}
