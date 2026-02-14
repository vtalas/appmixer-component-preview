/**
 * File sync store — communicates with the Node.js backend API
 * for all file system operations (no more Tauri / Browser FS API).
 */

const STORAGE_KEY = 'appmixer-connectors-path';

function createFileSyncStore() {
    let state = $state({
        directoryPath: null,
        directoryName: null,
        hasUnsavedChanges: false,
        modifiedComponents: new Set(),
        isSaving: false,
        isLoading: false,
        lastSavedAt: null,
        error: null
    });

    let tree = $state({ connectors: [] });

    return {
        get state() {
            return state;
        },
        get tree() {
            return tree;
        },
        set tree(value) {
            tree = value;
        },

        get isSupported() {
            return true; // Always supported — backend handles FS
        },

        get isConnected() {
            return state.directoryPath !== null && tree.connectors.length > 0;
        },

        get directoryPath() {
            return state.directoryPath;
        },

        markComponentDirty(path) {
            state.modifiedComponents = new Set([...state.modifiedComponents, path]);
            state.hasUnsavedChanges = true;
            state.error = null;
        },

        /**
         * Open a connectors folder.
         * Since we're a web app, the user provides the path via a prompt/input.
         * If a path is provided, use it directly. Otherwise prompt.
         */
        async openConnectorsFolder(directoryPath) {
            if (!directoryPath) {
                directoryPath = prompt('Enter the path to the appmixer connectors folder:');
                if (!directoryPath) return false;
            }

            state.isLoading = true;
            state.error = null;

            try {
                const response = await fetch('/api/connectors', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ directoryPath })
                });

                const data = await response.json();

                if (!response.ok) {
                    throw new Error(data.error || 'Failed to open folder');
                }

                state.directoryPath = data.directoryPath;
                state.directoryName = data.directoryName;
                state.hasUnsavedChanges = false;
                state.modifiedComponents = new Set();
                state.lastSavedAt = null;
                state.error = null;

                tree = { connectors: data.connectors };
                state.isLoading = false;

                // Persist path for auto-restore
                try { localStorage.setItem(STORAGE_KEY, directoryPath); } catch { /* */ }

                return true;
            } catch (err) {
                state.isLoading = false;
                state.error = err instanceof Error ? err.message : 'Failed to open folder';
                return false;
            }
        },

        async scanConnectorsDirectory() {
            if (!state.directoryPath) return;

            state.isLoading = true;
            state.error = null;

            try {
                const response = await fetch('/api/connectors');
                const data = await response.json();

                if (data.directoryPath) {
                    tree = { connectors: data.connectors };
                }
                state.isLoading = false;
            } catch (err) {
                state.isLoading = false;
                state.error = err instanceof Error ? err.message : 'Failed to scan';
            }
        },

        async loadComponentFromDirectory(path) {
            try {
                const response = await fetch(`/api/component?path=${encodeURIComponent(path)}`);
                const data = await response.json();

                if (!response.ok || !data.componentJson) return false;

                for (const connector of tree.connectors) {
                    for (const module of connector.modules) {
                        for (const component of module.components) {
                            if (component.path === path) {
                                component.componentJson = data.componentJson;
                                return true;
                            }
                        }
                    }
                }
                return false;
            } catch (err) {
                console.error(`Failed to load component ${path}:`, err);
                return false;
            }
        },

        async saveComponentToDirectory(component) {
            state.isSaving = true;
            state.error = null;

            try {
                const response = await fetch(`/api/component?path=${encodeURIComponent(component.path)}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ componentJson: component.componentJson })
                });

                if (!response.ok) {
                    const data = await response.json();
                    throw new Error(data.error || 'Failed to save');
                }

                const newModified = new Set(state.modifiedComponents);
                newModified.delete(component.path);
                state.modifiedComponents = newModified;
                state.hasUnsavedChanges = newModified.size > 0;
                state.lastSavedAt = new Date();
                state.isSaving = false;

                return true;
            } catch (err) {
                state.isSaving = false;
                state.error = err instanceof Error ? err.message : 'Failed to save component';
                return false;
            }
        },

        async saveAllModifiedComponents() {
            if (!state.directoryPath) {
                state.error = 'No connectors folder is open';
                return false;
            }

            if (state.modifiedComponents.size === 0) return true;

            state.isSaving = true;
            state.error = null;
            const errors = [];

            for (const path of state.modifiedComponents) {
                const component = this.findComponentByPath(path);
                if (component) {
                    const success = await this.saveComponentToDirectory(component);
                    if (!success && state.error) {
                        errors.push(`${path}: ${state.error}`);
                    }
                }
            }

            state.isSaving = false;

            if (errors.length > 0) {
                state.error = `Failed to save: ${errors.join(', ')}`;
                return false;
            }

            return true;
        },

        findComponentByPath(path) {
            for (const connector of tree.connectors) {
                for (const module of connector.modules) {
                    for (const component of module.components) {
                        if (component.path === path) {
                            return component;
                        }
                    }
                }
            }
            return null;
        },

        updateComponent(path, updates) {
            for (const connector of tree.connectors) {
                for (const module of connector.modules) {
                    for (const component of module.components) {
                        if (component.path === path) {
                            Object.assign(component.componentJson, updates);
                            this.markComponentDirty(path);
                            return true;
                        }
                    }
                }
            }
            return false;
        },

        isComponentModified(path) {
            return state.modifiedComponents.has(path);
        },

        async loadTestPlan(connectorName) {
            try {
                const response = await fetch(`/api/testplan?connector=${encodeURIComponent(connectorName)}`);
                const data = await response.json();
                return data.data;
            } catch {
                return null;
            }
        },

        async saveTestPlan(connectorName, data) {
            try {
                const response = await fetch(`/api/testplan?connector=${encodeURIComponent(connectorName)}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ data })
                });
                return response.ok;
            } catch {
                return false;
            }
        },

        async getAuthInfo(connectorName) {
            try {
                const response = await fetch(`/api/auth?connector=${encodeURIComponent(connectorName)}`);
                return await response.json();
            } catch {
                return { found: false };
            }
        },

        async restoreLastFolder() {
            try {
                const savedPath = localStorage.getItem(STORAGE_KEY);
                if (!savedPath) return false;
                return await this.openConnectorsFolder(savedPath);
            } catch (err) {
                console.warn('Failed to restore last connectors folder:', err);
                return false;
            }
        },

        disconnect() {
            tree = { connectors: [] };
            state.directoryPath = null;
            state.directoryName = null;
            state.hasUnsavedChanges = false;
            state.modifiedComponents = new Set();
            state.lastSavedAt = null;
            state.error = null;
            try { localStorage.removeItem(STORAGE_KEY); } catch { /* */ }
        }
    };
}

export const fileSync = createFileSyncStore();
