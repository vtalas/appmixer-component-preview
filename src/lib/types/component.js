/**
 * @typedef {Object} InspectorInput
 * @property {'text'|'textarea'|'number'|'date-time'|'select'|'toggle'|'expression'|'filepicker'} type
 * @property {string} [label]
 * @property {string} [tooltip]
 * @property {number} [index]
 * @property {string} [group]
 * @property {*} [defaultValue]
 * @property {boolean} [required]
 * @property {{ url: string, data?: Object }} [source]
 * @property {Array<{ label: string, value: string }>} [options]
 * @property {Object} [when]
 * @property {string[]} [levels]
 * @property {Record<string, InspectorInput>} [fields]
 * @property {string[]} [exclusiveFields]
 * @property {Object} [config]
 */

/**
 * @typedef {Object} InspectorGroup
 * @property {string} label
 * @property {number} [index]
 * @property {boolean} [closed]
 */

/**
 * @typedef {Object} Inspector
 * @property {Record<string, InspectorInput>} [inputs]
 * @property {Record<string, InspectorGroup>} [groups]
 */

/**
 * @typedef {Object} SchemaProperty
 * @property {string|string[]} [type]
 * @property {string} [title]
 * @property {string} [description]
 * @property {string} [format]
 * @property {string[]} [enum]
 * @property {SchemaProperty} [items]
 * @property {Record<string, SchemaProperty>} [properties]
 * @property {string[]} [required]
 * @property {string} [$ref]
 * @property {SchemaProperty[]} [oneOf]
 * @property {SchemaProperty[]} [anyOf]
 */

/**
 * @typedef {Object} Schema
 * @property {string} [type]
 * @property {Record<string, SchemaProperty>} [properties]
 * @property {string[]} [required]
 * @property {Record<string, SchemaProperty>} [definitions]
 */

/**
 * @typedef {Object} Port
 * @property {string} name
 * @property {Schema} [schema]
 * @property {Inspector} [inspector]
 * @property {Array<{ label: string, value: string }>} [options]
 * @property {{ url: string, data?: Object }} [source]
 */

/**
 * @typedef {Object} Quota
 * @property {string} manager
 * @property {string|string[]} resources
 * @property {number} [maxWait]
 * @property {number} [concurrency]
 * @property {Record<string, string>} [scope]
 */

/**
 * @typedef {Object} ComponentJson
 * @property {string} name
 * @property {string} [description]
 * @property {string} [author]
 * @property {string} [version]
 * @property {string} [label]
 * @property {boolean} [private]
 * @property {boolean} [trigger]
 * @property {boolean} [webhook]
 * @property {boolean} [tick]
 * @property {{ service: string, scope?: string[] }} [auth]
 * @property {Quota} [quota]
 * @property {Port[]} [inPorts]
 * @property {{ schema?: Schema, inspector?: Inspector }} [properties]
 * @property {Port[]} [outPorts]
 * @property {string} [icon]
 */

/**
 * @typedef {Object} ConnectorComponent
 * @property {string} name
 * @property {string} [label]
 * @property {string} path
 * @property {ComponentJson} componentJson
 */

/**
 * @typedef {Object} ConnectorModule
 * @property {string} name
 * @property {ConnectorComponent[]} components
 */

/**
 * @typedef {Object} Connector
 * @property {string} name
 * @property {string} [label]
 * @property {string} [icon]
 * @property {ConnectorModule[]} modules
 */

/**
 * @typedef {Object} ConnectorTree
 * @property {Connector[]} connectors
 */
