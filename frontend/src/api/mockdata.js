export default {
  "nodes": [
    {
      "id": "domain_vulnweb_com",
      "label": "vulnweb.com",
      "category": "domain",
      "alive": null,
      "status": null,
      "number": null,
      "service": null
    },
    {
      "id": "sub_rest_vulnweb_com",
      "label": "rest.vulnweb.com",
      "category": "subdomain",
      "alive": true,
      "status": null,
      "number": null,
      "service": null
    },
    {
      "id": "ip_18.215.71.186",
      "label": "18.215.71.186",
      "category": "ip",
      "alive": false,
      "status": null,
      "number": null,
      "service": null
    },
    {
      "id": "sub_testaspnet_vulnweb_com",
      "label": "testaspnet.vulnweb.com",
      "category": "subdomain",
      "alive": true,
      "status": null,
      "number": null,
      "service": null
    },
    {
      "id": "ip_44.238.29.244",
      "label": "44.238.29.244",
      "category": "ip",
      "alive": true,
      "status": null,
      "number": null,
      "service": null
    },
    {
      "id": "44.238.29.244:25",
      "label": "44.238.29.244:25",
      "category": "port",
      "alive": null,
      "status": "open",
      "number": 25,
      "service": "smtp"
    },
    {
      "id": "44.238.29.244:80",
      "label": "44.238.29.244:80",
      "category": "port",
      "alive": null,
      "status": "open",
      "number": 80,
      "service": "http"
    },
    {
      "id": "sub_testasp_vulnweb_com",
      "label": "testasp.vulnweb.com",
      "category": "subdomain",
      "alive": true,
      "status": null,
      "number": null,
      "service": null
    },
    {
      "id": "sub_testhtml5_vulnweb_com",
      "label": "testhtml5.vulnweb.com",
      "category": "subdomain",
      "alive": true,
      "status": null,
      "number": null,
      "service": null
    },
    {
      "id": "ip_44.228.249.3",
      "label": "44.228.249.3",
      "category": "ip",
      "alive": true,
      "status": null,
      "number": null,
      "service": null
    },
    {
      "id": "44.228.249.3:25",
      "label": "44.228.249.3:25",
      "category": "port",
      "alive": null,
      "status": "open",
      "number": 25,
      "service": "smtp"
    },
    {
      "id": "44.228.249.3:80",
      "label": "44.228.249.3:80",
      "category": "port",
      "alive": null,
      "status": "open",
      "number": 80,
      "service": "http"
    },
    {
      "id": "sub_testphp_vulnweb_com",
      "label": "testphp.vulnweb.com",
      "category": "subdomain",
      "alive": true,
      "status": null,
      "number": null,
      "service": null
    },
    {
      "id": "sub_www_vulnweb_com",
      "label": "www.vulnweb.com",
      "category": "subdomain",
      "alive": false,
      "status": null,
      "number": null,
      "service": null
    }
  ],
  "edges": [
    {
      "source": "domain_vulnweb_com",
      "target": "sub_rest_vulnweb_com",
      "label": "HAS_SUBDOMAIN"
    },
    {
      "source": "sub_rest_vulnweb_com",
      "target": "ip_18.215.71.186",
      "label": "RESOLVES_TO"
    },
    {
      "source": "domain_vulnweb_com",
      "target": "sub_testaspnet_vulnweb_com",
      "label": "HAS_SUBDOMAIN"
    },
    {
      "source": "sub_testaspnet_vulnweb_com",
      "target": "ip_44.238.29.244",
      "label": "RESOLVES_TO"
    },
    {
      "source": "ip_44.238.29.244",
      "target": "44.238.29.244:25",
      "label": "HAS_PORT"
    },
    {
      "source": "ip_44.238.29.244",
      "target": "44.238.29.244:80",
      "label": "HAS_PORT"
    },
    {
      "source": "domain_vulnweb_com",
      "target": "sub_testasp_vulnweb_com",
      "label": "HAS_SUBDOMAIN"
    },
    {
      "source": "sub_testasp_vulnweb_com",
      "target": "ip_44.238.29.244",
      "label": "RESOLVES_TO"
    },
    {
      "source": "domain_vulnweb_com",
      "target": "sub_testhtml5_vulnweb_com",
      "label": "HAS_SUBDOMAIN"
    },
    {
      "source": "sub_testhtml5_vulnweb_com",
      "target": "ip_44.228.249.3",
      "label": "RESOLVES_TO"
    },
    {
      "source": "ip_44.228.249.3",
      "target": "44.228.249.3:25",
      "label": "HAS_PORT"
    },
    {
      "source": "ip_44.228.249.3",
      "target": "44.228.249.3:80",
      "label": "HAS_PORT"
    },
    {
      "source": "domain_vulnweb_com",
      "target": "sub_testphp_vulnweb_com",
      "label": "HAS_SUBDOMAIN"
    },
    {
      "source": "sub_testphp_vulnweb_com",
      "target": "ip_44.228.249.3",
      "label": "RESOLVES_TO"
    },
    {
      "source": "domain_vulnweb_com",
      "target": "sub_www_vulnweb_com",
      "label": "HAS_SUBDOMAIN"
    },
    {
      "source": "sub_www_vulnweb_com",
      "target": "ip_44.228.249_3",
      "label": "RESOLVES_TO"
    }
  ]
}