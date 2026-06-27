from fastapi import FastAPI

from app.main import app as api_app

# Single combined deployment: the built React app is served as static files and
# the FastAPI app is mounted under /api, so the whole product runs from one
# origin (no second project, no cross-origin proxy, no CORS). The frontend calls
# "/api/..." which maps to the API routes here.
app = FastAPI()
app.mount("/api", api_app)


@app.get("/api")
def api_root() -> dict[str, str]:
    return {"message": "Gel Invent API", "status": "healthy"}
