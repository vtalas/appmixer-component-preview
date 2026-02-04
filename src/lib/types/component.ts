export interface InspectorInput {
	type:
		| 'text'
		| 'textarea'
		| 'number'
		| 'date-time'
		| 'select'
		| 'toggle'
		| 'expression'
		| 'filepicker';
	label?: string;
	tooltip?: string;
	index?: number;
	group?: string;
	defaultValue?: unknown;
	required?: boolean;
	source?: {
		url: string;
		data?: Record<string, unknown>;
	};
	options?: Array<{ label: string; value: string }>;
	when?: Record<string, unknown>;
	levels?: string[];
	fields?: Record<string, InspectorInput>;
	exclusiveFields?: string[];
	config?: Record<string, unknown>;
}

export interface InspectorGroup {
	label: string;
	index?: number;
	closed?: boolean;
}

export interface Inspector {
	inputs?: Record<string, InspectorInput>;
	groups?: Record<string, InspectorGroup>;
}

export interface SchemaProperty {
	type?: string | string[];
	title?: string;
	description?: string;
	format?: string;
	enum?: string[];
	items?: SchemaProperty;
	properties?: Record<string, SchemaProperty>;
	required?: string[];
	$ref?: string;
	oneOf?: SchemaProperty[];
	anyOf?: SchemaProperty[];
}

export interface Schema {
	type?: string;
	properties?: Record<string, SchemaProperty>;
	required?: string[];
	definitions?: Record<string, SchemaProperty>;
}

export interface Port {
	name: string;
	schema?: Schema;
	inspector?: Inspector;
	options?: Array<{ label: string; value: string }>;
	source?: {
		url: string;
		data?: Record<string, unknown>;
	};
}

export interface Quota {
	manager: string;
	resources: string | string[];
	maxWait?: number;
	concurrency?: number;
	scope?: Record<string, string>;
}

export interface ComponentJson {
	name: string;
	description?: string;
	author?: string;
	version?: string;
	label?: string;
	private?: boolean;
	trigger?: boolean;
	webhook?: boolean;
	tick?: boolean;
	auth?: {
		service: string;
		scope?: string[];
	};
	quota?: Quota;
	inPorts?: Port[];
	properties?: {
		schema?: Schema;
		inspector?: Inspector;
	};
	outPorts?: Port[];
	icon?: string;
}

export interface ConnectorComponent {
	name: string;
	label?: string;
	path: string;
	componentJson: ComponentJson;
}

export interface ConnectorModule {
	name: string;
	components: ConnectorComponent[];
}

export interface Connector {
	name: string;
	label?: string;
	icon?: string;
	modules: ConnectorModule[];
}

export interface ConnectorTree {
	connectors: Connector[];
}
