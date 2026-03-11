import os
import json
from typing import Any, Dict, Iterable, List, Tuple

from dotenv import load_dotenv
from neo4j import GraphDatabase, Driver


load_dotenv()

_NEO4J_URI = os.getenv("NEO4J_URI")
_NEO4J_USERNAME = os.getenv("NEO4J_USERNAME")
_NEO4J_PASSWORD = os.getenv("NEO4J_PASSWORD")
_NEO4J_DATABASE = os.getenv("NEO4J_DATABASE")

_driver: Driver | None = None


def _get_driver() -> Driver:
    global _driver

    if _driver is None:
        if not (_NEO4J_URI and _NEO4J_USERNAME and _NEO4J_PASSWORD):
            raise RuntimeError("Neo4j connection information is not fully configured in environment variables.")

        _driver = GraphDatabase.driver(_NEO4J_URI, auth=(_NEO4J_USERNAME, _NEO4J_PASSWORD))

    return _driver


def create_domain_with_subdomains(domain: str, subdomains: Iterable[str]) -> None:
    """
    Create (or update) a Domain node and related Subdomain nodes in Neo4j,
    using the original schema:

    - (:Domain {name})-[:HAS_SUBDOMAIN]->(:Subdomain {name})
    """
    domain = domain.strip()
    subdomain_list: List[str] = [s.strip() for s in subdomains if s.strip()]

    if not domain or not subdomain_list:
        return

    driver = _get_driver()

    with driver.session(database=_NEO4J_DATABASE) as session:
        session.execute_write(_create_domain_and_subdomains_tx, domain, subdomain_list)


def _create_domain_and_subdomains_tx(tx, domain: str, subdomains: List[str]) -> None:
    tx.run(
        """
        MERGE (d:Domain {name: $domain})
        WITH d
        UNWIND $subdomains AS sub
        MERGE (s:Subdomain {name: sub})
        MERGE (d)-[:HAS_SUBDOMAIN]->(s)
        """,
        domain=domain,
        subdomains=subdomains,
    )


def create_full_scan_graph(domain: str, hosts: Iterable[Dict[str, Any]]) -> None:
    """
    Persist full scan results into Neo4j, including Subdomain, IP and Port nodes.

    hosts: iterable of dicts with shape:
        {
          "subdomain": str,
          "ip": str,
          "alive": bool | None,
          "ports": [{"number": int, "service": str | None, "status": str | None}, ...]
        }
    """
    domain = domain.strip()
    hosts_list = _normalize_hosts(hosts)

    if not domain or not hosts_list:
        return

    driver = _get_driver()

    with driver.session(database=_NEO4J_DATABASE) as session:
        cypher, params = build_full_scan_graph_cypher(domain, hosts_list)
        session.execute_write(_run_write_tx, cypher, params)


def build_full_scan_graph_cypher(domain: str, hosts: Iterable[Dict[str, Any]]) -> Tuple[str, Dict[str, Any]]:
    domain = domain.strip()
    hosts_list = _normalize_hosts(hosts)

    cypher = """
    MERGE (d:Domain {name: $domain})
    WITH d
    UNWIND $hosts AS h
    
    // Create Subdomain and set its exact attributes
    MERGE (s:Subdomain {name: h.subdomain})
    SET s.alive = coalesce(h.subdomain_alive, s.alive)
    MERGE (d)-[:HAS_SUBDOMAIN]->(s)
    
    // Create IP and set its exact attributes
    WITH s, h
    WHERE h.ip IS NOT NULL AND h.ip <> ''
    MERGE (i:IP {address: h.ip})
    SET i.alive = coalesce(h.ip_alive, i.alive)
    MERGE (s)-[:RESOLVES_TO]->(i)
    
    // Create Port and set its exact attributes
    WITH i, h
    UNWIND coalesce(h.ports, []) AS p
    MERGE (prt:Port {id: p.id})
    SET prt.number = p.number,
        prt.service = p.service,
        prt.status = p.status
    MERGE (i)-[:HAS_PORT]->(prt)
    """

    return cypher, {"domain": domain, "hosts": hosts_list}


def _run_write_tx(tx, cypher: str, params: Dict[str, Any]) -> None:
    tx.run(cypher, **params)


def _normalize_hosts(hosts: Iterable[Dict[str, Any]]) -> List[Dict[str, Any]]:
    normalized: List[Dict[str, Any]] = []

    for raw in hosts or []:
        if not isinstance(raw, dict):
            continue

        subdomain = str(raw.get("subdomain") or "").strip()
        if not subdomain:
            continue

        ip = str(raw.get("ip") or "").strip()
        
        # 2. EXTRACT EXACT BOOLEANS
        subdomain_alive = raw.get("subdomain_alive")
        ip_alive = raw.get("ip_alive")
        ports_in = raw.get("ports") or []

        ports_out: List[Dict[str, Any]] = []
        for p in ports_in:
            if not isinstance(p, dict):
                continue
            try:
                number = int(p.get("number"))
            except Exception:
                continue

            ports_out.append({
                "id": f"{ip}:{number}",
                "number": number,
                "service": p.get("service") or "unknown",
                "status": p.get("status") or "open"
            })

        # 3. APPEND TO NORMALIZED LIST
        normalized.append({
            "subdomain": subdomain,
            "subdomain_alive": subdomain_alive,
            "ip": ip,
            "ip_alive": ip_alive,
            "ports": ports_out
        })

    return normalized


def _safe_json(value: Any) -> str | None:
    try:
        return json.dumps(value, ensure_ascii=False, separators=(",", ":"), default=str)
    except Exception:
        return None


__all__ = ["create_domain_with_subdomains", "create_full_scan_graph", "build_full_scan_graph_cypher"]

