const log = require("@ui5/logger").getLogger("builder:tasks:jsdoc:generateJsdoc");
const path = require("path");
const makeDir = require("make-dir");
const os = require("os");
const fs = require("graceful-fs");
const {promisify} = require("util");
const mkdtemp = promisify(fs.mkdtemp);
const rimraf = promisify(require("rimraf"));
const jsdocGenerator = require("../../processors/jsdoc/jsdocGenerator");
const {resourceFactory} = require("@ui5/fs");

/**
 * Task to execute a JSDoc build for UI5 projects
 *
 * @public
 * @alias module:@ui5/builder.tasks.generateJsdoc
 * @param {Object} parameters Parameters
 * @param {module:@ui5/fs.DuplexCollection} parameters.workspace DuplexCollection to read and write files
 * @param {module:@ui5/fs.AbstractReader} parameters.dependencies Reader or Collection to read dependency files
 * @param {Object} parameters.options Options
 * @param {string|Array} parameters.options.pattern Pattern to locate the files to be processed
 * @param {string} parameters.options.projectName Project name
 * @param {string} parameters.options.namespace Namespace to build (e.g. <code>some/project/name</code>)
 * @param {string} parameters.options.version Project version
 * @returns {Promise<undefined>} Promise resolving with <code>undefined</code> once data has been written
 */
const generateJsdoc = async function({buildContext, workspace, dependencies, options} = {}) {
	if (!options || !options.projectName || !options.namespace || !options.version || !options.pattern) {
		throw new Error("[generateJsdoc]: One or more mandatory options not provided");
	}

	const {sourcePath: resourcePath, targetPath, tmpPath, cleanup} =
		await generateJsdoc._createTmpDirs(options.projectName);

	buildContext.registerCleanupTask(cleanup);

	const [writtenResourcesCount] = await Promise.all([
		generateJsdoc._writeResourcesToDir({
			workspace,
			pattern: options.pattern,
			targetPath: resourcePath
		}),
		generateJsdoc._writeDependencyApisToDir({
			dependencies,
			targetPath: path.posix.join(tmpPath, "dependency-apis")
		})
	]);

	if (writtenResourcesCount === 0) {
		log.info(`Failed to find any input resources for project ${options.projectName} using pattern ` +
			`${options.pattern}. Skipping JSDoc generation...`);
		return;
	}

	const createdResources = await jsdocGenerator({
		sourcePath: resourcePath,
		targetPath,
		tmpPath,
		options: {
			projectName: options.projectName,
			namespace: options.namespace,
			version: options.version,
			variants: ["apijson"]
		}
	});

	await Promise.all(createdResources.map((resource) => {
		return workspace.write(resource);
	}));
};

/**
 * Create temporary directories for JSDoc generation processor
 *
 * @private
 * @param {string} projectName Project name used for naming the temporary working directory
 * @returns {Promise<Object>} Promise resolving with sourcePath, targetPath and tmpPath strings
 */
async function createTmpDirs(projectName) {
	const tmpDirPath = await generateJsdoc._createTmpDir(projectName);

	const sourcePath = path.join(tmpDirPath, "src"); // dir will be created by writing project resources below
	await makeDir(sourcePath, {fs});
	const targetPath = path.join(tmpDirPath, "target"); // dir will be created by jsdoc itself
	await makeDir(targetPath, {fs});

	const tmpPath = path.join(tmpDirPath, "tmp"); // dir needs to be created by us
	await makeDir(tmpPath, {fs});

	return {
		sourcePath,
		targetPath,
		tmpPath,
		cleanup: async () => {
			return rimraf(tmpDirPath);
		}
	};
}

/**
 * Create a temporary directory on the host system
 *
 * @private
 * @param {string} projectName Project name used for naming the temporary directory
 * @returns {Promise<string>} Promise resolving with path of the temporary directory
 */
async function createTmpDir(projectName) {
	const sanitizedProjectName = projectName.replace(/[^A-Za-z0-9]/g, "");

	const tmpRootPath = path.join(os.tmpdir(), "ui5-tooling");
	await makeDir(tmpRootPath, {fs});

	// Appending minus sign also because node docs advise to "avoid trailing X characters in prefix"
	return mkdtemp(path.join(tmpRootPath, `jsdoc-${sanitizedProjectName}-`));
}

/**
 * Write resources from workspace matching the given pattern to the given fs destination
 *
 * @private
 * @param {Object} parameters Parameters
 * @param {module:@ui5/fs.DuplexCollection} parameters.workspace DuplexCollection to read and write files
 * @param {string} parameters.pattern Pattern to match resources in workspace against
 * @param {string} parameters.targetPath Path to write the resources to
 * @returns {Promise<number>} Promise resolving with number of resources written to given directory
 */
async function writeResourcesToDir({workspace, pattern, targetPath}) {
	const fsTarget = resourceFactory.createAdapter({
		fsBasePath: targetPath,
		virBasePath: "/resources/"
	});

	let allResources;
	if (workspace.byGlobSource) { // API only available on duplex collections
		allResources = await workspace.byGlobSource(pattern);
	} else {
		allResources = await workspace.byGlob(pattern);
	}

	// write all resources to the tmp folder
	await Promise.all(allResources.map((resource) => fsTarget.write(resource)));
	return allResources.length;
}

/**
 * Write api.json files of dependencies to given target path in a flat structure
 *
 * @private
 * @param {Object} parameters Parameters
 * @param {module:@ui5/fs.AbstractReader} parameters.dependencies Reader or Collection to read dependency files
 * @param {string} parameters.targetPath Path to write the resources to
 * @returns {Promise<number>} Promise resolving with number of resources written to given directory
 */
async function writeDependencyApisToDir({dependencies, targetPath}) {
	const depApis = await dependencies.byGlob("/test-resources/**/designtime/api.json");

	// Clone resources before changing their path
	const apis = await Promise.all(depApis.map((resource) => resource.clone()));

	for (let i = 0; i < apis.length; i++) {
		apis[i].setPath(`/api-${i}.json`);
	}

	const fsTarget = resourceFactory.createAdapter({
		fsBasePath: targetPath,
		virBasePath: "/"
	});
	await Promise.all(apis.map((resource) => fsTarget.write(resource)));
	return apis.length;
}

module.exports = generateJsdoc;
module.exports._createTmpDirs = createTmpDirs;
module.exports._createTmpDir = createTmpDir;
module.exports._writeResourcesToDir = writeResourcesToDir;
module.exports._writeDependencyApisToDir = writeDependencyApisToDir;
