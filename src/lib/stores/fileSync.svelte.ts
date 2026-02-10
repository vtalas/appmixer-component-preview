import type { ConnectorTree, ConnectorComponent, Connector, ConnectorModule, ComponentJson } from '$lib/types/component';

// Tauri APIs — loaded dynamically so the store works in browsers too
let tauriDialog: typeof import('@tauri-apps/plugin-dialog') | null = null;
let tauriFs: typeof import('@tauri-apps/plugin-fs') | null = null;
let isTauri = false;

const STORAGE_KEY = 'appmixer-connectors-path';

if (typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window) {
	isTauri = true;
	Promise.all([
		import('@tauri-apps/plugin-dialog'),
		import('@tauri-apps/plugin-fs')
	]).then(([dialog, fs]) => {
		tauriDialog = dialog;
		tauriFs = fs;
		// Auto-restore the last opened folder
		fileSync.restoreLastFolder();
	});
}

export interface FileSyncState {
	directoryHandle: FileSystemDirectoryHandle | null;
	directoryPath: string | null; // Tauri: absolute path to the directory
	directoryName: string | null;
	hasUnsavedChanges: boolean;
	modifiedComponents: Set<string>;
	isSaving: boolean;
	isLoading: boolean;
	lastSavedAt: Date | null;
	error: string | null;
}

