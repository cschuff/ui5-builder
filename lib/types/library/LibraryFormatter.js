const log = require("@ui5/logger").getLogger("types:library:LibraryFormatter");
const path = require("path");
const fs = require("graceful-fs");
const AbstractUi5Formatter = require("../AbstractUi5Formatter");
const {promisify} = require("util");
const readFile = promisify(fs.readFile);
const glob = require("globby");


class LibraryFormatter extends AbstractUi5Formatter {
	/**
	 * Formats and validates the project
  	 *
	 * @returns {Promise}
	 */
	async format() {
		const project = this._project;
		await this.validate();

		log.verbose("Formatting library project %s...", project.metadata.name);
		project.resources.pathMappings = {
			"/resources/": project.resources.configuration.paths.src
		};

		if (project.resources.configuration.paths.test) {
			// Directory 'test' is somewhat optional for libraries
			project.resources.pathMappings["/test-resources/"] = project.resources.configuration.paths.test;
		} else {
			log.verbose(`Ignoring 'test' directory for project ${project.metadata.name}.` +
				"Either no setting was provided or the path not found.");
		}

		project.metadata.namespace = await this.getNamespace();
		project.metadata.copyright = await this.getCopyright();
	}

	/**
	 * Returns the base *source* path of the project. Runtime resources like manifest.json are expected
	 * to be located inside this path.
	 *
	 * @abstract
	 * @returns {string} Base source path of the project
	 */
	getSourceBasePath() {
		return this._project.resources.pathMappings["/resources/"];
	}

	async getNamespace() {
		let appId;
		try {
			const manifest = await this.getManifest();
			// check for a proper sap.app/id in manifest.json to determine namespace
			if (manifest["sap.app"] && manifest["sap.app"].id) {
				appId = manifest["sap.app"] && manifest["sap.app"].id;
			} else {
				log.verbose(
					`No "sap.app" ID configuration found in manifest.json of project ${this._project.metadata.name}`);
			}
		} catch (err) {
			log.verbose(`Namespace resolution from manifest.json failed for project ` +
				`${this._project.metadata.name}: ${err.message}`);
			log.verbose(`Falling back to .library file...`);
		}

		if (!appId) {
			try {
				const dotLibrary = await this.getDotLibrary();
				if (dotLibrary && dotLibrary.library && dotLibrary.library.name) {
					appId = dotLibrary.library.name;
				} else {
					log.verbose(
						`No library name found in .library of project ${this._project.metadata.name}`);
				}
			} catch (err) {
				// TODO 2.0: Throw error if namespace can not be resolved
				log.verbose(`Namespace resolution from .library failed for project ` +
					`${this._project.metadata.name}: ${err.message}`);
			}
		}

		if (appId && this.hasMavenPlaceholder(appId)) {
			try {
				appId = await this.resolveMavenPlaceholder(appId);
			} catch (err) {
				// TODO 2.0: Throw error if namespace can not be resolved
				log.warn(`Failed to resolve namespace of project ${this._project.metadata.name}: ${err.message}`);
				appId = null;
			}
		}

		if (!appId) {
			return null;
		}

		const namespace = appId.replace(/\./g, "/");
		log.verbose(`Namespace of project ${this._project.metadata.name} is ${namespace}`);
		return namespace;
	}

	async getCopyright() {
		if (this._project.metadata.copyright) {
			return this._project.metadata.copyright;
		}
		// If no copyright replacement was provided by ui5.yaml,
		// check if the .library file has a valid copyright replacement
		const dotLibrary = await this.getDotLibrary();
		if (dotLibrary && dotLibrary.library && dotLibrary.library.copyright) {
			log.verbose(`Using copyright from .library for project ${this._project.metadata.name}...`);
			return dotLibrary.library.copyright;
		}
	}

	/**
	 * Reads the .library file
	 *
	 * @returns {Promise<Object>} resolves with the json object
	 */
	async getDotLibrary() {
		if (this._pDotLibrary) {
			return this._pDotLibrary;
		}
		const basePath = path.join(this._project.path, this._project.resources.pathMappings["/resources/"]);
		return this._pDotLibrary = glob("**/.library", {
			cwd: basePath
		}).then(async (dotLibraryResources) => {
			if (!dotLibraryResources.length) {
				throw new Error(`Could not find .library file for project ${this._project.id}`);
			}
			if (dotLibraryResources.length > 1) {
				throw new Error(`Found multiple (${dotLibraryResources.length}) .library files ` +
					`for project ${this._project.id}`);
			}
			const fsPath = path.join(basePath, dotLibraryResources[0]);
			const content = await readFile(fsPath);
			const xml2js = require("xml2js");
			const parser = new xml2js.Parser({
				explicitArray: false,
				ignoreAttrs: true
			});
			const readXML = promisify(parser.parseString);
			return readXML(content);
		});
	}

	/**
	 * Validate the project
	 *
	 * @returns {Promise}
	 */
	validate() {
		const project = this._project;
		return Promise.resolve().then(() => {
			if (!project) {
				throw new Error("Project is undefined");
			} else if (!project.metadata || !project.metadata.name) {
				throw new Error(`"metadata.name" configuration is missing for project ${project.id}`);
			} else if (!project.type) {
				throw new Error(`"type" configuration is missing for project ${project.id}`);
			} else if (project.version === undefined) {
				throw new Error(`"version" is missing for project ${project.id}`);
			}
			if (!project.resources) {
				project.resources = {};
			}
			if (!project.resources.configuration) {
				project.resources.configuration = {};
			}
			if (!project.resources.configuration.paths) {
				project.resources.configuration.paths = {};
			}
			if (!project.resources.configuration.paths.src) {
				project.resources.configuration.paths.src = "src";
			}
			if (!project.resources.configuration.paths.test) {
				project.resources.configuration.paths.test = "test";
			}

			const absoluteSrcPath = path.join(project.path, project.resources.configuration.paths.src);
			const absoluteTestPath = path.join(project.path, project.resources.configuration.paths.test);
			return Promise.all([
				this.dirExists(absoluteSrcPath).then(function(bExists) {
					if (!bExists) {
						throw new Error(`Could not find source directory of project ${project.id}: ` +
							`${absoluteSrcPath}`);
					}
				}),
				this.dirExists(absoluteTestPath).then(function(bExists) {
					if (!bExists) {
						log.verbose(`Could not find (optional) test directory of project ${project.id}: ` +
							`${absoluteSrcPath}`);
						// Current signal to following consumers that "test" is not available is null
						project.resources.configuration.paths.test = null;
					}
				})
			]);
		});
	}
}

module.exports = LibraryFormatter;
