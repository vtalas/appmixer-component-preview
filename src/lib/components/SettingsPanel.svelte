<script>
	import { Button } from '$lib/components/ui/button';
	import { Badge } from '$lib/components/ui/badge';
	import { ArrowLeft, Plus, Trash2, Check, Pencil, X, Loader2, Server, Github } from 'lucide-svelte';
	import { onMount } from 'svelte';

	let { onBack } = $props();

	// Data
	let loading = $state(true);
	let appmixerData = $state({ instances: [], activeId: 'env-default', envConfigured: false, envInfo: {} });
	let githubData = $state({ instances: [], activeId: 'env-default', envConfigured: false, envInfo: {} });

	// Appmixer form
	let showAmForm = $state(false);
	let amEditing = $state(null); // null = add, id = edit
	let amForm = $state({ name: '', baseUrl: '', username: '', password: '' });
	let amSaving = $state(false);
	let amError = $state('');

	// GitHub form
	let showGhForm = $state(false);
	let ghEditing = $state(null);
	let ghForm = $state({ name: '', owner: '', repo: '', branch: '', token: '' });
	let ghSaving = $state(false);
	let ghError = $state('');

	async function loadSettings() {
		try {
			const res = await fetch('/api/settings');
			if (res.ok) {
				const data = await res.json();
				appmixerData = data.appmixer;
				githubData = data.github;
			}
		} catch { /* ignore */ }
		finally { loading = false; }
	}

	onMount(() => { loadSettings(); });

	// ── Appmixer actions ──

	function openAmAdd() {
		amEditing = null;
		amForm = { name: '', baseUrl: '', username: '', password: '' };
		amError = '';
		showAmForm = true;
	}

	function openAmEdit(inst) {
		amEditing = inst.id;
		amForm = { name: inst.name, baseUrl: inst.baseUrl, username: inst.username, password: '' };
		amError = '';
		showAmForm = true;
	}

	function closeAmForm() {
		showAmForm = false;
		amError = '';
	}

	async function saveAmInstance() {
		if (!amForm.name.trim() || !amForm.baseUrl.trim() || !amForm.username.trim()) {
			amError = 'Name, Base URL, and Username are required';
			return;
		}
		if (!amEditing && !amForm.password.trim()) {
			amError = 'Password is required for new instances';
			return;
		}
		amSaving = true;
		amError = '';
		try {
			const action = amEditing ? 'update' : 'add';
			const instance = { ...amForm };
			if (amEditing) instance.id = amEditing;
			// Don't send empty password on edit (keeps existing)
			if (amEditing && !instance.password) delete instance.password;

			const res = await fetch('/api/settings', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ action, type: 'appmixer', instance })
			});
			if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message || 'Failed to save');
			const result = await res.json();
			appmixerData = { ...appmixerData, instances: result.instances };
			showAmForm = false;
		} catch (e) {
			amError = e.message;
		} finally {
			amSaving = false;
		}
	}

	async function deleteAmInstance(id) {
		try {
			const res = await fetch('/api/settings', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ action: 'delete', type: 'appmixer', id })
			});
			if (!res.ok) throw new Error('Failed to delete');
			const result = await res.json();
			appmixerData = { ...appmixerData, instances: result.instances, activeId: result.activeId };
		} catch { /* ignore */ }
	}

	async function setAmActive(id) {
		try {
			const res = await fetch('/api/settings', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ action: 'setActive', type: 'appmixer', id })
			});
			if (!res.ok) throw new Error('Failed');
			const result = await res.json();
			appmixerData = { ...appmixerData, activeId: result.activeId };
		} catch { /* ignore */ }
	}

	// ── GitHub actions ──

	function openGhAdd() {
		ghEditing = null;
		ghForm = { name: '', owner: '', repo: '', branch: '', token: '' };
		ghError = '';
		showGhForm = true;
	}

	function openGhEdit(inst) {
		ghEditing = inst.id;
		ghForm = { name: inst.name, owner: inst.owner, repo: inst.repo, branch: inst.branch, token: '' };
		ghError = '';
		showGhForm = true;
	}

	function closeGhForm() {
		showGhForm = false;
		ghError = '';
	}

	async function saveGhInstance() {
		if (!ghForm.name.trim() || !ghForm.owner.trim() || !ghForm.repo.trim() || !ghForm.branch.trim()) {
			ghError = 'Name, Owner, Repository, and Branch are required';
			return;
		}
		ghSaving = true;
		ghError = '';
		try {
			const action = ghEditing ? 'update' : 'add';
			const instance = { ...ghForm };
			if (ghEditing) instance.id = ghEditing;
			if (ghEditing && !instance.token) delete instance.token;

			const res = await fetch('/api/settings', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ action, type: 'github', instance })
			});
			if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message || 'Failed to save');
			const result = await res.json();
			githubData = { ...githubData, instances: result.instances };
			showGhForm = false;
		} catch (e) {
			ghError = e.message;
		} finally {
			ghSaving = false;
		}
	}

	async function deleteGhInstance(id) {
		try {
			const res = await fetch('/api/settings', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ action: 'delete', type: 'github', id })
			});
			if (!res.ok) throw new Error('Failed to delete');
			const result = await res.json();
			githubData = { ...githubData, instances: result.instances, activeId: result.activeId };
		} catch { /* ignore */ }
	}

	async function setGhActive(id) {
		try {
			const res = await fetch('/api/settings', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ action: 'setActive', type: 'github', id })
			});
			if (!res.ok) throw new Error('Failed');
			const result = await res.json();
			githubData = { ...githubData, activeId: result.activeId };
		} catch { /* ignore */ }
	}

	function handleKeydown(e) {
		if (e.key === 'Escape') {
			if (showAmForm) closeAmForm();
			else if (showGhForm) closeGhForm();
		}
	}
