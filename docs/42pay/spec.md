# 42Pay Module Spec

## Goal

Embed a reusable B2C commerce subsystem inside `42trade` that supports:

- `admin`: manage 42Pay users and monitor marketplace activity
- `seller`: manage products, publish offers, generate QR codes, and review transactions
- `buyer`: browse offers, create orders from offers, and review purchases

The first vertical targets hospitality-style inventory so the seed data feels real, but the model is generic enough to evolve into:

- Airbnb-like stay inventory
- Amazon-like catalog + offer marketplace
- Shopify-like seller-owned storefront operations

## Initial Scope

### Seller

- Create and update products
- Create and update offers
- Generate a QR code for every offer
- Review transactions from incoming orders
- View a seller dashboard with product / offer / sales counts

### Buyer

- View active offers
- Create an order from an offer
- Scan a 42Pay QR payload to create an order
- Review order history and total spend

### Admin

- View 42Pay role users with seller / buyer activity counts
- Use existing system user management for role assignment and edits
- View marketplace KPI summary

## Role Model

Canonical roles:

- `admin`
- `seller`
- `buyer`

Compatibility rules:

- legacy `user` is normalized to `buyer`
- legacy `merchant` is normalized to `seller`
- legacy `system` is normalized to `admin`

## Permissions

42Pay-specific page permissions:

- `pages.42pay.dashboard`
- `pages.42pay.products`
- `pages.42pay.offers`
- `pages.42pay.orders`
- `pages.42pay.admin.users`

42Pay-specific API permissions:

- `apis.42pay.dashboard.read`
- `apis.42pay.products.read`
- `apis.42pay.products.write`
- `apis.42pay.offers.read`
- `apis.42pay.offers.write`
- `apis.42pay.orders.read`
- `apis.42pay.orders.write`
- `apis.42pay.scan.write`
- `apis.42pay.admin.users.read`

## UI Surface

Routes:

- `/42pay/dashboard`
- `/42pay/products`
- `/42pay/offers`
- `/42pay/orders`
- `/42pay/admin/users`

Navigation:

- a dedicated `42Pay` top menu is shown when the authenticated user has at least one 42Pay page permission
- authenticated home routing prefers `/42pay/dashboard` when available

## QR Flow

Each offer stores:

- a QR payload string in `qr_code`
- a rendered QR image data URL in `qr_code_image`

The encoded payload is a namespaced `42pay:` JSON envelope that includes:

- offer SID
- seller SID
- price
- tax

Buyer order creation currently supports:

- direct order creation from an offer card
- QR scan simulation by submitting the QR payload string

## Seeded Demo Data

Demo users:

- `42pay.admin` / `123456`
- `42pay.seller` / `123456`
- `42pay.buyer` / `123456`

Seed products focus on real hotel inventory:

- Marina Bay Suites Singapore
- Kyoto Garden Ryokan Escape
- Alpine Lake Retreat Zurich
- Old Quarter Heritage Hanoi

Each seeded product has a matching active offer and initial order history.

## Storage Strategy

42Pay data is stored through the existing SQLite object-store provider inside the shared `42trade` data tree.

Physical storage follows the same object-store layout already used by the main app, so 42Pay is not a sidecar repo or standalone database.

Logical collections:

- `42pay_products`
- `42pay_product_offers`
- `42pay_product_orders`

This keeps the implementation SQLite-backed while avoiding a second migration stack inside the existing app runtime.

## Non-Goals For This Iteration

- camera-based QR scanning
- payment gateway integration
- checkout settlement / refunds
- inventory reservation workflows
- storefront theming
- multi-seller commissions
