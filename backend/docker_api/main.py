import os
import re
import shlex
from typing import Dict, List, Optional

import docker
from dotenv import load_dotenv


load_dotenv()

_client = docker.from_env()
_worker = _client.containers.get(os.getenv("ENGINE_DOCKER_NAME"))


def init_project(domain: str):
    """
    Initiate project on docker engine via domain name
    """

    domain = domain.strip()
    cmd = f"find /tmp/{domain}"
    output = _worker.exec_run(["/bin/sh", "-c", cmd]).output.decode("utf-8", errors="ignore")

    if "No such file or directory" in output:
        cmd = f"mkdir /tmp/{domain}; touch /tmp/{domain}/subdomain.txt"
        _worker.exec_run(["/bin/sh", "-c", cmd])
        print(f"Create temp folder for {domain} successfully at /tmp/{domain}")
    else:
        print(f"folder for {domain} already existed at /tmp/{domain}")

def subdomain_enum(domain: str):
    """
    Run both passive(run_subfinder) and active (run_alterx) to find all subdomains then combine subdomain list. 
    """
    domain = domain.strip()
    if not domain:
        return []

    init_project(domain)

    passive_subdomains = run_subfinder(domain)
    active_subdomains = run_alterx(domain)

    subdomains = list(passive_subdomains | active_subdomains)
    _write_subdomains_file(domain, subdomains)

    return list(subdomains)

def run_subfinder(domain: str) -> set[str]:
    """
    Run subfinder inside the CLI Engine container and return a list of subdomains.
    """
    cmd = f"subfinder -d {domain} -silent"
    result = _worker.exec_run(["/bin/sh", "-c", cmd])
    raw_output = result.output.decode("utf-8", errors="ignore")

    subdomains = {line.strip() for line in raw_output.splitlines() if line.strip()}
    return subdomains

def run_alterx(domain: str) -> set[str]:
    """
    Act as active subdomain enumeration return accessible subdomain
    """
    cmd = f"echo {domain} | alterx -silent | dnsx -silent"
    result = _worker.exec_run(["/bin/sh", "-c", cmd])
    raw_output = result.output.decode("utf-8", errors="ignore")

    subdomains = {line.strip() for line in raw_output.splitlines() if line.strip()}
    return subdomains


def run_dnsx(domain: str, subdomains: Optional[List[str]] = None) -> Dict[str, List[str]]:
    """
    Resolve each subdomain to one or more IP addresses using dnsx.
    Returns: {subdomain: [ip1, ip2, ...]}
    """
    mapping: Dict[str, List[str]] = {}

    domain = domain.strip()

    cmd = f"dnsx -l /tmp/{domain}/subdomain.txt -a -resp -silent -nc"
    result = _worker.exec_run(["/bin/sh", "-c", cmd])
    raw_output = result.output.decode("utf-8", errors="ignore")

    # line format: "host [A] [ip]"
    for line in raw_output.splitlines():
        parts = line.strip().split()
        if len(parts) < 2:
            continue
        host, ip = parts[0], parts[-1]

        ip = ip.replace("[", "").replace("]", "").strip()
        
        if not ip:
            continue
        mapping.setdefault(host, [])
        if ip not in mapping[host]:
            mapping[host].append(ip)

    return mapping


def is_ip_alive(ip: str) -> bool:
    """
    Check if an IP is reachable using a single ping inside the container.
    """
    ip = ip.strip()
    if not ip:
        return False

    cmd = f"ping -c 1 -W 1 {ip}"
    result = _worker.exec_run(["/bin/sh", "-c", cmd])
    return result.exit_code == 0


def is_subdomain_alive(subdomain: str) -> bool:
    """
    Basic HTTP reachability check for a subdomain using curl inside the container.
    Tries HTTPS first, then HTTP if HTTPS fails.
    """
    subdomain = subdomain.strip()
    if not subdomain:
        return False

    # Try HTTPS
    https_cmd = f"curl -k -s -o /dev/null -m 5 https://{subdomain}"
    https_res = _worker.exec_run(["/bin/sh", "-c", https_cmd])
    if https_res.exit_code == 0:
        return True

    # Fallback to HTTP
    http_cmd = f"curl -s -o /dev/null -m 5 http://{subdomain}"
    http_res = _worker.exec_run(["/bin/sh", "-c", http_cmd])
    return http_res.exit_code == 0


def run_naabu_with_nmap(ip: str) -> List[Dict[str, str]]:
    """
    Scan ports on an IP using naabu and nmap service detection.
    Returns a list of dicts: [{\"number\": int, \"service\": str | None, \"status\": str | None}, ...]
    """
    ip = ip.strip()
    if not ip:
        return []

    cmd = f"naabu -silent -host {ip} -nmap-cli 'nmap -sS'"
    result = _worker.exec_run(["/bin/sh", "-c", cmd])
    raw_output = result.output.decode("utf-8", errors="ignore").strip()

    if not raw_output:
        return []

    ports: Dict[int, Dict[str, str]] = {}

    # Lines like '8.8.8.8:443'
    host_port_re = re.compile(r"^\s*[^:]+:(\d+)\s*$")
    # Lines like '53/tcp (domain)' from naabu+nmap
    service_paren_re = re.compile(r"^\s*(\d+)/tcp\s*\(([^)]*)\)")
    # Lines like '8008/tcp open  http' from plain nmap
    nmap_table_re = re.compile(r"^\s*(\d+)/tcp\s+(\w+)\s+(\S+)\s*$")

    for line in raw_output.splitlines():
        line = line.strip()
        if not line:
            continue

        m_hp = host_port_re.match(line)
        if m_hp:
            port_num = int(m_hp.group(1))
            ports.setdefault(
                port_num,
                {
                    "number": port_num,
                    "status": "open",
                    "service": None,
                },
            )
            continue

        m_srv_paren = service_paren_re.match(line)
        if m_srv_paren:
            port_num = int(m_srv_paren.group(1))
            service_name = m_srv_paren.group(2) or None
            entry = ports.setdefault(
                port_num,
                {
                    "number": port_num,
                    "status": "open",
                    "service": None,
                },
            )
            entry["service"] = service_name
            continue

        m_nmap = nmap_table_re.match(line)
        if m_nmap:
            port_num = int(m_nmap.group(1))
            state = m_nmap.group(2) or "open"
            service_name = m_nmap.group(3) or None
            entry = ports.setdefault(
                port_num,
                {
                    "number": port_num,
                    "status": "open",
                    "service": None,
                },
            )
            entry["service"] = service_name

    return list(ports.values())


def _write_subdomains_file(domain: str, subdomains: List[str]) -> None:
    """
    Write subdomains to /tmp/<domain>/subdomain.txt inside the engine container.
    """
    domain = domain.strip()

    cleaned = [s.strip() for s in (subdomains or []) if isinstance(s, str) and s.strip()]
    if not cleaned:
        _worker.exec_run(["/bin/sh", "-c", f"> /tmp/{domain}/subdomain.txt"])
        return

    args = " ".join(shlex.quote(s) for s in cleaned)
    cmd = f"printf '%s\n' {args} > /tmp/{domain}/subdomain.txt"
    _worker.exec_run(["/bin/sh", "-c", cmd])


__all__ = ["subdomain_enum", "run_dnsx", "is_ip_alive", "run_naabu_with_nmap"]