import { rimraf } from '../../utils/filesystem.js';
import { parse_route_id } from '../../utils/routing.js';
import { write } from './utils.js';
import fs from 'fs';
import path from 'path';

/**
 * @param {string} imports
 * @param {number} dots
 */
const header = (imports, dots) => `
// this file is auto-generated
import type { ${imports} } from '@sveltejs/kit';
import type { JsonResponses } from '${Array(dots).fill('..').join('/')}/fetch';`;

/** @param {string} arg */
const endpoint = (arg) => `
export type RequestHandler<Output = ResponseBody> = GenericRequestHandler<${arg}, Output>;`;

/** @param {string} arg */
const page = (arg) => `
export type Load<
	InputProps extends Record<string, any> = Record<string, any>,
	OutputProps extends Record<string, any> = InputProps
> = GenericLoad<${arg}, InputProps, OutputProps, JsonResponses>;`;

/**
 * @param {import('types').ValidatedConfig} config
 * @param {import('types').ManifestData} manifest_data
 */
export function write_types(config, manifest_data) {
	rimraf(`${config.kit.outDir}/types`);

	write_generic_fetch(config, manifest_data);

	/** @type {Map<string, { params: string[], type: 'page' | 'endpoint' | 'both' }>} */
	const shadow_types = new Map();

	manifest_data.routes.forEach((route) => {
		const file = route.type === 'endpoint' ? route.file : route.shadow;

		if (file) {
			const ext = /** @type {string} */ (
				config.kit.moduleExtensions.find((ext) => file.endsWith(ext))
			);
			const key = file.slice(0, -ext.length);
			shadow_types.set(key, {
				params: parse_route_id(key).names,
				type: route.type === 'endpoint' ? 'endpoint' : 'both'
			});
		}
	});

	manifest_data.components.forEach((component) => {
		if (component.startsWith('.')) return; // exclude fallback components

		const ext = /** @type {string} */ (config.extensions.find((ext) => component.endsWith(ext)));
		const key = component.slice(0, -ext.length);

		if (!shadow_types.has(key)) {
			shadow_types.set(key, { params: parse_route_id(key).names, type: 'page' });
		}
	});

	shadow_types.forEach(({ params, type }, key) => {
		const arg =
			params.length > 0 ? `{ ${params.map((param) => `${param}: string`).join('; ')} }` : '{}';

		const imports = [];
		const content = [];

		if (type !== 'page') {
			imports.push('RequestHandler as GenericRequestHandler, ResponseBody');
			content.push(endpoint(arg));
		}

		if (type !== 'endpoint') {
			imports.push('Load as GenericLoad');
			content.push(page(arg));
		}

		content.unshift(header(imports.join(', '), key.split('/').length));

		const parts = (key || 'index').split('/');
		parts.push('__types', /** @type {string} */ (parts.pop()));

		write(`${config.kit.outDir}/types/${parts.join('/')}.d.ts`, content.join('\n').trim());
	});
}


/**
 * @param {string[]} types
 */
const generic_fetch = (types) => `
// this file is auto-generated
import type { GenericResponse, GenericRequestInit, GenericJsonResponse } from '@sveltejs/kit';

export type JsonResponses = {
${types.join('\n')}
} & GenericJsonResponse;

declare global {
	export function fetch<
		Input extends string = string,
		Method extends string = "GET"
	>(
		input: Input,
		init?: GenericRequestInit<Method>
	): Promise<GenericResponse<JsonResponses, Input, Method>>;
}`;

/**
 * @param {import('types').ValidatedConfig} config
 * @param {import('types').ManifestData} manifest_data
 */
const write_generic_fetch = (config, manifest_data) => {
	const endpoints = /** @type {import('types').EndpointData[]} */ (
		manifest_data.routes.filter(({type}) => type === 'endpoint')
	);
	const fetch_types = endpoints.map(({file, id}) => {
		const file_path = path.resolve(file);
		const contents = fs.readFileSync(file_path, 'utf8');
		const methods = /** @type {Array<import('types').HttpMethod>} */ (['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD']);
		const method_types = methods.map(method => {
			const regex = new RegExp(`export\\s+(type|interface)\\s+${method}Type`);
			if (!regex.test(contents))
				return `        ${method.toLowerCase()}: any;`;
			return `        ${method.toLowerCase()}: import('../../${file.replace(/\.ts$/, '')}').${method}Type;`;
		});
		return `    '/${id}': {\n${method_types.join('\n')}\n    };`;
	});
	write(`${config.kit.outDir}/types/fetch.d.ts`, generic_fetch(fetch_types).trim());
}