# 42Pay DB Design

## Physical Storage

Provider:

- universal-store facade backed by SQLite or Postgres adapters

SQLite demo / local adapter location:

- `.local/universal-store.sqlite` or environment-specific adapter path

Primary physical tables:

- `object_entities`
- `object_links`
- `object_journal`
- `object_processes`

42Pay uses logical entity types in the universal-store tables instead of adding many dedicated SQL tables.

## Logical Tables

### `products`

Stored as `object_entities.entity_type = 42pay_products`

Fields:

- `id`
- `sid`
- `name`
- `image`
- `type`
- `status`
- `metadata`
- `create_at`
- `create_sid`

Added fields:

- `updated_at`

Notes:

- `create_sid` is the seller / creator user ID
- `metadata` stores catalog-specific details like city, country, nights, and description

### `product_offers`

Stored as `object_entities.entity_type = 42pay_product_offers`

Fields:

- `id`
- `sid`
- `product_id`
- `price`
- `tax`
- `qr_code`
- `seller_id`
- `metadata`
- `status`
- `create_at`
- `start_at`
- `end_at`

Added fields:

- `qr_code_image`
- `updated_at`

Notes:

- `qr_code` stores the encoded 42Pay payload string
- `qr_code_image` stores a renderable QR image data URL
- `metadata` holds commerce-specific details like offer name, currency, inventory

### `product_orders`

Stored as `object_entities.entity_type = 42pay_product_orders`

Fields:

- `id`
- `sid`
- `product_offer_id`
- `profit`
- `tax`
- `buyer_id`
- `metadata`
- `start_at`
- `close_at`
- `create_at`

Added fields:

- `status`
- `updated_at`

Notes:

- `profit` is currently used as the seller revenue-before-tax figure from the selected offer
- `metadata` stores `seller_id`, `product_id`, payment method, and original QR payload

## Universal-Store Notes

42Pay records should use governance columns in `object_entities`:

- `scope_type = TENANT` for tenant-owned catalog/order rows
- `scope_module = 42pay`
- `visibility = PRIVATE`, `TENANT`, or `PUBLIC` depending on page exposure
- `access_level` to distinguish owner-only vs tenant-visible records

Wallet identity and current balance snapshots live in `object_entities`, while wallet movement history belongs in `object_journal`.
