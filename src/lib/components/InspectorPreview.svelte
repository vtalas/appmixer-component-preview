<script lang="ts">
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Button } from '$lib/components/ui/button';
	import { Badge } from '$lib/components/ui/badge';
	import * as Card from '$lib/components/ui/card';
	import { Separator } from '$lib/components/ui/separator';
	import {
		Type,
		AlignLeft,
		Hash,
		Calendar,
		List,
		ToggleLeft,
		FileText,
		Filter,
		Upload,
		HelpCircle
	} from 'lucide-svelte';
	import type { Inspector, InspectorInput, InspectorGroup, Schema } from '$lib/types/component';

	interface Props {
		inspector: Inspector;
		schema?: Schema;
	}

	let { inspector, schema }: Props = $props();

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

	function getTypeIcon(type: string) {
		switch (type) {
			case 'text':
				return Type;
			case 'textarea':
				return AlignLeft;
			case 'number':
				return Hash;
			case 'date-time':
				return Calendar;
			case 'select':
				return List;
			case 'toggle':
				return ToggleLeft;
			case 'filepicker':
				return Upload;
			case 'expression':
				return Filter;
			default:
				return FileText;
		}
	}

	function getSchemaType(key: string): string | undefined {
		if (!schema?.properties?.[key]) return undefined;
		const prop = schema.properties[key];
		if (Array.isArray(prop.type)) return prop.type.join(' | ');
		return prop.type;
	}
</script>

<div class="space-y-6">
	{#if sortedGroups.length > 0}
		<!-- Render grouped inputs -->
		{#each sortedGroups as [groupKey, group]}
			{@const groupInputs = groupedInputs.get(groupKey) || []}
			{#if groupInputs.length > 0}
				<div class="border rounded-lg p-4">
					<h4 class="font-medium mb-3">{group.label}</h4>
					<div class="space-y-4">
						{#each groupInputs as [key, input]}
							<InspectorField {key} {input} schemaType={getSchemaType(key)} />
						{/each}
					</div>
				</div>
			{/if}
		{/each}

		<!-- Render ungrouped inputs -->
		{@const ungroupedInputs = groupedInputs.get(null) || []}
		{#if ungroupedInputs.length > 0}
			<div class="space-y-4">
				{#each ungroupedInputs as [key, input]}
					<InspectorField {key} {input} schemaType={getSchemaType(key)} />
				{/each}
			</div>
		{/if}
	{:else}
		<!-- No groups defined, render all inputs -->
		<div class="space-y-4">
			{#each sortedInputs as [key, input]}
				<InspectorField {key} {input} schemaType={getSchemaType(key)} />
			{/each}
		</div>
	{/if}
</div>

{#snippet InspectorField(props: { key: string; input: InspectorInput; schemaType?: string })}
	{@const { key, input, schemaType } = props}
	{@const Icon = getTypeIcon(input.type)}
	<div class="space-y-2">
		<div class="flex items-center gap-2">
			<Icon class="h-4 w-4 text-muted-foreground" />
			<Label class="font-medium">{input.label || key}</Label>
			{#if input.required}
				<Badge variant="destructive" class="text-xs">Required</Badge>
			{/if}
			<Badge variant="outline" class="text-xs">{input.type}</Badge>
			{#if schemaType}
				<Badge variant="secondary" class="text-xs font-mono">{schemaType}</Badge>
			{/if}
			{#if input.tooltip}
				<span class="text-muted-foreground" title={input.tooltip}>
					<HelpCircle class="h-4 w-4" />
				</span>
			{/if}
		</div>

		<div class="pl-6">
			{#if input.type === 'text'}
				<Input
					placeholder={input.defaultValue?.toString() || `Enter ${input.label || key}...`}
					disabled
					class="max-w-md"
				/>
			{:else if input.type === 'textarea'}
				<textarea
					placeholder={input.defaultValue?.toString() || `Enter ${input.label || key}...`}
					disabled
					class="w-full max-w-md h-24 p-2 border rounded-md bg-muted/50 text-sm"
				></textarea>
			{:else if input.type === 'number'}
				<Input
					type="number"
					placeholder={input.defaultValue?.toString() || '0'}
					disabled
					class="max-w-[200px]"
				/>
			{:else if input.type === 'date-time'}
				<Input type="datetime-local" disabled class="max-w-[250px]" />
			{:else if input.type === 'select'}
				<div class="max-w-md">
					{#if input.options && input.options.length > 0}
						<select disabled class="w-full p-2 border rounded-md bg-muted/50 text-sm">
							<option>Select {input.label || key}...</option>
							{#each input.options as option}
								<option value={option.value}>{option.label}</option>
							{/each}
						</select>
					{:else if input.source}
						<div class="p-2 border rounded-md bg-muted/30 text-sm">
							<p class="text-muted-foreground">Dynamic options from:</p>
							<p class="font-mono text-xs mt-1 break-all">{input.source.url}</p>
						</div>
					{:else}
						<select disabled class="w-full p-2 border rounded-md bg-muted/50 text-sm">
							<option>Select {input.label || key}...</option>
						</select>
					{/if}
				</div>
			{:else if input.type === 'toggle'}
				<div class="flex items-center gap-2">
					<div
						class="w-10 h-6 rounded-full bg-muted border relative"
						role="switch"
						aria-checked={!!input.defaultValue}
						aria-label="Toggle switch preview"
					>
						<span class="absolute left-1 top-1 w-4 h-4 rounded-full bg-muted-foreground/50"></span>
					</div>
					<span class="text-sm text-muted-foreground">
						{input.defaultValue ? 'Enabled' : 'Disabled'}
					</span>
				</div>
			{:else if input.type === 'filepicker'}
				<Button variant="outline" disabled class="gap-2">
					<Upload class="h-4 w-4" />
					Choose File
				</Button>
			{:else if input.type === 'expression'}
				<div class="border rounded-md p-4 bg-muted/30">
					<div class="flex items-center gap-2 mb-3">
						<Filter class="h-4 w-4" />
						<span class="text-sm font-medium">Expression Builder</span>
						{#if input.levels}
							<Badge variant="outline" class="text-xs">
								Levels: {input.levels.join(', ')}
							</Badge>
						{/if}
					</div>
					{#if input.fields}
						<div class="space-y-3 pl-4 border-l-2 border-muted">
							{#each Object.entries(input.fields) as [fieldKey, field]}
								<div class="text-sm">
									<span class="font-medium">{field.label || fieldKey}</span>
									<Badge variant="secondary" class="ml-2 text-xs">{field.type}</Badge>
									{#if field.when}
										<span class="text-muted-foreground ml-2 text-xs">
											(conditional)
										</span>
									{/if}
								</div>
							{/each}
						</div>
					{/if}
				</div>
			{:else}
				<p class="text-sm text-muted-foreground">Unknown input type: {input.type}</p>
			{/if}

			{#if input.tooltip}
				<p class="text-xs text-muted-foreground mt-1">{input.tooltip}</p>
			{/if}

			{#if input.when}
				<p class="text-xs text-muted-foreground mt-1 italic">
					Conditional visibility: {JSON.stringify(input.when)}
				</p>
			{/if}
		</div>
	</div>
{/snippet}
