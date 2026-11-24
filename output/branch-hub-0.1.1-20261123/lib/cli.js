"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const server_1 = require("./server");
async function main() {
    const configPath = process.env.POS_HUB_CONFIG;
    if (!configPath)
        throw new Error('Set POS_HUB_CONFIG to the absolute Hub JSON configuration path');
    const absolute = path_1.default.resolve(configPath);
    const config = JSON.parse(fs_1.default.readFileSync(absolute, 'utf8'));
    const base = path_1.default.dirname(absolute);
    config.database = path_1.default.resolve(base, config.database || 'branch-hub.db');
    config.backupDirectory = path_1.default.resolve(base, config.backupDirectory || 'backups');
    fs_1.default.mkdirSync(path_1.default.dirname(config.database), { recursive: true });
    const hub = (0, server_1.createBranchHub)(config);
    const port = await hub.listen();
    console.log(`[Hub] Branch ${config.branchId} listening on ${config.host || '127.0.0.1'}:${port}`);
    void hub.backup().catch(err => console.error('[Hub] Initial backup failed:', err.message));
    let stopping = false;
    const stop = async () => { if (!stopping) {
        stopping = true;
        await hub.close();
    } };
    process.on('SIGINT', () => { void stop(); });
    process.on('SIGTERM', () => { void stop(); });
}
if (require.main === module)
    void main().catch(err => { console.error('[Hub]', err.message); process.exitCode = 1; });
