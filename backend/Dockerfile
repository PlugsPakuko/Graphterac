FROM golang:1.26.0-alpine 

RUN apk add --no-cache git bash curl nmap nmap-nselibs  build-base libpcap-dev

ENV PATH="/go/bin:${PATH}"

RUN go install -v github.com/projectdiscovery/subfinder/v2/cmd/subfinder@latest
RUN CGO_ENABLED=1 go install github.com/projectdiscovery/katana/cmd/katana@latest
RUN go install -v github.com/projectdiscovery/dnsx/cmd/dnsx@latest
RUN go install -v github.com/projectdiscovery/naabu/v2/cmd/naabu@latest
RUN go install github.com/projectdiscovery/alterx/cmd/alterx@latest

WORKDIR /app
ENTRYPOINT ["tail", "-f", "/dev/null"]