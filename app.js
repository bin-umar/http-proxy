const http = require('http');

const server = http.createServer((req, res) => {
    console.log(req.url);

    const proxyReq = http.req({
        port: 80,
        host: req.headers.host,
        method: req.method,
        path: req.url,
        headers: req.headers
    });

    proxyReq.addListener('response',  (proxyRes) => {
        proxyRes.addListener('data', (chunk) => res.write(chunk, 'binary'));
        proxyRes.addListener('end', () => res.end());

        res.writeHead(proxyRes.statusCode, proxyRes.headers);
    });

    req.addListener('data', (chunk) => proxyReq.write(chunk, 'binary'));
    req.addListener('end', () => proxyReq.end());
});

console.log("Server started listening on port 9000");
server.listen(9000);