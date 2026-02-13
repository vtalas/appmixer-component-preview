// Tauri APIs — loaded dynamically so the store works in browsers too
let tauriDialog = null;
let tauriFs = null;
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

function createFileSyncStore() {
	let state = $state({
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

	let tree = $state({ connectors: [] });

	// ── Tauri filesystem helpers ─────────────────────────────────────

	async function tauriReadDir(dirPath) {
		if (!tauriFs) return [];
		const entries = await tauriFs.readDir(dirPath);
		return entries.map(e => ({
			name: e.name ?? '',
			isDirectory: e.isDirectory ?? false
		}));
	}

	async function tauriReadTextFile(filePath) {
		if (!tauriFs) throw new Error('Tauri FS not loaded');
		return tauriFs.readTextFile(filePath);
	}

	async function tauriWriteTextFile(filePath, content) {
		if (!tauriFs) throw new Error('Tauri FS not loaded');
		await tauriFs.writeTextFile(filePath, content);
	}

	async function tauriExists(filePath) {
		if (!tauriFs) return false;
		return tauriFs.exists(filePath);
	}

	// ── Tauri-based directory scanning ───────────────────────────────

	// Directories to skip while scanning (not component modules)
	const SKIP_DIRS = new Set([
		'node_modules', '.git', '.github', 'artifacts', 'test', 'tests',
		'__tests__', 'dist', 'build', '.svelte-kit', '.vscode'
	]);

	function shouldScanDir(name) {
		if (!name || name.startsWith('.')) return false;
		return !SKIP_DIRS.has(name);
	}

	async function tauriFindFile(dirPath, fileName, depth = 0, maxDepth = 4) {
		if (depth > maxDepth) return null;
		try {
			const entries = await tauriReadDir(dirPath);
			for (const entry of entries) {
				if (!entry.isDirectory && entry.name === fileName) {
					return `${dirPath}/${entry.name}`;
				}
			}
			for (const entry of entries) {
				if (entry.isDirectory && shouldScanDir(entry.name)) {
					const found = await tauriFindFile(`${dirPath}/${entry.name}`, fileName, depth + 1, maxDepth);
					if (found) return found;
				}
			}
		} catch { /* ignore */ }
		return null;
	}

	async function scanWithTauri(basePath) {
		state.isLoading = true;
		state.error = null;

		try {
			const connectors = [];
			const topEntries = await tauriReadDir(basePath);

			for (const connectorEntry of topEntries) {
				if (!connectorEntry.isDirectory || !shouldScanDir(connectorEntry.name)) continue;

				const connectorPath = `${basePath}/${connectorEntry.name}`;
				const modules = [];
				let connectorLabel;
				let connectorIcon;

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

				let moduleEntries = [];
				try {
					moduleEntries = await tauriReadDir(connectorPath);
				} catch {
					continue; // skip connectors we can't read
				}

				for (const moduleEntry of moduleEntries) {
					if (!moduleEntry.isDirectory || !shouldScanDir(moduleEntry.name)) continue;

					const modulePath = `${connectorPath}/${moduleEntry.name}`;
					const components = [];

					let componentEntries = [];
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
								const componentJson = JSON.parse(content);
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

	async function scanWithBrowserFS(dirHandle) {
		state.isLoading = true;
		state.error = null;

		try {
			const connectors = [];

			for await (const [connectorName, connectorHandle] of dirHandle.entries()) {
				if (connectorHandle.kind !== 'directory') continue;

				const modules = [];
				let connectorLabel;
				let connectorIcon;

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

					const components = [];

					for await (const [componentName, componentHandle] of moduleHandle.entries()) {
						if (componentHandle.kind !== 'directory') continue;

						try {
							const fileHandle = await componentHandle.getFileHandle('component.json', { create: false });
							const file = await fileHandle.getFile();
							const content = await file.text();
							const componentJson = JSON.parse(content);

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
		set tree(value) {
			tree = value;
		},

		get isTauri() {
			return isTauri;
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

		markComponentDirty(path) {
			state.modifiedComponents = new Set([...state.modifiedComponents, path]);
			state.hasUnsavedChanges = true;
			state.error = null;
		},

		async openConnectorsFolder() {
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

					const dirPath = selected;
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

		async scanConnectorsDirectory() {
			if (isTauri && state.directoryPath) {
				await scanWithTauri(state.directoryPath);
			} else if (state.directoryHandle) {
				await scanWithBrowserFS(state.directoryHandle);
			}
		},

		async loadComponentFromDirectory(path) {
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

		async saveComponentToDirectory(component) {
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

		async saveAllModifiedComponents() {
			if (!state.directoryHandle && !state.directoryPath) {
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

		/** The base directory path (Tauri only) */
		get directoryPath() {
			return state.directoryPath;
		},

		/**
		 * Load test-plan.json for a given connector.
		 * Path: <connectorsDir>/<connector>/artifacts/ai-artifacts/test-plan.json
		 */
		async loadTestPlan(connectorName) {
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
		async saveTestPlan(connectorName, data) {
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

		async restoreLastFolder() {
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

		async getAuthInfo(connectorName) {
			if (!isTauri || !state.directoryPath) return { found: false };

			const connectorPath = `${state.directoryPath}/${connectorName}`;
			const authJsPath = await tauriFindFile(connectorPath, 'auth.js');

			if (!authJsPath) return { found: false, authType: null, fullPath: null };

			try {
				const content = await tauriReadTextFile(authJsPath);
				const typeMatch = content.match(/type:\s*['"](\w+)['"]/);
				const authType = typeMatch ? typeMatch[1] : null;

				return { found: true, authType, fullPath: authJsPath };
			} catch {
				return { found: false, authType: null, fullPath: null };
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
