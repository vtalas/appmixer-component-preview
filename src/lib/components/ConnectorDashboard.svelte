<script>
	import * as Card from '$lib/components/ui/card';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import { Package, FlaskConical, Box } from 'lucide-svelte';

	let {
		connector,
		testPlanData = null,
		onComponentSelect,
		onViewTestPlan
	} = $props();

	let stats = $derived.by(() => {
		let totalComponents = 0;
		let totalModules = connector.modules.length;
		let triggers = 0;
		let authComponents = 0;

		for (const module of connector.modules) {
			for (const comp of module.components) {
				totalComponents++;
				if (comp.componentJson.trigger) triggers++;
				if (comp.componentJson.auth) authComponents++;
			}
		}

		return { totalComponents, totalModules, triggers, authComponents };
	});

	let testPlanStats = $derived.by(() => {
		if (!testPlanData) return null;
		return {
			passed: testPlanData.filter(t => t.status === 'passed').length,
			failed: testPlanData.filter(t => t.status === 'failed').length,
			total: testPlanData.length
		};
	});

	let allComponents = $derived.by(() => {
		const list = [];
		for (const module of connector.modules) {
			for (const comp of module.components) {
				list.push({ ...comp, moduleName: module.name });
			}
		}
		return list;
	});

	function getComponentType(comp) {
		if (comp.componentJson.trigger && comp.componentJson.webhook) return 'Webhook';
		if (comp.componentJson.trigger && comp.componentJson.tick) return 'Polling';
		if (comp.componentJson.trigger) return 'Trigger';
		return 'Action';
	}

	function getTypeBadgeVariant(type) {
		if (type === 'Webhook') return 'secondary';
		if (type === 'Polling') return 'secondary';
		if (type === 'Trigger') return 'default';
		return 'outline';
	}
</script>

