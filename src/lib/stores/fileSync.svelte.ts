import type { ConnectorTree, ConnectorComponent, Connector, ConnectorModule, ComponentJson } from '$lib/types/component';

export interface FileSyncState {
	directoryHandle: FileSystemDirectoryHandle | null;
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
		directoryName: null,
		hasUnsavedChanges: false,
		modifiedComponents: new Set(),
		isSaving: false,
		isLoading: false,
		lastSavedAt: null,
		error: null
	});

	let tree = $state<ConnectorTree>({ connectors: [] });

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
			return typeof window !== 'undefined' && 'showDirectoryPicker' in window;
		},

		get isConnected() {
			return state.directoryHandle !== null && tree.connectors.length > 0;
		},

		markComponentDirty(path: string) {
			state.modifiedComponents = new Set([...state.modifiedComponents, path]);
			state.hasUnsavedChanges = true;
			state.error = null;
		},

		async openConnectorsFolder(): Promise<boolean> {
			if (!this.isSupported) {
				state.error = 'File System Access API is not supported in this browser';
				return false;
			}

			try {
				const dirHandle = await window.showDirectoryPicker({
					id: 'appmixer-connectors',
					mode: 'readwrite'
				});

				state.directoryHandle = dirHandle;
				state.directoryName = dirHandle.name;
				state.hasUnsavedChanges = false;
				state.modifiedComponents = new Set();
				state.error = null;
				state.lastSavedAt = null;

				// Scan the directory and build the tree
				await this.scanConnectorsDirectory();

				return true;
			} catch (err) {
				if (err instanceof Error && err.name === 'AbortError') {
					return false;
				}
				state.error = err instanceof Error ? err.message : 'Failed to open folder';
				return false;
			}
		},

		async scanConnectorsDirectory(): Promise<void> {
			if (!state.directoryHandle) {
				return;
			}

			state.isLoading = true;
			state.error = null;

			try {
				const connectors: Connector[] = [];

				// Iterate over connector directories
				for await (const [connectorName, connectorHandle] of state.directoryHandle.entries()) {
					if (connectorHandle.kind !== 'directory') continue;

					const modules: ConnectorModule[] = [];
					let connectorLabel: string | undefined;
					let connectorIcon: string | undefined;

					// Try to read service.json for connector metadata (icon, label)
					try {
						const serviceFileHandle = await connectorHandle.getFileHandle('service.json', { create: false });
						const serviceFile = await serviceFileHandle.getFile();
						const serviceContent = await serviceFile.text();
						const serviceJson = JSON.parse(serviceContent);
						connectorLabel = serviceJson.label;
						connectorIcon = serviceJson.icon;
					} catch {
						// service.json is optional
					}

					// Iterate over module directories
					for await (const [moduleName, moduleHandle] of connectorHandle.entries()) {
						if (moduleHandle.kind !== 'directory') continue;

						const components: ConnectorComponent[] = [];

						// Iterate over component directories
						for await (const [componentName, componentHandle] of moduleHandle.entries()) {
							if (componentHandle.kind !== 'directory') continue;

							try {
								// Try to read component.json
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
								// Skip directories without component.json
							}
						}

						if (components.length > 0) {
							// Sort components by name
							components.sort((a, b) => a.name.localeCompare(b.name));
							modules.push({
								name: moduleName,
								components
							});
						}
					}

					if (modules.length > 0) {
						// Sort modules by name
						modules.sort((a, b) => a.name.localeCompare(b.name));
						connectors.push({
							name: connectorName,
							label: connectorLabel,
							icon: connectorIcon,
							modules
						});
					}
				}

				// Sort connectors by name
				connectors.sort((a, b) => a.name.localeCompare(b.name));

				tree = { connectors };
				state.isLoading = false;
			} catch (err) {
				state.isLoading = false;
				state.error = err instanceof Error ? err.message : 'Failed to scan directory';
				console.error('Failed to scan connectors directory:', err);
			}
		},

		async loadComponentFromDirectory(path: string): Promise<boolean> {
			if (!state.directoryHandle) {
				return false;
			}

			try {
				const pathParts = path.split('/');
				if (pathParts.length !== 3) {
					return false;
				}

				const [connectorName, moduleName, componentName] = pathParts;

				let currentDir = state.directoryHandle;
				currentDir = await currentDir.getDirectoryHandle(connectorName);
				currentDir = await currentDir.getDirectoryHandle(moduleName);
				currentDir = await currentDir.getDirectoryHandle(componentName);

				const fileHandle = await currentDir.getFileHandle('component.json', { create: false });
				const file = await fileHandle.getFile();
				const content = await file.text();
				const componentJson = JSON.parse(content);

				// Update the component in the tree
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
			} catch (err) {
				console.error(`Failed to load component ${path}:`, err);
				return false;
			}
		},

		async saveComponentToDirectory(component: ConnectorComponent): Promise<boolean> {
			if (!state.directoryHandle) {
				state.error = 'No connectors folder is open';
				return false;
			}

			state.isSaving = true;
			state.error = null;

			try {
				const pathParts = component.path.split('/');
				if (pathParts.length !== 3) {
					throw new Error(`Invalid component path: ${component.path}`);
				}

				const [connectorName, moduleName, componentName] = pathParts;

				let currentDir = state.directoryHandle;
				currentDir = await currentDir.getDirectoryHandle(connectorName);
				currentDir = await currentDir.getDirectoryHandle(moduleName);
				currentDir = await currentDir.getDirectoryHandle(componentName);

				const fileHandle = await currentDir.getFileHandle('component.json', { create: false });
				const writable = await fileHandle.createWritable();
				const content = JSON.stringify(component.componentJson, null, 4);
				await writable.write(content);
				await writable.close();

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
			if (!state.directoryHandle) {
				state.error = 'No connectors folder is open';
				return false;
			}

			if (state.modifiedComponents.size === 0) {
				return true;
			}

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

		disconnect() {
			tree = { connectors: [] };
			state.directoryHandle = null;
			state.directoryName = null;
			state.hasUnsavedChanges = false;
			state.modifiedComponents = new Set();
			state.lastSavedAt = null;
			state.error = null;
		}
	};
}

export const fileSync = createFileSyncStore();
