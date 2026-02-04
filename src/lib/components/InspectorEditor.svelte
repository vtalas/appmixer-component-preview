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
		ToggleRight,
		Pencil,
		Check,
		X,
		Plus,
		Trash2,
		GripVertical,
		Link,
		Search
	} from 'lucide-svelte';
	import type { Inspector, InspectorInput, Schema } from '$lib/types/component';
	import { fileSync } from '$lib/stores/fileSync.svelte';

	// Available input types
	const INPUT_TYPES = [
		{ value: 'text', label: 'Text' },
		{ value: 'textarea', label: 'Textarea' },
		{ value: 'number', label: 'Number' },
		{ value: 'select', label: 'Select' },
		{ value: 'multiselect', label: 'Multi-Select' },
		{ value: 'date-time', label: 'Date/Time' },
		{ value: 'toggle', label: 'Toggle' },
		{ value: 'expression', label: 'Expression' },
		{ value: 'key-value', label: 'Key-Value' },
		{ value: 'filepicker', label: 'File Picker' }
	];

	interface Props {
		inspector: Inspector;
		schema?: Schema;
		portName?: string;
		onInputChange?: (inputKey: string, field: string, value: string) => void;
		onRequiredChange?: (inputKey: string, required: boolean) => void;
		onTypeChange?: (inputKey: string, newType: string) => void;
		onOptionsChange?: (inputKey: string, options: unknown[]) => void;
		onFieldsChange?: (inputKey: string, fields: unknown) => void;
		onSourceChange?: (inputKey: string, source: { url: string; data?: unknown } | null) => void;
	}

	let { inspector, schema, portName = 'in', onInputChange, onRequiredChange, onTypeChange, onOptionsChange, onFieldsChange, onSourceChange }: Props = $props();

	// Track expanded options editors
	let expandedOptionsEditors = $state<Set<string>>(new Set());

	// Track which fields are being edited
	let editingLabel = $state<string | null>(null);
	let editingTooltip = $state<string | null>(null);
	let editLabelValue = $state('');
	let editTooltipValue = $state('');

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

	// Label editing functions
	function startEditLabel(key: string, currentLabel: string) {
		editingLabel = key;
		editLabelValue = currentLabel;
	}

	function saveLabel(key: string) {
		if (onInputChange && editLabelValue.trim()) {
			onInputChange(key, 'label', editLabelValue.trim());
		}
		editingLabel = null;
	}

	function cancelEditLabel() {
		editingLabel = null;
		editLabelValue = '';
	}

	// Tooltip editing functions
	function startEditTooltip(key: string, currentTooltip: string) {
		editingTooltip = key;
		editTooltipValue = currentTooltip;
	}

	function saveTooltip(key: string) {
		if (onInputChange) {
			onInputChange(key, 'tooltip', editTooltipValue.trim());
		}
		editingTooltip = null;
	}

	function cancelEditTooltip() {
		editingTooltip = null;
		editTooltipValue = '';
	}

	// Toggle required state
	function toggleRequired(key: string) {
		const currentRequired = isRequired(key);
		if (onRequiredChange) {
			onRequiredChange(key, !currentRequired);
		}
	}

	// Handle type change
	function handleTypeChange(key: string, newType: string) {
		if (onTypeChange) {
			onTypeChange(key, newType);
		}
	}

	// Toggle options editor expansion
	function toggleOptionsEditor(key: string) {
		const newSet = new Set(expandedOptionsEditors);
		if (newSet.has(key)) {
			newSet.delete(key);
		} else {
			newSet.add(key);
		}
		expandedOptionsEditors = newSet;
	}

	// Normalize options to always be array of { content, value } or { label, value }
	function normalizeOptions(options: unknown[] | undefined): Array<{ content?: string; label?: string; value: string }> {
		if (!options) return [];
		return options.map(opt => {
			if (typeof opt === 'string') {
				return { content: opt, value: opt };
			}
			return opt as { content?: string; label?: string; value: string };
		});
	}

	// Get display label for an option
	function getOptionLabel(opt: { content?: string; label?: string; value: string }): string {
		return opt.content || opt.label || opt.value;
	}

	// Add new option
	function addOption(key: string, input: InspectorInput) {
		const currentOptions = normalizeOptions(input.options);
		const newOptions = [...currentOptions, { content: '', value: '' }];
		if (onOptionsChange) {
			onOptionsChange(key, newOptions);
		}
	}

	// Update option
	function updateOption(key: string, input: InspectorInput, index: number, field: 'content' | 'value', newValue: string) {
		const currentOptions = normalizeOptions(input.options);
		const updated = [...currentOptions];
		updated[index] = { ...updated[index], [field]: newValue };
		if (onOptionsChange) {
			onOptionsChange(key, updated);
		}
	}

	// Remove option
	function removeOption(key: string, input: InspectorInput, index: number) {
		const currentOptions = normalizeOptions(input.options);
		const updated = currentOptions.filter((_, i) => i !== index);
		if (onOptionsChange) {
			onOptionsChange(key, updated);
		}
	}

	// Check if type supports options
	function supportsOptions(type: string | undefined): boolean {
		return type === 'select' || type === 'multiselect';
	}

	// Check if type is expression
	function isExpression(type: string | undefined): boolean {
		return type === 'expression';
	}

	// Expression field types
	const EXPRESSION_FIELD_TYPES = [
		{ value: 'text', label: 'Text' },
		{ value: 'textarea', label: 'Textarea' },
		{ value: 'number', label: 'Number' },
		{ value: 'select', label: 'Select' },
		{ value: 'toggle', label: 'Toggle' }
	];

	// Add expression field
	function addExpressionField(key: string, input: InspectorInput) {
		const currentFields = input.fields || {};
		const newFieldKey = `field${Object.keys(currentFields).length + 1}`;
		const newFields = {
			...currentFields,
			[newFieldKey]: {
				type: 'text',
				label: 'New Field'
			}
		};
		if (onFieldsChange) {
			onFieldsChange(key, newFields);
		}
	}

	// Update expression field
	function updateExpressionField(key: string, input: InspectorInput, fieldKey: string, prop: string, value: unknown) {
		const currentFields = input.fields as Record<string, Record<string, unknown>> || {};
		const newFields = {
			...currentFields,
			[fieldKey]: {
				...currentFields[fieldKey],
				[prop]: value
			}
		};
		if (onFieldsChange) {
			onFieldsChange(key, newFields);
		}
	}

	// Remove expression field
	function removeExpressionField(key: string, input: InspectorInput, fieldKey: string) {
		const currentFields = { ...(input.fields as Record<string, unknown> || {}) };
		delete currentFields[fieldKey];
		if (onFieldsChange) {
			onFieldsChange(key, currentFields);
		}
	}

	// Track editing field state
	let editingExpressionField = $state<string | null>(null);

	// Component picker state
	let showComponentPicker = $state<string | null>(null);
	let componentSearchQuery = $state('');
	let selectedOutPort = $state('out');

	// Get all components with outPorts from fileSync tree
	let allComponentsWithOutPorts = $derived.by(() => {
		const components: Array<{
			name: string;
			label: string;
			path: string;
			connectorName: string;
			moduleName: string;
			outPorts: Array<{ name: string }>;
			icon?: string;
		}> = [];

		for (const connector of fileSync.tree.connectors) {
			for (const module of connector.modules) {
				for (const component of module.components) {
					const outPorts = component.componentJson.outPorts;
					if (outPorts && outPorts.length > 0) {
						components.push({
							name: component.name,
							label: component.componentJson.label || component.name,
							path: component.path,
							connectorName: connector.name,
							moduleName: module.name,
							outPorts: outPorts,
							icon: component.componentJson.icon || connector.icon
						});
					}
				}
			}
		}

		return components;
	});

	// Filter components based on search query
	let filteredComponents = $derived.by(() => {
		if (!componentSearchQuery.trim()) {
			return allComponentsWithOutPorts.slice(0, 50); // Limit to 50 for performance
		}

		const query = componentSearchQuery.toLowerCase();
		return allComponentsWithOutPorts.filter(comp => {
			const searchText = `${comp.connectorName} ${comp.moduleName} ${comp.name} ${comp.label}`.toLowerCase();
			return searchText.includes(query);
		}).slice(0, 50);
	});

	// Generate source URL from component
	function generateSourceUrl(connectorName: string, moduleName: string, componentName: string, outPort: string): string {
		return `/component/${connectorName}/${moduleName}/${componentName}?outPort=${outPort}`;
	}

	// Parse source URL to extract component info
	function parseSourceUrl(url: string): { connectorName: string; moduleName: string; componentName: string; outPort: string } | null {
		const match = url.match(/^\/component\/([^/]+)\/([^/]+)\/([^?]+)\?outPort=(.+)$/);
		if (match) {
			return {
				connectorName: match[1],
				moduleName: match[2],
				componentName: match[3],
				outPort: match[4]
			};
		}
		return null;
	}

	// Open component picker
	function openComponentPicker(key: string, currentSource?: { url: string }) {
		showComponentPicker = key;
		componentSearchQuery = '';
		if (currentSource?.url) {
			const parsed = parseSourceUrl(currentSource.url);
			if (parsed) {
				selectedOutPort = parsed.outPort;
			}
		} else {
			selectedOutPort = 'out';
		}
	}

	// Close component picker
	function closeComponentPicker() {
		showComponentPicker = null;
		componentSearchQuery = '';
	}

	// Select component from picker
	function selectComponent(key: string, comp: typeof allComponentsWithOutPorts[0], outPort: string) {
		const url = generateSourceUrl(comp.connectorName, comp.moduleName, comp.name, outPort);
		if (onSourceChange) {
			onSourceChange(key, { url });
		}
		closeComponentPicker();
	}

	// Remove source (switch to static options)
	function removeSource(key: string) {
		if (onSourceChange) {
			onSourceChange(key, null);
		}
	}

	// Add source (switch to dynamic)
	function addSource(key: string) {
		openComponentPicker(key);
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
			{#if editingLabel === key}
				<div class="edit-inline">
					<Input
						type="text"
						bind:value={editLabelValue}
						class="edit-inline-input"
						onkeydown={(e) => {
							if (e.key === 'Enter') saveLabel(key);
							if (e.key === 'Escape') cancelEditLabel();
						}}
					/>
					<button class="edit-action-btn save" onclick={() => saveLabel(key)} title="Save">
						<Check class="h-3.5 w-3.5" />
					</button>
					<button class="edit-action-btn cancel" onclick={cancelEditLabel} title="Cancel">
						<X class="h-3.5 w-3.5" />
					</button>
				</div>
			{:else}
				<Label class="input-label editable" onclick={() => startEditLabel(key, input.label || key)}>
					{input.label || key}
					{#if isRequired(key)}
						<span class="required-asterisk">*</span>
					{/if}
					<Pencil class="edit-icon h-3 w-3" />
				</Label>
			{/if}
			<label class="required-checkbox" title="Required field">
				<input
					type="checkbox"
					checked={isRequired(key)}
					onchange={() => toggleRequired(key)}
				/>
				<span class="required-checkbox-label">Required</span>
			</label>
		</div>

		<div class="input-meta-row">
			<div class="input-tooltip-row">
				{#if editingTooltip === key}
					<div class="edit-inline tooltip-edit">
						<Input
							type="text"
							bind:value={editTooltipValue}
							placeholder="Enter tooltip..."
							class="edit-inline-input"
							onkeydown={(e) => {
								if (e.key === 'Enter') saveTooltip(key);
								if (e.key === 'Escape') cancelEditTooltip();
							}}
						/>
						<button class="edit-action-btn save" onclick={() => saveTooltip(key)} title="Save">
							<Check class="h-3.5 w-3.5" />
						</button>
						<button class="edit-action-btn cancel" onclick={cancelEditTooltip} title="Cancel">
							<X class="h-3.5 w-3.5" />
						</button>
					</div>
				{:else}
					<button
						class="tooltip-editable {input.tooltip ? 'has-tooltip' : ''}"
						onclick={() => startEditTooltip(key, input.tooltip || '')}
					>
						<HelpCircle class="h-3.5 w-3.5" />
						<span class="tooltip-text-preview">{input.tooltip || 'Add tooltip...'}</span>
						<Pencil class="edit-icon h-3 w-3" />
					</button>
				{/if}
			</div>

			<label class="input-type-selector">
				<span class="type-label">Type:</span>
				<select
					class="type-select"
					value={input.type || 'text'}
					onchange={(e) => handleTypeChange(key, e.currentTarget.value)}
				>
					{#each INPUT_TYPES as inputType}
						<option value={inputType.value}>{inputType.label}</option>
					{/each}
				</select>
			</label>
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

		<!-- Options Editor for select/multiselect -->
		{#if supportsOptions(input.type)}
			<div class="options-editor-section">
				<button
					class="options-toggle"
					onclick={() => toggleOptionsEditor(key)}
				>
					{#if expandedOptionsEditors.has(key)}
						<ChevronDown class="h-4 w-4" />
					{:else}
						<ChevronRight class="h-4 w-4" />
					{/if}
					<span>Options ({input.options?.length || 0})</span>
					{#if input.source}
						<Badge variant="outline" class="source-badge">Dynamic</Badge>
					{/if}
				</button>

				{#if expandedOptionsEditors.has(key)}
					<div class="options-editor">
						{#if input.source}
							<div class="source-config">
								<div class="source-header">
									<span class="source-label">Source URL:</span>
									<button class="remove-source-btn" onclick={() => removeSource(key)} title="Switch to static options">
										<X class="h-3.5 w-3.5" />
										<span>Remove</span>
									</button>
								</div>
								<button class="source-url-editable" onclick={() => openComponentPicker(key, input.source)}>
									<Link class="h-3.5 w-3.5" />
									<code class="source-url-text">{input.source.url}</code>
									<Pencil class="edit-icon h-3 w-3" />
								</button>
							</div>
						{:else}
							<div class="options-list">
								{#each normalizeOptions(input.options) as option, index}
									<div class="option-row">
										<GripVertical class="drag-handle h-4 w-4" />
										<Input
											type="text"
											placeholder="Label"
											value={getOptionLabel(option)}
											class="option-input"
											oninput={(e) => updateOption(key, input, index, 'content', e.currentTarget.value)}
										/>
										<Input
											type="text"
											placeholder="Value"
											value={option.value}
											class="option-input"
											oninput={(e) => updateOption(key, input, index, 'value', e.currentTarget.value)}
										/>
										<button
											class="option-delete-btn"
											onclick={() => removeOption(key, input, index)}
											title="Remove option"
										>
											<Trash2 class="h-4 w-4" />
										</button>
									</div>
								{/each}
							</div>
							<div class="options-actions">
								<button class="add-option-btn" onclick={() => addOption(key, input)}>
									<Plus class="h-4 w-4" />
									Add Option
								</button>
								<button class="add-source-btn" onclick={() => addSource(key)}>
									<Link class="h-4 w-4" />
									Use Dynamic Source
								</button>
							</div>
						{/if}
					</div>
				{/if}

				<!-- Component Picker Modal -->
				{#if showComponentPicker === key}
					<div class="component-picker-overlay" onclick={closeComponentPicker}></div>
					<div class="component-picker">
						<div class="picker-header">
							<h4>Select Component</h4>
							<button class="picker-close-btn" onclick={closeComponentPicker}>
								<X class="h-4 w-4" />
							</button>
						</div>
						<div class="picker-search">
							<Search class="picker-search-icon h-4 w-4" />
							<input
								type="text"
								placeholder="Search components..."
								class="picker-search-input"
								bind:value={componentSearchQuery}
							/>
						</div>
						<div class="picker-list">
							{#each filteredComponents as comp}
								<div class="picker-item">
									<div class="picker-item-info">
										{#if comp.icon}
											<img src={comp.icon} alt="" class="picker-item-icon" />
										{/if}
										<div class="picker-item-text">
											<span class="picker-item-label">{comp.label}</span>
											<span class="picker-item-path">{comp.connectorName}/{comp.moduleName}/{comp.name}</span>
										</div>
									</div>
									<div class="picker-item-ports">
										{#each comp.outPorts as port}
											<button
												class="picker-port-btn"
												onclick={() => selectComponent(key, comp, port.name)}
											>
												{port.name}
											</button>
										{/each}
									</div>
								</div>
							{/each}
							{#if filteredComponents.length === 0}
								<div class="picker-empty">
									{#if componentSearchQuery}
										No components found matching "{componentSearchQuery}"
									{:else}
										No components with outPorts available
									{/if}
								</div>
							{/if}
						</div>
					</div>
				{/if}
			</div>
		{/if}

		<!-- Expression Fields Editor -->
		{#if isExpression(input.type)}
			<div class="expression-editor-section">
				<button
					class="options-toggle"
					onclick={() => toggleOptionsEditor(key + '_expr')}
				>
					{#if expandedOptionsEditors.has(key + '_expr')}
						<ChevronDown class="h-4 w-4" />
					{:else}
						<ChevronRight class="h-4 w-4" />
					{/if}
					<span>Expression Fields ({input.fields ? (Array.isArray(input.fields) ? input.fields.length : Object.keys(input.fields).length) : 0})</span>
				</button>

				{#if expandedOptionsEditors.has(key + '_expr')}
					<div class="expression-config">
						<div class="expression-config-row">
							<label class="config-label">
								Levels (comma-separated):
								<Input
									type="text"
									placeholder="AND, OR"
									value={input.levels?.join(', ') || ''}
									class="config-input"
									oninput={(e) => {
										if (onInputChange) {
											onInputChange(key, 'levels', e.currentTarget.value);
										}
									}}
								/>
							</label>
						</div>

						<div class="expression-fields-container">
							<div class="fields-section-header">
								<span>Fields</span>
							</div>

							{#if input.fields && !Array.isArray(input.fields)}
								<div class="expression-fields-list">
									{#each Object.entries(input.fields) as [fieldKey, field]}
										<div class="field-row-expanded">
											<div class="field-row-main">
												<Input
													type="text"
													value={fieldKey}
													class="field-key-input"
													placeholder="Field key"
													disabled
												/>
												<select
													class="field-type-select"
													value={field.type || 'text'}
													onchange={(e) => updateExpressionField(key, input, fieldKey, 'type', e.currentTarget.value)}
												>
													{#each EXPRESSION_FIELD_TYPES as ft}
														<option value={ft.value}>{ft.label}</option>
													{/each}
												</select>
												<Input
													type="text"
													value={field.label || ''}
													class="field-label-input"
													placeholder="Label"
													oninput={(e) => updateExpressionField(key, input, fieldKey, 'label', e.currentTarget.value)}
												/>
												<button
													class="option-delete-btn"
													onclick={() => removeExpressionField(key, input, fieldKey)}
													title="Remove field"
												>
													<Trash2 class="h-4 w-4" />
												</button>
											</div>
											{#if field.type === 'select'}
												<div class="field-options-hint">
													<span class="hint-text">Options: {field.options?.length || 0} defined</span>
												</div>
											{/if}
										</div>
									{/each}
								</div>
							{:else if input.fields && Array.isArray(input.fields)}
								<div class="expression-fields-list">
									{#each input.fields as field, index}
										<div class="field-row-expanded">
											<div class="field-row-main">
												<span class="field-index-num">{index + 1}</span>
												<select
													class="field-type-select"
													value={field.type || 'text'}
													disabled
												>
													{#each EXPRESSION_FIELD_TYPES as ft}
														<option value={ft.value}>{ft.label}</option>
													{/each}
												</select>
												<span class="field-label-text">{field.label || '-'}</span>
											</div>
										</div>
									{/each}
								</div>
								<p class="array-fields-note">Array-format fields are read-only. Convert to object format to edit.</p>
							{:else}
								<p class="no-fields-note">No fields defined yet.</p>
							{/if}

							<button class="add-option-btn" onclick={() => addExpressionField(key, input)}>
								<Plus class="h-4 w-4" />
								Add Field
							</button>
						</div>
					</div>
				{/if}
			</div>
		{/if}
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

	:global(.input-label.editable) {
		cursor: pointer;
		display: inline-flex;
		align-items: center;
		gap: 4px;
		padding: 2px 4px;
		margin: -2px -4px;
		border-radius: var(--radius-sm);
		transition: background-color 0.15s ease;
	}

	:global(.input-label.editable:hover) {
		background: var(--color-muted);
	}

	:global(.input-label.editable .edit-icon) {
		opacity: 0;
		transition: opacity 0.15s ease;
	}

	:global(.input-label.editable:hover .edit-icon) {
		opacity: 0.5;
	}

	.required-asterisk {
		color: var(--color-destructive);
		font-weight: bold;
	}

	.required-checkbox {
		display: flex;
		align-items: center;
		gap: 4px;
		margin-left: auto;
		cursor: pointer;
		font-size: 12px;
		color: var(--color-muted-foreground);
		user-select: none;
	}

	.required-checkbox input[type="checkbox"] {
		width: 14px;
		height: 14px;
		cursor: pointer;
		accent-color: var(--color-primary);
	}

	.required-checkbox-label {
		font-weight: 400;
	}

	.input-meta-row {
		display: flex;
		align-items: flex-start;
		gap: 12px;
		margin-bottom: 8px;
	}

	.input-tooltip-row {
		flex: 1;
	}

	.input-type-selector {
		display: flex;
		align-items: center;
		gap: 6px;
		flex-shrink: 0;
	}

	.type-label {
		font-size: 12px;
		color: var(--color-muted-foreground);
		white-space: nowrap;
	}

	.type-select {
		height: 28px;
		padding: 0 8px;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		font-size: 12px;
		background: var(--color-background);
		cursor: pointer;
		color: var(--color-foreground);
	}

	.type-select:focus {
		outline: none;
		border-color: var(--color-ring);
		box-shadow: 0 0 0 2px color-mix(in srgb, var(--color-ring) 20%, transparent);
	}

	.tooltip-editable {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 4px 8px;
		background: none;
		border: 1px dashed var(--color-border);
		border-radius: var(--radius-sm);
		cursor: pointer;
		font-size: 12px;
		color: var(--color-muted-foreground);
		transition: all 0.15s ease;
		width: 100%;
		text-align: left;
	}

	.tooltip-editable:hover {
		background: var(--color-muted);
		border-color: var(--color-muted-foreground);
	}

	.tooltip-editable.has-tooltip {
		color: var(--color-foreground);
		border-style: solid;
	}

	.tooltip-editable .tooltip-text-preview {
		flex: 1;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	:global(.tooltip-editable .edit-icon) {
		opacity: 0;
		transition: opacity 0.15s ease;
		flex-shrink: 0;
	}

	:global(.tooltip-editable:hover .edit-icon) {
		opacity: 0.5;
	}

	.edit-inline {
		display: flex;
		align-items: center;
		gap: 4px;
		flex: 1;
	}

	.edit-inline.tooltip-edit {
		width: 100%;
	}

	:global(.edit-inline-input) {
		height: 28px;
		font-size: 13px;
		flex: 1;
	}

	.edit-action-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 24px;
		height: 24px;
		border: none;
		border-radius: var(--radius-sm);
		cursor: pointer;
		transition: all 0.15s ease;
		flex-shrink: 0;
	}

	.edit-action-btn.save {
		background: var(--color-primary);
		color: var(--color-primary-foreground);
	}

	.edit-action-btn.save:hover {
		opacity: 0.9;
	}

	.edit-action-btn.cancel {
		background: var(--color-muted);
		color: var(--color-muted-foreground);
	}

	.edit-action-btn.cancel:hover {
		background: var(--color-accent);
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

	/* Options Editor */
	.options-editor-section,
	.expression-editor-section {
		margin-top: 12px;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		overflow: hidden;
	}

	.options-toggle {
		display: flex;
		align-items: center;
		gap: 8px;
		width: 100%;
		padding: 8px 12px;
		background: var(--color-muted);
		border: none;
		cursor: pointer;
		font-size: 12px;
		font-weight: 500;
		text-align: left;
		color: var(--color-foreground);
	}

	.options-toggle:hover {
		background: var(--color-accent);
	}

	:global(.source-badge) {
		font-size: 10px;
		margin-left: auto;
	}

	.options-editor {
		padding: 12px;
		background: var(--color-background);
	}

	.options-list {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	.option-row {
		display: flex;
		align-items: center;
		gap: 8px;
	}

	:global(.drag-handle) {
		color: var(--color-muted-foreground);
		cursor: grab;
		flex-shrink: 0;
	}

	:global(.option-input) {
		flex: 1;
		height: 32px;
		font-size: 12px;
	}

	.option-delete-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 28px;
		height: 28px;
		border: none;
		border-radius: var(--radius-sm);
		background: transparent;
		color: var(--color-muted-foreground);
		cursor: pointer;
		flex-shrink: 0;
	}

	.option-delete-btn:hover {
		background: var(--color-destructive);
		color: var(--color-destructive-foreground);
	}

	.add-option-btn {
		display: flex;
		align-items: center;
		gap: 6px;
		margin-top: 8px;
		padding: 6px 12px;
		border: 1px dashed var(--color-border);
		border-radius: var(--radius-sm);
		background: transparent;
		color: var(--color-muted-foreground);
		cursor: pointer;
		font-size: 12px;
		width: 100%;
		justify-content: center;
	}

	.add-option-btn:hover {
		background: var(--color-muted);
		border-color: var(--color-muted-foreground);
		color: var(--color-foreground);
	}

	.source-config {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}

	.source-label {
		font-size: 11px;
		color: var(--color-muted-foreground);
	}

	.source-url-display {
		font-size: 11px;
		font-family: monospace;
		word-break: break-all;
		background: var(--color-muted);
		padding: 6px 8px;
		border-radius: var(--radius-sm);
	}

	/* Expression Config */
	.expression-config {
		padding: 12px;
		background: var(--color-background);
	}

	.expression-config-row {
		margin-bottom: 12px;
	}

	.config-label {
		display: flex;
		flex-direction: column;
		gap: 4px;
		font-size: 12px;
		color: var(--color-muted-foreground);
	}

	:global(.config-input) {
		height: 32px;
		font-size: 12px;
	}

	.expression-fields-list {
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		overflow: hidden;
	}

	.fields-header {
		display: grid;
		grid-template-columns: 1fr 80px 1fr 32px;
		gap: 8px;
		padding: 6px 10px;
		background: var(--color-muted);
		font-size: 11px;
		font-weight: 500;
		color: var(--color-muted-foreground);
	}

	.field-row {
		display: grid;
		grid-template-columns: 1fr 80px 1fr 32px;
		gap: 8px;
		padding: 8px 10px;
		border-top: 1px solid var(--color-border);
		font-size: 12px;
		align-items: center;
	}

	.field-name {
		font-family: monospace;
		font-size: 11px;
	}

	.field-type {
		color: var(--color-primary);
		font-size: 11px;
	}

	.field-label {
		color: var(--color-muted-foreground);
	}

	.field-index {
		font-family: monospace;
		color: var(--color-muted-foreground);
	}

	.field-edit-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 24px;
		height: 24px;
		border: none;
		border-radius: var(--radius-sm);
		background: transparent;
		color: var(--color-muted-foreground);
		cursor: pointer;
	}

	.field-edit-btn:hover {
		background: var(--color-muted);
		color: var(--color-foreground);
	}

	/* Source URL Editor */
	.source-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: 8px;
	}

	.remove-source-btn {
		display: flex;
		align-items: center;
		gap: 4px;
		padding: 4px 8px;
		background: transparent;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		cursor: pointer;
		font-size: 11px;
		color: var(--color-muted-foreground);
		transition: all 0.15s ease;
	}

	.remove-source-btn:hover {
		background: var(--color-destructive);
		color: var(--color-destructive-foreground);
		border-color: var(--color-destructive);
	}

	.source-url-editable {
		display: flex;
		align-items: center;
		gap: 8px;
		width: 100%;
		padding: 8px 12px;
		background: var(--color-muted);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		cursor: pointer;
		text-align: left;
		transition: all 0.15s ease;
	}

	.source-url-editable:hover {
		border-color: var(--color-ring);
		background: var(--color-accent);
	}

	.source-url-text {
		flex: 1;
		font-size: 11px;
		font-family: monospace;
		word-break: break-all;
		background: transparent;
	}

	:global(.source-url-editable .edit-icon) {
		opacity: 0;
		transition: opacity 0.15s ease;
		flex-shrink: 0;
	}

	:global(.source-url-editable:hover .edit-icon) {
		opacity: 0.5;
	}

	.options-actions {
		display: flex;
		gap: 8px;
		margin-top: 8px;
	}

	.options-actions .add-option-btn {
		flex: 1;
		margin-top: 0;
	}

	.add-source-btn {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 6px 12px;
		border: 1px dashed var(--color-border);
		border-radius: var(--radius-sm);
		background: transparent;
		color: var(--color-muted-foreground);
		cursor: pointer;
		font-size: 12px;
		flex: 1;
		justify-content: center;
	}

	.add-source-btn:hover {
		background: var(--color-primary);
		border-color: var(--color-primary);
		color: var(--color-primary-foreground);
		border-style: solid;
	}

	/* Component Picker */
	.component-picker-overlay {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.4);
		z-index: 100;
	}

	.component-picker {
		position: fixed;
		top: 50%;
		left: 50%;
		transform: translate(-50%, -50%);
		width: 90%;
		max-width: 600px;
		max-height: 80vh;
		background: var(--color-card);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.25);
		z-index: 101;
		display: flex;
		flex-direction: column;
		overflow: hidden;
	}

	.picker-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 16px;
		border-bottom: 1px solid var(--color-border);
	}

	.picker-header h4 {
		font-size: 16px;
		font-weight: 600;
		margin: 0;
	}

	.picker-close-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 28px;
		height: 28px;
		background: transparent;
		border: none;
		border-radius: var(--radius-sm);
		cursor: pointer;
		color: var(--color-muted-foreground);
	}

	.picker-close-btn:hover {
		background: var(--color-muted);
		color: var(--color-foreground);
	}

	.picker-search {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 12px 16px;
		border-bottom: 1px solid var(--color-border);
	}

	:global(.picker-search-icon) {
		color: var(--color-muted-foreground);
		flex-shrink: 0;
	}

	.picker-search-input {
		flex: 1;
		border: none;
		background: transparent;
		font-size: 14px;
		outline: none;
		color: var(--color-foreground);
	}

	.picker-search-input::placeholder {
		color: var(--color-muted-foreground);
	}

	.picker-list {
		flex: 1;
		overflow-y: auto;
		padding: 8px;
	}

	.picker-item {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		padding: 10px 12px;
		border-radius: var(--radius-md);
		transition: background-color 0.15s ease;
	}

	.picker-item:hover {
		background: var(--color-muted);
	}

	.picker-item-info {
		display: flex;
		align-items: center;
		gap: 10px;
		flex: 1;
		min-width: 0;
	}

	.picker-item-icon {
		width: 24px;
		height: 24px;
		flex-shrink: 0;
		border-radius: 4px;
	}

	.picker-item-text {
		display: flex;
		flex-direction: column;
		min-width: 0;
	}

	.picker-item-label {
		font-size: 13px;
		font-weight: 500;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.picker-item-path {
		font-size: 11px;
		color: var(--color-muted-foreground);
		font-family: monospace;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.picker-item-ports {
		display: flex;
		gap: 6px;
		flex-shrink: 0;
	}

	.picker-port-btn {
		padding: 4px 10px;
		background: var(--color-primary);
		color: var(--color-primary-foreground);
		border: none;
		border-radius: var(--radius-sm);
		font-size: 11px;
		font-weight: 500;
		cursor: pointer;
		transition: opacity 0.15s ease;
	}

	.picker-port-btn:hover {
		opacity: 0.9;
	}

	.picker-empty {
		padding: 32px 16px;
		text-align: center;
		color: var(--color-muted-foreground);
		font-size: 13px;
	}
</style>
