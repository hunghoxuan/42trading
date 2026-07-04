# 42Pay Tickets

## Done In This Slice

### T1. Role and ACL migration

- normalize legacy `user` to `buyer`
- normalize legacy `merchant` to `seller`
- add 42Pay page and API permissions
- add authenticated home routing that prefers 42Pay

### T2. SQLite-backed 42Pay repository

- add `src/api/modules/42pay/repo.js`
- back 42Pay data with the shared `42trade` SQLite object-store layout
- seed products, offers, orders, and QR codes

### T3. 42Pay API endpoints

- `GET /42pay/dashboard`
- `GET/POST/PUT /42pay/products`
- `GET/POST/PUT /42pay/offers`
- `GET/POST /42pay/orders`
- `POST /42pay/scan`
- `GET /42pay/admin/users`

### T4. 42Pay frontend pages

- dashboard
- products
- offers
- orders / transactions
- admin users overview

### T5. Demo data refresh

- canonical demo users:
  - `42pay.admin`
  - `42pay.seller`
  - `42pay.buyer`
- canonical password:
  - `123456`

## Next Tickets

### T6. Camera QR scanning

- add browser camera scanning flow for buyer mobile usage

### T7. Payment workflow

- integrate payment status lifecycle
- split `order created` from `order paid`
- add settlement timestamps and failure reasons

### T8. Offer lifecycle tooling

- seller-side activation / deactivation / expiration controls
- stock and inventory editing
- duplication of popular offers

### T9. Marketplace admin controls

- module-specific seller approval and suspension
- buyer support actions
- offer moderation

### T10. Analytics

- GMV trend chart
- seller ranking
- buyer repeat purchase rate
- offer conversion funnel
