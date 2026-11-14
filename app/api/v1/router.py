from fastapi import APIRouter

from app.api.v1 import catalog, community, jobs, locations, results

router = APIRouter()
for routes in [locations.router, catalog.router, jobs.router, results.router, community.router]:
    router.include_router(routes)