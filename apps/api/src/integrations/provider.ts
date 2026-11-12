/**
 * Provider-side records are not public catalog records. External identifiers
 * must be resolved to stable internal IDs before persisting or serving them.
 * An omitted field is unknown or unavailable; null explicitly clears a value.
 */
export interface ExternalProduct {
  externalId: string;
  name: string;
  sku?: string | null;
  shortDescription?: string | null;
  description?: string | null;
  brandName?: string | null;
  /** Nonnegative integer in the currency's minor unit. */
  priceMinor?: number | null;
  currency?: string;
  isActive?: boolean;
  /** UTC ISO-8601 timestamp when reliably available. */
  sourceUpdatedAt?: string | null;
  /** Complete provider category relationships when present; [] clears them. */
  categoryExternalIds?: string[];
  /** Complete provider image list when present; [] clears it. */
  images?: ExternalProductImage[];
  /** Complete provider variant list when present; [] clears it. */
  variants?: ExternalProductVariant[];
}

export interface ExternalProductImage {
  sourceUrl: string;
  altText?: string | null;
  position?: number;
}

export interface ExternalProductVariant {
  externalId?: string | null;
  name: string;
  sku?: string | null;
  attributesJson?: string | null;
  priceMinor?: number | null;
  isActive?: boolean;
}

export interface ExternalCategory {
  externalId: string;
  name: string;
  parentExternalId?: string | null;
  isActive?: boolean;
  /** UTC ISO-8601 timestamp when reliably available. */
  sourceUpdatedAt?: string | null;
}

/** Continuations are opaque to callers and must be passed back unchanged. */
export interface ProviderPageInput {
  continuation?: string;
  pageSize?: number;
}

export interface ProviderPage<T> {
  items: T[];
  /** Null means the collection has been exhausted. */
  nextContinuation: string | null;
}

/** Failures reject; null from getProduct means a confirmed missing product. */
export interface CatalogProvider {
  listProducts(input: ProviderPageInput): Promise<ProviderPage<ExternalProduct>>;
  getProduct(externalId: string): Promise<ExternalProduct | null>;
  listCategories(input: ProviderPageInput): Promise<ProviderPage<ExternalCategory>>;
}