<div class="dashboard">
	<!-- Header -->
	<div class="dashboard-header">
		<div class="dashboard-title-section">
			{#if connector.icon}
				<img src={connector.icon} alt="" class="dashboard-icon" />
			{:else}
				<div class="dashboard-icon-placeholder">
					<Package class="dashboard-icon-fallback" />
				</div>
			{/if}
			<div class="dashboard-title-text">
				<h2 class="dashboard-title">{connector.label || connector.name}</h2>
				<p class="dashboard-subtitle">{connector.name}</p>
			</div>
		</div>
	</div>

	<div class="dashboard-body">
		<!-- Stat Cards -->
		<div class="stats-grid">
			<Card.Root class="stat-card">
				<Card.Content class="stat-card-content">
					<span class="stat-label">Components</span>
					<span class="stat-value">{stats.totalComponents}</span>
				</Card.Content>
			</Card.Root>

			<Card.Root class="stat-card">
				<Card.Content class="stat-card-content">
					<span class="stat-label">Modules</span>
					<span class="stat-value">{stats.totalModules}</span>
				</Card.Content>
			</Card.Root>

			<Card.Root class="stat-card">
				<Card.Content class="stat-card-content">
					<span class="stat-label">Triggers</span>
					<span class="stat-value">{stats.triggers}</span>
				</Card.Content>
			</Card.Root>

			<Card.Root class="stat-card">
				<Card.Content class="stat-card-content">
					<span class="stat-label">Auth Required</span>
					<span class="stat-value">{stats.authComponents}</span>
				</Card.Content>
			</Card.Root>

			{#if testPlanStats}
				<Card.Root class="stat-card test-plan-card">
					<Card.Content class="stat-card-content">
						<span class="stat-label">
							<FlaskConical class="stat-icon" />
							Test Plan
						</span>
						<div class="test-plan-stats">
							<span class="test-passed">{testPlanStats.passed} passed</span>
							<span class="test-separator">/</span>
							<span class="test-failed">{testPlanStats.failed} failed</span>
							<span class="test-separator">/</span>
							<span class="test-total">{testPlanStats.total} total</span>
						</div>
						{#if onViewTestPlan}
							<Button variant="outline" size="sm" onclick={onViewTestPlan} class="test-plan-btn">
								View Test Plan
							</Button>
						{/if}
					</Card.Content>
				</Card.Root>
			{/if}
		</div>

		<!-- Components Table -->
		<div class="components-section">
			<h3 class="section-title">Components</h3>
			<div class="components-table">
				<div class="table-header">
					<span class="col-name">Name</span>
					<span class="col-type">Type</span>
					<span class="col-module">Module</span>
				</div>
				{#each allComponents as comp}
					{@const compType = getComponentType(comp)}
					<button
						class="table-row"
						onclick={() => onComponentSelect?.(comp)}
					>
						<span class="col-name">
							{#if comp.componentJson.icon}
								<img src={comp.componentJson.icon} alt="" class="table-comp-icon" />
							{:else if connector.icon}
								<img src={connector.icon} alt="" class="table-comp-icon" />
							{:else}
								<Box class="table-comp-icon-fallback" />
							{/if}
							{comp.label || comp.name}
						</span>
						<span class="col-type">
							<Badge variant={getTypeBadgeVariant(compType)}>{compType}</Badge>
						</span>
						<span class="col-module">{comp.moduleName}</span>
					</button>
				{/each}
			</div>
		</div>
	</div>
</div>

<style>
	.dashboard {
		flex: 1;
		display: flex;
		flex-direction: column;
		overflow: hidden;
	}

	.dashboard-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 16px 20px;
		border-bottom: 1px solid var(--color-border);
		background: var(--color-card);
	}

	.dashboard-title-section {
		display: flex;
		align-items: center;
		gap: 12px;
	}

	.dashboard-icon {
		width: 40px;
		height: 40px;
		flex-shrink: 0;
		border-radius: 4px;
	}

	.dashboard-icon-placeholder {
		width: 40px;
		height: 40px;
		flex-shrink: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		background: var(--color-muted);
		border-radius: 4px;
	}

	:global(.dashboard-icon-fallback) {
		width: 24px;
		height: 24px;
		color: var(--color-muted-foreground);
	}

	.dashboard-title-text {
		display: flex;
		flex-direction: column;
	}

	.dashboard-title {
		font-size: 18px;
		font-weight: 600;
		line-height: 1.2;
	}

	.dashboard-subtitle {
		font-size: 12px;
		color: var(--color-muted-foreground);
		font-family: monospace;
	}

	.dashboard-body {
		flex: 1;
		overflow: auto;
		padding: 20px;
	}

	/* Stat Cards Grid */
	.stats-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
		gap: 12px;
		margin-bottom: 24px;
	}

	:global(.stat-card) {
		padding: 0 !important;
		gap: 0 !important;
	}

	:global(.stat-card-content) {
		display: flex;
		flex-direction: column;
		gap: 4px;
		padding: 16px !important;
	}

	.stat-label {
		font-size: 12px;
		font-weight: 500;
		color: var(--color-muted-foreground);
		display: flex;
		align-items: center;
		gap: 4px;
	}

	:global(.stat-icon) {
		width: 14px;
		height: 14px;
	}

	.stat-value {
		font-size: 28px;
		font-weight: 700;
		line-height: 1;
	}

	/* Test Plan Card */
	:global(.test-plan-card) {
		grid-column: span 2;
	}

	.test-plan-stats {
		display: flex;
		align-items: center;
		gap: 6px;
		font-size: 14px;
		font-weight: 500;
		margin-top: 4px;
	}

	.test-passed {
		color: #22c55e;
	}

	.test-failed {
		color: #ef4444;
	}

	.test-total {
		color: var(--color-muted-foreground);
	}

	.test-separator {
		color: var(--color-muted-foreground);
	}

	:global(.test-plan-btn) {
		margin-top: 8px;
		align-self: flex-start;
	}

	/* Components Table */
	.components-section {
		display: flex;
		flex-direction: column;
	}

	.section-title {
		font-size: 14px;
		font-weight: 600;
		margin-bottom: 8px;
	}

	.components-table {
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		overflow: hidden;
	}

	.table-header {
		display: grid;
		grid-template-columns: 1fr 100px 120px;
		gap: 8px;
		padding: 8px 12px;
		font-size: 11px;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--color-muted-foreground);
		background: var(--color-muted);
		border-bottom: 1px solid var(--color-border);
	}

	.table-row {
		display: grid;
		grid-template-columns: 1fr 100px 120px;
		gap: 8px;
		padding: 8px 12px;
		font-size: 13px;
		border: none;
		background: transparent;
		text-align: left;
		cursor: pointer;
		width: 100%;
		border-bottom: 1px solid var(--color-border);
		transition: background 0.1s;
	}

	.table-row:last-child {
		border-bottom: none;
	}

	.table-row:hover {
		background: var(--color-muted);
	}

	.col-name {
		display: flex;
		align-items: center;
		gap: 8px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.col-type {
		display: flex;
		align-items: center;
	}

	.col-module {
		display: flex;
		align-items: center;
		color: var(--color-muted-foreground);
		font-family: monospace;
		font-size: 12px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.table-comp-icon {
		width: 16px;
		height: 16px;
		flex-shrink: 0;
		border-radius: 2px;
	}

	:global(.table-comp-icon-fallback) {
		width: 16px;
		height: 16px;
		flex-shrink: 0;
		color: var(--color-muted-foreground);
	}
</style>
