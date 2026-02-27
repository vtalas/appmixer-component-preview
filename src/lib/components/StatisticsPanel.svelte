<script>
    import { Package, Blocks, FlaskConical, ArrowLeft, Loader2, RefreshCw } from 'lucide-svelte';
    import { Button } from '$lib/components/ui/button';
    import { onMount } from 'svelte';

    let { onBack = () => {}, directoryPath = null } = $props();

    let stats = $state(null);
    let loading = $state(false);
    let error = $state(null);

    async function loadStats() {
        loading = true;
        error = null;
        try {
            const res = await fetch('/api/statistics');
            if (!res.ok) {
                const data = await res.json();
                throw new Error(data.error || 'Failed to load statistics');
            }
            stats = await res.json();
        } catch (err) {
            error = err.message;
        } finally {
            loading = false;
        }
    }

    onMount(() => {
        loadStats();
    });

    // Reload when directory changes
    let prevDir = directoryPath;
    $effect(() => {
        if (directoryPath !== prevDir) {
            prevDir = directoryPath;
            loadStats();
        }
    });
</script>

<div class="statistics-panel">
    <div class="statistics-header">
        <Button variant="ghost" size="sm" onclick={onBack}>
            <ArrowLeft class="h-4 w-4 mr-2" />
            Back
        </Button>
        <h2 class="statistics-title">Statistics</h2>
        <Button variant="ghost" size="sm" onclick={loadStats} disabled={loading}>
            <RefreshCw class="h-4 w-4 {loading ? "spinning" : ""}" />
        </Button>
    </div>

    {#if loading && !stats}
        <div class="statistics-loading">
            <Loader2 class="h-6 w-6 spinning" />
            <span>Loading statistics...</span>
        </div>
    {:else if error}
        <div class="statistics-error">{error}</div>
    {:else if stats}
        <div class="statistics-grid">
            <div class="stat-card">
                <div class="stat-icon connectors">
                    <Package class="h-6 w-6" />
                </div>
                <div class="stat-info">
                    <span class="stat-value">{stats.connectors}</span>
                    <span class="stat-label">Connectors</span>
                    <span class="stat-desc">bundle.json files</span>
                </div>
            </div>
            <div class="stat-card">
                <div class="stat-icon components">
                    <Blocks class="h-6 w-6" />
                </div>
                <div class="stat-info">
                    <span class="stat-value">{stats.components}</span>
                    <span class="stat-label">Components</span>
                    <span class="stat-desc">component.json files</span>
                </div>
            </div>
            <div class="stat-card">
                <div class="stat-icon flows">
                    <FlaskConical class="h-6 w-6" />
                </div>
                <div class="stat-info">
                    <span class="stat-value">{stats.e2eFlows}</span>
                    <span class="stat-label">E2E Flows</span>
                    <span class="stat-desc">test-flow*.json files</span>
                </div>
            </div>
        </div>
        {#if stats.bundles && stats.bundles.length > 0}
            <div class="flow-list-section">
                <h3 class="flow-list-title">Connectors</h3>
                <div class="flow-list">
                    {#each stats.bundles as bundle}
                        <div class="flow-list-item">
                            <span class="flow-connector">{bundle.name}</span>
                            <span class="bundle-version">{bundle.version}</span>
                        </div>
                    {/each}
                </div>
            </div>
        {/if}
        {#if stats.e2eFlowFiles && stats.e2eFlowFiles.length > 0}
            <div class="flow-list-section">
                <h3 class="flow-list-title">E2E Test Flows</h3>
                <div class="flow-list">
                    {#each stats.e2eFlowFiles as flowPath}
                        {@const parts = flowPath.split('/')}
                        {@const connector = parts[0] || ''}
                        {@const fileName = parts[parts.length - 1]}
                        <div class="flow-list-item">
                            <span class="flow-connector">{connector}</span>
                            <span class="flow-filename">{fileName}</span>
                            <span class="flow-path">{flowPath}</span>
                        </div>
                    {/each}
                </div>
            </div>
        {/if}
        {#if stats.directoryPath}
            <div class="statistics-footer">
                <code class="stat-path">{stats.directoryPath}</code>
            </div>
        {/if}
    {/if}
</div>

<style>
    .statistics-panel {
        flex: 1;
        display: flex;
        flex-direction: column;
        overflow: auto;
    }

    .statistics-header {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 16px 24px;
        border-bottom: 1px solid var(--color-border);
    }

    .statistics-title {
        font-size: 18px;
        font-weight: 600;
        flex: 1;
    }

    .statistics-loading {
        flex: 1;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 12px;
        color: var(--color-muted-foreground);
    }

    .statistics-error {
        padding: 24px;
        color: hsl(var(--color-destructive));
        text-align: center;
    }

    .statistics-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
        gap: 16px;
        padding: 24px;
    }

    .stat-card {
        display: flex;
        align-items: center;
        gap: 16px;
        padding: 20px;
        border: 1px solid var(--color-border);
        border-radius: var(--radius-md);
        background: var(--color-card);
    }

    .stat-icon {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 48px;
        height: 48px;
        border-radius: 12px;
        flex-shrink: 0;
    }

    .stat-icon.connectors {
        background: #dbeafe;
        color: #2563eb;
    }

    .stat-icon.components {
        background: #dcfce7;
        color: #16a34a;
    }

    .stat-icon.flows {
        background: #fef3c7;
        color: #d97706;
    }

    .stat-info {
        display: flex;
        flex-direction: column;
    }

    .stat-value {
        font-size: 28px;
        font-weight: 700;
        line-height: 1.1;
    }

    .stat-label {
        font-size: 14px;
        font-weight: 500;
        color: var(--color-foreground);
    }

    .stat-desc {
        font-size: 11px;
        color: var(--color-muted-foreground);
    }

    .flow-list-section {
        padding: 0 24px 16px;
    }

    .flow-list-title {
        font-size: 14px;
        font-weight: 600;
        margin-bottom: 8px;
    }

    .flow-list {
        border: 1px solid var(--color-border);
        border-radius: var(--radius-md);
        overflow: hidden;
    }

    .flow-list-item {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 8px 12px;
        font-size: 13px;
        border-bottom: 1px solid var(--color-border);
    }

    .flow-list-item:last-child {
        border-bottom: none;
    }

    .flow-list-item:hover {
        background: var(--color-muted);
    }

    .bundle-version {
        font-family: monospace;
        font-size: 12px;
        color: var(--color-muted-foreground);
        background: var(--color-muted);
        padding: 1px 8px;
        border-radius: 9999px;
    }

    .flow-connector {
        font-weight: 600;
        min-width: 120px;
        flex-shrink: 0;
    }

    .flow-filename {
        font-family: monospace;
        font-size: 12px;
        flex: 1;
    }

    .flow-path {
        font-family: monospace;
        font-size: 11px;
        color: var(--color-muted-foreground);
        display: none;
    }

    .statistics-footer {
        padding: 0 24px 24px;
    }

    .stat-path {
        display: block;
        font-size: 12px;
        color: var(--color-muted-foreground);
        font-family: monospace;
    }

    :global(.spinning) {
        animation: spin 1s linear infinite;
    }

    @keyframes spin {
        from { transform: rotate(0deg); }
        to { transform: rotate(360deg); }
    }
</style>
