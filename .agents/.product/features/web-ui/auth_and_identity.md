# Feature: Auth & Identity

## User Flow
Users log in to the dashboard to manage their accounts, signals, and trades. The system supports multi-user isolation.

## Key Capabilities
- **Role-Based Access**: Support for `admin` and `user` roles.
- **Session Management**: Secure cookie-based sessions with JWT/Hash verification.
- **Profile Management**: Users can update their names, passwords, and custom metadata.
- **Multi-Account Mapping**: A single user can manage multiple broker accounts (MT5/Binance).

## Technical Details
- **Endpoints**: `/auth/login`, `/auth/logout`, `/auth/me`, `/auth/profile`.
- **Database**: `users` and `user_accounts` tables.
- **Security**: Password hashing with salt, API key hashing for account security.
