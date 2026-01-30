<script lang="ts">
	import { Input } from '$lib/components/ui/input';
	import { ScrollArea } from '$lib/components/ui/scroll-area';
	import * as Collapsible from '$lib/components/ui/collapsible';
	import { Badge } from '$lib/components/ui/badge';
	import { ChevronRight, Search, Package, Folder, Box, X } from 'lucide-svelte';
	import { Button } from '$lib/components/ui/button';
	import ComponentPreview from '$lib/components/ComponentPreview.svelte';
	import type { ConnectorComponent, ConnectorTree } from '$lib/types/component';

	let { data } = $props();

	let searchQuery = $state('');
	let selectedComponent = $state<ConnectorComponent | null>(null);
	let expandedConnectors = $state<Set<string>>(new Set());
	let expandedModules = $state<Set<string>>(new Set());

	let filteredTree = $derived.by(() => {
		if (!searchQuery.trim()) {
			return data.tree;
		}

		const query = searchQuery.toLowerCase();
		const filtered: ConnectorTree = { connectors: [] };

		for (const connector of data.tree.connectors) {
			const filteredModules = [];

			for (const module of connector.modules) {
				const filteredComponents = module.components.filter((comp) => {
					const searchText = [
						comp.name,
						comp.label || '',
						comp.componentJson.description || '',
						connector.name,
						module.name
					]
						.join(' ')
						.toLowerCase();
					return searchText.includes(query);
				});

				if (filteredComponents.length > 0) {
					filteredModules.push({
						...module,
						components: filteredComponents
					});
				}
			}

			if (filteredModules.length > 0) {
				filtered.connectors.push({
					...connector,
					modules: filteredModules
				});
			}
		}

		return filtered;
	});

	function toggleConnector(name: string) {
		const newSet = new Set(expandedConnectors);
		if (newSet.has(name)) {
			newSet.delete(name);
		} else {
			newSet.add(name);
		}
		expandedConnectors = newSet;
	}

	function toggleModule(key: string) {
		const newSet = new Set(expandedModules);
		if (newSet.has(key)) {
			newSet.delete(key);
		} else {
			newSet.add(key);
		}
		expandedModules = newSet;
	}

	function selectComponent(component: ConnectorComponent) {
		selectedComponent = component;
	}

	function closeEditor() {
		selectedComponent = null;
	}

	// Expand all when searching
	$effect(() => {
		if (searchQuery.trim()) {
			const connectorNames = new Set(filteredTree.connectors.map((c) => c.name));
			expandedConnectors = connectorNames;

			const moduleKeys = new Set<string>();
			for (const connector of filteredTree.connectors) {
				for (const module of connector.modules) {
					moduleKeys.add(`${connector.name}/${module.name}`);
				}
			}
			expandedModules = moduleKeys;
		}
	});
</script>

<svelte:head>
	<title>Appmixer Component Preview</title>
</svelte:head>

