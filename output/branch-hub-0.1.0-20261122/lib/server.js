"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createBranchHub = createBranchHub;
const http_1 = __importDefault(require("http"));
const crypto_1 = require("crypto");
const fs_1 = require("fs");
const path_1 = __importDefault(require("path"));
const better_sqlite3_1 = __importDefault(require("better-sqlite3"));
const ws_1 = require("ws");
const store_1 = require("./store");
function createBranchHub(config) {
    if (!Object.entries(config.terminals).length || Object.entries(config.terminals).some(([id, token]) => !/^[A-Za-z0-9_-]{1,40}$/.test(id) || typeof token !== 'string' || token.length < 24))
        throw new Error('Configure terminal IDs with unique credentials of at least 24 characters');
    if (new Set(Object.values(config.terminals)).size !== Object.values(config.terminals).length)
        throw new Error('Each terminal requires a different credential');
    const store = new store_1.BranchHubStore(config.database, config.branchId, config.timezone);
    const sockets = new ws_1.WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });
    const live = new Set();
    let closed = false;
    let lastBackupDay = '';
    let backingUp = false;
    const authenticate = (req) => {
        const terminal = String(req.headers['x-pos-terminal'] || '');
        const branch = String(req.headers['x-pos-branch'] || '');
        const supplied = Buffer.from(String(req.headers.authorization || '').replace(/^Bearer /, ''));
        const expected = Buffer.from(config.terminals[terminal] || '');
        if (branch !== config.branchId || !expected.length || supplied.length !== expected.length || !(0, crypto_1.timingSafeEqual)(supplied, expected))
            throw new store_1.HubError('Unauthorized terminal', 401);
        return terminal;
    };
    const notify = () => {
        const packet = JSON.stringify({ type: 'hub.changed', branch_id: config.branchId });
        for (const socket of live)
            if (socket.readyState === ws_1.WebSocket.OPEN)
                socket.send(packet);
    };
    const respond = (res, status, data) => {
        res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
        res.end(JSON.stringify(data));
    };
    const server = http_1.default.createServer(async (req, res) => {
        try {
            const terminal = authenticate(req);
            const url = new URL(req.url || '/', 'http://hub.local');
            if (req.method === 'GET' && url.pathname === '/v1/status') {
                respond(res, 200, { branch_id: config.branchId, hub: 'online', cloud: 'not_configured', pending_cloud: store.pendingCloud(), business_day: (0, store_1.businessDay)(new Date(), store.timezone) });
                return;
            }
            if (req.method === 'GET' && url.pathname === '/v1/holds') {
                respond(res, 200, { holds: store.listHolds() });
                return;
            }
            if (req.method === 'GET' && url.pathname === '/v1/changes') {
                respond(res, 200, store.changes(Number(url.searchParams.get('after') || 0)));
                return;
            }
            if (req.method !== 'POST' || !['/v1/holds', '/v1/holds/consume', '/v1/events'].includes(url.pathname))
                throw new store_1.HubError('Endpoint not found', 404);
            if (!String(req.headers['content-type'] || '').startsWith('application/json'))
                throw new store_1.HubError('JSON body required', 415);
            const chunks = [];
            let bytes = 0;
            for await (const chunk of req) {
                bytes += chunk.length;
                if (bytes > 2 * 1024 * 1024)
                    throw new store_1.HubError('Request exceeds 2 MiB', 413);
                chunks.push(Buffer.from(chunk));
            }
            let body;
            try {
                body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
            }
            catch {
                throw new store_1.HubError('Invalid JSON');
            }
            if (!body || typeof body !== 'object' || Array.isArray(body))
                throw new store_1.HubError('JSON object required');
            let data;
            if (url.pathname === '/v1/holds')
                data = { hold: store.createHold(terminal, body.id, body.payload || {}, body.local_number) };
            else if (url.pathname === '/v1/holds/consume')
                data = { hold: store.consumeHold(terminal, body.request_id, body.hold) };
            else
                data = { acknowledged: store.appendEvents(terminal, body.events) };
            respond(res, 200, data);
            notify();
        }
        catch (err) {
            if (!res.headersSent)
                respond(res, err instanceof store_1.HubError ? err.status : 500, { error: err instanceof store_1.HubError ? err.message : 'Hub storage or service error' });
            else
                res.end();
        }
    });
    server.requestTimeout = 10000;
    server.headersTimeout = 10000;
    server.on('upgrade', (req, socket, head) => {
        try {
            authenticate(req);
            if (req.url !== '/v1/ws')
                throw new store_1.HubError('Endpoint not found', 404);
            sockets.handleUpgrade(req, socket, head, ws => {
                live.add(ws);
                let alive = true;
                ws.on('pong', () => { alive = true; });
                const heartbeat = setInterval(() => { if (!alive)
                    ws.terminate();
                else {
                    alive = false;
                    ws.ping();
                } }, 10000);
                heartbeat.unref();
                ws.on('error', () => ws.terminate());
                ws.on('close', () => { clearInterval(heartbeat); live.delete(ws); });
                ws.send(JSON.stringify({ type: 'hub.ready', branch_id: config.branchId }));
            });
        }
        catch {
            socket.end('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
        }
    });
    const backup = async () => {
        if (!config.backupDirectory || backingUp || closed)
            return undefined;
        backingUp = true;
        try {
            (0, fs_1.mkdirSync)(config.backupDirectory, { recursive: true });
            const filename = path_1.default.join(config.backupDirectory, `hub-${new Date().toISOString().replace(/[:.]/g, '-')}-${(0, crypto_1.randomUUID)()}.db`);
            const partial = `${filename}.partial`;
            await store.db.backup(partial);
            const verification = new better_sqlite3_1.default(partial, { readonly: true, fileMustExist: true });
            try {
                if (verification.pragma('integrity_check', { simple: true }) !== 'ok')
                    throw new Error('Backup integrity check failed');
            }
            finally {
                verification.close();
            }
            (0, fs_1.renameSync)(partial, filename);
            lastBackupDay = (0, store_1.businessDay)(new Date(), store.timezone);
            return filename;
        }
        finally {
            backingUp = false;
        }
    };
    const timer = setInterval(() => {
        if (lastBackupDay !== (0, store_1.businessDay)(new Date(), store.timezone))
            void backup().catch(err => console.error('[Hub] Daily backup failed:', err.message));
    }, 60000);
    timer.unref();
    return {
        store, server, backup,
        listen: (port = config.port ?? 4781, host = config.host || '127.0.0.1') => new Promise((resolve, reject) => {
            server.once('error', reject);
            server.listen(port, host, () => {
                server.removeListener('error', reject);
                const address = server.address();
                resolve(typeof address === 'object' && address ? address.port : port);
            });
        }),
        close: async () => {
            if (closed)
                return;
            closed = true;
            clearInterval(timer);
            for (const socket of live)
                socket.terminate();
            sockets.close();
            await new Promise((resolve, reject) => server.listening ? server.close(error => error ? reject(error) : resolve()) : resolve());
            // backup() is only scheduled in the CLI and serialized against shutdown.
            while (backingUp)
                await new Promise(resolve => setTimeout(resolve, 10));
            store.close();
        },
    };
}
