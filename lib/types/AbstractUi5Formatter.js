const log = require("@ui5/logger").getLogger("types:AbstractUi5Formatter");
const path = require("path");
const fs = require("graceful-fs");
const AbstractFormatter = require("./AbstractFormatter");
const {promisify} = require("util");
const readFile = promisify(fs.readFile);


class AbstractUi5Formatter extends AbstractFormatter {
	/**
	 * Constructor
	 *
	 * @param {Object} parameters
	 * @param {Object} parameters.project Project
	 */
	constructor(parameters) {
		super(parameters);
		if (new.target === AbstractUi5Formatter) {
			throw new TypeError("Class 'AbstractUi5Formatter' is abstract");
		}
	}

	/**
	 * Returns the base *source* path of the project. Runtime resources like manifest.json are expected
	 * to be located inside this path.
	 *
	 * @abstract
	 * @returns {string} Base source path of the project
	 */
	getSourceBasePath() {
		throw new Error("Function getSourceBasePath Not implemented");
	}

	hasMavenPlaceholder(value) {
		return !!value.match(/^\$\{(.*)\}$/);
	}

	/**
	 * Resolves maven placeholders in strings from projects pom.xml
	 *
	 * @param {string} value String containing a maven placeholder
	 * @returns {Promise<string>} Resolved string
	 */
	async resolveMavenPlaceholder(value) {
		const parts = value && value.match(/^\$\{(.*)\}$/);
		if (parts) {
			log.verbose(`"${value} contains a maven placeholder "${parts[1]}". Resolving from projects pom.xml...`);
			const pom = await this.getPom();
			let mvnValue;
			if (pom.project && pom.project.properties && pom.project.properties[parts[1]]) {
				mvnValue = pom.project.properties[parts[1]];
			} else {
				let obj = pom;
				parts[1].split(".").forEach((part) => {
					obj = obj && obj[part];
				});
				mvnValue = obj;
			}
			if (!mvnValue) {
				throw new Error(`"${value}" couldn't be resolved from maven property ` +
					`"${parts[1]}" of pom.xml of project ${this._project.metadata.name}`);
			}
			return mvnValue;
		} else {
			throw new Error(`"${value}" does not contain any maven placeholder`);
		}
	}

	/**
	 * Reads the manifest
	 *
	 * @returns {Promise<Object>} resolves with the json object
	 */
	async getManifest() {
		if (this._pManifest) {
			return this._pManifest;
		}
		const fsPath = path.join(this._project.path, this.getSourceBasePath(), "manifest.json");
		return this._pManifest = readFile(fsPath).then(
			(content) => JSON.parse(content),
			(err) => {
				throw new Error(
					`Failed to read manifest.json for project ${this._project.metadata.name}: ${err.message}`);
			});
	}

	/**
	 * Reads the pom.xml file
	 *
	 * @returns {Promise<Object>} resolves with the XML document from the pom.xml
	 */
	async getPom() {
		if (this._pPom) {
			return this._pPom;
		}
		const fsPath = path.join(this._project.path, "pom.xml");
		return this._pPom = readFile(fsPath).then(async (content) => {
			const xml2js = require("xml2js");
			const parser = new xml2js.Parser({
				explicitArray: false,
				ignoreAttrs: true
			});
			const readXML = promisify(parser.parseString);
			return readXML(content);
		});
	}
}

module.exports = AbstractUi5Formatter;
