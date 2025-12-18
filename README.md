# Gel Invent

Minimal FastAPI-based inventory management service scaffold. Tracks products and stock movements using FastAPI + SQLite by default.

## Tech stack
- Python 3.11+
- FastAPI
- Uvicorn
- SQLAlchemy + PyMySQL
- MySQL database

## Quickstart

### Database setup (MySQL Workbench)
1. Open MySQL Workbench and create a new database: `CREATE DATABASE gelinvent;`
2. Copy `.env.example` to `.env` and update credentials:
   ```bash
   cp .env.example .env
   # Edit .env with your MySQL username, password, and connection details
   ```

### Backend setup
1. Create a virtual environment: `python -m venv .venv` then activate it (`source .venv/bin/activate` on macOS/Linux).
2. Install dependencies: `pip install -r requirements.txt`.
3. Run the dev server: `uvicorn app.main:app --reload`.
4. Visit `http://127.0.0.1:8000/health` to verify the API is running.
   - Tables are created automatically on first start via SQLAlchemy migrations.## Frontend (Vite + React)
1. `cd frontend && npm install`
2. Start dev server: `npm run dev` (defaults to http://127.0.0.1:5173).
3. Lint: `npm run lint`.
4. Backend base URL defaults to `http://127.0.0.1:8000`. Override with `VITE_API_BASE` env at run time if different.
5. Build for production: `npm run build`.

If VS Code shows unresolved Python imports, select the correct interpreter and install deps:

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

## API quick tour
- `GET /health` – health probe.
- `POST /products` – create a product `{ "sku": "ABC-1", "name": "Widget" }`.
- `GET /products` – list products.
- `GET /products/{id}` – fetch one product.
- `POST /products/{id}/movements` – record stock movement `{ "change": 5, "reason": "initial stock" }`.
- `GET /products/{id}/movements` – list movements for a product.

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
