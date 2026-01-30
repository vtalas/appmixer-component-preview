<script lang="ts">
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Button } from '$lib/components/ui/button';
	import { Badge } from '$lib/components/ui/badge';
	import * as Collapsible from '$lib/components/ui/collapsible';
	import {
		ChevronDown,
		ChevronRight,
		HelpCircle,
		ToggleLeft,
		ToggleRight
	} from 'lucide-svelte';
	import type { Inspector, InspectorInput, Schema } from '$lib/types/component';

	interface Props {
		inspector: Inspector;
		schema?: Schema;
		portName?: string;
	}

	let { inspector, schema, portName = 'in' }: Props = $props();

	// Form values state
	let formValues = $state<Record<string, unknown>>({});

	// Group expansion state
	let expandedGroups = $state<Set<string>>(new Set());

	// Initialize all groups as expanded
	$effect(() => {
		if (inspector.groups) {
			expandedGroups = new Set(Object.keys(inspector.groups));
		}
	});

	// Sort inputs by index
	let sortedInputs = $derived.by(() => {
		if (!inspector.inputs) return [];
		return Object.entries(inspector.inputs).sort(([, a], [, b]) => {
			return (a.index ?? 999) - (b.index ?? 999);
		});
	});

	// Sort groups by index
	let sortedGroups = $derived.by(() => {
		if (!inspector.groups) return [];
		return Object.entries(inspector.groups).sort(([, a], [, b]) => {
			return (a.index ?? 999) - (b.index ?? 999);
		});
	});

	// Group inputs by their group property
	let groupedInputs = $derived.by(() => {
		const groups = new Map<string | null, [string, InspectorInput][]>();

		for (const [key, input] of sortedInputs) {
			const groupKey = input.group ?? null;
			if (!groups.has(groupKey)) {
				groups.set(groupKey, []);
			}
			groups.get(groupKey)!.push([key, input]);
		}

		return groups;
	});

	function toggleGroup(groupKey: string) {
		const newSet = new Set(expandedGroups);
		if (newSet.has(groupKey)) {
			newSet.delete(groupKey);
		} else {
			newSet.add(groupKey);
		}
		expandedGroups = newSet;
	}

	function isRequired(key: string): boolean {
		return schema?.required?.includes(key) ?? false;
	}

	function getInputValue(key: string): unknown {
		return formValues[key] ?? '';
	}

	function setInputValue(key: string, value: unknown) {
		formValues[key] = value;
	}
</script>

