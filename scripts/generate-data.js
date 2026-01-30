import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const CONNECTORS_PATH = process.env.CONNECTORS_PATH || '/Users/vladimir/Projects/appmixer-connectors/src/appmixer';
const OUTPUT_PATH = path.join(__dirname, '..', 'src', 'lib', 'data', 'connectors.json');

function listConnectors() {
	try {
		const entries = fs.readdirSync(CONNECTORS_PATH, { withFileTypes: true });
		return entries.filter((e) => e.isDirectory()).map((e) => e.name);
	} catch {
		return [];
	}
}

function listModules(connector) {
	const connectorPath = path.join(CONNECTORS_PATH, connector);
	try {
		const entries = fs.readdirSync(connectorPath, { withFileTypes: true });
		return entries.filter((e) => e.isDirectory()).map((e) => e.name);
	} catch {
		return [];
	}
}

function listComponents(connector, module) {
	const modulePath = path.join(CONNECTORS_PATH, connector, module);
	try {
		const entries = fs.readdirSync(modulePath, { withFileTypes: true });
		return entries
			.filter((e) => e.isDirectory())
			.filter((e) => {
				const componentJsonPath = path.join(modulePath, e.name, 'component.json');
				return fs.existsSync(componentJsonPath);
			})
			.map((e) => e.name);
	} catch {
		return [];
	}
}

function getComponentJson(connector, module, component) {
	const componentJsonPath = path.join(
		CONNECTORS_PATH,
		connector,
		module,
		component,
		'component.json'
	);
	try {
		const content = fs.readFileSync(componentJsonPath, 'utf-8');
		return JSON.parse(content);
	} catch {
		return null;
	}
}

function generateConnectorTree() {
	const connectors = [];
	const connectorNames = listConnectors();

	console.log(`Found ${connectorNames.length} connectors`);

	for (const connectorName of connectorNames) {
		const modules = [];
		const moduleNames = listModules(connectorName);

		for (const moduleName of moduleNames) {
			const components = [];
			const componentNames = listComponents(connectorName, moduleName);

			for (const componentName of componentNames) {
				const componentJson = getComponentJson(connectorName, moduleName, componentName);
				if (componentJson) {
					components.push({
						name: componentName,
						label: componentJson.label,
						path: `${connectorName}/${moduleName}/${componentName}`,
						componentJson
					});
				}
			}

			if (components.length > 0) {
				modules.push({
					name: moduleName,
					components
				});
			}
		}

		if (modules.length > 0) {
			connectors.push({
				name: connectorName,
				modules
			});
		}
	}

	return { connectors };
}

// Ensure output directory exists
const outputDir = path.dirname(OUTPUT_PATH);
if (!fs.existsSync(outputDir)) {
	fs.mkdirSync(outputDir, { recursive: true });
}

console.log('Generating connector data...');
const tree = generateConnectorTree();
console.log(`Generated data for ${tree.connectors.length} connectors`);

const totalComponents = tree.connectors.reduce(
	(acc, c) => acc + c.modules.reduce((a, m) => a + m.components.length, 0),
	0
);
console.log(`Total components: ${totalComponents}`);

fs.writeFileSync(OUTPUT_PATH, JSON.stringify(tree, null, 2));
console.log(`Data written to ${OUTPUT_PATH}`);
