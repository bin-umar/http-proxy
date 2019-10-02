const http = require('http');
const https = require('https');
const tls = require('tls');
const shelljs = require('shelljs');
const sqlite3 = require('sqlite3');
const fs = require('fs');
const path = require('path');


/////////// DB
const db = new sqlite3.Database('database.sqlite3', (err) => {
    if (err) {
        console.log('Could not connect to database', err)
    } else {
        console.log('Connected to database')
    }
});

const args = process.argv.slice(2);

if (args.includes('-rr')) {
    db.all('SELECT * FROM requests', (err, results) => {
        console.log(results);
    });

    return;
}

const sql = `
    CREATE TABLE IF NOT EXISTS requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      request TEXT)`;

db.run(sql);


///////// HTTPS Server

const certsDirectory = 'certifications';
const root = 'http-proxy';

const getCommand = ({
        country,
        city,
        organization,
        domain,
    }) => `
      cd ${certsDirectory};
      openssl genrsa -out ${domain}.key 2048;
      openssl req -new -sha256 -key ${domain}.key -subj "/C=${country}/ST=${city}/O=${organization}, Inc./CN=${domain}" -out ${domain}.csr;
      openssl req -in ${domain}.csr -noout -text;
      openssl x509 -req -in ${domain}.csr -CA ${root}/rootCA.crt -CAkey ${root}/rootCA.key -CAcreateserial -out ${domain}.crt -days 500 -sha256;
      openssl x509 -in ${domain}.crt -text -noout;
`;

const generate = (domain) => {
    const command = getCommand({
        country: 'RU',
        city: 'Moscow',
        organization: 'Mail.ru Group',
        domain,
    });

    shelljs.exec(command);
};

const generateCertificates = (domain) => {
    const certPath = path.resolve(certsDirectory, `${domain}.crt`);
    const keyPath = path.resolve(certsDirectory, `${domain}.key`);

    if (!fs.existsSync(certPath) || !fs.existsSync(keyPath)) {
        generate(domain);
    }

    return {
        cert: fs.readFileSync(certPath),
        key: fs.readFileSync(keyPath),
    };
};

const SNICallback = (domain, cb) => {
    const secureOptions = generateCertificates(domain);
    const context = tls.createSecureContext(secureOptions);

    cb(null, context);
};

const httpsServer = https.createServer({SNICallback}, (req, res) => {
    console.log('https', req.url);

    const request = {
        host: req.headers.host,
        method: req.method,
        path: req.url,
        headers: req.headers
    };

    const proxyReq = https.request(request);
    proxyReq.addListener('response',  (proxyRes) => {
        proxyRes.addListener('data', (chunk) => res.write(chunk, 'binary'));
        proxyRes.addListener('end', () => res.end());

        res.writeHead(proxyRes.statusCode, proxyRes.headers);
    });

    req.addListener('data', (chunk) => proxyReq.write(chunk, 'binary'));
    req.addListener('end', () => proxyReq.end());
});

httpsServer.on('tlsClientError',  (e) => console.log(e) );

httpsServer.listen(443,  () => {
    console.log(`HTTPS Server is listening at address 443`);
});

///////////// HTTP Server
const server = http.createServer((req, res) => {
    console.log('http', req.url);

    const request = {
        port: 80,
        host: req.headers.host,
        method: req.method,
        path: req.url,
        headers: req.headers
    };

    db.run(
        'INSERT INTO requests (request) VALUES (?)',
        [JSON.stringify(request)]
    );

    const proxyReq = http.request(request);
    proxyReq.addListener('response',  (proxyRes) => {
        proxyRes.addListener('data', (chunk) => res.write(chunk, 'binary'));
        proxyRes.addListener('end', () => res.end());

        res.writeHead(proxyRes.statusCode, proxyRes.headers);
    });

    req.addListener('data', (chunk) => proxyReq.write(chunk, 'binary'));
    req.addListener('end', () => proxyReq.end());
});

server.listen(8000, () => {
    console.log("Server started listening on port 9000");
});