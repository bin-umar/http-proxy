const http = require('http');
const https = require('https');
const tls = require('tls');
const shelljs = require('shelljs');
const sqlite3 = require('sqlite3');
const fs = require('fs');
const path = require('path');
const net = require('net');
const url = require('url');
const requestModule = require('request');

/////////// DB
const db = new sqlite3.Database('database.sqlite3', (err) => {
    if (err) {
        console.log('Could not connect to database', err)
    } else {
        console.log('Connected to database')
    }
});

const sql = `
    CREATE TABLE IF NOT EXISTS requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      request TEXT)`;

db.run(sql);

const saveToDb = (request) => {
    db.run(
        'INSERT INTO requests (request) VALUES (?)',
        [JSON.stringify(request)]
    );
};

///////// ReRequest

const reRequest = (dbResult) => {
    const options = JSON.parse(dbResult.request);
    console.log('repeat http request on ', options.path);
    requestModule(options.path, options, (err, response, body) => console.log('result of rerequest', body));
};

const args = process.argv[2] || '';
if (args.includes('-rr')) {
    const id = parseInt(args.split('=')[1]);

    if (!isNaN(id)) {
        db.get('SELECT * FROM requests WHERE id=?', [id], (err, result) => {
            if (err || !result) return;
            reRequest(result);
        });
    } else {
        db.all('SELECT * FROM requests', (err, results) => {
            if (err || !results.length) return;
            results.forEach(result => reRequest(result));
        });
    }

    return;
}

///////// HTTPS Server

const certsDirectory = 'certificates';

const getCommand = ({
        country,
        city,
        organization,
        domain,
    }) => `
      cd ${certsDirectory};
      openssl genrsa -out ${domain}.key 2048;
      openssl req -new -sha256 -key ${domain}.key -subj '/C=${country}/ST=${city}/O=${organization}, Inc./CN=${domain}' -out ${domain}.csr;
      openssl req -in ${domain}.csr -noout -text;
      openssl x509 -req -in ${domain}.csr -CA ../rootCA.crt -CAkey ../rootCA.key -CAcreateserial -out ${domain}.crt -days 500 -sha256;
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

https
    .createServer({SNICallback}, (req, res) => requestHandler(req, res, true))
    .on('tlsClientError',  (e) => console.log(e))
    .listen(443,  () => console.log(`HTTPS Server started listening on port 443`));

///////////// HTTP Server
    
http
    .createServer((req, res) => requestHandler(req, res, false))
    .on('connect', (req, cltSocket, head) => {
        const srvUrl = url.parse(`http://${req.url}`);
        const srvSocket = net.connect(
            srvUrl.port,
            srvUrl.hostname,
            () => {
                cltSocket.write('HTTP/1.1 200 Connection Established\r\n'
                    + 'Proxy-agent: Node.js-Proxy\r\n'
                    + '\r\n');
                srvSocket.write(head);
                srvSocket.pipe(cltSocket).on('error', (e) => console.log('srvSocket', e));
                cltSocket.pipe(srvSocket).on('error', (e) => console.log('cltSocket', e));
            },
        );
    })
    .listen(9000, () => console.log('HTTP Server started listening on port 9000'));

//// Request Handler

const requestHandler = (req, res, isSecure) => {
    const options = {
        port: isSecure ? 443 : 80,
        host: req.headers.host,
        method: req.method,
        path: req.url,
        headers: req.headers
    };

    saveToDb(options);

    const proxyReq = isSecure ? https.request(options) : http.request(options);
    proxyReq.addListener('response',  (proxyRes) => {
        proxyRes.addListener('data', (chunk) => res.write(chunk, 'binary'));
        proxyRes.addListener('end', () => res.end());

        res.writeHead(proxyRes.statusCode, proxyRes.headers);
    });

    req.addListener('data', (chunk) => proxyReq.write(chunk, 'binary'));
    req.addListener('end', () => proxyReq.end());
};