</script>

<svelte:window onkeydown={handleKeydown} />

<div class="settings-panel">
	<!-- Header -->
	<div class="settings-header">
		<div class="settings-header-left">
			<Button variant="ghost" size="sm" onclick={onBack}>
				<ArrowLeft class="h-4 w-4 mr-1" />
				Back
			</Button>
			<h2 class="settings-title">Settings</h2>
		</div>
	</div>

	{#if loading}
		<div class="settings-loading">
			<Loader2 class="h-5 w-5 spinning" />
			<span>Loading settings...</span>
		</div>
	{:else}
		<div class="settings-body">
			<!-- ═══════ Appmixer Instances ═══════ -->
			<div class="settings-section">
				<div class="section-header">
					<div class="section-title-row">
						<Server class="h-4 w-4" />
						<h3>Appmixer Instances</h3>
					</div>
					<Button variant="outline" size="sm" onclick={openAmAdd}>
						<Plus class="h-3.5 w-3.5 mr-1" />
						Add Instance
					</Button>
				</div>

				<!-- Env default card -->
				<button
					class="instance-card"
					class:active={appmixerData.activeId === 'env-default'}
					onclick={() => setAmActive('env-default')}
				>
					<div class="instance-info">
						<div class="instance-name">
							Environment Default
							{#if appmixerData.activeId === 'env-default'}
								<Badge variant="default" class="active-badge">Active</Badge>
							{/if}
						</div>
						<div class="instance-details">
							{#if appmixerData.envConfigured}
								<span>{appmixerData.envInfo.baseUrl}</span>
								<span class="detail-sep">&middot;</span>
								<span>{appmixerData.envInfo.username}</span>
							{:else}
								<span class="not-configured">Not configured (set APPMIXER_BASE_URL, APPMIXER_USERNAME, APPMIXER_PASSWORD)</span>
							{/if}
						</div>
					</div>
				</button>

				<!-- Custom instances -->
				{#each appmixerData.instances as inst (inst.id)}
					<div
						class="instance-card"
						class:active={appmixerData.activeId === inst.id}
					>
						<button class="instance-info" onclick={() => setAmActive(inst.id)}>
							<div class="instance-name">
								{inst.name}
								{#if appmixerData.activeId === inst.id}
									<Badge variant="default" class="active-badge">Active</Badge>
								{/if}
							</div>
							<div class="instance-details">
								<span>{inst.baseUrl}</span>
								<span class="detail-sep">&middot;</span>
								<span>{inst.username}</span>
								{#if inst.hasPassword}
									<span class="detail-sep">&middot;</span>
									<span class="detail-muted">Password set</span>
								{/if}
							</div>
						</button>
						<div class="instance-actions">
							<button class="icon-btn" onclick={() => openAmEdit(inst)} title="Edit">
								<Pencil class="h-3.5 w-3.5" />
							</button>
							<button class="icon-btn icon-btn-danger" onclick={() => deleteAmInstance(inst.id)} title="Delete">
								<Trash2 class="h-3.5 w-3.5" />
							</button>
						</div>
					</div>
				{/each}

				<!-- Add/Edit form -->
				{#if showAmForm}
					<div class="instance-form">
						<div class="form-header">
							<span class="form-title">{amEditing ? 'Edit' : 'Add'} Appmixer Instance</span>
							<button class="icon-btn" onclick={closeAmForm}><X class="h-3.5 w-3.5" /></button>
						</div>
						<div class="form-fields">
							<label class="form-field">
								<span>Name</span>
								<input type="text" bind:value={amForm.name} placeholder="e.g. QA, Production" class="settings-input" />
							</label>
							<label class="form-field">
								<span>Base URL</span>
								<div class="quick-btns">
									<button class="quick-btn" class:active={amForm.baseUrl === 'https://api-dev-automated-00001.dev.appmixer.ai'} onclick={() => amForm.baseUrl = 'https://api-dev-automated-00001.dev.appmixer.ai'}>QA</button>
									<button class="quick-btn" class:active={amForm.baseUrl === 'https://api.clientio.appmixer.cloud'} onclick={() => amForm.baseUrl = 'https://api.clientio.appmixer.cloud'}>ClientIO</button>
								</div>
								<input type="text" bind:value={amForm.baseUrl} placeholder="https://api.example.com" class="settings-input" />
							</label>
							<label class="form-field">
								<span>Username</span>
								<input type="text" bind:value={amForm.username} placeholder="user@example.com" class="settings-input" />
							</label>
							<label class="form-field">
								<span>Password {#if amEditing}<small>(leave empty to keep current)</small>{/if}</span>
								<input type="password" bind:value={amForm.password} placeholder={amEditing ? 'Keep current password' : 'Enter password'} class="settings-input" />
							</label>
						</div>
						{#if amError}
							<div class="form-error">{amError}</div>
						{/if}
						<div class="form-actions">
							<Button variant="outline" size="sm" onclick={closeAmForm} disabled={amSaving}>Cancel</Button>
							<Button size="sm" onclick={saveAmInstance} disabled={amSaving}>
								{#if amSaving}<Loader2 class="h-3.5 w-3.5 spinning mr-1" />Saving...{:else}{amEditing ? 'Update' : 'Add'}{/if}
							</Button>
						</div>
					</div>
				{/if}
			</div>

			<!-- ═══════ GitHub Instances ═══════ -->
			<div class="settings-section">
				<div class="section-header">
					<div class="section-title-row">
						<Github class="h-4 w-4" />
						<h3>GitHub Instances</h3>
					</div>
					<Button variant="outline" size="sm" onclick={openGhAdd}>
						<Plus class="h-3.5 w-3.5 mr-1" />
						Add Instance
					</Button>
				</div>

				<!-- Env default card -->
				<button
					class="instance-card"
					class:active={githubData.activeId === 'env-default'}
					onclick={() => setGhActive('env-default')}
				>
					<div class="instance-info">
						<div class="instance-name">
							Environment Default
							{#if githubData.activeId === 'env-default'}
								<Badge variant="default" class="active-badge">Active</Badge>
							{/if}
						</div>
						<div class="instance-details">
							<span>{githubData.envInfo.owner}/{githubData.envInfo.repo}</span>
							<span class="detail-sep">&middot;</span>
							<span>{githubData.envInfo.branch}</span>
							{#if githubData.envConfigured}
								<span class="detail-sep">&middot;</span>
								<span class="detail-muted">Token set</span>
							{:else}
								<span class="detail-sep">&middot;</span>
								<span class="not-configured">No token</span>
							{/if}
						</div>
					</div>
				</button>

				<!-- Custom instances -->
				{#each githubData.instances as inst (inst.id)}
					<div
						class="instance-card"
						class:active={githubData.activeId === inst.id}
					>
						<button class="instance-info" onclick={() => setGhActive(inst.id)}>
							<div class="instance-name">
								{inst.name}
								{#if githubData.activeId === inst.id}
									<Badge variant="default" class="active-badge">Active</Badge>
								{/if}
							</div>
							<div class="instance-details">
								<span>{inst.owner}/{inst.repo}</span>
								<span class="detail-sep">&middot;</span>
								<span>{inst.branch}</span>
								{#if inst.hasToken}
									<span class="detail-sep">&middot;</span>
									<span class="detail-muted">Token set</span>
								{/if}
							</div>
						</button>
						<div class="instance-actions">
							<button class="icon-btn" onclick={() => openGhEdit(inst)} title="Edit">
								<Pencil class="h-3.5 w-3.5" />
							</button>
							<button class="icon-btn icon-btn-danger" onclick={() => deleteGhInstance(inst.id)} title="Delete">
								<Trash2 class="h-3.5 w-3.5" />
							</button>
						</div>
					</div>
				{/each}

				<!-- Add/Edit form -->
				{#if showGhForm}
					<div class="instance-form">
						<div class="form-header">
							<span class="form-title">{ghEditing ? 'Edit' : 'Add'} GitHub Instance</span>
							<button class="icon-btn" onclick={closeGhForm}><X class="h-3.5 w-3.5" /></button>
						</div>
						<div class="form-fields">
							<label class="form-field">
								<span>Name</span>
								<input type="text" bind:value={ghForm.name} placeholder="e.g. Main Repo, Fork" class="settings-input" />
							</label>
							<label class="form-field">
								<span>Owner</span>
								<input type="text" bind:value={ghForm.owner} placeholder="e.g. clientIO" class="settings-input" />
							</label>
							<label class="form-field">
								<span>Repository</span>
								<input type="text" bind:value={ghForm.repo} placeholder="e.g. appmixer-connectors" class="settings-input" />
							</label>
							<label class="form-field">
								<span>Branch</span>
								<input type="text" bind:value={ghForm.branch} placeholder="e.g. dev" class="settings-input" />
							</label>
							<label class="form-field">
								<span>Token {#if ghEditing}<small>(leave empty to keep current)</small>{:else}<small>(optional, for private repos)</small>{/if}</span>
								<input type="password" bind:value={ghForm.token} placeholder={ghEditing ? 'Keep current token' : 'ghp_...'} class="settings-input" />
							</label>
						</div>
						{#if ghError}
							<div class="form-error">{ghError}</div>
						{/if}
						<div class="form-actions">
							<Button variant="outline" size="sm" onclick={closeGhForm} disabled={ghSaving}>Cancel</Button>
							<Button size="sm" onclick={saveGhInstance} disabled={ghSaving}>
								{#if ghSaving}<Loader2 class="h-3.5 w-3.5 spinning mr-1" />Saving...{:else}{ghEditing ? 'Update' : 'Add'}{/if}
							</Button>
						</div>
					</div>
				{/if}
			</div>
		</div>
	{/if}
</div>

<style>
	.settings-panel {
		flex: 1;
		display: flex;
		flex-direction: column;
		min-height: 0;
		overflow: hidden;
	}

	.settings-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 12px 20px;
		border-bottom: 1px solid var(--color-border);
		background: var(--color-card);
	}

	.settings-header-left {
		display: flex;
		align-items: center;
		gap: 8px;
	}

	.settings-title {
		font-size: 16px;
		font-weight: 600;
		margin: 0;
	}

	.settings-loading {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 8px;
		padding: 40px;
		color: var(--color-muted-foreground);
		font-size: 13px;
	}

	.settings-body {
		flex: 1;
		overflow-y: auto;
		padding: 24px;
		display: flex;
		flex-direction: column;
		gap: 32px;
		max-width: 900px;
	}

	/* Section */
	.settings-section {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	.section-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: 4px;
	}

	.section-title-row {
		display: flex;
		align-items: center;
		gap: 8px;
	}

	.section-title-row h3 {
		font-size: 14px;
		font-weight: 600;
		margin: 0;
	}

	/* Instance card */
	.instance-card {
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 12px 16px;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		background: var(--color-background);
		transition: all 0.15s;
		cursor: pointer;
		text-align: left;
		width: 100%;
	}

	.instance-card:hover {
		border-color: var(--color-ring);
	}

	.instance-card.active {
		border-color: hsl(var(--color-primary));
		background: hsl(var(--color-primary) / 0.04);
	}

	.instance-info {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 2px;
		border: none;
		background: transparent;
		cursor: pointer;
		text-align: left;
		padding: 0;
		color: inherit;
	}

	.instance-name {
		font-size: 13px;
		font-weight: 600;
		display: flex;
		align-items: center;
		gap: 8px;
	}

	:global(.active-badge) {
		font-size: 10px;
		padding: 0 6px;
		height: 18px;
	}

	.instance-details {
		font-size: 11px;
		color: var(--color-muted-foreground);
		display: flex;
		align-items: center;
		gap: 4px;
		flex-wrap: wrap;
	}

	.detail-sep {
		color: var(--color-border);
	}

	.detail-muted {
		color: var(--color-muted-foreground);
		font-style: italic;
	}

	.not-configured {
		color: var(--color-muted-foreground);
		font-style: italic;
		font-size: 11px;
	}

	.instance-actions {
		display: flex;
		align-items: center;
		gap: 2px;
		flex-shrink: 0;
	}

	.icon-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 28px;
		height: 28px;
		border: none;
		border-radius: var(--radius-sm);
		background: transparent;
		cursor: pointer;
		color: var(--color-muted-foreground);
		transition: all 0.15s;
	}

	.icon-btn:hover {
		background: var(--color-muted);
		color: var(--color-foreground);
	}

	.icon-btn-danger:hover {
		background: #fef2f2;
		color: #dc2626;
	}

	/* Form */
	.instance-form {
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		padding: 16px;
		background: var(--color-card);
	}

	.form-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: 12px;
	}

	.form-title {
		font-size: 13px;
		font-weight: 600;
	}

	.form-fields {
		display: flex;
		flex-direction: column;
		gap: 10px;
	}

	.form-field {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}

	.form-field > span {
		font-size: 12px;
		font-weight: 500;
	}

	.form-field > span small {
		font-weight: 400;
		color: var(--color-muted-foreground);
	}

	.settings-input {
		padding: 6px 10px;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		background: var(--color-background);
		font-size: 12px;
		color: var(--color-foreground);
		width: 100%;
	}

	.settings-input:focus {
		outline: none;
		box-shadow: 0 0 0 2px var(--color-ring);
	}

	.quick-btns {
		display: flex;
		gap: 6px;
		margin-bottom: 4px;
	}

	.quick-btn {
		padding: 3px 10px;
		border: 1px solid var(--color-border);
		border-radius: 9999px;
		background: var(--color-muted);
		font-size: 10px;
		cursor: pointer;
		transition: all 0.15s;
		color: var(--color-foreground);
	}

	.quick-btn:hover {
		background: var(--color-accent);
	}

	.quick-btn.active {
		background: var(--color-primary);
		color: var(--color-primary-foreground);
		border-color: var(--color-primary);
	}

	.form-error {
		padding: 8px 10px;
		border-radius: var(--radius-sm);
		background: #fef2f2;
		border: 1px solid #fecaca;
		color: #dc2626;
		font-size: 12px;
		margin-top: 8px;
	}

	.form-actions {
		display: flex;
		align-items: center;
		justify-content: flex-end;
		gap: 8px;
		margin-top: 12px;
	}

	:global(.spinning) {
		animation: spin 1s linear infinite;
	}

	@keyframes spin {
		from { transform: rotate(0deg); }
		to { transform: rotate(360deg); }
	}
</style>