<div class="inspector-editor">
	{#if sortedGroups.length > 0}
		<!-- Render grouped inputs -->
		{#each sortedGroups as [groupKey, group]}
			{@const groupInputs = groupedInputs.get(groupKey) || []}
			{#if groupInputs.length > 0}
				<Collapsible.Root
					open={expandedGroups.has(groupKey)}
					onOpenChange={() => toggleGroup(groupKey)}
					class="group-section"
				>
					<Collapsible.Trigger class="group-header">
						{#if expandedGroups.has(groupKey)}
							<ChevronDown class="h-4 w-4" />
						{:else}
							<ChevronRight class="h-4 w-4" />
						{/if}
						<span class="group-title">{group.label}</span>
					</Collapsible.Trigger>
					<Collapsible.Content class="group-content">
						{#each groupInputs as [key, input]}
							{@render InputField(key, input)}
						{/each}
					</Collapsible.Content>
				</Collapsible.Root>
			{/if}
		{/each}

		<!-- Render ungrouped inputs -->
		{@const ungroupedInputs = groupedInputs.get(null) || []}
		{#if ungroupedInputs.length > 0}
			<div class="ungrouped-section">
				{#each ungroupedInputs as [key, input]}
					{@render InputField(key, input)}
				{/each}
			</div>
		{/if}
	{:else}
		<!-- No groups defined, render all inputs -->
		<div class="ungrouped-section">
			{#each sortedInputs as [key, input]}
				{@render InputField(key, input)}
			{/each}
		</div>
	{/if}
</div>

{#snippet InputField(key: string, input: InspectorInput)}
	<div class="input-field">
		<div class="input-label-row">
			<Label class="input-label">
				{input.label || key}
				{#if isRequired(key)}
					<span class="required-asterisk">*</span>
				{/if}
			</Label>
			{#if input.tooltip}
				<span class="tooltip-icon" title={input.tooltip}>
					<HelpCircle class="h-3.5 w-3.5" />
				</span>
			{/if}
		</div>

		<div class="input-control">
			{#if input.type === 'text'}
				<Input
					type="text"
					placeholder={input.defaultValue?.toString() || ''}
					value={getInputValue(key)?.toString() || ''}
					oninput={(e) => setInputValue(key, e.currentTarget.value)}
					class="editor-input"
				/>
			{:else if input.type === 'textarea'}
				<textarea
					placeholder={input.defaultValue?.toString() || ''}
					value={getInputValue(key)?.toString() || ''}
					oninput={(e) => setInputValue(key, e.currentTarget.value)}
					class="editor-textarea"
				></textarea>
			{:else if input.type === 'number'}
				<Input
					type="number"
					placeholder={input.defaultValue?.toString() || ''}
					value={getInputValue(key)?.toString() || ''}
					oninput={(e) => setInputValue(key, e.currentTarget.value)}
					class="editor-input"
				/>
			{:else if input.type === 'date-time'}
				<Input
					type="datetime-local"
					value={getInputValue(key)?.toString() || ''}
					oninput={(e) => setInputValue(key, e.currentTarget.value)}
					class="editor-input"
				/>
			{:else if input.type === 'select'}
				{#if input.options && input.options.length > 0}
					<select
						class="editor-select"
						value={getInputValue(key)?.toString() || ''}
						onchange={(e) => setInputValue(key, e.currentTarget.value)}
					>
						<option value="">Select...</option>
						{#each input.options as option}
							<option value={option.value}>{option.label}</option>
						{/each}
					</select>
				{:else if input.source}
					<div class="dynamic-source">
						<select class="editor-select" disabled>
							<option value="">Loading from source...</option>
						</select>
						<div class="source-info">
							<span class="source-url">{input.source.url}</span>
						</div>
					</div>
				{:else}
					<select class="editor-select" disabled>
						<option value="">No options available</option>
					</select>
				{/if}
			{:else if input.type === 'toggle'}
				<button
					type="button"
					class="toggle-button {getInputValue(key) ? 'active' : ''}"
					onclick={() => setInputValue(key, !getInputValue(key))}
					aria-pressed={!!getInputValue(key)}
				>
					{#if getInputValue(key)}
						<ToggleRight class="h-5 w-5" />
					{:else}
						<ToggleLeft class="h-5 w-5" />
					{/if}
					<span class="toggle-label">{getInputValue(key) ? 'Yes' : 'No'}</span>
				</button>
			{:else if input.type === 'filepicker'}
				<Button variant="outline" class="filepicker-button">
					Choose File...
				</Button>
			{:else if input.type === 'expression'}
				<div class="expression-builder">
					<div class="expression-header">
						<Badge variant="outline" class="expression-badge">Expression</Badge>
						{#if input.levels}
							<span class="expression-levels">Levels: {input.levels.join(', ')}</span>
						{/if}
					</div>
					{#if input.fields}
						<div class="expression-fields">
							{#each Object.entries(input.fields) as [fieldKey, field]}
								<div class="expression-field">
									<Label class="expression-field-label">{field.label || fieldKey}</Label>
									{#if field.type === 'select'}
										{#if field.options && field.options.length > 0}
											<select class="editor-select">
												<option value="">Select {field.label || fieldKey}...</option>
												{#each field.options as option}
													<option value={option.value}>{option.label}</option>
												{/each}
											</select>
										{:else if field.source}
											<select class="editor-select" disabled>
												<option value="">Dynamic source</option>
											</select>
										{:else}
											<select class="editor-select">
												<option value="">Select...</option>
											</select>
										{/if}
									{:else if field.type === 'text'}
										<Input type="text" class="editor-input" placeholder="" />
									{:else}
										<Input type="text" class="editor-input" placeholder="" />
									{/if}
								</div>
							{/each}
						</div>
						<Button variant="outline" size="sm" class="add-condition-btn">
							+ Add Condition
						</Button>
					{/if}
				</div>
			{:else}
				<Input
					type="text"
					placeholder=""
					class="editor-input"
				/>
			{/if}
		</div>
	</div>
{/snippet}

<style>
	.inspector-editor {
		display: flex;
		flex-direction: column;
		gap: 0;
	}

	:global(.group-section) {
		border-bottom: 1px solid var(--color-border);
	}

	:global(.group-header) {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 12px 16px;
		width: 100%;
		background: var(--color-muted);
		font-weight: 500;
		font-size: 13px;
		cursor: pointer;
		border: none;
		text-align: left;
	}

	:global(.group-header:hover) {
		background: var(--color-accent);
	}

	.group-title {
		flex: 1;
	}

	:global(.group-content) {
		padding: 0;
	}

	.ungrouped-section {
		display: flex;
		flex-direction: column;
	}

	.input-field {
		display: flex;
		flex-direction: column;
		padding: 12px 16px;
		border-bottom: 1px solid var(--color-border);
	}

	.input-field:last-child {
		border-bottom: none;
	}

	.input-label-row {
		display: flex;
		align-items: center;
		gap: 6px;
		margin-bottom: 8px;
	}

	:global(.input-label) {
		font-size: 13px;
		font-weight: 500;
		color: var(--color-foreground);
	}

	.required-asterisk {
		color: var(--color-destructive);
		font-weight: bold;
	}

	.tooltip-icon {
		color: var(--color-muted-foreground);
		cursor: help;
	}

	.input-control {
		width: 100%;
	}

	:global(.editor-input) {
		width: 100%;
		height: 36px;
		font-size: 13px;
	}

	.editor-textarea {
		width: 100%;
		min-height: 80px;
		padding: 8px 12px;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		font-size: 13px;
		font-family: inherit;
		resize: vertical;
		background: var(--color-background);
	}

	.editor-textarea:focus {
		outline: none;
		border-color: var(--color-ring);
		box-shadow: 0 0 0 2px color-mix(in srgb, var(--color-ring) 20%, transparent);
	}

	.editor-select {
		width: 100%;
		height: 36px;
		padding: 0 12px;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		font-size: 13px;
		background: var(--color-background);
		cursor: pointer;
	}

	.editor-select:focus {
		outline: none;
		border-color: var(--color-ring);
		box-shadow: 0 0 0 2px color-mix(in srgb, var(--color-ring) 20%, transparent);
	}

	.editor-select:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}

	.dynamic-source {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}

	.source-info {
		font-size: 11px;
		color: var(--color-muted-foreground);
	}

	.source-url {
		font-family: monospace;
		word-break: break-all;
	}

	.toggle-button {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 8px 12px;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		background: var(--color-background);
		cursor: pointer;
		font-size: 13px;
		transition: all 0.15s ease;
	}

	.toggle-button:hover {
		background: var(--color-muted);
	}

	.toggle-button.active {
		background: var(--color-primary);
		color: var(--color-primary-foreground);
		border-color: var(--color-primary);
	}

	.toggle-label {
		font-weight: 500;
	}

	:global(.filepicker-button) {
		width: 100%;
		justify-content: flex-start;
	}

	.expression-builder {
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		overflow: hidden;
	}

	.expression-header {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 8px 12px;
		background: var(--color-muted);
		border-bottom: 1px solid var(--color-border);
	}

	:global(.expression-badge) {
		font-size: 11px;
	}

	.expression-levels {
		font-size: 11px;
		color: var(--color-muted-foreground);
	}

	.expression-fields {
		padding: 12px;
		display: flex;
		flex-direction: column;
		gap: 12px;
	}

	.expression-field {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}

	:global(.expression-field-label) {
		font-size: 12px;
		color: var(--color-muted-foreground);
	}

	:global(.add-condition-btn) {
		margin: 0 12px 12px;
	}
</style>