function createFileSyncStore() {
	let state = $state<FileSyncState>({
		directoryHandle: null,
		directoryPath: null,
		directoryName: null,
		hasUnsavedChanges: false,
		modifiedComponents: new Set(),
		isSaving: false,
		isLoading: false,
		lastSavedAt: null,
		error: null
	});

	let tree = $state<ConnectorTree>({ connectors: [] });

	// ── Tauri filesystem helpers ─────────────────────────────────────

	async function tauriReadDir(dirPath: string): Promise<{ name: string; isDirectory: boolean }[]> {
		if (!tauriFs) return [];
		const entries = await tauriFs.readDir(dirPath);
		return entries.map(e => ({
			name: e.name ?? '',
			isDirectory: e.isDirectory ?? false
		}));
	}

	async function tauriReadTextFile(filePath: string): Promise<string> {
		if (!tauriFs) throw new Error('Tauri FS not loaded');
		return tauriFs.readTextFile(filePath);
	}

	async function tauriWriteTextFile(filePath: string, content: string): Promise<void> {
		if (!tauriFs) throw new Error('Tauri FS not loaded');
		await tauriFs.writeTextFile(filePath, content);
	}

	async function tauriExists(filePath: string): Promise<boolean> {
		if (!tauriFs) return false;
		return tauriFs.exists(filePath);
	}

	// ── Tauri-based directory scanning ───────────────────────────────

	// Directories to skip while scanning (not component modules)
	const SKIP_DIRS = new Set([
		'node_modules', '.git', '.github', 'artifacts', 'test', 'tests',
		'__tests__', 'dist', 'build', '.svelte-kit', '.vscode'
	]);

	function shouldScanDir(name: string): boolean {
		if (!name || name.startsWith('.')) return false;
		return !SKIP_DIRS.has(name);
	}

	async function scanWithTauri(basePath: string): Promise<void> {
		state.isLoading = true;
		state.error = null;

		try {
			const connectors: Connector[] = [];
			const topEntries = await tauriReadDir(basePath);

			for (const connectorEntry of topEntries) {
				if (!connectorEntry.isDirectory || !shouldScanDir(connectorEntry.name)) continue;

				const connectorPath = `${basePath}/${connectorEntry.name}`;
				const modules: ConnectorModule[] = [];
				let connectorLabel: string | undefined;
				let connectorIcon: string | undefined;

				// Try to read service.json for connector metadata
				const servicePath = `${connectorPath}/service.json`;
				try {
					if (await tauriExists(servicePath)) {
						const serviceContent = await tauriReadTextFile(servicePath);
						const serviceJson = JSON.parse(serviceContent);
						connectorLabel = serviceJson.label;
						connectorIcon = serviceJson.icon;
					}
				} catch {
					// optional
				}

				let moduleEntries: { name: string; isDirectory: boolean }[] = [];
				try {
					moduleEntries = await tauriReadDir(connectorPath);
				} catch {
					continue; // skip connectors we can't read
				}

				for (const moduleEntry of moduleEntries) {
					if (!moduleEntry.isDirectory || !shouldScanDir(moduleEntry.name)) continue;

					const modulePath = `${connectorPath}/${moduleEntry.name}`;
					const components: ConnectorComponent[] = [];

					let componentEntries: { name: string; isDirectory: boolean }[] = [];
					try {
						componentEntries = await tauriReadDir(modulePath);
					} catch {
						continue; // skip modules we can't read
					}

					for (const compEntry of componentEntries) {
						if (!compEntry.isDirectory || !shouldScanDir(compEntry.name)) continue;

						const compDir = `${modulePath}/${compEntry.name}`;
						const compJsonPath = `${compDir}/component.json`;

						try {
							if (await tauriExists(compJsonPath)) {
								const content = await tauriReadTextFile(compJsonPath);
								const componentJson = JSON.parse(content) as ComponentJson;
								components.push({
									name: compEntry.name,
									label: componentJson.label || compEntry.name,
									path: `${connectorEntry.name}/${moduleEntry.name}/${compEntry.name}`,
									componentJson
								});
							}
						} catch {
							// Skip bad files
						}
					}

					if (components.length > 0) {
						components.sort((a, b) => a.name.localeCompare(b.name));
						modules.push({ name: moduleEntry.name, components });
					}
				}

				if (modules.length > 0) {
					modules.sort((a, b) => a.name.localeCompare(b.name));
					connectors.push({
						name: connectorEntry.name,
						label: connectorLabel,
						icon: connectorIcon,
						modules
					});
				}
			}

			connectors.sort((a, b) => a.name.localeCompare(b.name));
			tree = { connectors };
			state.isLoading = false;
		} catch (err) {
			state.isLoading = false;
			const errMsg = err instanceof Error ? err.message : String(err);
			state.error = `Failed to scan: ${errMsg}`;
			console.error('Failed to scan connectors directory:', err);
		}
	}

	// ── Browser File System Access API scanning ──────────────────────

	async function scanWithBrowserFS(dirHandle: FileSystemDirectoryHandle): Promise<void> {
		state.isLoading = true;
		state.error = null;

		try {
			const connectors: Connector[] = [];

			for await (const [connectorName, connectorHandle] of dirHandle.entries()) {
				if (connectorHandle.kind !== 'directory') continue;

				const modules: ConnectorModule[] = [];
				let connectorLabel: string | undefined;
				let connectorIcon: string | undefined;

				try {
					const serviceFileHandle = await connectorHandle.getFileHandle('service.json', { create: false });
					const serviceFile = await serviceFileHandle.getFile();
					const serviceContent = await serviceFile.text();
					const serviceJson = JSON.parse(serviceContent);
					connectorLabel = serviceJson.label;
					connectorIcon = serviceJson.icon;
				} catch {
					// optional
				}

				for await (const [moduleName, moduleHandle] of connectorHandle.entries()) {
					if (moduleHandle.kind !== 'directory') continue;

					const components: ConnectorComponent[] = [];

					for await (const [componentName, componentHandle] of moduleHandle.entries()) {
						if (componentHandle.kind !== 'directory') continue;

						try {
							const fileHandle = await componentHandle.getFileHandle('component.json', { create: false });
							const file = await fileHandle.getFile();
							const content = await file.text();
							const componentJson = JSON.parse(content) as ComponentJson;

							components.push({
								name: componentName,
								label: componentJson.label || componentName,
								path: `${connectorName}/${moduleName}/${componentName}`,
								componentJson
							});
						} catch {
							// Skip
						}
					}

					if (components.length > 0) {
						components.sort((a, b) => a.name.localeCompare(b.name));
						modules.push({ name: moduleName, components });
					}
				}

				if (modules.length > 0) {
					modules.sort((a, b) => a.name.localeCompare(b.name));
					connectors.push({
						name: connectorName,
						label: connectorLabel,
						icon: connectorIcon,
						modules
					});
				}
			}

			connectors.sort((a, b) => a.name.localeCompare(b.name));
			tree = { connectors };
			state.isLoading = false;
		} catch (err) {
			state.isLoading = false;
			const errMsg = err instanceof Error ? err.message : String(err);
			state.error = `Failed to scan: ${errMsg}`;
			console.error('Failed to scan connectors directory:', err);
		}
	}

	return {
		get state() {
			return state;
		},
		get tree() {
			return tree;
		},
		set tree(value: ConnectorTree) {
			tree = value;
		},

		get isSupported() {
			if (isTauri) return true;
			return typeof window !== 'undefined' && 'showDirectoryPicker' in window;
		},

		get isConnected() {
			if (isTauri) {
				return state.directoryPath !== null && tree.connectors.length > 0;
			}
			return state.directoryHandle !== null && tree.connectors.length > 0;
		},

		markComponentDirty(path: string) {
			state.modifiedComponents = new Set([...state.modifiedComponents, path]);
			state.hasUnsavedChanges = true;
			state.error = null;
		},

		async openConnectorsFolder(): Promise<boolean> {
			if (isTauri) {
				// ── Tauri path ──
				if (!tauriDialog) {
					state.error = 'Tauri dialog plugin not loaded';
					return false;
				}
				try {
					const selected = await tauriDialog.open({
						directory: true,
						multiple: false,
						title: 'Select Appmixer Connectors Folder'
					});
					if (!selected) return false; // user cancelled

					const dirPath = selected as string;
					const dirName = dirPath.split('/').pop() || dirPath;

					state.directoryPath = dirPath;
					state.directoryName = dirName;
					state.directoryHandle = null;
					state.hasUnsavedChanges = false;
					state.modifiedComponents = new Set();
					state.error = null;
					state.lastSavedAt = null;

					// Persist the path so it auto-opens on next launch
					try { localStorage.setItem(STORAGE_KEY, dirPath); } catch { /* ignore */ }

					await scanWithTauri(dirPath);
					return true;
				} catch (err) {
					if (err instanceof Error && err.name === 'AbortError') return false;
					state.error = err instanceof Error ? err.message : 'Failed to open folder';
					return false;
				}
			} else {
				// ── Browser File System Access API path ──
				if (!('showDirectoryPicker' in window)) {
					state.error = 'File System Access API is not supported in this browser';
					return false;
				}
				try {
					const dirHandle = await window.showDirectoryPicker({
						id: 'appmixer-connectors',
						mode: 'readwrite'
					});

					state.directoryHandle = dirHandle;
					state.directoryPath = null;
					state.directoryName = dirHandle.name;
					state.hasUnsavedChanges = false;
					state.modifiedComponents = new Set();
					state.error = null;
					state.lastSavedAt = null;

					await scanWithBrowserFS(dirHandle);
					return true;
				} catch (err) {
					if (err instanceof Error && err.name === 'AbortError') return false;
					state.error = err instanceof Error ? err.message : 'Failed to open folder';
					return false;
				}
			}
		},

		async scanConnectorsDirectory(): Promise<void> {
			if (isTauri && state.directoryPath) {
				await scanWithTauri(state.directoryPath);
			} else if (state.directoryHandle) {
				await scanWithBrowserFS(state.directoryHandle);
			}
		},

		async loadComponentFromDirectory(path: string): Promise<boolean> {
			try {
				const pathParts = path.split('/');
				if (pathParts.length !== 3) return false;

				if (isTauri && state.directoryPath) {
					const filePath = `${state.directoryPath}/${pathParts.join('/')}/component.json`;
					const content = await tauriReadTextFile(filePath);
					const componentJson = JSON.parse(content);

					for (const connector of tree.connectors) {
						for (const module of connector.modules) {
							for (const component of module.components) {
								if (component.path === path) {
									component.componentJson = componentJson;
									return true;
								}
							}
						}
					}
					return false;
				} else if (state.directoryHandle) {
					const [connectorName, moduleName, componentName] = pathParts;
					let currentDir = state.directoryHandle;
					currentDir = await currentDir.getDirectoryHandle(connectorName);
					currentDir = await currentDir.getDirectoryHandle(moduleName);
					currentDir = await currentDir.getDirectoryHandle(componentName);

					const fileHandle = await currentDir.getFileHandle('component.json', { create: false });
					const file = await fileHandle.getFile();
					const content = await file.text();
					const componentJson = JSON.parse(content);

					for (const connector of tree.connectors) {
						for (const module of connector.modules) {
							for (const component of module.components) {
								if (component.path === path) {
									component.componentJson = componentJson;
									return true;
								}
							}
						}
					}
					return false;
				}
				return false;
			} catch (err) {
				console.error(`Failed to load component ${path}:`, err);
				return false;
			}
		},

		async saveComponentToDirectory(component: ConnectorComponent): Promise<boolean> {
			state.isSaving = true;
			state.error = null;

			try {
				const pathParts = component.path.split('/');
				if (pathParts.length !== 3) {
					throw new Error(`Invalid component path: ${component.path}`);
				}

				const content = JSON.stringify(component.componentJson, null, 4);

				if (isTauri && state.directoryPath) {
					const filePath = `${state.directoryPath}/${pathParts.join('/')}/component.json`;
					await tauriWriteTextFile(filePath, content);
				} else if (state.directoryHandle) {
					const [connectorName, moduleName, componentName] = pathParts;
					let currentDir = state.directoryHandle;
					currentDir = await currentDir.getDirectoryHandle(connectorName);
					currentDir = await currentDir.getDirectoryHandle(moduleName);
					currentDir = await currentDir.getDirectoryHandle(componentName);

					const fileHandle = await currentDir.getFileHandle('component.json', { create: false });
					const writable = await fileHandle.createWritable();
					await writable.write(content);
					await writable.close();
				} else {
					throw new Error('No connectors folder is open');
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

		async saveAllModifiedComponents(): Promise<boolean> {
			if (!state.directoryHandle && !state.directoryPath) {
				state.error = 'No connectors folder is open';
				return false;
			}

			if (state.modifiedComponents.size === 0) return true;

			state.isSaving = true;
			state.error = null;

			const errors: string[] = [];

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

		findComponentByPath(path: string): ConnectorComponent | null {
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

		updateComponent(path: string, updates: Record<string, unknown>) {
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

		isComponentModified(path: string): boolean {
			return state.modifiedComponents.has(path);
		},

		/** The base directory path (Tauri only) */
		get directoryPath(): string | null {
			return state.directoryPath;
		},

		/**
		 * Load test-plan.json for a given connector.
		 * Path: <connectorsDir>/<connector>/artifacts/ai-artifacts/test-plan.json
		 */
		async loadTestPlan(connectorName: string): Promise<unknown[] | null> {
			const testPlanRelPath = `${connectorName}/artifacts/ai-artifacts/test-plan.json`;

			if (isTauri && state.directoryPath) {
				const fullPath = `${state.directoryPath}/${testPlanRelPath}`;
				if (!(await tauriExists(fullPath))) return null;
				try {
					const content = await tauriReadTextFile(fullPath);
					return JSON.parse(content);
				} catch {
					return null;
				}
			} else if (state.directoryHandle) {
				try {
					const parts = testPlanRelPath.split('/');
					let dir = state.directoryHandle;
					for (const part of parts.slice(0, -1)) {
						dir = await dir.getDirectoryHandle(part, { create: false });
					}
					const fileHandle = await dir.getFileHandle(parts[parts.length - 1], { create: false });
					const file = await fileHandle.getFile();
					const content = await file.text();
					return JSON.parse(content);
				} catch {
					return null;
				}
			}
			return null;
		},

		/**
		 * Save test-plan.json for a given connector.
		 */
		async saveTestPlan(connectorName: string, data: unknown[]): Promise<boolean> {
			const testPlanRelPath = `${connectorName}/artifacts/ai-artifacts/test-plan.json`;
			const content = JSON.stringify(data, null, 4);

			if (isTauri && state.directoryPath) {
				try {
					await tauriWriteTextFile(`${state.directoryPath}/${testPlanRelPath}`, content);
					return true;
				} catch {
					return false;
				}
			} else if (state.directoryHandle) {
				try {
					const parts = testPlanRelPath.split('/');
					let dir = state.directoryHandle;
					for (const part of parts.slice(0, -1)) {
						dir = await dir.getDirectoryHandle(part, { create: false });
					}
					const fileHandle = await dir.getFileHandle(parts[parts.length - 1], { create: false });
					const writable = await fileHandle.createWritable();
					await writable.write(content);
					await writable.close();
					return true;
				} catch {
					return false;
				}
			}
			return false;
		},

		async restoreLastFolder(): Promise<boolean> {
			if (!isTauri) return false;
			try {
				const savedPath = localStorage.getItem(STORAGE_KEY);
				if (!savedPath) return false;

				// Verify the directory still exists
				if (!tauriFs || !(await tauriFs.exists(savedPath))) {
					localStorage.removeItem(STORAGE_KEY);
					return false;
				}

				const dirName = savedPath.split('/').pop() || savedPath;
				state.directoryPath = savedPath;
				state.directoryName = dirName;
				state.directoryHandle = null;
				state.hasUnsavedChanges = false;
				state.modifiedComponents = new Set();
				state.error = null;
				state.lastSavedAt = null;

				await scanWithTauri(savedPath);
				return true;
			} catch (err) {
				console.warn('Failed to restore last connectors folder:', err);
				return false;
			}
		},

		disconnect() {
			tree = { connectors: [] };
			state.directoryHandle = null;
			state.directoryPath = null;
			state.directoryName = null;
			state.hasUnsavedChanges = false;
			state.modifiedComponents = new Set();
			state.lastSavedAt = null;
			state.error = null;
			try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
		}
	};
}

export const fileSync = createFileSyncStore();
