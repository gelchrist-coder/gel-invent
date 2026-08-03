# Gel Invent

FastAPI-based inventory management service with a React (Vite) frontend.

## Tech stack
- Python 3.11+
- FastAPI
- Uvicorn
- SQLAlchemy
- PostgreSQL (Supabase recommended)

## Quickstart

### Database setup (Supabase)
1. Create a Supabase project and get the project connection string.
2. Copy `.env.example` to `.env` and update `DATABASE_URL`:
     ```bash
     cp .env.example .env
     # Edit .env with your Supabase connection string (includes sslmode=require)
     ```
3. To have users appear in Supabase Dashboard -> Authentication -> Users,
   also set `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` in `.env`.

### Backend setup
1. Create a virtual environment: `python -m venv .venv` then activate it (`source .venv/bin/activate` on macOS/Linux).
2. Install dependencies: `pip install -r requirements.txt`.
3. Run the dev server: `uvicorn app.main:app --reload`.
4. Visit `http://127.0.0.1:8000/health` to verify the API is running.

### Forgot password email setup
To actually send reset codes by email, configure SMTP env vars:
- `SMTP_HOST` (required)
- `SMTP_PORT` (default `587`)
- `SMTP_USER`
- `SMTP_PASSWORD` (or `SMTP_PASS`)
- `SMTP_FROM` (optional sender address)
- `SMTP_FROM_NAME` (optional sender display name, default `Gel Invent`)
- `SMTP_USE_TLS=1` (recommended)

For local testing without SMTP delivery, set:
- `PASSWORD_RESET_DEBUG=1`

Then `/auth/password-reset/request` also returns `reset_code` in the JSON response.

### Frontend (Vite + React)
1. `cd frontend && npm install`
2. Start dev server: `npm run dev` (defaults to http://127.0.0.1:5173).
3. Lint: `npm run lint`.
4. Backend base URL defaults to `http://127.0.0.1:8000`. Override with `VITE_API_URL` env at run time if different.
5. Build for production: `npm run build`.

## Deployment

### Backend (Vercel)
1. Set `DATABASE_URL` in Vercel Project Settings (from Supabase).
2. Deploy the root of this repository to Vercel.
3. Vercel will serve the FastAPI app from `api/index.py`.

### Frontend (Vercel)
1. Update [frontend/.env.production](frontend/.env.production) with your backend URL.
2. Deploy the `frontend` folder as a separate Vercel project.

## API quick tour
- `GET /health` – health probe.
- `POST /products` – create a product `{ "sku": "ABC-1", "name": "Widget" }`.
- `GET /products` – list products.
- `GET /products/{id}` – fetch one product.
- `POST /products/{id}/movements` – record stock movement `{ "change": 5, "reason": "initial stock" }`.
- `GET /products/{id}/movements` – list movements for a product.

## Authentication behavior
- The app keeps business profile data in `public.users` (application table).
- New signups and new employees can also be provisioned in Supabase Auth (`auth.users`) when `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are configured.
- Supabase Dashboard -> Authentication -> Users only displays `auth.users`, not `public.users`.

### Verify where users are stored
Run in Supabase SQL editor:

```sql
select 'public.users' as table_name, count(*) from public.users
union all
select 'auth.users' as table_name, count(*) from auth.users;
```

Inspect recent rows:

```sql
select id, email, created_at from public.users order by created_at desc limit 20;
select id, email, created_at from auth.users order by created_at desc limit 20;
```

## Data export/import (Admin)
- `GET /data/export` – downloads a JSON backup (best for restoring/import later).
- `POST /data/import?force=true|false` – imports a prior JSON backup (with optional replace).
- `GET /data/export/xlsx?days=30` – downloads an Excel workbook with recent Products, Sales, and Inventory Movements.

### Example curl flow
```bash
curl -X POST http://127.0.0.1:8000/products \
    -H "Content-Type: application/json" \
    -d '{"sku":"SKU-001","name":"Test Widget"}'

curl http://127.0.0.1:8000/products

curl -X POST http://127.0.0.1:8000/products/1/movements \
    -H "Content-Type: application/json" \
    -d '{"change":10,"reason":"initial stock"}'
```

## Next steps
- Add pagination and filtering for listings.
- Add auth (JWT/basic) if needed.
- Add inventory valuation/reporting endpoints.
