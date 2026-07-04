# 42Pay DB Design

## Physical Storage

Provider:

- existing object-store SQLite provider

SQLite location:

- shared `42trade` object-store layout under `data/users/.../object_store.db`
- 42Pay records are stored under the logical scope `__42pay__`

Internal physical table:

- `object_store`

42Pay uses logical object types instead of new hard SQL tables. This keeps the storage implementation aligned with the current `42trade` repository patterns while preserving the requested product / offer / order design.

## Logical Tables

### `products`

Stored as object type: `42pay_products`

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

Stored as object type: `42pay_product_offers`

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

Stored as object type: `42pay_product_orders`

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

## Suggested Future Expansion

When 42Pay needs stronger relational guarantees, the next evolution can lift these logical tables into dedicated Drizzle-managed SQLite tables:

- `pay42_products`
- `pay42_product_offers`
- `pay42_product_orders`
- `pay42_payments`
- `pay42_refunds`
- `pay42_inventory_reservations`

For the initial release, the object-store model keeps the implementation faster, lower-risk, and easier to ship inside the existing application.
