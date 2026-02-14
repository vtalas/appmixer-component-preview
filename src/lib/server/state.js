/**
 * Server-side state: holds the currently opened connectors directory path.
 * This is shared across all API routes via module-level state.
 */

let connectorsDir = null;

export function getConnectorsDir() {
    return connectorsDir;
}

export function setConnectorsDir(dir) {
    connectorsDir = dir;
}
