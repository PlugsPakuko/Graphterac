from pathlib import Path
from typing import Dict, List, Optional

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

import os
import sys
import asyncio

# On Windows the default event loop must support subprocesses for Playwright to spawn
# browser processes. Ensure the Proactor event loop policy is used so
# asyncio.create_subprocess_exec is implemented.
if sys.platform.startswith("win"):
    try:
        asyncio.set_event_loop_policy(asyncio.WindowsProactorEventLoopPolicy())
    except Exception:
        # If this fails for any reason, continue; Playwright errors will be handled
        pass

from backend.docker_api import (
    is_ip_alive,
    is_subdomain_alive,
    run_dnsx,
    run_naabu_with_nmap,
    subdomain_enum
)
from backend.cypher_api import create_full_scan_graph


app = FastAPI(title="Cyber Scan API")
app.add_middleware(
    CORSMiddleware,
    # Allow the frontend dev server origins. Keep these explicit for security in dev.
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class ScanRequest(BaseModel):
    domain: str


class PortInfo(BaseModel):
    number: int
    status: Optional[str] = None
    service: Optional[str] = None


class HostInfo(BaseModel):
    subdomain: str
    subdomain_alive: bool
    ip: str
    alive: bool
    ports: List[PortInfo]


class GraphNode(BaseModel):
    id: str
    label: str
    category: str
    alive: Optional[bool] = None
    status: Optional[str] = None
    # Optional extra fields for port nodes
    number: Optional[int] = None
    service: Optional[str] = None


class GraphEdge(BaseModel):
    source: str
    target: str
    label: str


class ScanGraphResponse(BaseModel):
    nodes: List[GraphNode]
    edges: List[GraphEdge]


@app.post("/api/scan", response_model=ScanGraphResponse)
async def scan_domain(payload: ScanRequest) -> ScanGraphResponse:
    """Run a scan and return a graph-style response (nodes + edges).

    Flow changed to:
    1) Subdomain discovery (subdomain_enum)
    2) Subdomain reachability (is_subdomain_alive)
    3) Resolve to IPs (dnsx)
    4) Scan each unique IP once (is_ip_alive + run_naabu_with_nmap)
    """
    domain = payload.domain.strip()
    if not domain:
        raise HTTPException(status_code=400, detail="Domain is required.")

    project_root = _get_project_root(domain)
    project_root.mkdir(parents=True, exist_ok=True)

    # 1) Subdomain discovery
    subdomains = subdomain_enum(domain)
    (project_root / "subdomains.txt").write_text("\n".join(subdomains), encoding="utf-8")

    if not subdomains:
        return ScanGraphResponse(nodes=[], edges=[])

    # 2) Check for subdomain reachability
    sub_alive_map: Dict[str, bool] = {}
    for sub in subdomains:
        sub_alive_map[sub] = is_subdomain_alive(sub)

    # 2.a) Take screenshots for reachable subdomains and save under projects/{domain}/screenshot
    screenshot_dir = project_root / "screenshot"
    screenshot_dir.mkdir(parents=True, exist_ok=True)

    for sub, alive in sub_alive_map.items():
        if not alive:
            continue
        try:
            # Use async screenshot helper since we're inside an async endpoint
            took = await _take_screenshot(sub, screenshot_dir)
            if took:
                # non-fatal informational message
                print(f"Screenshot saved for {sub} in {screenshot_dir}")
            else:
                print(f"Screenshot skipped/failed for {sub}")
        except Exception as e:
            print(f"Error taking screenshot for {sub}: {e}")

    # 3) Resolve to IPs via dnsx
    sub_to_ips = run_dnsx(domain, subdomains)

    # Collect unique IPs
    unique_ips = set()
    for ips in sub_to_ips.values():
        for ip in ips:
            unique_ips.add(ip)

    # 4) Scan each unique IP exactly once
    ip_scan_results: Dict[str, Dict] = {}
    for ip in unique_ips:
        alive = is_ip_alive(ip)
        ports_raw = run_naabu_with_nmap(ip) if alive else []
        ip_scan_results[ip] = {
            "alive": alive,
            "ports": [PortInfo(**p) for p in ports_raw],
            "ports_raw": ports_raw,
        }

    # Build hosts payload (raw) and typed hosts for constructing response
    hosts_payload = []
    hosts_for_response: List[HostInfo] = []

    for sub in subdomains:
        sub_alive = sub_alive_map.get(sub, False)
        ips = sub_to_ips.get(sub, [])
        for ip in ips:
            clean_ip = ip.replace("[", "").replace("]", "").strip()
            scan_data = ip_scan_results.get(clean_ip, {"alive": False, "ports": [], "ports_raw": []})

            hosts_payload.append({
                "subdomain": sub,
                "subdomain_alive": sub_alive,
                "ip": clean_ip,
                "ip_alive": scan_data["alive"],
                "ports": scan_data["ports_raw"],
            })

            hosts_for_response.append(
                HostInfo(
                    subdomain=sub,
                    subdomain_alive=sub_alive,
                    ip=clean_ip,
                    alive=scan_data["alive"],
                    ports=scan_data["ports"],
                )
            )

    # # 3) Ping check + 4) Port scan via naabu
    # hosts_payload: List[Dict] = []
    # hosts_for_response: List[HostInfo] = []

    # for sub, ips in sub_to_ips.items():
    #     sub_alive = is_subdomain_alive(sub)
    #     for ip in ips:
    #         alive = is_ip_alive(ip)
    #         ports_raw: List[Dict] = run_naabu_with_nmap(ip) if alive else []

    #         hosts_payload.append(
    #             {
    #                 "subdomain": sub,
    #                 "subdomain_alive": sub_alive,
    #                 "ip": ip,
    #                 "ports": ports_raw,
    #             }
    #         )

    #         hosts_for_response.append(
    #             HostInfo(
    #                 subdomain=sub,
    #                 subdomain_alive=sub_alive,
    #                 ip=ip,
    #                 alive=alive,
    #                 ports=[PortInfo(**p) for p in ports_raw],
    #             )
    #         )

    # Save a simple JSON summary into the project directory
    try:
        import json

        summary_path = project_root / "hosts.json"
        json.dump(
            [
                {
                    "subdomain": h.subdomain,
                    "subdomain_alive": h.subdomain_alive,
                    "ip": h.ip,
                    "alive": h.alive,
                    "ports": [p.model_dump() for p in h.ports],
                }
                for h in hosts_for_response
            ],
            summary_path.open("w", encoding="utf-8"),
            indent=2,
        )
    except Exception:
        # Non-fatal if writing summary fails
        pass

    # 5) Store full graph into Neo4j
    create_full_scan_graph(domain, hosts_payload)

    # 6) Build graph-style response (nodes + edges) using the requested format
    domain_node_id = f"domain_{_slugify(domain)}"

    nodes_by_id: Dict[str, GraphNode] = {}
    edge_keys: set[tuple[str, str, str]] = set()
    edges: List[GraphEdge] = []

    # Domain node: minimal fields
    nodes_by_id[domain_node_id] = GraphNode(id=domain_node_id, label=domain, category="domain")

    for host in hosts_for_response:
        # Subdomain node
        sub_id = f"sub_{_slugify(host.subdomain)}"
        if sub_id not in nodes_by_id:
            nodes_by_id[sub_id] = GraphNode(
                id=sub_id,
                label=host.subdomain,
                category="subdomain",
                alive=host.subdomain_alive,
            )

        # Edge: domain -> subdomain
        if (domain_node_id, sub_id, "HAS_SUBDOMAIN") not in edge_keys:
            edge_keys.add((domain_node_id, sub_id, "HAS_SUBDOMAIN"))
            edges.append(GraphEdge(source=domain_node_id, target=sub_id, label="HAS_SUBDOMAIN"))

        # IP node
        ip_id = f"ip_{host.ip}"
        if ip_id not in nodes_by_id:
            nodes_by_id[ip_id] = GraphNode(
                id=ip_id,
                label=host.ip,
                category="ip",
                alive=host.alive,
            )

        # Edge: subdomain -> ip
        if (sub_id, ip_id, "RESOLVES_TO") not in edge_keys:
            edge_keys.add((sub_id, ip_id, "RESOLVES_TO"))
            edges.append(GraphEdge(source=sub_id, target=ip_id, label="RESOLVES_TO"))

        # Ports
        for port in host.ports:
            # Use ip:port in id to ensure uniqueness and match requested format
            port_node_id = f"port_{host.ip}:{port.number}"
            if port_node_id not in nodes_by_id:
                nodes_by_id[port_node_id] = GraphNode(
                    id=port_node_id,
                    label=f"{host.ip}:{port.number}",
                    category="port",
                    status=port.status,
                    number=port.number,
                    service=port.service,
                )

            # Edge: ip -> port
            if (ip_id, port_node_id, "HAS_PORT") not in edge_keys:
                edge_keys.add((ip_id, port_node_id, "HAS_PORT"))
                edges.append(GraphEdge(source=ip_id, target=port_node_id, label="HAS_PORT"))

    return ScanGraphResponse(
        nodes=list(nodes_by_id.values()),
        edges=edges,
    )


def _get_project_root(domain: str) -> Path:
    # backend/rest_api/main.py -> backend -> project root
    backend_dir = Path(__file__).resolve().parents[1]
    return backend_dir / "projects" / domain


def _slugify(value: str) -> str:
    return "".join(ch if ch.isalnum() else "_" for ch in value)


async def _take_screenshot(subdomain: str, out_dir: Path) -> bool:
    """
    Try to take a screenshot of the given subdomain using Playwright.
    Saves to out_dir/<slugified_subdomain>.png. Returns True on success, False otherwise.
    This function is intentionally tolerant: it catches import/runtime errors so the
    scanning flow stays robust when Playwright or browsers are not available.
    """
    subdomain = subdomain.strip()
    if not subdomain:
        return False

    filename = f"{_slugify(subdomain)}.png"
    out_path = out_dir / filename

    # Ensure output directory exists
    out_dir.mkdir(parents=True, exist_ok=True)

    try:
        # Import inside function to avoid hard dependency at module import time
        from playwright.async_api import async_playwright
    except Exception as e:
        print(f"Playwright not available: {e}")
        return False

    try:
        async with async_playwright() as pw:
            browser = await pw.chromium.launch(headless=True, args=["--no-sandbox"]) 
            page = await browser.new_page()

            # Try HTTPS first, then HTTP
            for scheme in ("https", "http"):
                url = f"{scheme}://{subdomain}"
                try:
                    await page.goto(url, timeout=10000)
                    # Small wait for rendering
                    await page.wait_for_timeout(500)
                    await page.screenshot(path=str(out_path), full_page=True)
                    await browser.close()
                    return True
                except Exception as ex:
                    # Print debug and try next scheme
                    print(f"Failed {url}: {ex}")
                    continue

            # nothing worked
            await browser.close()
            return False
    except Exception as e:
        # Playwright not installed, browsers missing, or async API error; non-fatal
        print(f"Playwright screenshot failure for {subdomain}: {e}")
        return False


