<script>
	import { Badge } from '$lib/components/ui/badge';
	import { Separator } from '$lib/components/ui/separator';

	let { schema } = $props();

	function getTypeDisplay(prop) {
		if (Array.isArray(prop.type)) {
			return prop.type.join(' | ');
		}
		if (prop.type === 'array' && prop.items) {
			return `array<${getTypeDisplay(prop.items)}>`;
		}
		if (prop.$ref) {
			return prop.$ref.replace('#/definitions/', '');
		}
		return prop.type || 'any';
	}

	function isRequired(key) {
		return schema.required?.includes(key) ?? false;
	}
</script>

<div class="space-y-4">
	{#if schema.type}
		<div class="flex items-center gap-2">
			<span class="text-sm font-medium">Type:</span>
			<Badge variant="outline">{schema.type}</Badge>
		</div>
	{/if}

	{#if schema.properties}
		<div class="space-y-3">
			<h4 class="text-sm font-medium">Properties:</h4>
			<div class="border rounded-md overflow-hidden">
				<table class="w-full text-sm">
					<thead class="bg-muted">
						<tr>
							<th class="text-left p-2 font-medium">Property</th>
							<th class="text-left p-2 font-medium">Type</th>
							<th class="text-left p-2 font-medium">Description</th>
						</tr>
					</thead>
					<tbody>
						{#each Object.entries(schema.properties) as [key, prop]}
							<tr class="border-t">
								<td class="p-2">
									<span class="font-mono">{key}</span>
									{#if isRequired(key)}
										<Badge variant="destructive" class="ml-2 text-xs">required</Badge>
									{/if}
								</td>
								<td class="p-2">
									<Badge variant="secondary" class="font-mono text-xs">
										{getTypeDisplay(prop)}
									</Badge>
									{#if prop.format}
										<Badge variant="outline" class="ml-1 text-xs">
											{prop.format}
										</Badge>
									{/if}
									{#if prop.enum}
										<div class="mt-1">
											<span class="text-xs text-muted-foreground">enum:</span>
											{#each prop.enum as val}
												<Badge variant="outline" class="ml-1 text-xs">{val}</Badge>
											{/each}
										</div>
									{/if}
								</td>
								<td class="p-2 text-muted-foreground">
									{prop.title || prop.description || '-'}
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		</div>
	{/if}

	{#if schema.definitions}
		<div class="space-y-3">
			<h4 class="text-sm font-medium">Definitions:</h4>
			{#each Object.entries(schema.definitions) as [defKey, defSchema]}
				<div class="border rounded-md p-3">
					<div class="flex items-center gap-2 mb-2">
						<span class="font-mono font-medium">{defKey}</span>
						{#if defSchema.type}
							<Badge variant="outline">{defSchema.type}</Badge>
						{/if}
					</div>
					{#if defSchema.properties}
						<div class="text-xs space-y-1 pl-2 border-l-2 border-muted">
							{#each Object.entries(defSchema.properties) as [propKey, propSchema]}
								<div class="flex items-center gap-2">
									<span class="font-mono">{propKey}:</span>
									<Badge variant="secondary" class="text-xs">
										{getTypeDisplay(propSchema)}
									</Badge>
								</div>
							{/each}
						</div>
					{/if}
					{#if defSchema.oneOf}
						<div class="text-xs mt-2">
							<span class="text-muted-foreground">oneOf:</span>
							{#each defSchema.oneOf as opt}
								<Badge variant="outline" class="ml-1">{getTypeDisplay(opt)}</Badge>
							{/each}
						</div>
					{/if}
					{#if defSchema.anyOf}
						<div class="text-xs mt-2">
							<span class="text-muted-foreground">anyOf:</span>
							{#each defSchema.anyOf as opt}
								<Badge variant="outline" class="ml-1">{getTypeDisplay(opt)}</Badge>
							{/each}
						</div>
					{/if}
				</div>
			{/each}
		</div>
	{/if}
</div>