<div class="app-layout">
	<!-- Sidebar -->
	<div class="sidebar">
		<div class="sidebar-header">
			<h1 class="sidebar-title">Components</h1>
			<div class="search-box">
				<Search class="search-icon" />
				<Input
					placeholder="Search..."
					class="search-input"
					bind:value={searchQuery}
				/>
			</div>
		</div>

		<ScrollArea class="sidebar-content">
			<div class="tree-container">
				{#each filteredTree.connectors as connector}
					<Collapsible.Root
						open={expandedConnectors.has(connector.name)}
						onOpenChange={() => toggleConnector(connector.name)}
					>
						<Collapsible.Trigger class="tree-item connector-item">
							<ChevronRight
								class="tree-chevron {expandedConnectors.has(connector.name) ? 'expanded' : ''}"
							/>
							<Package class="tree-icon" />
							<span class="tree-label">{connector.name}</span>
							<Badge variant="secondary" class="tree-badge">
								{connector.modules.reduce((acc, m) => acc + m.components.length, 0)}
							</Badge>
						</Collapsible.Trigger>
						<Collapsible.Content>
							<div class="tree-children">
								{#each connector.modules as module}
									{@const moduleKey = `${connector.name}/${module.name}`}
									<Collapsible.Root
										open={expandedModules.has(moduleKey)}
										onOpenChange={() => toggleModule(moduleKey)}
									>
										<Collapsible.Trigger class="tree-item module-item">
											<ChevronRight
												class="tree-chevron {expandedModules.has(moduleKey) ? 'expanded' : ''}"
											/>
											<Folder class="tree-icon" />
											<span class="tree-label">{module.name}</span>
											<Badge variant="outline" class="tree-badge">
												{module.components.length}
											</Badge>
										</Collapsible.Trigger>
										<Collapsible.Content>
											<div class="tree-children">
												{#each module.components as component}
													<button
														class="tree-item component-item {selectedComponent?.path === component.path ? 'selected' : ''}"
														onclick={() => selectComponent(component)}
													>
														{#if component.componentJson.icon}
															<img
																src="data:image/svg+xml;base64,{component.componentJson.icon}"
																alt=""
																class="component-icon"
															/>
														{:else}
															<Box class="tree-icon" />
														{/if}
														<span class="tree-label">{component.label || component.name}</span>
														{#if component.componentJson.trigger}
															<Badge variant="secondary" class="tree-badge small">T</Badge>
														{/if}
													</button>
												{/each}
											</div>
										</Collapsible.Content>
									</Collapsible.Root>
								{/each}
							</div>
						</Collapsible.Content>
					</Collapsible.Root>
				{/each}
			</div>
		</ScrollArea>
	</div>

	<!-- Main Content -->
	<div class="main-content">
		{#if selectedComponent}
			{@const comp = selectedComponent.componentJson}
			<div class="editor-panel">
				<!-- Editor Header -->
				<div class="editor-header">
					<div class="editor-title-section">
						{#if comp.icon}
							<img
								src="data:image/svg+xml;base64,{comp.icon}"
								alt=""
								class="editor-icon"
							/>
						{/if}
						<div class="editor-title-text">
							<h2 class="editor-title">{comp.label || selectedComponent.name}</h2>
							<p class="editor-subtitle">{comp.name}</p>
						</div>
					</div>
					<Button variant="ghost" size="sm" onclick={closeEditor} class="close-button">
						<X class="h-4 w-4" />
					</Button>
				</div>

				<!-- Component Info -->
				{#if comp.description}
					<div class="editor-description">
						{comp.description}
					</div>
				{/if}

				<div class="editor-badges">
					{#if comp.trigger}
						<Badge>Trigger</Badge>
					{/if}
					{#if comp.webhook}
						<Badge variant="secondary">Webhook</Badge>
					{/if}
					{#if comp.tick}
						<Badge variant="secondary">Polling</Badge>
					{/if}
					{#if comp.auth}
						<Badge variant="outline">{comp.auth.service}</Badge>
					{/if}
				</div>

				<!-- Component Preview/Editor -->
				<div class="editor-body">
					<ComponentPreview componentJson={comp} />
				</div>
			</div>
		{:else}
			<div class="empty-state">
				<Package class="empty-icon" />
				<p class="empty-title">Select a component</p>
				<p class="empty-subtitle">Browse connectors in the sidebar and click on a component to preview its inputs</p>
			</div>
		{/if}
	</div>
</div>

<style>
	.app-layout {
		display: flex;
		height: 100vh;
		background: var(--color-background);
	}

	/* Sidebar */
	.sidebar {
		width: 320px;
		border-right: 1px solid var(--color-border);
		display: flex;
		flex-direction: column;
		background: var(--color-card);
	}

	.sidebar-header {
		padding: 16px;
		border-bottom: 1px solid var(--color-border);
	}

	.sidebar-title {
		font-size: 16px;
		font-weight: 600;
		margin-bottom: 12px;
	}

	.search-box {
		position: relative;
	}

	:global(.search-icon) {
		position: absolute;
		left: 10px;
		top: 50%;
		transform: translateY(-50%);
		width: 16px;
		height: 16px;
		color: var(--color-muted-foreground);
	}

	:global(.search-input) {
		padding-left: 34px;
		height: 36px;
		font-size: 13px;
	}

	:global(.sidebar-content) {
		flex: 1;
	}

	.tree-container {
		padding: 8px;
	}

	:global(.tree-item) {
		display: flex;
		align-items: center;
		gap: 6px;
		width: 100%;
		padding: 6px 8px;
		border-radius: var(--radius-md);
		font-size: 13px;
		text-align: left;
		cursor: pointer;
		border: none;
		background: transparent;
	}

	:global(.tree-item:hover) {
		background: var(--color-muted);
	}

	:global(.tree-item.selected) {
		background: var(--color-accent);
	}

	:global(.tree-chevron) {
		width: 14px;
		height: 14px;
		flex-shrink: 0;
		transition: transform 0.15s ease;
	}

	:global(.tree-chevron.expanded) {
		transform: rotate(90deg);
	}

	:global(.tree-icon) {
		width: 16px;
		height: 16px;
		flex-shrink: 0;
		color: var(--color-muted-foreground);
	}

	.component-icon {
		width: 16px;
		height: 16px;
		flex-shrink: 0;
	}

	.tree-label {
		flex: 1;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	:global(.tree-badge) {
		font-size: 10px;
		padding: 0 6px;
		height: 18px;
	}

	:global(.tree-badge.small) {
		padding: 0 4px;
		height: 16px;
	}

	.tree-children {
		margin-left: 20px;
	}

	/* Main Content */
	.main-content {
		flex: 1;
		display: flex;
		flex-direction: column;
		overflow: hidden;
	}

	.editor-panel {
		flex: 1;
		display: flex;
		flex-direction: column;
		overflow: hidden;
	}

	.editor-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 16px 20px;
		border-bottom: 1px solid var(--color-border);
		background: var(--color-card);
	}

	.editor-title-section {
		display: flex;
		align-items: center;
		gap: 12px;
	}

	.editor-icon {
		width: 40px;
		height: 40px;
	}

	.editor-title-text {
		display: flex;
		flex-direction: column;
	}

	.editor-title {
		font-size: 18px;
		font-weight: 600;
		line-height: 1.2;
	}

	.editor-subtitle {
		font-size: 12px;
		color: var(--color-muted-foreground);
		font-family: monospace;
	}

	:global(.close-button) {
		color: var(--color-muted-foreground);
	}

	.editor-description {
		padding: 12px 20px;
		font-size: 13px;
		color: var(--color-muted-foreground);
		border-bottom: 1px solid var(--color-border);
		background: var(--color-muted);
	}

	.editor-badges {
		display: flex;
		gap: 6px;
		padding: 12px 20px;
		border-bottom: 1px solid var(--color-border);
	}

	.editor-badges:empty {
		display: none;
	}

	.editor-body {
		flex: 1;
		overflow: auto;
		padding: 20px;
	}

	/* Empty State */
	.empty-state {
		flex: 1;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		color: var(--color-muted-foreground);
		padding: 40px;
	}

	:global(.empty-icon) {
		width: 64px;
		height: 64px;
		opacity: 0.3;
		margin-bottom: 16px;
	}

	.empty-title {
		font-size: 18px;
		font-weight: 500;
		margin-bottom: 8px;
	}

	.empty-subtitle {
		font-size: 14px;
		text-align: center;
		max-width: 300px;
	}
</style>
