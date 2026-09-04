"""Operator diagnostics: fetch a procurement portal URL from the scraper's own egress.

Used to answer "is this source reachable from Vercel's IPs?" (e.g. MERX blocks
datacenter ranges) without deploying a crawler change. Restricted to known
procurement hosts to avoid turning the service into an open proxy.
"""

from __future__ import annotations

from urllib.parse import urlparse

import requests
from fastapi import APIRouter, Depends, HTTPException, Query

from src.api.auth import verify_api_key

router = APIRouter(prefix="/api/diagnostics", tags=["diagnostics"])

ALLOWED_HOST_SUFFIXES = (
    "merx.com", "canadabuys.canada.ca", "sam.gov", "biddingo.com", "bidsandtenders.ca",
    "sasktenders.ca", "purchasing.alberta.ca", "purchasingconnection.ca", "seao.ca",
    "seao.gouv.qc.ca", "donneesquebec.ca", "toronto.ca", "bcbid.gov.bc.ca", "procurement.novascotia.ca",
    "bidnetdirect.com", "bonfirehub.ca", "ontariotenders.app.jaggaer.com",
)

_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"


@router.get("/fetch", dependencies=[Depends(verify_api_key)])
def probe_fetch(url: str = Query(..., min_length=8), timeout: int = Query(20, ge=1, le=60)) -> dict:
    host = (urlparse(url).hostname or "").lower()
    if not host.endswith(ALLOWED_HOST_SUFFIXES):
        raise HTTPException(status_code=400, detail="Host not in the allowed procurement-portal list")
    try:
        resp = requests.get(url, headers={"User-Agent": _UA, "Accept": "text/html,application/json"}, timeout=timeout, allow_redirects=True)
    except requests.RequestException as exc:
        return {"url": url, "ok": False, "error": str(exc)[:300]}
    body = resp.text or ""
    return {
        "url": url,
        "final_url": resp.url,
        "status": resp.status_code,
        "content_type": resp.headers.get("content-type"),
        "server": resp.headers.get("server"),
        "cf_ray": resp.headers.get("cf-ray"),
        "length": len(body),
        "looks_blocked": any(k in body.lower() for k in ("access denied", "captcha", "cf-challenge", "just a moment", "request blocked")),
        "snippet": body[:400],
    }
